<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ProjectFileTree from '@/components/filetree/ProjectFileTree.vue'
import SkillPickerBar from '@/components/chat/SkillPickerBar.vue'
import MediaPlanCard from '@/components/chat/MediaPlanCard.vue'
import MediaTaskBubble from '@/components/chat/MediaTaskBubble.vue'
import SkillInstallCard from '@/components/chat/SkillInstallCard.vue'
import MemorySettings from './MemorySettings.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { useProjectStore } from '@/stores/projectStore'
import { onEvent } from '@/utils/eventBus'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import type { ProjectResourceOpenResult } from '@/services/projectExplorerService'
import { openProjectResource } from '@/services/projectExplorerService'
import {
  appendMemoryTurn,
  initializeMemoryProject,
  renameMemoryConversation,
} from '@/runtime/memory/memoryProject'
import { runMemoryChat } from '@/runtime/memory/memoryChat'
import {
  parseMediaPlan,
  updateMediaPlanParameters,
  type MediaPlan,
  type MediaPlanParameterPatch,
} from '@/runtime/workbench/mediaPlan'
import { preparePublicMediaPlan } from '@/runtime/workbench/mediaPlanBridge'
import {
  parseSkillInstallPlan,
  stripSkillInstallBlock,
  type SkillInstallPlan,
} from '@/runtime/memory/skillInstall'
import type { OpenCodeSkillOption } from '@/opencodeClient/catalog'
import { getPlainText, setEditorText } from '@/composables/useContentEditable'
import type { DirectMessageFile, ResolvedDirectAttachment } from '@/utils/directMessageBuilder'
import type { SkillConfig } from '@/types/skill'

const projectStore = useProjectStore()
const agentStore = useAgentStore()
const mediaTaskStore = useMediaTaskStore()
const files = createRuntimeProjectFileService()
const opened = ref<ProjectResourceOpenResult | null>(null)
const input = ref('')
const attachments = ref<ResolvedDirectAttachment[]>([])
const referencedFiles = ref<DirectMessageFile[]>([])
const selectedSkillName = ref('')
const skills = computed<OpenCodeSkillOption[]>(() => agentStore.getCustomSkills().map(skill => ({
  name: skill.name,
  label: skill.name,
  description: skill.description || undefined,
  location: `user-skill://${skill.id}`,
})))
const skillsLoading = ref(false)
const skillsError = ref('')
const sending = ref(false)
const streamingText = ref('')
const status = ref('')
const error = ref('')
const settingsOpen = ref(false)
const treeOpen = ref(true)
const messagesEl = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const mediaUrl = ref('')
const mediaPlans = ref<Record<string, MediaPlan>>({})
const mediaPlanStatus = ref<Record<string, 'ready' | 'submitting' | 'submitted' | 'failed'>>({})
const mediaPlanErrors = ref<Record<string, string>>({})
const mediaTasks = ref<Record<string, string>>({})
const skillInstallPlans = ref<Record<string, SkillInstallPlan>>({})
const skillInstallStatus = ref<Record<string, 'ready' | 'installing' | 'installed' | 'failed'>>({})
const skillInstallErrors = ref<Record<string, string>>({})
const mediaTaskResources = new Map<string, ProjectResourceOpenResult & { type: 'conversation' }>()
const recordedMediaTasks = new Set<string>()
let abortController: AbortController | null = null
let mediaObjectUrl = ''
let offOpenResource: (() => void) | null = null
let offToggleTree: (() => void) | null = null
let offMediaTaskSettled: (() => void) | null = null
let offReferenceFile: (() => void) | null = null

const conversation = computed(() => opened.value?.type === 'conversation' ? opened.value : null)
const title = computed(() => {
  if (conversation.value) return conversation.value.transcript.title
  return opened.value?.resource.name || projectStore.projectName.value || '韭菜盒子'
})
const textModels = computed(() => agentStore.textModels)

onMounted(async () => {
  offOpenResource = onEvent('memory:open-resource', resource => void openResource(resource as ProjectResourceOpenResult))
  offToggleTree = onEvent('toggle-file-tree', () => { treeOpen.value = !treeOpen.value })
  offMediaTaskSettled = onEvent('media-task-settled', payload => void recordMediaResult(payload))
  offReferenceFile = onEvent('reference-file', addReferencedFile)
  await Promise.all([
    refreshSkills(),
    agentStore.fetchModels({ skipOpenCode: true }).catch(() => {}),
    mediaTaskStore.init(),
  ])
  if (projectStore.webProjectId.value) {
    try {
      const first = await initializeMemoryProject(projectStore.webProjectId.value, files)
      await openResource(await openProjectResource(files, first.resource))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }
})

onBeforeUnmount(() => {
  offOpenResource?.()
  offToggleTree?.()
  offMediaTaskSettled?.()
  offReferenceFile?.()
  abortController?.abort()
  releaseMediaUrl()
})

watch(() => conversation.value?.transcript.turns.length, async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
})

async function openResource(resource: ProjectResourceOpenResult) {
  releaseMediaUrl()
  opened.value = resource
  error.value = ''
  if (!sending.value) status.value = ''
  streamingText.value = ''
  if (resource.type === 'conversation') {
    for (const turn of resource.transcript.turns) {
      if (turn.role !== 'assistant') continue
      try {
        mediaPlans.value[turn.id] = parseMediaPlan(turn.content)
        mediaPlanStatus.value[turn.id] ||= 'ready'
      } catch { /* ordinary assistant reply */ }
      try {
        skillInstallPlans.value[turn.id] = parseSkillInstallPlan(turn.content)
        skillInstallStatus.value[turn.id] ||= 'ready'
      } catch { /* ordinary assistant reply */ }
    }
  } else if (resource.type === 'media') {
    try {
      const binary = await files.readBinary(resource.resource)
      mediaObjectUrl = URL.createObjectURL(new Blob(
        [new Uint8Array(binary.data).buffer as ArrayBuffer],
        { type: binary.mimeType || resource.resource.mimeType },
      ))
      mediaUrl.value = mediaObjectUrl
    } catch {
      mediaUrl.value = ''
    }
  }
  if (window.innerWidth <= 760) treeOpen.value = false
}

async function send() {
  const active = conversation.value
  const message = input.value.trim()
  if (!active || !message || sending.value) return
  sending.value = true
  error.value = ''
  status.value = '正在保存你的消息'
  streamingText.value = ''
  abortController = new AbortController()
  try {
    let saved = await appendMemoryTurn(active.resource, 'user', message, files)
    if (saved.transcript.turns.filter(turn => turn.role === 'user').length === 1 && saved.transcript.title === '新对话') {
      saved = await renameMemoryConversation(saved.resource, message.replace(/\s+/g, ' ').slice(0, 28), files)
    }
    opened.value = await openProjectResource(files, saved.resource)
    input.value = ''
    setEditorText(composerRef.value, '')
    status.value = '正在查询 Wiki'
    const reply = await runMemoryChat({
      projectId: active.resource.owner,
      turns: saved.transcript.turns,
      modelId: agentStore.currentModel,
      selectedSkillName: selectedSkillName.value,
      attachments: attachments.value,
      files: referencedFiles.value,
      signal: abortController.signal,
      onTool(name) { status.value = name === 'skill' ? '正在加载查询 Skill' : '正在查询 Wiki' },
      onText(text) {
        status.value = '正在回复'
        streamingText.value = text
      },
    })
    const complete = await appendMemoryTurn(saved.resource, 'assistant', reply, files)
    opened.value = await openProjectResource(files, complete.resource)
    const turn = complete.transcript.turns.at(-1)
    if (turn?.role === 'assistant') {
      try {
        mediaPlans.value[turn.id] = parseMediaPlan(turn.content)
        mediaPlanStatus.value[turn.id] = 'ready'
      } catch { /* no media plan */ }
      try {
        skillInstallPlans.value[turn.id] = parseSkillInstallPlan(turn.content)
        skillInstallStatus.value[turn.id] = 'ready'
      } catch { /* no Skill install plan */ }
    }
    attachments.value = []
    referencedFiles.value = []
    streamingText.value = ''
    status.value = ''
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') status.value = '已停止'
    else {
      status.value = ''
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    sending.value = false
    abortController = null
  }
}

function stop() {
  abortController?.abort()
}

function addReferencedFile(payload: unknown) {
  const file = payload as DirectMessageFile | null
  if (!file?.name || !file.content || referencedFiles.value.some(item => item.name === file.name)) return
  referencedFiles.value.push({ name: file.name, content: file.content })
}

function resetComposer() {
  const editor = composerRef.value
  if (!editor) return
  editor.style.height = ''
  editor.style.overflowY = 'hidden'
  editor.scrollTop = 0
}

function resizeComposer() {
  const editor = composerRef.value
  if (!editor || !input.value) {
    resetComposer()
    return
  }
  const maxHeight = window.innerWidth <= 760 ? 120 : Math.min(220, Math.floor(window.innerHeight * 0.3))
  editor.style.height = 'auto'
  editor.style.height = `${Math.min(editor.scrollHeight, maxHeight)}px`
  editor.style.overflowY = editor.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function handleComposerInput(event: Event) {
  input.value = getPlainText(event.currentTarget as HTMLElement)
  resizeComposer()
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}

async function refreshSkills() {
  skillsLoading.value = true
  skillsError.value = ''
  try {
    await agentStore.refreshSkills()
    if (selectedSkillName.value && !skills.value.some(skill => skill.name === selectedSkillName.value)) {
      selectedSkillName.value = ''
    }
  } catch (cause) {
    skillsError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    skillsLoading.value = false
  }
}

async function selectFiles(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files || [])
  attachments.value = await Promise.all(selected.map(async file => ({
    id: `${file.name}-${file.lastModified}-${file.size}`,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio' : 'file',
    value: await readDataUrl(file),
  })))
  ;(event.target as HTMLInputElement).value = ''
}

async function approveMediaPlan(turnId: string) {
  const plan = mediaPlans.value[turnId]
  if (!plan || !conversation.value) return
  mediaPlanStatus.value[turnId] = 'submitting'
  mediaPlanErrors.value[turnId] = ''
  try {
    const prepared = await preparePublicMediaPlan({ plan, owner: conversation.value.resource.owner })
    const taskId = await mediaTaskStore.submitTask({
      ...prepared.submission,
      chatMessageId: turnId,
    })
    mediaTasks.value[turnId] = taskId
    mediaTaskResources.set(taskId, conversation.value)
    mediaPlanStatus.value[turnId] = 'submitted'
    const updated = await appendMemoryTurn(
      conversation.value.resource,
      'assistant',
      `[媒体任务]\n任务 ${taskId} 已提交：${plan.title}`,
      files,
    )
    opened.value = await openProjectResource(files, updated.resource)
  } catch (cause) {
    mediaPlanStatus.value[turnId] = 'failed'
    mediaPlanErrors.value[turnId] = cause instanceof Error ? cause.message : String(cause)
  }
}

async function recordMediaResult(payload: unknown) {
  const result = payload as { taskId?: string; status?: string; url?: string; text?: string; errorMsg?: string }
  const taskId = String(result.taskId || '')
  const target = mediaTaskResources.get(taskId)
  if (!target || recordedMediaTasks.has(taskId)) return
  recordedMediaTasks.add(taskId)
  const summary = result.status === 'success'
    ? `[媒体结果]\n任务 ${taskId} 已完成。\n${result.url || result.text || ''}`
    : `[媒体结果]\n任务 ${taskId} 失败：${result.errorMsg || '未知错误'}`
  try {
    const updated = await appendMemoryTurn(target.resource, 'assistant', summary, files)
    if (conversation.value?.resource.owner === target.resource.owner
      && conversation.value.resource.path === target.resource.path) {
      opened.value = await openProjectResource(files, updated.resource)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function updatePlan(turnId: string, patch: MediaPlanParameterPatch) {
  try {
    mediaPlans.value[turnId] = updateMediaPlanParameters(mediaPlans.value[turnId], patch)
    mediaPlanErrors.value[turnId] = ''
  } catch (cause) {
    mediaPlanErrors.value[turnId] = cause instanceof Error ? cause.message : String(cause)
  }
}

function installedSkill(plan: SkillInstallPlan): SkillConfig | undefined {
  return agentStore.getCustomSkills().find(skill => skill.id === plan.id)
}

function isSkillPlanInstalled(plan: SkillInstallPlan): boolean {
  return installedSkill(plan)?.skillContent.trim() === plan.skillMd.trim()
}

async function approveSkillInstall(turnId: string) {
  const plan = skillInstallPlans.value[turnId]
  if (!plan || isSkillPlanInstalled(plan)) return
  skillInstallStatus.value[turnId] = 'installing'
  skillInstallErrors.value[turnId] = ''
  const existing = installedSkill(plan)
  try {
    await agentStore.createAgent({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      triggers: plan.triggers,
      skillContent: plan.skillMd,
      references: existing?.references || [],
      examples: existing?.examples || [],
      version: existing ? existing.version + 1 : 1,
      source: 'user',
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      evolutionLog: existing?.evolutionLog || [],
    })
    skillInstallStatus.value[turnId] = 'installed'
  } catch (cause) {
    skillInstallStatus.value[turnId] = 'failed'
    skillInstallErrors.value[turnId] = cause instanceof Error ? cause.message : String(cause)
  }
}

async function continueSkillRevision(plan: SkillInstallPlan) {
  input.value = `继续修改 Skill「${plan.name}」：`
  setEditorText(composerRef.value, input.value)
  await nextTick()
  resizeComposer()
  composerRef.value?.focus()
}

function displayTurnContent(content: string): string {
  return stripSkillInstallBlock(content)
}

function releaseMediaUrl() {
  if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl)
  mediaObjectUrl = ''
  mediaUrl.value = ''
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`无法读取附件：${file.name}`))
    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="memory-workbench" :class="{ 'tree-closed': !treeOpen }">
    <aside class="memory-tree" :class="{ open: treeOpen }">
      <ProjectFileTree memory-mode />
    </aside>
    <button v-if="treeOpen" class="memory-tree-backdrop" aria-label="关闭文件树" @click="treeOpen = false"></button>

    <main class="memory-main">
      <header class="memory-topbar">
        <button v-if="!treeOpen" class="icon-button" title="打开文件树" @click="treeOpen = true"><JcIcon name="menu" /></button>
        <strong>{{ title }}</strong>
        <div class="memory-topbar-actions">
          <select v-model="agentStore.currentModel" aria-label="模型" @change="agentStore.setModel(agentStore.currentModel)">
            <option v-if="!textModels.length" :value="agentStore.currentModel">{{ agentStore.currentModel || '登录后加载模型' }}</option>
            <option v-for="model in textModels" :key="model.id" :value="model.id">{{ model.label }}</option>
          </select>
          <button class="icon-button" title="账号与设置" @click="settingsOpen = true"><JcIcon name="settings" /></button>
        </div>
      </header>

      <section v-if="conversation" ref="messagesEl" class="memory-messages">
        <div v-if="!conversation.transcript.turns.length" class="memory-empty-state">开始一段对话</div>
        <article v-for="turn in conversation.transcript.turns" :key="turn.id" class="memory-message" :class="turn.role">
          <span class="memory-role">{{ turn.role === 'user' ? '你' : '韭菜盒子' }}</span>
          <div v-if="displayTurnContent(turn.content)" class="memory-message-text">{{ displayTurnContent(turn.content) }}</div>
          <MediaPlanCard
            v-if="mediaPlans[turn.id]"
            :plan="mediaPlans[turn.id]"
            :status="mediaPlanStatus[turn.id] || 'ready'"
            :error="mediaPlanErrors[turn.id]"
            workbench-mode
            @approve="approveMediaPlan(turn.id)"
            @update-parameters="patch => updatePlan(turn.id, patch)"
          />
          <MediaTaskBubble v-if="mediaTasks[turn.id]" :task-id="mediaTasks[turn.id]" workbench-mode />
          <SkillInstallCard
            v-if="skillInstallPlans[turn.id]"
            :plan="skillInstallPlans[turn.id]"
            :installed="isSkillPlanInstalled(skillInstallPlans[turn.id])"
            :updating="Boolean(installedSkill(skillInstallPlans[turn.id]))"
            :status="skillInstallStatus[turn.id] || 'ready'"
            :error="skillInstallErrors[turn.id]"
            @approve="approveSkillInstall(turn.id)"
            @revise="continueSkillRevision(skillInstallPlans[turn.id])"
          />
        </article>
        <article v-if="sending && streamingText" class="memory-message assistant streaming">
          <span class="memory-role">韭菜盒子</span>
          <div class="memory-message-text">{{ streamingText }}</div>
        </article>
      </section>

      <section v-else-if="opened?.type === 'editor'" class="memory-document">
        <pre>{{ opened.text.content }}</pre>
      </section>
      <section v-else-if="opened?.type === 'media'" class="memory-media">
        <img v-if="opened.mediaKind === 'image' && mediaUrl" :src="mediaUrl" :alt="opened.resource.name" />
        <video v-else-if="opened.mediaKind === 'video' && mediaUrl" :src="mediaUrl" controls />
        <audio v-else-if="opened.mediaKind === 'audio' && mediaUrl" :src="mediaUrl" controls />
        <p v-else>该媒体文件暂时无法在浏览器中预览。</p>
      </section>
      <section v-else-if="opened" class="memory-empty-state">该文件不支持直接预览，请从文件树菜单导出。</section>
      <section v-else class="memory-empty-state">从左侧文件树打开对话或文档</section>

      <footer v-if="conversation" class="memory-composer">
        <SkillPickerBar
          :skills="skills"
          :selected-skill-name="selectedSkillName"
          :loading="skillsLoading"
          :error="skillsError"
          web-mode
          @select="selectedSkillName = $event"
          @refresh="refreshSkills"
        />
        <div v-if="attachments.length" class="memory-attachments">
          <span v-for="file in attachments" :key="file.id">{{ file.name }}<button title="移除附件" @click="attachments = attachments.filter(item => item.id !== file.id)">×</button></span>
        </div>
        <div v-if="referencedFiles.length" class="memory-attachments memory-references">
          <span v-for="file in referencedFiles" :key="file.name">
            <JcIcon name="attach-file" />{{ file.name }}
            <button title="移除引用" @click="referencedFiles = referencedFiles.filter(item => item.name !== file.name)">×</button>
          </span>
        </div>
        <div v-if="status || error" class="memory-status" :class="{ error: Boolean(error) }">{{ error || status }}</div>
        <div class="memory-input-row">
          <input ref="fileInput" type="file" multiple hidden @change="selectFiles" />
          <button class="icon-button" title="添加附件" @click="fileInput?.click()"><JcIcon name="attach-file" /></button>
          <div
            ref="composerRef"
            class="memory-composer-editable"
            contenteditable="true"
            data-placeholder="输入消息"
            @input="handleComposerInput"
            @keydown="handleComposerKeydown"
          />
          <button v-if="sending" class="send-button" title="停止" @click="stop"><JcIcon name="stop" /></button>
          <button v-else class="send-button" title="发送" :disabled="!input.trim()" @click="send"><JcIcon name="arrow-upward" /></button>
        </div>
      </footer>
    </main>

    <div v-if="settingsOpen" class="memory-settings-backdrop" @click="settingsOpen = false"></div>
    <aside class="memory-settings-drawer" :class="{ open: settingsOpen }">
      <header><strong>设置</strong><button class="icon-button" title="关闭" @click="settingsOpen = false"><JcIcon name="close" /></button></header>
      <MemorySettings />
    </aside>
  </div>
</template>

<style scoped>
.memory-workbench { --memory-header-height: 74px; display: grid; grid-template-columns: 280px minmax(0, 1fr); width: 100vw; height: 100dvh; overflow: hidden; background: var(--paper); color: var(--ink1); font-size: var(--font-base); }
.memory-workbench.tree-closed { grid-template-columns: 0 minmax(0, 1fr); }
.memory-tree { min-width: 0; border-right: 1px solid var(--line); background: var(--surface); }
.memory-workbench.tree-closed .memory-tree { overflow: hidden; border-right: 0; }
.memory-main { display: grid; grid-template-rows: var(--memory-header-height) minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
.memory-topbar { display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--line); }
.memory-topbar > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-base); }
.memory-topbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.memory-topbar select { max-width: 190px; height: 32px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 0 8px; }
.icon-button, .send-button { display: grid; width: 34px; height: 34px; flex: 0 0 34px; padding: 0; place-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink2); cursor: pointer; }
.icon-button:hover { color: var(--olive); border-color: var(--olive); }
.memory-messages { min-height: 0; overflow-y: auto; padding: 24px max(20px, calc((100% - 820px) / 2)); }
.memory-message { margin-bottom: 24px; }
.memory-message.user { margin-left: min(18%, 130px); padding: 12px 14px; border-radius: 8px; background: var(--surface); }
.memory-role { display: block; margin-bottom: 6px; color: var(--ink3); font-size: calc(var(--font-base) - 3px); font-weight: 700; }
.memory-message-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-base); line-height: 1.72; }
.memory-message.streaming { opacity: .85; }
.memory-composer { width: min(860px, calc(100% - 28px)); margin: 0 auto 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 26px rgb(0 0 0 / 8%); }
.memory-input-row { display: flex; align-items: flex-end; gap: 8px; padding: 10px; }
.memory-composer-editable { min-width: 0; min-height: 24px; max-height: min(220px, 30vh); flex: 1; overflow-y: hidden; overscroll-behavior: contain; scrollbar-width: thin; border: 0; outline: 0; background: transparent; color: var(--ink1); font: inherit; font-size: var(--font-base); line-height: 1.55; overflow-wrap: anywhere; }
.memory-composer-editable:empty::before { color: var(--ink3); content: attr(data-placeholder); pointer-events: none; }
.memory-composer-editable::-webkit-scrollbar { width: 12px; }
.memory-composer-editable::-webkit-scrollbar-track { background: transparent; }
.memory-composer-editable::-webkit-scrollbar-thumb { min-height: 36px; border: 2px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--olive) 68%, transparent); background-clip: content-box; }
.send-button { border-color: var(--olive); background: var(--olive); color: white; }
.send-button:disabled { opacity: .4; cursor: default; }
.memory-status { padding: 6px 12px 0; color: var(--ink3); font-size: calc(var(--font-base) - 2px); }
.memory-status.error { color: var(--danger); }
.memory-attachments { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 12px 0; }
.memory-attachments span { display: flex; align-items: center; gap: 4px; max-width: 210px; padding: 4px 7px; border-radius: 5px; background: var(--surface); color: var(--ink2); font-size: calc(var(--font-base) - 3px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-attachments button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.memory-references { border-top: 1px solid var(--line); background: var(--surface-alt); }
.memory-document { min-height: 0; overflow: auto; padding: 28px max(24px, calc((100% - 900px) / 2)); }
.memory-document pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink1); font: var(--font-base)/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
.memory-media { display: grid; min-height: 0; padding: 20px; place-items: center; overflow: auto; }
.memory-media img, .memory-media video { max-width: 100%; max-height: 100%; object-fit: contain; }
.memory-media audio { width: min(620px, 100%); }
.memory-empty-state { display: grid; min-height: 0; padding: 32px; place-items: center; color: var(--ink3); font-size: calc(var(--font-base) - 1px); }
.memory-settings-drawer { position: fixed; z-index: 40; inset: 0 0 0 auto; width: min(440px, 92vw); transform: translateX(100%); border-left: 1px solid var(--line); background: var(--paper); transition: transform .18s ease; }
.memory-settings-drawer.open { transform: translateX(0); }
.memory-settings-drawer > header { display: flex; height: 52px; align-items: center; justify-content: space-between; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line); }
.memory-settings-drawer > :last-child { height: calc(100% - 52px); }
.memory-settings-backdrop, .memory-tree-backdrop { position: fixed; z-index: 35; inset: 0; border: 0; background: rgb(0 0 0 / 28%); }
.mobile-only, .memory-tree-backdrop { display: none; }
@media (max-width: 760px) {
  .memory-workbench { display: block; }
  .memory-main { height: 100%; }
  .memory-tree { position: fixed; z-index: 38; inset: 0 auto 0 0; width: min(320px, 88vw); transform: translateX(-100%); transition: transform .18s ease; }
  .memory-tree.open { transform: translateX(0); }
  .memory-tree-backdrop, .mobile-only { display: grid; }
  .memory-topbar { padding: 0 8px; }
  .memory-topbar select { max-width: 126px; }
  .memory-messages { padding: 18px 14px; }
  .memory-message.user { margin-left: 12%; }
  .memory-composer { width: calc(100% - 16px); margin-bottom: 8px; }
}
</style>
