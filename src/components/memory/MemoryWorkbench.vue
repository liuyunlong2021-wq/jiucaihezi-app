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
  createMemoryConversation,
  initializeMemoryProject,
  inspectMemoryProject,
  renameMemoryConversation,
  type MemoryConversation,
} from '@/runtime/memory/memoryProject'
import { runMemoryChat } from '@/runtime/memory/memoryChat'
import {
  parseMediaPlans,
  stripMediaPlanBlocks,
  updateMediaPlanParameters,
  type MediaPlan,
  type MediaPlanParameterPatch,
} from '@/runtime/workbench/mediaPlan'
import {
  buildExplicitMediaReferences,
  buildMediaReferencePolicy,
  createMediaContextSnapshot,
  materializeMediaPlanReferences,
} from '@/runtime/workbench/mediaReference'
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
import { isTauriRuntime } from '@/utils/tauriEnv'
import { confirmAction } from '@/utils/confirmAction'
import { safePrompt } from '@/utils/safePrompt'
import type { ConversationAttachment, ConversationMode, ConversationTurn } from '@/runtime/memory/conversationTranscript'

const projectStore = useProjectStore()
const agentStore = useAgentStore()
const mediaTaskStore = useMediaTaskStore()
const files = createRuntimeProjectFileService()
const desktopRuntime = isTauriRuntime()
const opened = ref<ProjectResourceOpenResult | null>(null)
const previewResource = ref<ProjectResourceOpenResult | null>(null)
const conversations = ref<MemoryConversation[]>([])
const conversationPickerOpen = ref(false)
const conversationSearch = ref('')
const conversationPickerRef = ref<HTMLElement | null>(null)
const input = ref('')
const attachments = ref<ResolvedDirectAttachment[]>([])
const referencedFiles = ref<DirectMessageFile[]>([])
const selectedSkillName = ref('')
const executionMode = ref<ConversationMode>('memory')
const skills = computed<OpenCodeSkillOption[]>(() => agentStore.getCustomSkills().map(skill => ({
  name: skill.name,
  label: skill.name,
  description: skill.description || undefined,
  location: `user-skill://${skill.id}`,
})))
const skillsLoading = ref(false)
const skillsError = ref('')
const modelPickerOpen = ref(false)
const modelPickerRef = ref<HTMLElement | null>(null)
const sending = ref(false)
const projectActionPending = ref(false)
const memoryReady = ref(false)
const streamingText = ref('')
const status = ref('')
const error = ref('')
const settingsOpen = ref(false)
const treeOpen = ref(true)
const messagesEl = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const mediaUrl = ref('')
const mediaPlans = ref<Record<string, MediaPlan[]>>({})
const mediaPlanStatus = ref<Record<string, 'ready' | 'submitting' | 'submitted' | 'failed'>>({})
const mediaPlanErrors = ref<Record<string, string>>({})
const mediaTasks = ref<Record<string, string>>({})
const skillInstallPlans = ref<Record<string, SkillInstallPlan>>({})
const skillInstallStatus = ref<Record<string, 'ready' | 'installing' | 'installed' | 'failed'>>({})
const skillInstallErrors = ref<Record<string, string>>({})
const mediaTaskResources = new Map<string, ProjectResourceOpenResult & { type: 'conversation' }>()
const recordedMediaTasks = new Set<string>()
const transientAttachments = ref<Record<string, ResolvedDirectAttachment[]>>({})
let abortController: AbortController | null = null
let mediaObjectUrl = ''
let projectGeneration = 0
let sendInFlight = false
let offOpenResource: (() => void) | null = null
let offToggleTree: (() => void) | null = null
let offMediaTaskSettled: (() => void) | null = null
let offReferenceFile: (() => void) | null = null
let stopProjectWatch: (() => void) | null = null

const conversation = computed(() => opened.value?.type === 'conversation' ? opened.value : null)
const filteredConversations = computed(() => {
  const query = conversationSearch.value.trim().toLowerCase()
  return conversations.value
    .filter(item => !query || item.transcript.title.toLowerCase().includes(query))
    .slice()
    .reverse()
})
const textModels = computed(() => agentStore.textModels.filter(model => !isInternalMediaModel(model.id)))
const modelGroups = computed(() => {
  const groups = new Map<string, typeof textModels.value>()
  for (const model of textModels.value) {
    const key = modelGroupKey(model.id)
    const group = groups.get(key) || []
    group.push(model)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, models]) => ({ key, label: modelGroupLabel(key), models }))
})
const currentModelLabel = computed(() => textModels.value.find(model => model.id === agentStore.currentModel)?.label || agentStore.currentModel || '登录后加载模型')
const projectOwner = computed(() => desktopRuntime
  ? projectStore.projectDir.value
  : projectStore.webProjectId.value)

onMounted(async () => {
  offOpenResource = onEvent('memory:open-resource', resource => void openResource(resource as ProjectResourceOpenResult))
  offToggleTree = onEvent('toggle-file-tree', () => { treeOpen.value = !treeOpen.value })
  offMediaTaskSettled = onEvent('media-task-settled', payload => void recordMediaResult(payload))
  offReferenceFile = onEvent('reference-file', addReferencedFile)
  document.addEventListener('pointerdown', closeModelPicker)
  document.addEventListener('keydown', handleGlobalKeydown)
  stopProjectWatch = watch(projectOwner, owner => void openProject(owner), { immediate: true })
  await Promise.all([
    refreshSkills(),
    agentStore.fetchModels({ skipOpenCode: true }).catch(() => {}),
    mediaTaskStore.init(),
  ])
})

onBeforeUnmount(() => {
  offOpenResource?.()
  offToggleTree?.()
  offMediaTaskSettled?.()
  offReferenceFile?.()
  document.removeEventListener('pointerdown', closeModelPicker)
  document.removeEventListener('keydown', handleGlobalKeydown)
  stopProjectWatch?.()
  projectGeneration++
  abortController?.abort()
  releaseMediaUrl()
})

function modelGroupKey(modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('claude') || id.includes('anthropic')) return 'anthropic'
  if (id.includes('gpt') || id.includes('openai')) return 'openai'
  if (id.includes('gemini') || id.includes('gemma') || id.includes('google')) return 'google'
  if (id.includes('grok') || id.includes('xai')) return 'xai'
  if (id.includes('deepseek')) return 'deepseek'
  if (id.includes('qwen') || id.includes('tongyi')) return 'qwen'
  if (id.includes('glm') || id.includes('zhipu')) return 'zhipu'
  if (id.includes('doubao') || id.includes('bytedance')) return 'doubao'
  if (id.includes('ollama') || id.includes('local-')) return 'local'
  return 'other'
}

function modelGroupLabel(key: string): string {
  return ({ anthropic: 'Claude', openai: 'GPT / OpenAI', google: 'Gemini / Google', xai: 'Grok / xAI', deepseek: 'DeepSeek', qwen: '通义千问', zhipu: '智谱', doubao: '豆包', local: '本地模型', other: '其他' } as Record<string, string>)[key] || key
}

function isInternalMediaModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id.startsWith('rh-') || id.includes('/rh-') || id.includes('runninghub')
}

function closeModelPicker(event: PointerEvent) {
  if (modelPickerOpen.value && !modelPickerRef.value?.contains(event.target as Node)) modelPickerOpen.value = false
  if (conversationPickerOpen.value && !conversationPickerRef.value?.contains(event.target as Node)) conversationPickerOpen.value = false
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && previewResource.value) closePreview()
}

function selectModel(modelId: string) {
  agentStore.setModel(modelId)
  modelPickerOpen.value = false
}

async function openProject(owner: string) {
  const generation = ++projectGeneration
  opened.value = null
  previewResource.value = null
  conversations.value = []
  memoryReady.value = false
  error.value = ''
  if (!owner) return
  try {
    const state = await inspectMemoryProject(owner, files)
    if (generation !== projectGeneration) return
    memoryReady.value = state.initialized
    conversations.value = state.conversations
    const first = state.conversations[0]
    if (first) await openResource(await openProjectResource(files, first.resource))
  } catch (cause) {
    if (generation !== projectGeneration) return
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function createMemorySpace() {
  const owner = projectOwner.value
  if (!owner || projectActionPending.value) return
  projectActionPending.value = true
  error.value = ''
  try {
    await initializeMemoryProject(owner, files)
    memoryReady.value = true
    opened.value = null
    conversations.value = []
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    projectActionPending.value = false
  }
}

async function startNewConversation() {
  const owner = projectOwner.value
  if (!owner || !memoryReady.value || sending.value || projectActionPending.value) return
  projectActionPending.value = true
  error.value = ''
  try {
    const created = await createMemoryConversation(owner, '新对话', files)
    rememberConversation(created)
    await openResource(await openProjectResource(files, created.resource))
    await nextTick()
    composerRef.value?.focus()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    projectActionPending.value = false
  }
}

watch(() => conversation.value?.transcript.turns.length, async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
})

async function openResource(resource: ProjectResourceOpenResult) {
  error.value = ''
  if (!sending.value) status.value = ''
  streamingText.value = ''
  if (resource.type === 'conversation') {
    closePreview()
    opened.value = resource
    rememberConversation({ resource: resource.resource, transcript: resource.transcript })
    conversationPickerOpen.value = false
    conversationSearch.value = ''
    executionMode.value = [...resource.transcript.turns].reverse()
      .find(turn => turn.role === 'user' && turn.mode)?.mode || 'memory'
    for (const turn of resource.transcript.turns) {
      if (turn.role !== 'assistant') continue
      try {
        mediaPlans.value[turn.id] = parseMediaPlans(turn.content)
        mediaPlans.value[turn.id].forEach((_, index) => {
          mediaPlanStatus.value[mediaPlanKey(turn.id, index)] ||= 'ready'
        })
      } catch { /* ordinary assistant reply */ }
      try {
        skillInstallPlans.value[turn.id] = parseSkillInstallPlan(turn.content)
        skillInstallStatus.value[turn.id] ||= 'ready'
      } catch { /* ordinary assistant reply */ }
    }
  } else {
    releaseMediaUrl()
    previewResource.value = resource
  }
  if (resource.type === 'media') {
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

function rememberConversation(next: MemoryConversation) {
  const index = conversations.value.findIndex(item => item.resource.path === next.resource.path)
  if (index < 0) conversations.value.push(next)
  else conversations.value[index] = next
}

async function selectConversation(item: MemoryConversation) {
  await openResource(await openProjectResource(files, item.resource))
}

async function renameConversation(item: MemoryConversation) {
  const nextTitle = (await safePrompt('重命名对话', item.transcript.title, { forceDom: desktopRuntime }))?.trim()
  if (!nextTitle || nextTitle === item.transcript.title) return
  try {
    const renamed = await renameMemoryConversation(item.resource, nextTitle, files)
    rememberConversation(renamed)
    if (conversation.value?.resource.path === item.resource.path) {
      opened.value = await openProjectResource(files, renamed.resource)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function deleteConversation(item: MemoryConversation) {
  if (!(await confirmAction(`删除对话“${item.transcript.title}”？`, { title: '删除对话', okLabel: '删除' }))) return
  try {
    const plan = await files.planBatch({ kind: 'delete', resources: [item.resource] })
    const result = await files.executeBatch(plan)
    if (result.failures.length) throw new Error(result.failures[0].message)
    conversations.value = conversations.value.filter(entry => entry.resource.path !== item.resource.path)
    if (conversation.value?.resource.path === item.resource.path) {
      opened.value = null
      const next = conversations.value.at(-1)
      if (next) await selectConversation(next)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function closePreview() {
  previewResource.value = null
  releaseMediaUrl()
}

async function send() {
  const active = conversation.value
  const message = input.value.trim()
  const pendingAttachments = attachments.value.slice()
  const pendingMode = executionMode.value
  if (!active || (!message && !pendingAttachments.length && !referencedFiles.value.length) || sending.value || sendInFlight) return
  sendInFlight = true
  sending.value = true
  error.value = ''
  status.value = '正在保存你的消息'
  streamingText.value = ''
  abortController = new AbortController()
  try {
    let saved = await appendMemoryTurn(
      active.resource,
      'user',
      message || '请查看以下附件。',
      files,
      attachmentMetadata(pendingAttachments),
      pendingMode,
    )
    const userTurn = saved.transcript.turns.at(-1)
    if (userTurn?.role === 'user' && pendingAttachments.length) transientAttachments.value[userTurn.id] = pendingAttachments
    if (saved.transcript.turns.filter(turn => turn.role === 'user').length === 1 && saved.transcript.title === '新对话') {
      const titleSource = message || pendingAttachments[0]?.name || '新对话'
      saved = await renameMemoryConversation(saved.resource, titleSource.replace(/\s+/g, ' ').slice(0, 28), files)
    }
    rememberConversation(saved)
    opened.value = await openProjectResource(files, saved.resource)
    input.value = ''
    setEditorText(composerRef.value, '')
    const mediaInputs = pendingAttachments
      .filter(attachment => attachment.kind === 'image' || attachment.kind === 'video')
      .map(attachment => ({
        name: attachment.name,
        kind: attachment.kind as 'image' | 'video',
        value: attachment.value,
        source: 'attachment' as const,
      }))
    const mediaContext = createMediaContextSnapshot({
      owner: active.resource.owner,
      sessionId: saved.transcript.id,
      explicitReferences: buildExplicitMediaReferences(userTurn?.id || saved.transcript.id, mediaInputs),
    })
    status.value = pendingMode === 'memory' ? '正在查询 Wiki' : '正在回复'
    const reply = await runMemoryChat({
      projectId: active.resource.owner,
      turns: saved.transcript.turns,
      modelId: agentStore.currentModel,
      mode: pendingMode,
      selectedSkillName: selectedSkillName.value,
      mediaReferencePolicy: buildMediaReferencePolicy(mediaContext),
      attachments: pendingAttachments,
      files: referencedFiles.value,
      signal: abortController.signal,
      onTool(name) { status.value = name === 'skill' ? '正在加载查询 Skill' : '正在查询 Wiki' },
      onText(text) {
        status.value = '正在回复'
        streamingText.value = text
      },
    })
    const complete = await appendMemoryTurn(saved.resource, 'assistant', reply, files)
    rememberConversation(complete)
    opened.value = await openProjectResource(files, complete.resource)
    const turn = complete.transcript.turns.at(-1)
    if (turn?.role === 'assistant') {
      try {
        mediaPlans.value[turn.id] = parseMediaPlans(turn.content)
          .map(plan => materializeMediaPlanReferences(plan, mediaContext))
        mediaPlans.value[turn.id].forEach((_, index) => {
          mediaPlanStatus.value[mediaPlanKey(turn.id, index)] = 'ready'
        })
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
    sendInFlight = false
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

async function handleComposerPaste(event: ClipboardEvent) {
  const imageFiles = Array.from(event.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  event.preventDefault()
  if (imageFiles.length) {
    await addAttachmentFiles(imageFiles)
    return
  }

  const text = event.clipboardData?.getData('text/plain') || ''
  if (!text || !composerRef.value) return
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  const node = document.createTextNode(text)
  if (range && composerRef.value.contains(range.commonAncestorContainer)) {
    range.deleteContents()
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
  } else {
    composerRef.value.append(node)
  }
  input.value = getPlainText(composerRef.value)
  resizeComposer()
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
  await addAttachmentFiles(selected)
  ;(event.target as HTMLInputElement).value = ''
}

async function addAttachmentFiles(selected: File[]) {
  const resolved = await Promise.all(selected.map(async (file, index): Promise<ResolvedDirectAttachment> => ({
    id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio' : 'file',
    value: await readDataUrl(file),
  })))
  const byId = new Map(attachments.value.map(attachment => [attachment.id, attachment]))
  for (const attachment of resolved) byId.set(attachment.id, attachment)
  attachments.value = [...byId.values()]
}

function mediaPlanKey(turnId: string, planIndex: number): string {
  return `${turnId}:${planIndex}`
}

async function approveMediaPlan(turnId: string, planIndex: number) {
  const key = mediaPlanKey(turnId, planIndex)
  const plan = mediaPlans.value[turnId]?.[planIndex]
  if (!plan || !conversation.value) return
  mediaPlanStatus.value[key] = 'submitting'
  mediaPlanErrors.value[key] = ''
  try {
    const prepared = await preparePublicMediaPlan({ plan, owner: conversation.value.resource.owner })
    const taskId = await mediaTaskStore.submitTask({
      ...prepared.submission,
      chatMessageId: key,
    })
    mediaTasks.value[key] = taskId
    mediaTaskResources.set(taskId, conversation.value)
    mediaPlanStatus.value[key] = 'submitted'
    const updated = await appendMemoryTurn(
      conversation.value.resource,
      'assistant',
      `[媒体任务]\n任务 ${taskId} 已提交：${plan.title}`,
      files,
    )
    opened.value = await openProjectResource(files, updated.resource)
  } catch (cause) {
    mediaPlanStatus.value[key] = 'failed'
    mediaPlanErrors.value[key] = cause instanceof Error ? cause.message : String(cause)
  }
}

async function recordMediaResult(payload: unknown) {
  const result = payload as { taskId?: string; status?: string; url?: string; text?: string; errorMsg?: string }
  const taskId = String(result.taskId || '')
  const target = mediaTaskResources.get(taskId)
  if (!target || recordedMediaTasks.has(taskId)) return
  recordedMediaTasks.add(taskId)
  const projectPath = mediaTaskStore.getTask(taskId)?.projectPath
  const summary = result.status === 'success'
    ? `[媒体结果]\n任务 ${taskId} 已完成${projectPath ? `并保存到 ${projectPath}` : '，可在任务卡下载'}。`
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

function updatePlan(turnId: string, planIndex: number, patch: MediaPlanParameterPatch) {
  const key = mediaPlanKey(turnId, planIndex)
  try {
    mediaPlans.value[turnId][planIndex] = updateMediaPlanParameters(mediaPlans.value[turnId][planIndex], patch)
    mediaPlanErrors.value[key] = ''
  } catch (cause) {
    mediaPlanErrors.value[key] = cause instanceof Error ? cause.message : String(cause)
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

function displayTurnContent(turn: ConversationTurn): string {
  const content = stripSkillInstallBlock(turn.content)
  return mediaPlans.value[turn.id]?.length ? stripMediaPlanBlocks(content) : content
}

function attachmentMetadata(attachments: ResolvedDirectAttachment[]): ConversationAttachment[] {
  return attachments.map(({ id, name, mime, size, kind }) => ({ id, name, mime, size, kind }))
}

function turnAttachments(turn: ConversationTurn): Array<ConversationAttachment & { value?: string }> {
  const previews = new Map((transientAttachments.value[turn.id] || []).map(attachment => [attachment.id, attachment.value]))
  return (turn.attachments || []).map(attachment => ({ ...attachment, value: previews.get(attachment.id) }))
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
  <div class="memory-workbench" :class="{ 'tree-closed': !treeOpen, 'desktop-runtime': desktopRuntime }" data-tauri-drag-region>
    <aside class="memory-tree" :class="{ open: treeOpen }">
      <ProjectFileTree memory-mode />
    </aside>
    <button v-if="treeOpen" class="memory-tree-backdrop" aria-label="关闭文件树" @click="treeOpen = false"></button>

    <main class="memory-main">
      <header class="memory-topbar">
        <button v-if="!treeOpen" class="icon-button" title="打开文件树" @click="treeOpen = true"><JcIcon name="menu" /></button>
        <div v-if="memoryReady" ref="conversationPickerRef" class="memory-conversation-picker">
          <button
            class="memory-conversation-trigger"
            type="button"
            :aria-expanded="conversationPickerOpen"
            @click="conversationPickerOpen = !conversationPickerOpen"
          >
            <span>{{ conversation?.transcript.title || '选择对话' }}</span>
            <JcIcon :name="conversationPickerOpen ? 'expand-less' : 'expand-more'" />
          </button>
          <div v-if="conversationPickerOpen" class="memory-conversation-menu">
            <input v-model="conversationSearch" type="search" placeholder="搜索对话" aria-label="搜索对话" />
            <div class="memory-conversation-list">
              <div
                v-for="item in filteredConversations"
                :key="item.transcript.id"
                class="memory-conversation-item"
                :class="{ active: item.resource.path === conversation?.resource.path }"
              >
                <button class="memory-conversation-name" @click="selectConversation(item)">{{ item.transcript.title }}</button>
                <button class="memory-conversation-action" title="重命名" @click="renameConversation(item)"><JcIcon name="edit" /></button>
                <button class="memory-conversation-action" title="删除" @click="deleteConversation(item)"><JcIcon name="delete" /></button>
              </div>
              <p v-if="!filteredConversations.length" class="memory-model-empty">没有匹配的对话</p>
            </div>
          </div>
        </div>
        <button
          v-if="memoryReady"
          class="new-conversation-button"
          :disabled="sending || projectActionPending"
          @click="startNewConversation"
        >
          <span>新建对话</span>
        </button>
        <div class="memory-title-drag" data-tauri-drag-region></div>
        <div class="memory-topbar-actions">
          <div ref="modelPickerRef" class="memory-model-picker">
            <button class="memory-model-trigger" type="button" aria-label="模型" :aria-expanded="modelPickerOpen" @click="modelPickerOpen = !modelPickerOpen">
              <span>{{ currentModelLabel }}</span><JcIcon :name="modelPickerOpen ? 'expand-less' : 'expand-more'" />
            </button>
            <div v-if="modelPickerOpen" class="memory-model-menu" role="listbox">
              <section v-for="group in modelGroups" :key="group.key" class="memory-model-group">
                <h3>{{ group.label }}</h3>
                <button v-for="model in group.models" :key="model.id" type="button" role="option" :aria-selected="model.id === agentStore.currentModel" :class="{ selected: model.id === agentStore.currentModel }" @click="selectModel(model.id)">{{ model.label }}</button>
              </section>
              <p v-if="!textModels.length" class="memory-model-empty">登录后加载模型</p>
            </div>
          </div>
          <button class="icon-button" title="账号与设置" @click="settingsOpen = true"><JcIcon name="settings" /></button>
        </div>
      </header>

      <section v-if="conversation" ref="messagesEl" class="memory-messages">
        <div v-if="!conversation.transcript.turns.length" class="memory-empty-state">开始一段对话</div>
        <article v-for="turn in conversation.transcript.turns" :key="turn.id" class="memory-message" :class="turn.role">
          <span class="memory-role">{{ turn.role === 'user' ? '你' : '韭菜盒子' }}</span>
          <div v-if="turn.role === 'user' && turnAttachments(turn).length" class="memory-message-attachments">
            <div v-for="attachment in turnAttachments(turn)" :key="attachment.id" class="memory-message-attachment" :class="attachment.kind">
              <img v-if="attachment.kind === 'image' && attachment.value" :src="attachment.value" :alt="attachment.name" />
              <template v-else><JcIcon :name="attachment.kind === 'video' ? 'movie' : attachment.kind === 'audio' ? 'music-note' : 'description'" /><span :title="attachment.name">{{ attachment.name }}</span></template>
            </div>
          </div>
          <div v-if="displayTurnContent(turn)" class="memory-message-text">{{ displayTurnContent(turn) }}</div>
          <template v-for="(plan, planIndex) in mediaPlans[turn.id]" :key="mediaPlanKey(turn.id, planIndex)">
            <MediaPlanCard
              :plan="plan"
              :status="mediaPlanStatus[mediaPlanKey(turn.id, planIndex)] || 'ready'"
              :error="mediaPlanErrors[mediaPlanKey(turn.id, planIndex)]"
              workbench-mode
              @approve="approveMediaPlan(turn.id, planIndex)"
              @update-parameters="patch => updatePlan(turn.id, planIndex, patch)"
            />
            <MediaTaskBubble
              v-if="mediaTasks[mediaPlanKey(turn.id, planIndex)]"
              :task-id="mediaTasks[mediaPlanKey(turn.id, planIndex)]"
              workbench-mode
            />
          </template>
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

      <section v-else-if="projectOwner && !memoryReady" class="memory-onboarding">
        <div>
          <img src="/logo.svg" alt="" />
          <h1>开始使用记忆空间</h1>
          <p>这个文件夹还没有韭菜盒子记忆结构。</p>
          <button :disabled="projectActionPending" @click="createMemorySpace">
            {{ projectActionPending ? '正在创建' : '新建记忆空间' }}
          </button>
          <p v-if="error" class="memory-onboarding-error">{{ error }}</p>
        </div>
      </section>
      <section v-else-if="memoryReady" class="memory-onboarding">
        <div>
          <h1>还没有对话</h1>
          <button :disabled="projectActionPending" @click="startNewConversation">新建对话</button>
          <p v-if="error" class="memory-onboarding-error">{{ error }}</p>
        </div>
      </section>
      <section v-else class="memory-empty-state">从左侧选择项目文件夹</section>

      <footer v-if="conversation" class="memory-composer">
        <div class="memory-composer-tools">
          <div class="memory-mode-segment" role="group" aria-label="回答方式">
            <button
              type="button"
              :class="{ active: executionMode === 'quick' }"
              title="直接回答，不查询 Wiki"
              @click="executionMode = 'quick'"
            >快速</button>
            <button
              type="button"
              :class="{ active: executionMode === 'memory' }"
              title="回答前查询 Wiki"
              @click="executionMode = 'memory'"
            >记忆</button>
          </div>
          <SkillPickerBar
            :skills="skills"
            :selected-skill-name="selectedSkillName"
            :loading="skillsLoading"
            :error="skillsError"
            :web-mode="!desktopRuntime"
            compact
            @select="selectedSkillName = $event"
            @refresh="refreshSkills"
          />
        </div>
        <div v-if="attachments.length" class="memory-attachments">
          <div v-for="file in attachments" :key="file.id" class="memory-attachment-chip">
            <img v-if="file.kind === 'image'" :src="file.value" :alt="file.name" />
            <JcIcon v-else :name="file.kind === 'video' ? 'movie' : file.kind === 'audio' ? 'music-note' : 'description'" />
            <span class="memory-attachment-name" :title="file.name">{{ file.name }}</span>
            <button title="移除附件" @click="attachments = attachments.filter(item => item.id !== file.id)">×</button>
          </div>
        </div>
        <div v-if="referencedFiles.length" class="memory-attachments memory-references">
          <div v-for="file in referencedFiles" :key="file.name" class="memory-attachment-chip">
            <JcIcon name="attach-file" />
            <span class="memory-attachment-name" :title="file.name">{{ file.name }}</span>
            <button title="移除引用" @click="referencedFiles = referencedFiles.filter(item => item.name !== file.name)">×</button>
          </div>
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
            @paste="handleComposerPaste"
          />
          <button v-if="sending" class="send-button" title="停止" @click="stop"><JcIcon name="stop" /></button>
          <button v-else class="send-button" title="发送" :disabled="!input.trim() && !attachments.length && !referencedFiles.length" @click="send"><JcIcon name="arrow-upward" /></button>
        </div>
      </footer>

      <section v-if="previewResource" class="memory-preview">
        <header class="memory-preview-header">
          <button class="memory-preview-back" @click="closePreview"><JcIcon name="arrow-back" /><span>返回对话</span></button>
          <strong>{{ previewResource.resource.name }}</strong>
          <button class="icon-button" title="关闭预览" @click="closePreview"><JcIcon name="close" /></button>
        </header>
        <div v-if="previewResource.type === 'editor'" class="memory-document">
          <pre>{{ previewResource.text.content }}</pre>
        </div>
        <div v-else-if="previewResource.type === 'media'" class="memory-media">
          <img v-if="previewResource.mediaKind === 'image' && mediaUrl" :src="mediaUrl" :alt="previewResource.resource.name" />
          <video v-else-if="previewResource.mediaKind === 'video' && mediaUrl" :src="mediaUrl" controls />
          <audio v-else-if="previewResource.mediaKind === 'audio' && mediaUrl" :src="mediaUrl" controls />
          <p v-else>该媒体文件暂时无法在浏览器中预览。</p>
        </div>
        <div v-else class="memory-empty-state">该文件不支持直接预览，请从文件树菜单导出。</div>
      </section>
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
.memory-workbench.desktop-runtime { --memory-header-height: 102px; padding-top: 28px; box-sizing: border-box; }
.memory-workbench.tree-closed { grid-template-columns: 0 minmax(0, 1fr); }
.memory-tree { min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--line); background: var(--surface); }
.memory-workbench.tree-closed .memory-tree { overflow: hidden; border-right: 0; }
.memory-main { position: relative; display: grid; grid-template-rows: var(--memory-header-height) minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
.memory-topbar { display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--line); }
.memory-title-drag { display: flex; min-width: 80px; height: 100%; flex: 1; align-items: center; gap: 9px; user-select: none; }
.memory-topbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.memory-topbar .new-conversation-button, .memory-topbar .icon-button, .memory-model-trigger, .memory-conversation-trigger { height: 34px; box-sizing: border-box; border-radius: 6px; }
.memory-conversation-picker { position: relative; min-width: 0; max-width: min(280px, 34vw); }
.memory-conversation-trigger { display: flex; max-width: 100%; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--line); background: var(--surface); color: var(--ink1); cursor: pointer; font: inherit; }
.memory-conversation-trigger span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-conversation-trigger:hover, .memory-conversation-trigger[aria-expanded="true"] { border-color: var(--olive); }
.memory-conversation-menu { position: absolute; z-index: 50; top: calc(100% + 7px); left: 0; width: min(320px, 84vw); padding: 7px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 12px 30px rgb(0 0 0 / 16%); }
.memory-conversation-menu > input { width: 100%; height: 32px; padding: 0 9px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 5px; outline: 0; background: var(--surface); color: var(--ink1); font: inherit; }
.memory-conversation-menu > input:focus { border-color: var(--olive); }
.memory-conversation-list { max-height: min(420px, 58vh); margin-top: 6px; overflow-y: auto; }
.memory-conversation-item { display: grid; grid-template-columns: minmax(0, 1fr) 30px 30px; align-items: center; border-radius: 5px; }
.memory-conversation-item:hover, .memory-conversation-item.active { background: color-mix(in srgb, var(--olive) 14%, transparent); }
.memory-conversation-name, .memory-conversation-action { min-width: 0; height: 34px; border: 0; background: transparent; color: var(--ink1); cursor: pointer; font: inherit; }
.memory-conversation-name { overflow: hidden; padding: 0 8px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.memory-conversation-action { display: grid; padding: 0; place-items: center; color: var(--ink3); }
.memory-conversation-action:hover { color: var(--olive); }
.new-conversation-button { display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--olive); background: var(--olive); color: white; cursor: pointer; font: inherit; white-space: nowrap; }
.new-conversation-button:disabled { opacity: .45; cursor: default; }
.memory-model-picker { position: relative; min-width: 0; max-width: min(260px, 28vw); }
.memory-model-trigger { display: flex; max-width: 100%; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border: 1px solid var(--line); background: var(--surface); color: var(--ink1); cursor: pointer; font: inherit; text-align: left; }
.memory-model-trigger span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-model-trigger:hover, .memory-model-trigger[aria-expanded="true"] { border-color: var(--olive); }
.memory-model-menu { position: absolute; z-index: 50; top: calc(100% + 7px); left: 0; width: min(290px, 80vw); max-height: min(520px, 68vh); overflow-y: auto; padding: 7px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 12px 30px rgb(0 0 0 / 16%); }
.memory-model-group + .memory-model-group { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
.memory-model-group h3 { margin: 0 7px 3px; color: var(--ink3); font-size: 10px; font-weight: 700; letter-spacing: .02em; }
.memory-model-group button { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--ink1); cursor: pointer; font: inherit; font-size: 12px; text-align: left; }
.memory-model-group button:hover, .memory-model-group button.selected { background: color-mix(in srgb, var(--olive) 16%, transparent); color: var(--olive); }
.memory-model-empty { margin: 8px; color: var(--ink3); font-size: 12px; }
.icon-button, .send-button { display: grid; width: 34px; height: 34px; flex: 0 0 34px; padding: 0; place-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink2); cursor: pointer; }
.icon-button:hover { color: var(--olive); border-color: var(--olive); }
.memory-messages { min-height: 0; overflow-y: auto; padding: 24px max(20px, calc((100% - 820px) / 2)); }
.memory-message { margin-bottom: 24px; }
.memory-message.user { margin-left: min(18%, 130px); padding: 12px 14px; border-radius: 8px; background: var(--surface); }
.memory-role { display: block; margin-bottom: 6px; color: var(--ink3); font-size: calc(var(--font-base) - 3px); font-weight: 700; }
.memory-message-attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.memory-message-attachment { display: flex; width: min(220px, 100%); height: 48px; align-items: center; gap: 8px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-alt); overflow: hidden; color: var(--ink3); }
.memory-message-attachment.image { width: 64px; padding: 0; }
.memory-message-attachment img { width: 100%; height: 100%; object-fit: cover; }
.memory-message-attachment span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(var(--font-base) - 2px); }
.memory-message-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-base); line-height: 1.72; }
.memory-message.streaming { opacity: .85; }
.memory-composer { width: min(860px, calc(100% - 28px)); margin: 0 auto 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 26px rgb(0 0 0 / 8%); }
.memory-composer-tools { position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 10px 0; }
.memory-composer-tools :deep(.spb-root.compact) { position: static; }
.memory-mode-segment { display: flex; padding: 2px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-mode-segment button { height: 24px; padding: 0 9px; border: 0; border-radius: 4px; background: transparent; color: var(--ink3); cursor: pointer; font: inherit; font-size: 12px; }
.memory-mode-segment button.active { background: var(--olive); color: white; }
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
.memory-attachments { display: flex; gap: 6px; flex-wrap: wrap; padding: 5px 10px 0; }
.memory-attachment-chip { display: flex; height: 34px; max-width: 240px; align-items: center; gap: 5px; padding: 0 7px; box-sizing: border-box; border-radius: 5px; background: var(--surface); color: var(--ink2); font-size: calc(var(--font-base) - 3px); }
.memory-attachment-chip img { width: 26px; height: 26px; flex: 0 0 26px; border-radius: 4px; object-fit: cover; }
.memory-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-attachment-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.memory-document { min-height: 0; height: 100%; overflow-y: scroll; overflow-x: auto; overscroll-behavior: contain; scrollbar-gutter: stable; box-sizing: border-box; padding: 28px max(24px, calc((100% - 900px) / 2)); }
.memory-document pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink1); font: var(--font-base)/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
.memory-document, .memory-model-menu { scrollbar-color: color-mix(in srgb, var(--ink3) 48%, transparent) transparent; scrollbar-width: thin; }
.memory-document::-webkit-scrollbar, .memory-model-menu::-webkit-scrollbar { width: 10px; }
.memory-document::-webkit-scrollbar-thumb, .memory-model-menu::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--ink3) 48%, transparent); background-clip: content-box; }
.memory-media { display: grid; min-height: 0; padding: 20px; place-items: center; overflow: auto; }
.memory-media img, .memory-media video { max-width: 100%; max-height: 100%; object-fit: contain; }
.memory-media audio { width: min(620px, 100%); }
.memory-preview { position: absolute; z-index: 20; inset: var(--memory-header-height) 0 0; display: grid; grid-template-rows: 48px minmax(0, 1fr); min-height: 0; background: var(--paper); }
.memory-preview-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--line); }
.memory-preview-header > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.memory-preview-back { display: flex; height: 34px; align-items: center; gap: 5px; padding: 0 8px; border: 0; background: transparent; color: var(--olive); cursor: pointer; font: inherit; }
.memory-empty-state { display: grid; min-height: 0; padding: 32px; place-items: center; color: var(--ink3); font-size: calc(var(--font-base) - 1px); }
.memory-onboarding { display: grid; min-height: 0; padding: 32px; place-items: center; text-align: center; }
.memory-onboarding > div { display: grid; justify-items: center; gap: 12px; }
.memory-onboarding img { width: 72px; height: 72px; }
.memory-onboarding h1, .memory-onboarding p { margin: 0; }
.memory-onboarding h1 { font-size: calc(var(--font-base) + 5px); }
.memory-onboarding p { color: var(--ink3); }
.memory-onboarding button { min-height: 38px; padding: 0 16px; border: 1px solid var(--olive); border-radius: 6px; background: var(--olive); color: white; cursor: pointer; font: inherit; }
.memory-onboarding button:disabled { opacity: .45; cursor: default; }
.memory-onboarding .memory-onboarding-error { color: var(--danger); }
.memory-settings-drawer { position: fixed; z-index: 40; inset: 0 0 0 auto; width: min(440px, 92vw); transform: translateX(100%); border-left: 1px solid var(--line); background: var(--paper); transition: transform .18s ease; }
.memory-settings-drawer.open { transform: translateX(0); }
.memory-settings-drawer > header { display: flex; height: 52px; align-items: center; justify-content: space-between; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line); }
.memory-settings-drawer > :last-child { height: calc(100% - 52px); }
.memory-settings-backdrop, .memory-tree-backdrop { position: fixed; z-index: 35; inset: 0; border: 0; background: rgb(0 0 0 / 28%); }
.mobile-only, .memory-tree-backdrop { display: none; }
@media (max-width: 760px) {
  .memory-workbench, .memory-workbench.desktop-runtime { display: block; padding-top: 0; }
  .memory-main { height: 100%; }
  .memory-tree { position: fixed; z-index: 38; inset: 0 auto 0 0; width: min(320px, 88vw); transform: translateX(-100%); transition: transform .18s ease; }
  .memory-tree.open { transform: translateX(0); }
  .memory-tree-backdrop, .mobile-only { display: grid; }
  .memory-topbar { gap: 4px; padding: 0 8px; }
  .memory-title-drag { display: none; }
  .memory-topbar-actions { gap: 4px; }
  .memory-conversation-picker { max-width: 90px; }
  .new-conversation-button { padding: 0 7px; }
  .memory-model-picker { max-width: 100px; }
  .memory-model-menu { right: 0; left: auto; }
  .memory-messages { padding: 18px 14px; }
  .memory-message.user { margin-left: 12%; }
  .memory-composer { width: calc(100% - 16px); margin-bottom: 8px; }
}
</style>
