<script setup lang="ts">
/**
 * ChatPanel — 对话面板容器（Superpowers 完全体）
 *
 * 集成：
 *   1. Session Hook — 对话开始时注入 bootstrap prompt
 *   2. Skill Dispatch — LLM 路由 + 完整 SKILL.md 注入
 *   3. Chain Invoke — 检测 AI 回复中的 [INVOKE:xxx] + 用户确认
 *   4. Pipeline 可视化 — 阶段进度条
 *   5. karpathy-wiki — 学习开关自动收集
 */
import { ref, nextTick, watch, computed, onMounted, onBeforeUnmount, onUnmounted } from 'vue'
import { useChat } from '@/composables/useChat'
import { useAgentStore } from '@/stores/agentStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSkillRouter } from '@/composables/useSkillRouter'
import { useFileStore } from '@/composables/useFileStore'
import MessageBubble from './MessageBubble.vue'
import MediaTaskBubble from './MediaTaskBubble.vue'
import FileUploader from './FileUploader.vue'
import ChatScrollNav from './ChatScrollNav.vue'
import { onEvent } from '@/utils/eventBus'
import AgentStatusBar from './AgentStatusBar.vue'
import SkillPickerBar from './SkillPickerBar.vue'
import VaultPickerBar from './VaultPickerBar.vue'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { RH_CREATION_MODELS } from '@/data/creationModels'
import { dedupeOfficeDownloadFiles, extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { isLocalModelProviderId } from '@/utils/providerConfig'

const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const vaultStore = useVaultStore()
const mediaTaskStore = useMediaTaskStore()
const fileStore = useFileStore()

// ─── 媒体模型检测 ───
// 已知的媒体模型前缀/ID（匹配 creationModels.ts 中的模型名）
const MEDIA_MODEL_PATTERNS = [
  'gpt-image', 'grok-image', 'grok-video', 'veo', 'seedance', 'suno',
  'dall-e', 'midjourney', 'stable-diffusion', 'flux',
]

function isMediaModel(modelId: string): false | 'image' | 'video' | 'audio' {
  const lower = modelId.toLowerCase()
  if (lower.includes('suno') || lower.includes('udio')) return 'audio'
  if (lower.includes('video') || lower.includes('veo') || lower.includes('seedance') || lower.includes('kling')) return 'video'
  if (MEDIA_MODEL_PATTERNS.some(p => lower.includes(p))) return 'image'
  return false
}
const { messages, isStreaming, sendMessage, stopStream, clearMessages, loadMessages,
  agentPhase, agentDetail, currentToolProgress, toolHistory } = useChat()
const {
  routeNotification, isRouting, routeMessage,
  // Superpowers 新增
  currentSkillId, pendingInvoke, pipelineActive, phaseHistory,
  PIPELINE_STAGES, PLANNER_SKILL_ID,
  buildSuperpowersPrompt, processChainInvoke, confirmChainInvoke, rejectChainInvoke, resetPipeline,
} = useSkillRouter()

const inputText = ref('')
const isMobileView = ref(window.innerWidth <= 768)
const _onResize = () => { isMobileView.value = window.innerWidth <= 768 }
onMounted(() => window.addEventListener('resize', _onResize))
onUnmounted(() => window.removeEventListener('resize', _onResize))
const messagesContainer = ref<HTMLElement | null>(null)
const showModelMenu = ref(false)
const cloudTextModels = computed(() => agentStore.textModels.filter(m => !isLocalModelProviderId(m.providerId)))
const localTextModels = computed(() => agentStore.textModels.filter(m => isLocalModelProviderId(m.providerId)))
const currentModelEntry = computed(() => agentStore.availableModels.find(m => m.id === agentStore.currentModel))
const isLocalModelActive = computed(() => isLocalModelProviderId(currentModelEntry.value?.providerId))
const fileUploader = ref<InstanceType<typeof FileUploader> | null>(null)
const scrollNav = ref<InstanceType<typeof ChatScrollNav> | null>(null)
const attachedFileCount = computed(() => fileUploader.value?.attachedFiles?.length || 0)
const isFileProcessing = computed(() => Boolean(fileUploader.value?.isProcessing))
const canSend = computed(() => (
  Boolean(inputText.value.trim()) || attachedFileCount.value > 0
) && !isStreaming.value && !isFileProcessing.value)
const currentVault = computed(() => vaultStore.activeVault)
const vaultStatusLabel = computed(() =>
  isStreaming.value ? '正在沉淀' : '知识库已绑定'
)
const vaultStatusTitle = computed(() =>
  isStreaming.value
    ? '正在把本轮对话沉淀到当前知识库'
    : '已绑定知识库，对话会自动进入 raw/对话记录，并按规则写回 wiki'
)

const displayMessages = computed(() => {
  let lastOfficeFiles: OfficeDownloadFile[] = []
  return messages.value
    .filter(m => m.content || m.toolCalls)
    .map((message) => {
      if (message.role === 'user') {
        lastOfficeFiles = []
        return message
      }

      const messageFiles = dedupeOfficeDownloadFiles([
        ...(message.officeDownloadFiles || []),
        ...extractOfficeDownloadFiles(message.content || ''),
      ])

      if (message.role === 'tool' && messageFiles.length) {
        lastOfficeFiles = messageFiles
        return { ...message, officeDownloadFiles: messageFiles }
      }

      if (message.role === 'assistant') {
        if (messageFiles.length) {
          lastOfficeFiles = messageFiles
          return { ...message, officeDownloadFiles: messageFiles }
        }
        if (!message.toolCalls?.length && lastOfficeFiles.length) {
          return { ...message, officeDownloadFiles: lastOfficeFiles }
        }
      }

      return message
    })
})

// ─── 引用文件芯片 ───
interface RefFile {
  name: string
  content: string
}
const referenceFiles = ref<RefFile[]>([])

// 监听文件树的引用事件
const offReferenceFile = onEvent('reference-file', (payload: unknown) => {
  const p = payload as RefFile
  if (p?.name && p?.content) {
    // 去重
    if (!referenceFiles.value.some(f => f.name === p.name)) {
      referenceFiles.value.push({ name: p.name, content: p.content })
    }
  }
})
onBeforeUnmount(offReferenceFile)

// 监听跨面板的"发送到对话"事件（媒体图片作为附件）
const offSendToChat = onEvent('send-to-chat', (payload: unknown) => {
  const p = payload as { url?: string; name?: string; type?: string }
  if (p?.url && fileUploader.value) {
    // 将 URL 转为附件添加到上传器
    fetch(p.url).then(r => r.blob()).then(blob => {
      const ext = p.type === 'video' ? 'mp4' : 'png'
      const mime = p.type === 'video' ? 'video/mp4' : 'image/png'
      const file = new File([blob], p.name || `media_${Date.now()}.${ext}`, { type: mime })
      fileUploader.value?.addExternalFiles([file])
    }).catch(() => { /* silently fail */ })
  }
})
onBeforeUnmount(offSendToChat)

function removeReference(index: number) {
  referenceFiles.value.splice(index, 1)
}

// 输入历史回填 (V4 stepChatInputRecall 行 7714)
const recallState = ref({ index: -1, draft: '' })
function stepInputRecall(direction: number) {
  const pool = messages.value.filter(m => m.role === 'user').map(m => m.content)
  if (!pool.length) return
  const state = recallState.value
  if (state.index === -1) state.draft = inputText.value
  let next = state.index + direction
  if (next < -1) next = -1
  if (next >= pool.length) next = pool.length - 1
  recallState.value = { index: next, draft: state.draft }
  inputText.value = next === -1 ? state.draft : pool[pool.length - 1 - next]
}
function resetRecall() { recallState.value = { index: -1, draft: '' } }

// 整理模式：绑定知识库后自动沉淀（不再需要手动开关）
const learningEnabled = computed(() => Boolean(vaultStore.activeVaultId))
const knowledgeRecordStatus = ref<'idle' | 'recording' | 'saved' | 'error'>('idle')

// Token 水位估算
const MAX_CONTEXT_TOKENS = 128000
const tokenEstimate = computed(() =>
  messages.value.reduce((sum, m) => sum + Math.ceil(m.content.length / 2.5), 0)
)
const tokenPercent = computed(() =>
  Math.min(99, Math.round(tokenEstimate.value / MAX_CONTEXT_TOKENS * 100))
)
const tokenLevel = computed(() =>
  tokenPercent.value > 85 ? 'danger' : tokenPercent.value > 60 ? 'warn' : 'ok'
)

// 当前 sessionId
let currentSessionId = ''

async function persistCurrentSession() {
  if (!currentSessionId || messages.value.length === 0) return
  const messageSnapshot = messages.value.map(message => ({ ...message }))
  await sessionStore.saveSession(
    currentSessionId,
    agentStore.currentAgent?.id || '',
    messageSnapshot,
    vaultStore.activeVaultId,
  )
}

async function syncCurrentSessionToRaw(vaultId = vaultStore.activeVaultId) {
  if (!vaultId || !currentSessionId || messages.value.length === 0) return
  knowledgeRecordStatus.value = 'recording'
  try {
    await fileStore.syncSessionToVaultRaw({
      vaultId,
      sessionId: currentSessionId,
      messages: messages.value.map(message => ({ ...message })),
      title: sessionStore.buildTitle(messages.value),
    })
    knowledgeRecordStatus.value = 'saved'
  } catch {
    knowledgeRecordStatus.value = 'error'
  }
}

const offVaultSelected = onEvent('vault-selected', async (payload: unknown) => {
  const vaultId = (payload as { vaultId?: string })?.vaultId || vaultStore.activeVaultId
  if (!vaultId || !currentSessionId || messages.value.length === 0) return
  await persistCurrentSession()
  await syncCurrentSessionToRaw(vaultId)
})
onBeforeUnmount(offVaultSelected)

const offVaultCleared = onEvent('vault-cleared', async () => {
  if (!currentSessionId || messages.value.length === 0) return
  await persistCurrentSession()
  knowledgeRecordStatus.value = 'idle'
})
onBeforeUnmount(offVaultCleared)

// 自动滚动到底部
watch(messages, () => {
  nextTick(() => {
    scrollNav.value?.autoScrollIfNeeded()
  })
}, { deep: true })

// 切换对话时加载历史消息
watch(() => sessionStore.activeSessionId, async (newId) => {
  if (!newId) {
    clearMessages()
    currentSessionId = ''
    resetPipeline() // 新对话重置 pipeline
    return
  }
  if (newId === currentSessionId) return
  currentSessionId = newId
  const history = await sessionStore.loadSessionMessages(newId)
  loadMessages(history)
  const session = sessionStore.sessions.find(s => s.id === newId)
  if (session) vaultStore.setActiveVault(session.vaultId || null)
}, { immediate: true })

/**
 * 构建 system prompt
 * 超能模式 ON → session hook（搭子互相感知）+ 当前 skill 全文
 * 超能模式 OFF → 仅用搭子的 skillContent
 */
function buildSystemPrompt(): string | undefined {
  if (isLocalModelActive.value) {
    return agentStore.currentAgent?.skillContent || undefined
  }
  if (agentStore.superpowerEnabled) {
    return buildSuperpowersPrompt(agentStore.agents, agentStore.currentAgent || null)
  }
  return agentStore.currentAgent?.skillContent || undefined
}

// 发送消息 + superpowers 完整流程
async function handleSend() {
  const hasText = inputText.value.trim().length > 0
  const hasAttachments = (fileUploader.value?.attachedFiles?.length || 0) > 0
  const isFileProcessing = fileUploader.value?.isProcessing

  if ((!hasText && !hasAttachments) || isStreaming.value || isFileProcessing) return

  const text = inputText.value.trim() || (hasAttachments ? '请分析这些文件' : '')
  inputText.value = ''

  // 收集引用文件
  const refFiles = [...referenceFiles.value]
  referenceFiles.value = []

  // 收集附件（V2: 支持远程 URL + Office 文本）
  const attachedFiles = fileUploader.value?.attachedFiles || []
  const images: string[] = []
  const files: Array<{ name: string; content: string }> = []

  for (const af of attachedFiles) {
    // 优先使用远程 URL（大图/上传的文件）
    if (af.remoteUrl && !af.textContent) {
      images.push(af.remoteUrl)
    } else if (af.preview && !af.textContent) {
      images.push(af.preview)
    }
    if (af.textContent) {
      files.push({ name: af.file.name, content: af.textContent })
    }
  }

  // 清空附件
  fileUploader.value?.clearAll()

  // ─── 媒体模型拦截：如果当前模型是媒体生成模型，走 Task Engine ───
  const currentModelId = agentStore.currentModel
  const mediaType = isMediaModel(currentModelId)
  if (mediaType) {
    // 首次发消息时创建 session
    if (!currentSessionId) {
      currentSessionId = sessionStore.startNewSession(
        agentStore.currentAgent?.id || '',
        vaultStore.activeVaultId,
      )
    }

    // 插入用户消息
    const userMsgId = 'msg_' + Date.now().toString(36) + '_u'
    messages.value.push({
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: images.length > 0 ? images : undefined,
    })

    // 提交到任务引擎
    const taskMsgId = 'msg_' + Date.now().toString(36) + '_t'
    const taskId = await mediaTaskStore.submitTask({
      type: mediaType,
      model: currentModelId,
      modelLabel: agentStore.modelLabel,
      prompt: text,
      referenceImages: images,
      source: 'chat',
      chatMessageId: taskMsgId,
      imageParams: mediaType === 'image' ? { model: currentModelId, prompt: text } : undefined,
      videoParams: mediaType === 'video' ? { model: currentModelId, prompt: text } : undefined,
    })

    // 插入任务占位消息（assistant 角色，content 标记 taskId）
    messages.value.push({
      id: taskMsgId,
      role: 'assistant',
      content: `[MEDIA_TASK:${taskId}]`,
      timestamp: Date.now(),
      agentId: agentStore.currentAgent?.id,
    })

    await persistCurrentSession()
    await syncCurrentSessionToRaw()
    await nextTick()
    scrollNav.value?.autoScrollIfNeeded()
    return // 不走文本 LLM 流程
  }

  // 1. 超能模式：自动分析意图并路由到合适搭子
  if (agentStore.superpowerEnabled && !isLocalModelActive.value) {
    const routableSkills = agentStore.getRoutableSkills()
    if (routableSkills.length > 0) {
      const result = await routeMessage(text, routableSkills)
      if ((result.strategy === 'single' || result.strategy === 'chain') && result.matched.length > 0) {
        // single: 明确匹配; chain: 多步协作（先激活第一个）
        agentStore.selectAgent(result.matched[0].skillId)
        agentStore.incrementCallCount(result.matched[0].skillId)
      } else if (result.strategy === 'ambiguous') {
        // 多搭子同分 → 交给 planner 裁决
        agentStore.selectAgent(PLANNER_SKILL_ID)
      }
    }
  }

  // 2. 首次发消息时创建 session
  if (!currentSessionId) {
    currentSessionId = sessionStore.startNewSession(
      agentStore.currentAgent?.id || '',
      vaultStore.activeVaultId,
    )
  }

  // 3. 合并引用文件到 files
  for (const rf of refFiles) {
    files.push({ name: rf.name, content: rf.content })
  }

  // 4. 发送消息（使用 superpowers 完整 prompt + 附件）
  await sendMessage(text, {
    systemPrompt: buildSystemPrompt(),
    agentId: agentStore.currentAgent?.id,
    agentName: agentStore.currentAgent?.name || agentStore.modelLabel,
    vaultId: vaultStore.activeVaultId || undefined,
    sessionId: currentSessionId,
    images: images.length > 0 ? images : undefined,
    files: files.length > 0 ? files : undefined,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
  })

  // 4. Chain Invoke 检测：检查 AI 最新回复是否包含 [INVOKE:xxx]
  if (agentStore.superpowerEnabled && !isLocalModelActive.value) {
    const lastMsg = messages.value.at(-1)
    if (lastMsg && lastMsg.role === 'assistant') {
      processChainInvoke(lastMsg.content, agentStore.agents)
    }
  }

  // 5. 保存到 IndexedDB
  await persistCurrentSession()
  await syncCurrentSessionToRaw()
}

// Chain Invoke 用户确认 → 切换到下一阶段并自动发消息
async function handleConfirmChain() {
  const nextSkill = confirmChainInvoke(agentStore.agents)
  if (nextSkill) {
    agentStore.selectAgent(nextSkill.id)
    // 自动发一条消息让 AI 开始下一阶段的工作
    await sendMessage('请开始这个阶段的工作。', {
      systemPrompt: buildSystemPrompt(),
      agentId: nextSkill.id,
      agentName: nextSkill.name,
      vaultId: vaultStore.activeVaultId || undefined,
      sessionId: currentSessionId,
    })
    // 检测新回复是否又有 chain invoke
    const lastMsg = messages.value.at(-1)
    if (lastMsg && lastMsg.role === 'assistant') {
      processChainInvoke(lastMsg.content, agentStore.agents)
    }
    // 保存
    await persistCurrentSession()
    await syncCurrentSessionToRaw()
  }
}

// Chain Invoke 用户拒绝
function handleRejectChain() {
  rejectChainInvoke()
}

// 新对话
function startNew() {
  clearMessages()
  currentSessionId = ''
  sessionStore.switchSession('')
  resetPipeline()
}

// 切换模型
function selectModel(modelId: string) {
  agentStore.setModel(modelId)
  showModelMenu.value = false
}

function toggleModelMenu() {
  showModelMenu.value = !showModelMenu.value
}

// 键盘事件 (V4 chatKeydown 行 10678)
function onKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl+Shift+↑↓ → 输入历史回填
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    stepInputRecall(e.key === 'ArrowUp' ? 1 : -1)
    return
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    handleSend()
  }
}

// 删除消息
function deleteMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  messages.value.splice(index, 1)
  void persistCurrentSession()
}

// 重新发送
function retryMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const msg = messages.value[index]
  if (msg && msg.role === 'user') {
    // 删除该消息及之后的所有消息
    messages.value.splice(index)
    inputText.value = msg.content
    void persistCurrentSession()
  }
}

async function continueAssistantMessage(messageId: string) {
  if (isStreaming.value) return
  const msg = messages.value.find(m => m.id === messageId && m.role === 'assistant')
  if (!msg) return
  const tail = msg.content
    .replace(/\n\n⚠️[\s\S]*$/, '')
    .slice(-1400)
  if (!currentSessionId) {
    currentSessionId = sessionStore.startNewSession(
      agentStore.currentAgent?.id || '',
      vaultStore.activeVaultId,
    )
  }
  await sendMessage(`请从上一条回答中断处继续写。不要重复已经写过的内容，直接承接上一句或上一段继续；保持同一风格、人物、设定和格式。

上一条回答最后部分如下，只用于定位断点，不要重复输出：
${tail}`, {
    systemPrompt: buildSystemPrompt(),
    agentId: agentStore.currentAgent?.id,
    agentName: agentStore.currentAgent?.name || agentStore.modelLabel,
    vaultId: vaultStore.activeVaultId || undefined,
    sessionId: currentSessionId,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
  })
  await persistCurrentSession()
  await syncCurrentSessionToRaw()
}

// textarea 自动增高
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 320) + 'px'
}

function handleInput(e: Event) {
  autoGrow(e.target as HTMLTextAreaElement)
}

onMounted(async () => {
  agentStore.restoreLastAgent()
  await Promise.all([
    sessionStore.loadAllSessions(),
    vaultStore.loadAll(),
    mediaTaskStore.init(),
  ])
  // 静默拉取动态模型列表（不阻塞 UI）
  agentStore.fetchModels()
  const session = sessionStore.sessions.find(s => s.id === currentSessionId)
  if (session) vaultStore.setActiveVault(session.vaultId || null)
})

// ─── 拖拽上传 ───
const isDragOver = ref(false)
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
  isDragOver.value = true
  fileUploader.value?.handleDragOver(e)
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 延迟关闭避免子元素触发 dragleave
  dragLeaveTimer = setTimeout(() => { isDragOver.value = false }, 100)
  fileUploader.value?.handleDragLeave(e)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
  if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
  fileUploader.value?.handleDrop(e)
}
</script>

<template>
  <div class="cp"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 拖拽上传覆盖层 -->
    <div v-if="isDragOver" class="cp-drag-overlay">
      <span class="mso" style="font-size:48px">upload_file</span>
      <span>松开上传文件</span>
    </div>
    <!-- Header -->
    <div class="cp-header">
      <div class="cp-title">
        <button class="cp-new-chat-btn" @click="startNew" title="新建对话 (清空当前上下文)">
          <span class="mso" style="font-size:16px">add_circle</span>
          <span>新建对话</span>
        </button>
        <span v-if="routeNotification" class="cp-route-badge">{{ routeNotification }}</span>
        <span v-if="isRouting" class="cp-route-badge routing">🔄 路由中...</span>
      </div>
      <div class="cp-actions">
        <!-- 模型选择 -->
        <div class="cp-model-wrap">
          <button class="cp-model-btn" @click="toggleModelMenu">
            <span class="mso" style="font-size: 14px;">deployed_code</span>
            {{ agentStore.modelLabel }}
          </button>
          <div v-if="showModelMenu" class="cp-model-menu">
            <div v-if="cloudTextModels.length" class="cp-model-group-title">云端模型</div>
            <button
              v-for="m in cloudTextModels"
              :key="m.id"
              class="cp-model-item"
              :class="{ active: m.id === agentStore.currentModel }"
              @click="selectModel(m.id)"
            >
              {{ m.label }}
            </button>
            <div v-if="localTextModels.length" class="cp-model-group-title">本地模型</div>
            <button
              v-for="m in localTextModels"
              :key="m.id"
              class="cp-model-item local"
              :class="{ active: m.id === agentStore.currentModel }"
              @click="selectModel(m.id)"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
        <!-- 整理状态指示（绑定知识库后自动开启） -->
        <span v-if="learningEnabled" class="cp-pill-toggle on" :title="vaultStatusTitle">
          <span class="cp-pill-dot"></span>
          <span class="cp-pill-text">{{ knowledgeRecordStatus === 'error' ? '沉淀待重试' : vaultStatusLabel }}</span>
        </span>
        <!-- Token 水位 -->
        <div class="cp-token-meter" :class="tokenLevel" :title="'上下文已使用 ' + tokenPercent + '%'">
          <span class="cp-token-num">{{ tokenPercent }}%</span>
        </div>
      </div>
    </div>

    <!-- ★ Superpowers Pipeline 进度条 -->
    <div v-if="pipelineActive && agentStore.superpowerEnabled" class="cp-pipeline">
      <div v-for="(stage, i) in PIPELINE_STAGES" :key="stage.id" class="cp-pipeline-step"
           :class="{
             active: currentSkillId === stage.id,
             done: phaseHistory.includes(stage.id) && currentSkillId !== stage.id,
           }">
        <span class="mso cp-pipeline-icon">{{ stage.icon }}</span>
        <span class="cp-pipeline-label">{{ stage.name }}</span>
        <span v-if="i < PIPELINE_STAGES.length - 1" class="cp-pipeline-arrow">→</span>
      </div>
    </div>

    <!-- ★ Chain Invoke 确认弹窗 -->
    <div v-if="pendingInvoke" class="cp-chain-confirm">
      <div class="cp-chain-msg">
        <span class="mso" style="font-size:18px">arrow_forward</span>
        AI 请求进入下一阶段:
        <strong>{{ PIPELINE_STAGES.find(s => s.id === pendingInvoke)?.name || pendingInvoke }}</strong>
      </div>
      <div class="cp-chain-actions">
        <button class="cp-chain-btn confirm" @click="handleConfirmChain">✓ 确认进入</button>
        <button class="cp-chain-btn reject" @click="handleRejectChain">✗ 跳过</button>
      </div>
    </div>

    <!-- Messages -->
    <!-- 消息区 (带滚动导航) -->
    <div ref="messagesContainer" class="cp-messages"
         @dragover.prevent="fileUploader?.handleDragOver($event)"
         @dragleave.prevent="fileUploader?.handleDragLeave($event)"
         @drop.prevent="fileUploader?.handleDrop($event)">
      <!-- Welcome -->
      <div v-if="messages.length === 0" class="cp-welcome">
        <h2 class="serif">韭菜盒子</h2>
        <p>聊天用豆包，干活用韭菜盒子。</p>
      </div>

      <!-- Message list -->
      <template v-for="msg in displayMessages" :key="msg.id">
        <!-- 媒体任务气泡 -->
        <div v-if="msg.content.startsWith('[MEDIA_TASK:')" class="msg assistant">
          <div class="msg-meta">
            <div class="msg-meta-avatar"><span class="mso" style="font-size:14px">palette</span></div>
            <span class="msg-meta-name">媒体生成</span>
          </div>
          <div class="msg-bubble">
            <MediaTaskBubble :task-id="msg.content.slice(12, -1)" />
          </div>
        </div>
        <!-- 普通消息气泡 -->
        <MessageBubble
          v-else
          :message-id="msg.id"
          :content="msg.content"
          :role="msg.role"
          :agent-id="msg.agentId"
          :agent-name="msg.agentName"
          :tool-calls="msg.toolCalls"
          :tool-name="msg.toolName"
          :office-download-files="msg.officeDownloadFiles"
          :images="msg.images"
          :files="msg.files"
          :finish-reason="msg.finishReason"
          @retry="retryMessage"
          @delete="deleteMessage"
          @continue="continueAssistantMessage"
        />
      </template>

      <!-- Streaming indicator -->
      <div v-if="isStreaming && (!messages.length || !messages[messages.length - 1]?.content)" class="msg assistant">
        <div class="msg-meta">
          <div class="msg-meta-avatar"><span class="mso" style="font-size: 14px;">smart_toy</span></div>
          <span class="msg-meta-name">{{ agentStore.currentAgent?.name || agentStore.modelLabel }}</span>
        </div>
        <div class="msg-bubble">
          <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
        </div>
      </div>
    </div>

    <!-- 滚动导航（移到对话框右侧） -->
    <ChatScrollNav ref="scrollNav" :container="messagesContainer" :is-streaming="isStreaming" :messages="messages" />

    <!-- Agent 状态条 -->
    <AgentStatusBar
      :phase="agentPhase"
      :detail="agentDetail"
      :tool-progress="currentToolProgress"
      :tool-history="toolHistory"
    />

    <!-- 附件预览 -->
    <FileUploader ref="fileUploader" />

    <!-- 搭子快捷按钮栏 -->
    <SkillPickerBar />

    <!-- 知识库选择器 -->
    <VaultPickerBar />

    <!-- 引用文件条 -->
    <div v-if="referenceFiles.length > 0" class="cp-ref-bar">
      <div v-for="(rf, i) in referenceFiles" :key="rf.name" class="cp-ref-chip">
        <span class="mso" style="font-size:13px">attach_file</span>
        <span class="cp-ref-name">{{ rf.name }}</span>
        <button class="cp-ref-remove" @click="removeReference(i)">
          <span class="mso" style="font-size:12px">close</span>
        </button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="cp-input-area">
      <div class="cp-input-wrap">
        <textarea
          v-model="inputText"
          placeholder="给搭子发指令..."
          :rows="isMobileView ? 2 : 4"
          @keydown="onKeydown"
          @input="handleInput"
          @paste="fileUploader?.handlePaste($event)"
        />
        <div class="cp-input-actions">
          <button class="ci-btn" title="上传文件" @click="fileUploader?.triggerFileInput()">
            <span class="mso">attach_file</span>
          </button>
          <button
            v-if="isStreaming"
            class="cp-stop"
            @click="stopStream"
            title="停止生成"
          >
            <span class="mso">stop</span>
          </button>
          <button
            v-else
            class="cp-send"
            :disabled="!canSend"
            @click="handleSend"
          >
            <span class="mso">send</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
  position: relative;
  width: 100%;
}

/* 拖拽上传覆盖层 */
.cp-drag-overlay {
  position: absolute; inset: 0; z-index: 100;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  background: rgba(107,142,35,.08);
  border: 3px dashed var(--olive);
  border-radius: 12px;
  color: var(--olive); font-size: 16px; font-weight: 700;
  pointer-events: none;
  animation: drag-pulse .8s ease infinite alternate;
}
@keyframes drag-pulse {
  from { background: rgba(107,142,35,.05); }
  to { background: rgba(107,142,35,.15); }
}

/* Header — from code.html line 208-219 */
.cp-header {
  height: var(--app-header-height); box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid var(--border2);
  background: transparent;
  flex-shrink: 0;
  gap: 12px;
}
.cp-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 新建对话按钮 */
.cp-new-chat-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 12px; border: 1px solid var(--olive);
  border-radius: 8px; background: transparent;
  color: var(--olive); font-size: 12px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: all .15s;
}
.cp-new-chat-btn:hover {
  background: var(--olive); color: #fff;
}
@container (max-width: 320px) {
  .cp-new-chat-btn span:not(.mso) { display: none; }
  .cp-new-chat-btn { padding: 5px 8px; }
}
/* Token 水位 */
.cp-token-meter {
  padding: 2px 8px; border-radius: 10px;
  font-size: 10px; font-weight: 700; font-family: 'SF Mono', monospace;
  border: 1px solid var(--line); transition: all .3s;
}
.cp-token-meter.ok { color: #4caf50; border-color: #c8e6c9; }
.cp-token-meter.warn { color: #ff9800; border-color: #ff9800; background: rgba(255,152,0,.06); }
.cp-token-meter.danger { color: #e53935; border-color: #e53935; background: rgba(229,57,53,.06); animation: pulse-danger 1.5s infinite; }
@keyframes pulse-danger { 0%,100%{opacity:1} 50%{opacity:.6} }
.cp-route-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--olive);
  color: #fff;
  font-weight: 600;
  animation: routeFade 3s forwards;
}
.cp-route-badge.routing {
  background: var(--line);
  color: var(--ink3);
  animation: none;
}
@keyframes routeFade {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}
.cp-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
/* vault 相关样式已迁移到 VaultPickerBar */
.cp-vault-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-bottom: 1px solid rgba(217, 119, 6, 0.18);
  background: rgba(251, 191, 36, 0.08);
  color: #92400e;
  font-size: 12px;
  font-weight: 650;
  flex-shrink: 0;
}
.cp-vault-hint button {
  margin-left: auto;
  padding: 4px 9px;
  border: 1px solid rgba(146, 64, 14, 0.35);
  border-radius: 999px;
  background: var(--surface);
  color: #92400e;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.cp-model-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink2);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.cp-model-btn:hover {
  border-color: rgba(213, 199, 135, 0.45);
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cp-act-btn {
  width: 30px; height: 30px;
  border: none; background: none;
  border-radius: 8px;
  color: var(--ink2);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px;
}
.cp-act-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}

/* Messages — from code.html line 283-365 */
.cp-messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px 16px;
  min-height: 0;
  position: relative;
}
.msg {
  display: flex;
  margin-bottom: 16px;
  flex-direction: column;
}
.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }
.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 2px 6px;
  font-size: 11px;
  color: var(--ink3);
}
.msg.user .msg-meta { justify-content: flex-end; }
.msg-meta-avatar {
  width: 22px; height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center; justify-content: center;
  background: rgba(213, 199, 135, 0.16);
  color: var(--olive-dark);
}
.msg.user .msg-meta-avatar {
  background: rgba(244, 241, 232, 0.92);
  color: var(--ink2);
  border: 1px solid color-mix(in srgb, #F4F1E8 78%, var(--border));
}
.msg-meta-name {
  font-weight: 700;
  color: var(--ink2);
}
.msg-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.7;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.msg.user .msg-bubble {
  background: var(--jc-surface-container-low);
  color: var(--ink);
  border: 1px solid var(--border);
  border-bottom-right-radius: 4px;
}
.msg.assistant .msg-bubble {
  background: var(--surface-alt);
  color: var(--ink);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.msg-body { white-space: pre-wrap; }

/* Welcome */
.cp-welcome {
  text-align: center;
  padding: 80px 24px;
  color: var(--ink3);
}
.cp-welcome h2 {
  font-size: 24px;
  color: var(--ink);
  margin-bottom: 8px;
}
.cp-welcome p {
  font-size: 14px;
  max-width: 400px;
  margin: 0 auto;
  line-height: 1.6;
}

/* Typing dots — from code.html line 362-365 */
.typing-dot {
  display: inline-block;
  width: 6px; height: 6px;
  background: var(--ink3);
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 0.6s infinite alternate;
}
.typing-dot:nth-child(2) { animation-delay: 0.15s; }
.typing-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce { to { transform: translateY(-4px); opacity: 0.4; } }

/* Input — from code.html line 374-388 */
.cp-input-area {
  padding: 10px 14px;
  border-top: 1px solid var(--border2);
  background: var(--surface);
  flex-shrink: 0;
}
.cp-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 10px 14px;
  transition: border-color 0.2s;
}
.cp-input-wrap:focus-within {
  border-color: var(--olive);
}
.cp-input-wrap textarea {
  flex: 1;
  border: none;
  background: none;
  font-size: 14px;
  font-family: inherit;
  color: var(--ink);
  outline: none;
  resize: none;
  max-height: 320px;
  min-height: 72px;
  line-height: 1.6;
}
.cp-input-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  align-self: flex-end;
  padding-bottom: 2px;
}
.ci-btn {
  width: 30px; height: 30px;
  border: none; background: none;
  border-radius: 50%;
  color: var(--ink3);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
  transition: all 0.12s;
}
.ci-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cp-send, .cp-stop {
  height: 36px;
  min-width: 36px;
  border: none;
  border-radius: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  transition: transform 0.1s;
}
.cp-send {
  background: var(--olive);
  color: #fff;
}
.cp-send:hover { transform: scale(1.05); }
.cp-send:disabled { opacity: 0.4; cursor: default; transform: none; }
.cp-stop {
  background: var(--jc-error);
  color: #fff;
}
.cp-stop:hover { transform: scale(1.05); }

/* Model dropdown — from code.html 行 704-712 */
.cp-model-wrap {
  position: relative;
}
.cp-model-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 300px;
  overflow-y: auto;
}
.cp-model-item {
  padding: 7px 12px;
  border: none;
  background: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink2);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all 0.12s;
}
.cp-model-item:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cp-model-item.active {
  background: rgba(213, 199, 135, 0.18);
  color: var(--olive-dark);
}
.cp-model-group-title {
  padding: 7px 10px 3px;
  color: var(--ink3);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.cp-model-item.local {
  color: var(--ink);
}

/* 药丸开关 */
.cp-pill-toggle {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px 3px 4px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--surface-alt);
  cursor: pointer; font-family: inherit; transition: all .25s;
}
.cp-pill-toggle:hover { border-color: var(--olive); }
.cp-pill-toggle.on { background: var(--olive); border-color: var(--olive); }
.cp-pill-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--ink3); opacity: .3;
  transition: all .25s; flex-shrink: 0;
}
.cp-pill-toggle.on .cp-pill-dot {
  background: #fff; opacity: 1; transform: translateX(0);
}
.cp-pill-text {
  font-size: 10px; font-weight: 700; color: var(--ink3); line-height: 1;
}
.cp-pill-toggle.on .cp-pill-text { color: #fff; }

/* ─── Superpowers Pipeline 进度条 ─── */
.cp-pipeline {
  display: flex; align-items: center; gap: 2px;
  padding: 6px 16px; border-bottom: 1px solid var(--line);
  background: linear-gradient(135deg, rgba(107,142,35,.03), rgba(213,199,135,.06));
  overflow-x: auto;
}
.cp-pipeline-step {
  display: flex; align-items: center; gap: 3px;
  padding: 3px 8px; border-radius: 12px;
  font-size: 11px; color: var(--ink3);
  transition: all .2s; white-space: nowrap;
}
.cp-pipeline-step.active {
  background: var(--olive); color: #fff; font-weight: 700;
  box-shadow: 0 2px 8px rgba(107,142,35,.3);
}
.cp-pipeline-step.done {
  background: rgba(107,142,35,.1); color: var(--olive-dark); font-weight: 600;
}
.cp-pipeline-icon { font-size: 14px !important; }
.cp-pipeline-label { font-size: 11px; }
.cp-pipeline-arrow { color: var(--ink3); opacity: .4; margin: 0 2px; font-size: 12px; }

/* ─── Chain Invoke 确认条 ─── */
.cp-chain-confirm {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; gap: 12px;
  background: linear-gradient(135deg, rgba(107,142,35,.08), rgba(213,199,135,.12));
  border-bottom: 1.5px solid var(--olive);
  animation: chain-slide-in .3s ease;
}
@keyframes chain-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.cp-chain-msg {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--ink1);
}
.cp-chain-msg strong { color: var(--olive-dark); }
.cp-chain-actions { display: flex; gap: 6px; flex-shrink: 0; }
.cp-chain-btn {
  padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 700;
  border: none; cursor: pointer; font-family: inherit; transition: all .12s;
}
.cp-chain-btn.confirm {
  background: var(--olive); color: #fff;
}
.cp-chain-btn.confirm:hover { filter: brightness(1.1); }
.cp-chain-btn.reject {
  background: var(--surface); color: var(--ink3); border: 1px solid var(--line);
}
.cp-chain-btn.reject:hover { border-color: var(--ink3); }

/* ─── 引用文件条 ─── */
.cp-ref-bar {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 6px 14px; border-top: 1px solid var(--line);
  background: var(--surface-alt);
  animation: ref-slide .2s ease;
}
@keyframes ref-slide {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.cp-ref-chip {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px 3px 6px; border-radius: 8px;
  background: rgba(107,142,35,.1); border: 1px solid rgba(107,142,35,.2);
  font-size: 11px; color: var(--olive-dark); font-weight: 600;
  animation: ref-chip-in .15s ease;
}
@keyframes ref-chip-in {
  from { transform: scale(.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.cp-ref-name {
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-ref-remove {
  width: 16px; height: 16px; border: none; background: none;
  border-radius: 50%; cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  color: var(--ink3); transition: all .12s;
}
.cp-ref-remove:hover {
  background: rgba(200,0,0,.1); color: #c00;
}

/* ═══ 移动端适配 ═══ */
@media (max-width: 768px) {
  .cp {
    height: 100vh !important;
    height: 100dvh !important;
    max-height: 100vh;
    max-height: 100dvh;
    overflow: hidden;
  }
  .cp-messages {
    flex: 1 1 0 !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow-y: auto !important;
  }
  .cp-input-area {
    flex-shrink: 0 !important;
    position: relative;
    z-index: 10;
  }
  .cp-input-wrap textarea {
    min-height: 36px;
    max-height: 100px;
    font-size: 16px; /* 防止 iOS 缩放 */
  }
  .cp-input-area { padding: 6px 8px; }
  .cp-input-wrap { padding: 6px 10px; border-radius: 12px; gap: 4px; }
  .cp-header { padding: 0 8px; }
  .cp-actions { gap: 4px; overflow-x: auto; flex-wrap: nowrap; }
  .cp-send, .cp-stop { height: 32px; min-width: 32px; padding: 0 8px; }
  .ci-btn { width: 28px; height: 28px; }
  .cp-messages { padding: 10px 8px; }
  .cp-welcome h2 { font-size: 20px; }
  .cp-welcome p { font-size: 13px; }
}
</style>
