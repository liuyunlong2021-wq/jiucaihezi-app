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
import { getMediaModel } from '@/data/mediaModelCapabilities'
import { dedupeOfficeDownloadFiles, extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { getModelProviderId, isLocalModelProviderId } from '@/utils/providerConfig'
import { approximateTokenSize } from 'tokenx'
import { formatTokens, formatContextWindow } from '@/data/modelContextWindows'
import { isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import { resolveTextModelSelection } from '@/utils/modelSelection'
import { isWebSearchEnabled } from '@/utils/webSearch'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { markSetupWizardDone } from '@/utils/localCapabilities'
import { buildExplicitAgentLockNotice, canAutoRouteAgent, isSkillContentResolved } from '@/utils/agentRuntime'
import { normalizeRuntimeCapabilityTier, type RuntimeCapabilityTier } from '@/utils/runtimeCapabilities'
import type { ModelEntry } from '@/stores/agentStore'

const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const vaultStore = useVaultStore()
const mediaTaskStore = useMediaTaskStore()
const fileStore = useFileStore()
// gatewayStore removed - use isCloudLoggedIn() or isCloudReady instead
const isMember = computed(() => true)  // All features now available once logged in

function isMediaModel(modelId: string): false | 'image' | 'video' | 'audio' {
  const model = getMediaModel(modelId)
  if (!model) return false
  return model.task === 'digital-human' ? 'video' : model.task
}

function requiresCreationPanelMediaModel(modelId: string): boolean {
  const model = getMediaModel(modelId)
  if (!model) return false
  return model.provider.startsWith('runninghub-') || model.id === 'suno-custom-song'
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
const smartAgentSwitchEnabled = ref(false)
const capabilityTier = ref<RuntimeCapabilityTier>(
  normalizeRuntimeCapabilityTier(localStorage.getItem('jcRuntimeCapabilityTier')),
)
const capabilityTierOptions: Array<{ value: RuntimeCapabilityTier; label: string; title: string }> = [
  { value: 'fast', label: '快速', title: '轻量上下文，低推理预算' },
  { value: 'balanced', label: '均衡', title: '标准上下文，中等推理预算' },
  { value: 'deep', label: '深度', title: '扩展上下文，高推理预算' },
  { value: 'full-vault', label: '全库', title: '面向全库审阅的最大上下文策略' },
]
function setCapabilityTier(tier: RuntimeCapabilityTier) {
  capabilityTier.value = tier
  localStorage.setItem('jcRuntimeCapabilityTier', tier)
}
const isMobileView = ref(window.innerWidth <= 768)
const _onResize = () => {
  isMobileView.value = window.innerWidth <= 768
  void nextTick(() => resizeComposer())
}
onMounted(() => window.addEventListener('resize', _onResize))
onUnmounted(() => window.removeEventListener('resize', _onResize))

// ─── Tauri OS 文件拖拽（Finder → 应用窗口） ───
let unlistenFileDrop: (() => void) | null = null
onMounted(async () => {
  if (!isTauriRuntime()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    unlistenFileDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return
      const paths = event.payload.paths || []
      for (const path of paths) {
        if (fileUploader.value) {
          // 用 Tauri FS 读文件，构造 File 对象
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs')
            const data = await readFile(path)
            const name = path.split('/').pop() || path.split('\\').pop() || 'unknown'
            const ext = name.split('.').pop()?.toLowerCase() || ''
            const mimeMap: Record<string, string> = {
              png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
              webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
              txt: 'text/plain', md: 'text/markdown', json: 'application/json',
              csv: 'text/csv', mp4: 'video/mp4', mov: 'video/quicktime',
              mp3: 'audio/mpeg', wav: 'audio/wav', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            }
            const mime = mimeMap[ext] || 'application/octet-stream'
            const blob = new Blob([new Uint8Array(data)], { type: mime })
            const file = new File([blob], name, { type: mime })
            fileUploader.value.addExternalFiles([file])
          } catch { /* skip unreadable files */ }
        }
      }
    })
  } catch { /* Tauri API not available */ }
})
onBeforeUnmount(() => { unlistenFileDrop?.(); unlistenFileDrop = null })
const messagesContainer = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
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
  currentVault.value ? '知识库已绑定' : '未绑定'
)
const vaultStatusTitle = computed(() =>
  currentVault.value
    ? `已绑定「${currentVault.value.name}」，对话中可检索知识库内容作为参考`
    : '绑定知识库后，AI 可检索你的知识库作为参考'
)

const displayMessages = computed(() => {
  let lastOfficeFiles: OfficeDownloadFile[] = []
  return messages.value
    .filter(m => {
      if (m.role === 'system') return false // 系统消息不显示（上下文清除标记等）
      if (m.role === 'tool') return true
      if (m.content && String(m.content).trim()) return true
      if (m.toolCalls && m.toolCalls.length > 0) return true
      if (m.isMediaTask) return true
      return false
    })
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
  if (!isMember.value) return
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
  if (!isMember.value) return
  const p = payload as { url?: string; name?: string; type?: string }
  if (p?.url && fileUploader.value && isAllowedMediaAttachmentUrl(p.url)) {
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
  void nextTick(() => resizeComposer())
}
function resetRecall() { recallState.value = { index: -1, draft: '' } }

// 知识库绑定：检索 + raw/ 同步（需手动整理转 Wiki）
const learningEnabled = computed(() => Boolean(isMember.value && vaultStore.activeVaultId))
const knowledgeRecordStatus = ref<'idle' | 'recording' | 'saved' | 'error'>('idle')

// ─── 联网搜索开关 ───
const searchEnabled = ref(isWebSearchEnabled())

function toggleWebSearch() {
  searchEnabled.value = !searchEnabled.value
  localStorage.setItem('jcWebSearchEnabled', String(searchEnabled.value))
}

// ─── Token 水位计（模型感知） ───
// 当前上下文的总 token 估算（绝对值，不随模型切换变化）
const contextTokens = computed(() => {
  let total = 0
  // 系统提示词
  const sp = isMember.value ? buildSystemPrompt() : ''
  if (sp) total += approximateTokenSize(sp)
  // 非 system 消息
  for (const m of messages.value) {
    if (m.role === 'system') continue
    total += approximateTokenSize(m.content || '')
    // 图片附件按 vision 计费：每张 ~85 tokens（低分辨率）
    if (m.images?.length && m.role === 'user') total += m.images.length * 85
  }
  return total
})

// 当前选中模型的上下文窗口
const currentModelContextWindow = computed(() => {
  const entry = agentStore.availableModels.find(m => m.id === agentStore.currentModel)
  return entry?.contextWindow ?? 128_000
})

// 占用百分比
const contextPercent = computed(() => {
  if (currentModelContextWindow.value <= 0) return 0
  return Math.round(contextTokens.value / currentModelContextWindow.value * 100)
})

// 水位等级
const contextLevel = computed(() => {
  if (contextTokens.value > currentModelContextWindow.value) return 'danger'
  if (contextPercent.value > 75) return 'warn'
  return 'ok'
})

// 水位提示文字
const contextTooltip = computed(() => {
  const usage = formatTokens(contextTokens.value)
  const limit = formatContextWindow(currentModelContextWindow.value)
  const pct = contextPercent.value
  if (contextTokens.value > currentModelContextWindow.value) {
    return `⚠️ 上下文超出模型上限（${usage} > ${limit}）。旧消息将被自动裁剪。建议清除上下文或切换大窗口模型。`
  }
  if (pct > 90) return `上下文接近上限：${usage} / ${limit}。旧消息即将被裁剪。`
  if (pct > 75) return `上下文用量偏高：${usage} / ${limit}。可清除上下文释放空间。`
  return `上下文用量：${usage} / ${limit}（${pct}%）`
})

// 输入框实时 token 估算
const inputTokenCount = computed(() => {
  const text = inputText.value.trim()
  if (!text) return 0
  return approximateTokenSize(text)
})

// 当前 sessionId
let currentSessionId = ''
let sessionLoadRequestId = 0

function resolveExistingSessionVaultId(sessionVaultId: string | null | undefined): string | null {
  if (!sessionVaultId) return null
  return vaultStore.vaults.some(vault => vault.id === sessionVaultId) ? sessionVaultId : null
}

async function persistCurrentSession() {
  if (!currentSessionId || messages.value.length === 0) return
  const messageSnapshot = messages.value.map(message => ({ ...message }))
  await sessionStore.saveSession(
    currentSessionId,
    isMember.value ? (agentStore.currentAgent?.id || '') : '',
    messageSnapshot,
    isMember.value ? vaultStore.activeVaultId : null,
  )
}

async function syncCurrentSessionToRaw(vaultId = vaultStore.activeVaultId) {
  if (!isMember.value) return
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
  if (!isMember.value) return
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
  const requestId = ++sessionLoadRequestId
  if (!newId) {
    clearMessages()
    currentSessionId = ''
    resetPipeline() // 新对话重置 pipeline
    return
  }
  if (newId === currentSessionId) return
  currentSessionId = newId
  const history = await sessionStore.loadSessionMessages(newId)
  if (requestId !== sessionLoadRequestId || sessionStore.activeSessionId !== newId) return
  loadMessages(history)
  const session = sessionStore.sessions.find(s => s.id === newId)
  vaultStore.setActiveVault(resolveExistingSessionVaultId(session?.vaultId))
  void nextTick(() => resizeComposer())
}, { immediate: true })

/**
 * 构建 system prompt
 * 超能模式 ON → session hook（搭子互相感知）+ 当前 skill 全文
 * 超能模式 OFF → 仅用搭子的 skillContent
 */
function buildSystemPrompt(): string | undefined {
  if (!isMember.value) return undefined
  if (isLocalModelActive.value) {
    return agentStore.currentAgent?.skillContent || undefined
  }
  if (agentStore.superpowerEnabled) {
    return buildSuperpowersPrompt(agentStore.agents, agentStore.currentAgent || null)
  }
  return agentStore.currentAgent?.skillContent || undefined
}

// ─── P0-4: 欢迎页建议卡片 ───
const welcomeCards = [
  { icon: 'edit_note', label: '写一篇文章', hint: '大纲、草稿、润色', prompt: '帮我写一篇文章，主题是：' },
  { icon: 'code', label: '写代码', hint: '生成、解释、调试', prompt: '帮我写一段代码，需求是：' },
  { icon: 'translate', label: '翻译文本', hint: '中英互译、多语言', prompt: '请帮我翻译以下内容：' },
  { icon: 'analytics', label: '分析数据', hint: '图表、趋势、洞察', prompt: '请帮我分析以下数据：' },
]

function useWelcomeSuggestion(prompt: string) {
  inputText.value = prompt
  void nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
    // 把光标移到末尾
    composerRef.value?.setSelectionRange(prompt.length, prompt.length)
  })
}

// 发送消息 + superpowers 完整流程
async function handleSend() {
  const hasText = inputText.value.trim().length > 0
  const hasAttachments = (fileUploader.value?.attachedFiles?.length || 0) > 0
  const isFileProcessing = fileUploader.value?.isProcessing

  if ((!hasText && !hasAttachments) || isStreaming.value || isFileProcessing) return

  const text = inputText.value.trim() || (hasAttachments ? '请分析这些文件' : '')
  inputText.value = ''
  resetRecall()

  // 引用回复上下文
  const replyContext = replyTarget.value
  replyTarget.value = null

  void nextTick(() => resetComposer({ focus: true }))

  // 收集引用文件
  const refFiles = [...referenceFiles.value]
  referenceFiles.value = []

  // 收集附件（V2: 支持远程 URL + Office 文本）
  const attachedFiles = fileUploader.value?.attachedFiles || []
  const memberAttachedFiles = attachedFiles
  const images: string[] = []
  const files: Array<{ name: string; content: string }> = []

  for (const af of memberAttachedFiles) {
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
  if (mediaType && isMember.value) {
    // 首次发消息时创建 session
    if (!currentSessionId) {
      currentSessionId = sessionStore.startNewSession(
        isMember.value ? (agentStore.currentAgent?.id || '') : '',
        isMember.value ? vaultStore.activeVaultId : null,
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

    if (requiresCreationPanelMediaModel(currentModelId)) {
      const structuredMediaMsgId = 'msg_' + Date.now().toString(36) + '_structured'
      messages.value.push({
        id: structuredMediaMsgId,
        role: 'assistant',
        content: `当前模型需要完整参数，请到创作面板或画布中使用「${agentStore.modelLabel}」。`,
        timestamp: Date.now(),
        agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
      })
      await persistCurrentSession()
      await syncCurrentSessionToRaw()
      await nextTick()
      scrollNav.value?.autoScrollIfNeeded()
      return
    }

    // 提交到任务引擎
    const taskMsgId = 'msg_' + Date.now().toString(36) + '_t'
    let taskId = ''
    try {
      taskId = await mediaTaskStore.submitTask({
        type: mediaType,
        model: currentModelId,
        modelLabel: agentStore.modelLabel,
        prompt: text,
        referenceImages: images,
        source: 'chat',
        chatMessageId: taskMsgId,
        imageParams: mediaType === 'image' ? { model: currentModelId, prompt: text, image: images.length > 1 ? images : images[0] } : undefined,
        videoParams: mediaType === 'video' ? { model: currentModelId, prompt: text, imageUrl: images[0], imageUrls: images.length > 1 ? images : undefined } : undefined,
        audioParams: mediaType === 'audio' ? { model: currentModelId, prompt: text } : undefined,
      })
    } catch (error) {
      const mediaTaskErrorMsgId = 'msg_' + Date.now().toString(36) + '_media_error'
      messages.value.push({
        id: mediaTaskErrorMsgId,
        role: 'assistant',
        content: `媒体任务提交失败：${error instanceof Error ? error.message : '请稍后重试'}`,
        timestamp: Date.now(),
        agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
      })
      await persistCurrentSession()
      await syncCurrentSessionToRaw()
      await nextTick()
      scrollNav.value?.autoScrollIfNeeded()
      return
    }

    // 插入任务占位消息（assistant 角色，content 标记 taskId）
    messages.value.push({
      id: taskMsgId,
      role: 'assistant',
      content: `[MEDIA_TASK:${taskId}]`,
      timestamp: Date.now(),
      agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
      isMediaTask: true,
      mediaTaskId: taskId,
    })

    await persistCurrentSession()
    await syncCurrentSessionToRaw()
    await nextTick()
    scrollNav.value?.autoScrollIfNeeded()
    return // 不走文本 LLM 流程
  }

  // 1. 超能模式：自动分析意图并路由到合适搭子
  if (isMember.value && agentStore.superpowerEnabled && !isLocalModelActive.value) {
    const routableSkills = agentStore.getRoutableSkills()
    if (routableSkills.length > 0) {
      const result = await routeMessage(text, routableSkills)
      if ((result.strategy === 'single' || result.strategy === 'chain') && result.matched.length > 0) {
        const matchedSkill = agentStore.agents.find(skill => skill.id === result.matched[0].skillId)
        if (canAutoRouteAgent({
          currentAgent: agentStore.currentAgent,
          smartSwitchEnabled: smartAgentSwitchEnabled.value,
        })) {
          // single: 明确匹配; chain: 多步协作（先激活第一个）
          agentStore.selectAgent(result.matched[0].skillId)
          agentStore.incrementCallCount(result.matched[0].skillId)
        } else if (matchedSkill && matchedSkill.id !== agentStore.currentAgent?.id) {
          routeNotification.value = buildExplicitAgentLockNotice(agentStore.currentAgent, matchedSkill.name)
        }
      } else if (result.strategy === 'ambiguous') {
        if (canAutoRouteAgent({
          currentAgent: agentStore.currentAgent,
          smartSwitchEnabled: smartAgentSwitchEnabled.value,
        })) {
          // 多搭子同分 → 交给 planner 裁决
          agentStore.selectAgent(PLANNER_SKILL_ID)
        } else {
          routeNotification.value = buildExplicitAgentLockNotice(agentStore.currentAgent, '规划师')
        }
      }
    }
  }

  // 2. 首次发消息时创建 session
  if (!currentSessionId) {
    currentSessionId = sessionStore.startNewSession(
      isMember.value ? (agentStore.currentAgent?.id || '') : '',
      isMember.value ? vaultStore.activeVaultId : null,
    )
  }

  // 3. 合并引用文件到 files
  for (const rf of refFiles) {
    files.push({ name: rf.name, content: rf.content })
  }

  // 4. 发送消息（使用 superpowers 完整 prompt + 附件）
  const chatModelId = isMember.value
    ? agentStore.currentModel
    : resolveTextModelSelection(agentStore.currentModel, agentStore.availableModels)
  const chatModelEntry = agentStore.availableModels.find(m => m.id === chatModelId)

  // 拼接引用回复上下文
  const sendText = replyContext
    ? `[引用回复] 用户引用了之前的消息: 「${replyContext.content}」\n\n${text}`
    : text

  if (isMember.value && agentStore.currentAgent && !isSkillContentResolved(agentStore.currentAgent)) {
    messages.value.push({
      id: 'msg_' + Date.now().toString(36) + '_skill_loading',
      role: 'assistant',
      content: `当前搭子「${agentStore.currentAgent.name}」的完整 SKILL.md 仍在加载，请稍后再发送。`,
      timestamp: Date.now(),
      agentId: agentStore.currentAgent.id,
    })
    await persistCurrentSession()
    await nextTick()
    scrollNav.value?.autoScrollIfNeeded()
    return
  }

  await sendMessage(sendText, {
    systemPrompt: isMember.value ? buildSystemPrompt() : undefined,
    agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
    agentName: isMember.value ? (agentStore.currentAgent?.name || agentStore.modelLabel) : agentStore.modelLabel,
    vaultId: isMember.value ? (vaultStore.activeVaultId || undefined) : undefined,
    sessionId: currentSessionId,
    images: images.length > 0 ? images : undefined,
    files: files.length > 0 ? files : undefined,
    modelId: chatModelId,
    modelProviderId: chatModelEntry?.providerId,
    capabilityTier: capabilityTier.value,
  })

  // 多模型并行：向每个并行模型发送相同的问题
  if (isParallelMode.value && parallelModels.value.length > 0) {
    const parallelSendPromises = parallelModels.value.map(async (modelId) => {
      const entry = agentStore.availableModels.find(m => m.id === modelId)
      if (!entry) return
      await sendMessage(sendText, {
        systemPrompt: isMember.value ? buildSystemPrompt() : undefined,
        agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
        agentName: isMember.value ? `[${entry.label}] ${agentStore.currentAgent?.name || ''}` : `[${entry.label}] ${agentStore.modelLabel}`,
        vaultId: isMember.value ? (vaultStore.activeVaultId || undefined) : undefined,
        sessionId: currentSessionId,
        images: images.length > 0 ? images : undefined,
        files: files.length > 0 ? files : undefined,
        modelId,
        modelProviderId: entry.providerId,
        capabilityTier: capabilityTier.value,
        _parallel: true,
      })
    })
    // 不等待并行请求完成，让它们各自流式输出
    void Promise.allSettled(parallelSendPromises)
  }

  // 4. Chain Invoke 检测：检查 AI 最新回复是否包含 [INVOKE:xxx]
  if (isMember.value && agentStore.superpowerEnabled && !isLocalModelActive.value) {
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
  if (!isMember.value) {
    rejectChainInvoke()
    return
  }
  const nextSkill = confirmChainInvoke(agentStore.agents)
  if (nextSkill) {
    agentStore.selectAgent(nextSkill.id)
    // 自动发一条消息让 AI 开始下一阶段的工作
    await sendMessage('请开始这个阶段的工作。', {
      systemPrompt: isMember.value ? buildSystemPrompt() : undefined,
      agentId: isMember.value ? nextSkill.id : undefined,
      agentName: isMember.value ? nextSkill.name : agentStore.modelLabel,
      vaultId: isMember.value ? (vaultStore.activeVaultId || undefined) : undefined,
      sessionId: currentSessionId,
      capabilityTier: capabilityTier.value,
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

// ─── P0-1: 原地编辑 user 消息 ───
const editingMessageId = ref<string | null>(null)
const editingMessageContent = ref('')

function editUserMessage(messageId: string) {
  const msg = messages.value.find(m => m.id === messageId && m.role === 'user')
  if (!msg) return
  // 如果后面有 assistant 回复，先截断
  const index = messages.value.findIndex(m => m.id === messageId)
  if (index >= 0 && index < messages.value.length - 1) {
    if (!confirm('编辑此消息将删除后续对话，确定继续？')) return
    messages.value.splice(index + 1)
  }
  editingMessageId.value = messageId
  editingMessageContent.value = msg.content
}

// ─── 编辑 assistant 消息 ───
const editingAssistantId = ref<string | null>(null)
const editingAssistantContent = ref('')

function editAssistantMessage(messageId: string) {
  const msg = messages.value.find(m => m.id === messageId && m.role === 'assistant')
  if (!msg) return
  editingAssistantId.value = messageId
  editingAssistantContent.value = msg.content
}

function cancelEditAssistant() {
  editingAssistantId.value = null
  editingAssistantContent.value = ''
}

function confirmEditAssistant() {
  const msgId = editingAssistantId.value
  const newContent = editingAssistantContent.value.trim()
  if (!msgId || !newContent) return
  const msg = messages.value.find(m => m.id === msgId)
  if (msg) {
    msg.content = newContent
    void persistCurrentSession()
  }
  editingAssistantId.value = null
  editingAssistantContent.value = ''
}

// ─── 引用回复 ───
const replyTarget = ref<{ messageId: string; content: string; role: string; agentName?: string } | null>(null)

function setReplyTarget(messageId: string) {
  const msg = messages.value.find(m => m.id === messageId)
  if (!msg) return
  replyTarget.value = {
    messageId: msg.id,
    content: msg.content.substring(0, 100),
    role: msg.role,
    agentName: msg.agentName,
  }
}

function clearReplyTarget() {
  replyTarget.value = null
}

function cancelEditMessage() {
  editingMessageId.value = null
  editingMessageContent.value = ''
}

async function confirmEditMessage() {
  const msgId = editingMessageId.value
  const newContent = editingMessageContent.value.trim()
  if (!msgId || !newContent) return

  const index = messages.value.findIndex(m => m.id === msgId)
  if (index === -1) return

  // 更新消息内容
  messages.value[index].content = newContent
  editingMessageId.value = null
  editingMessageContent.value = ''

  // 删除该消息之后的所有消息
  messages.value.splice(index + 1)

  void persistCurrentSession()

  // 自动重新发送
  inputText.value = newContent
  void nextTick(() => {
    resizeComposer()
    handleSend()
  })
}

// ─── P0-2: 重新生成 assistant 回复 ───
async function regenerateAssistantMessage(messageId: string) {
  if (isStreaming.value) return
  // 找到前一条 user 消息
  const index = messages.value.findIndex(m => m.id === messageId)
  if (index === -1) return

  // 找到这条 assistant 消息之前的最后一条 user 消息
  let userMsgIndex = -1
  for (let i = index - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') {
      userMsgIndex = i
      break
    }
  }
  if (userMsgIndex === -1) return

  const userMsg = messages.value[userMsgIndex]
  // 删除从该 user 消息之后的所有消息
  messages.value.splice(userMsgIndex + 1)

  void persistCurrentSession()

  // 重新发送
  await sendMessage(userMsg.content, {
    systemPrompt: isMember.value ? buildSystemPrompt() : undefined,
    agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
    agentName: isMember.value ? (agentStore.currentAgent?.name || agentStore.modelLabel) : agentStore.modelLabel,
    vaultId: isMember.value ? (vaultStore.activeVaultId || undefined) : undefined,
    sessionId: currentSessionId,
    images: userMsg.images,
    files: userMsg.files,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    capabilityTier: capabilityTier.value,
  })
  await persistCurrentSession()
  await syncCurrentSessionToRaw()
}

// 新对话
function startNew() {
  clearMessages()
  currentSessionId = ''
  sessionStore.switchSession('')
  resetPipeline()
}

// 切换模型
function selectModel(model: ModelEntry) {
  agentStore.setModel(model.id, getModelProviderId(model))
  showModelMenu.value = false
}

function toggleModelMenu() {
  showModelMenu.value = !showModelMenu.value
}

// ─── 多模型并行 ───
const parallelModels = ref<string[]>([])
const isParallelMode = ref(false)

function toggleParallelModel(modelId: string) {
  if (agentStore.currentModel === modelId) return
  const idx = parallelModels.value.indexOf(modelId)
  if (idx >= 0) {
    parallelModels.value.splice(idx, 1)
  } else {
    parallelModels.value.push(modelId)
  }
}

function toggleParallelMode() {
  isParallelMode.value = !isParallelMode.value
  if (!isParallelMode.value) parallelModels.value = []
}

// 键盘事件 (V4 chatKeydown 行 10678)
function onKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl+Shift+↑↓ → 输入历史回填
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    stepInputRecall(e.key === 'ArrowUp' ? 1 : -1)
    return
  }
  if (e.key !== 'Enter') return
  if (e.isComposing || e.keyCode === 229) return
  if (e.shiftKey && !e.metaKey && !e.ctrlKey) return
  if (isMobileView.value && !e.metaKey && !e.ctrlKey) return
  e.preventDefault()
  if (!canSend.value) return
  void handleSend()
}

// 删除消息
function deleteMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  messages.value.splice(index, 1)
  void persistCurrentSession()
}

// 重新发送 — 有附件时直接重发，无附件时填回输入框
async function retryMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const msg = messages.value[index]
  if (msg && msg.role === 'user') {
    const hasFollowingMessages = index < messages.value.length - 1
    if (hasFollowingMessages && !confirm('重新发送将删除该消息及之后的所有对话，确定继续？')) {
      return
    }
    messages.value.splice(index)
    void persistCurrentSession()

    // 有附件 → 直接重发（不需要用户再手动点发送）
    if (msg.images?.length || msg.files?.length) {
      if (!currentSessionId) {
        currentSessionId = sessionStore.startNewSession(
          isMember.value ? (agentStore.currentAgent?.id || '') : '',
          isMember.value ? vaultStore.activeVaultId : null,
        )
      }
      await sendMessage(msg.content || '请分析这些文件', {
        systemPrompt: isMember.value ? buildSystemPrompt() : undefined,
        agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
        agentName: isMember.value ? (agentStore.currentAgent?.name || agentStore.modelLabel) : agentStore.modelLabel,
        vaultId: isMember.value ? (vaultStore.activeVaultId || undefined) : undefined,
        sessionId: currentSessionId,
        images: msg.images,
        files: msg.files,
        modelId: agentStore.currentModel,
        modelProviderId: currentModelEntry.value?.providerId,
        capabilityTier: capabilityTier.value,
      })
      await persistCurrentSession()
      await syncCurrentSessionToRaw()
      return
    }

    // 无附件 → 填回输入框
    inputText.value = msg.content
    void nextTick(() => {
      resizeComposer()
      composerRef.value?.focus()
    })
  }
}

const isContinuing = ref(false)

async function continueAssistantMessage(messageId: string) {
  if (isStreaming.value || isContinuing.value) return
  isContinuing.value = true
  const msg = messages.value.find(m => m.id === messageId && m.role === 'assistant')
  if (!msg) return
  const tail = msg.content
    .replace(/\n\n⚠️[\s\S]*$/, '')
    .slice(-1400)
  if (!currentSessionId) {
    currentSessionId = sessionStore.startNewSession(
      isMember.value ? (agentStore.currentAgent?.id || '') : '',
      isMember.value ? vaultStore.activeVaultId : null,
    )
  }
  await sendMessage(`请从上一条回答中断处继续写。不要重复已经写过的内容，直接承接上一句或上一段继续；保持同一风格、人物、设定和格式。

上一条回答最后部分如下，只用于定位断点，不要重复输出：
${tail}`, {
    systemPrompt: isMember.value ? buildSystemPrompt() : undefined,
    agentId: isMember.value ? agentStore.currentAgent?.id : undefined,
    agentName: isMember.value ? (agentStore.currentAgent?.name || agentStore.modelLabel) : agentStore.modelLabel,
    vaultId: isMember.value ? (vaultStore.activeVaultId || undefined) : undefined,
    sessionId: currentSessionId,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    capabilityTier: capabilityTier.value,
  })
  await persistCurrentSession()
  await syncCurrentSessionToRaw()
  isContinuing.value = false
}

function resetComposer(options: { focus?: boolean } = {}) {
  const el = composerRef.value
  if (!el) return
  el.style.height = ''
  el.style.overflowY = 'hidden'
  el.scrollTop = 0
  if (options.focus) el.focus()
}

// ChatGPT-like 输入框：自动增高，到上限后内部滚动，清空后恢复紧凑高度。
function resizeComposer(target?: HTMLTextAreaElement) {
  const el = target || composerRef.value
  if (!el) return
  const value = target ? target.value : inputText.value
  if (!value) {
    resetComposer()
    return
  }
  const maxHeight = isMobileView.value ? 120 : Math.min(220, Math.floor(window.innerHeight * 0.3))
  el.style.height = 'auto'
  const nextHeight = Math.min(el.scrollHeight, maxHeight)
  const hasOverflow = el.scrollHeight > maxHeight
  el.style.height = `${nextHeight}px`
  el.style.overflowY = hasOverflow ? 'auto' : 'hidden'
  // 滚动条出现时右侧留白，避免文字被滚动条遮挡
  el.style.paddingRight = hasOverflow ? '8px' : '0px'
}

function handleInput(e: Event) {
  resetRecall()
  resizeComposer(e.target as HTMLTextAreaElement)
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
  if (session) vaultStore.setActiveVault(resolveExistingSessionVaultId(session.vaultId))
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
            <!-- 多模型对比开关 -->
            <div class="cp-model-group-title" style="display:flex;justify-content:space-between;align-items:center">
              <span>模型选择</span>
              <button class="cp-parallel-toggle" :class="{ active: isParallelMode }" @click="toggleParallelMode">
                {{ isParallelMode ? '对比中' : '多模型对比' }}
              </button>
            </div>
            <div v-if="cloudTextModels.length" class="cp-model-group-title">云端模型</div>
            <div class="cp-capability-row">
              <button
                v-for="option in capabilityTierOptions"
                :key="option.value"
                class="cp-capability-btn"
                :class="{ active: capabilityTier === option.value }"
                :title="option.title"
                @click.stop="setCapabilityTier(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <button
              v-for="m in cloudTextModels"
              :key="m.id"
              class="cp-model-item"
              :class="{ active: m.id === agentStore.currentModel, parallel: isParallelMode && parallelModels.includes(m.id) }"
              @click="isParallelMode ? toggleParallelModel(m.id) : selectModel(m)"
            >
              <span v-if="isParallelMode" class="cp-model-check">
                <span class="mso">{{ m.id === agentStore.currentModel ? 'radio_button_checked' : parallelModels.includes(m.id) ? 'check_box' : 'check_box_outline_blank' }}</span>
              </span>
              <span class="cp-model-label">{{ m.label }}</span>
            </button>
            <div v-if="localTextModels.length" class="cp-model-group-title">本地模型</div>
            <button
              v-for="m in localTextModels"
              :key="m.id"
              class="cp-model-item local"
              :class="{ active: m.id === agentStore.currentModel, parallel: isParallelMode && parallelModels.includes(m.id) }"
              @click="isParallelMode ? toggleParallelModel(m.id) : selectModel(m)"
            >
              <span v-if="isParallelMode" class="cp-model-check">
                <span class="mso">{{ m.id === agentStore.currentModel ? 'radio_button_checked' : parallelModels.includes(m.id) ? 'check_box' : 'check_box_outline_blank' }}</span>
              </span>
              <span class="cp-model-label">{{ m.label }}</span>
            </button>
            <div v-if="isParallelMode && parallelModels.length > 0" class="cp-model-group-title" style="color:var(--olive)">
              已选 {{ parallelModels.length + 1 }} 个模型（含当前主模型），发送时将并行调用
            </div>
          </div>
        </div>
        <!-- 知识库状态指示 -->
        <span v-if="learningEnabled" class="cp-pill-toggle on" :title="vaultStatusTitle">
          <span class="cp-pill-dot"></span>
          <span class="cp-pill-text">{{ vaultStatusLabel }}</span>
        </span>
        <!-- 联网搜索开关 -->
        <button class="cp-search-toggle" :class="{ on: searchEnabled }" @click="toggleWebSearch" :title="searchEnabled ? '联网搜索已开启，AI 将自动搜索最新信息' : '开启联网搜索，AI 可获取实时信息'">
          <span class="mso" style="font-size:14px">{{ searchEnabled ? 'travel_explore' : 'travel_explore' }}</span>
          <span>{{ searchEnabled ? '联网' : '搜索' }}</span>
        </button>
        <!-- Token 水位计（模型感知） -->
        <div class="cp-token-meter" :class="contextLevel" :title="contextTooltip">
          <div class="cp-token-bar-wrap">
            <div class="cp-token-bar" :style="{ width: Math.min(contextPercent, 100) + '%' }"></div>
          </div>
          <span class="cp-token-num">{{ formatTokens(contextTokens) }} / {{ formatContextWindow(currentModelContextWindow) }}</span>
          <span v-if="contextTokens > currentModelContextWindow" class="cp-token-overflow" title="超出模型上限">⚠️</span>
        </div>
      </div>
    </div>

    <!-- ★ Superpowers Pipeline 进度条 -->
    <div v-if="isMember && pipelineActive && agentStore.superpowerEnabled" class="cp-pipeline">
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
    <div v-if="isMember && pendingInvoke" class="cp-chain-confirm">
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
        <div class="cp-welcome-cards">
          <button
            v-for="card in welcomeCards"
            :key="card.label"
            class="cp-welcome-card"
            @click="useWelcomeSuggestion(card.prompt)"
          >
            <span class="mso cp-welcome-card-icon">{{ card.icon }}</span>
            <span class="cp-welcome-card-label">{{ card.label }}</span>
            <span class="cp-welcome-card-hint">{{ card.hint }}</span>
          </button>
        </div>
      </div>

      <!-- Message list -->
      <template v-for="msg in displayMessages" :key="msg.id">
        <!-- 媒体任务气泡 -->
        <div v-if="msg.isMediaTask" class="msg assistant">
          <div class="msg-meta">
            <div class="msg-meta-avatar"><span class="mso" style="font-size:14px">palette</span></div>
            <span class="msg-meta-name">媒体生成</span>
          </div>
          <div class="msg-bubble">
            <MediaTaskBubble :task-id="msg.mediaTaskId || msg.content.slice(12, -1)" />
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
          :reasoning-content="msg.reasoningContent"
          :timestamp="msg.timestamp"
          :search-results="msg.searchResults"
          :knowledge-hits="msg.knowledgeHits"
          :trace-summary="msg.traceSummary"
          :is-editing="editingAssistantId === msg.id"
          :editing-content="editingAssistantId === msg.id ? editingAssistantContent : undefined"
          @retry="retryMessage"
          @delete="deleteMessage"
          @continue="continueAssistantMessage"
          @edit="editUserMessage"
          @regenerate="regenerateAssistantMessage"
          @reply="setReplyTarget"
          @edit-assistant="editAssistantMessage"
          @update:editing-content="(c: string) => editingAssistantContent = c"
          @confirm-edit="confirmEditAssistant"
          @cancel-edit="cancelEditAssistant"
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
    <SkillPickerBar v-if="isMember" />

    <!-- 知识库选择器 -->
    <VaultPickerBar v-if="isMember" />

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

    <!-- 引用回复条 -->
    <div v-if="replyTarget" class="cp-reply-bar">
      <div class="cp-reply-bar-content">
        <span class="cp-reply-bar-label">回复 {{ replyTarget.role === 'user' ? '用户' : (replyTarget.agentName || '助手') }}：</span>
        <span class="cp-reply-bar-text">{{ replyTarget.content }}</span>
      </div>
      <button class="cp-reply-bar-close" @click="clearReplyTarget">
        <span class="mso" style="font-size:14px">close</span>
      </button>
    </div>

    <!-- 输入区 -->
    <div class="cp-input-area">
      <div class="cp-input-wrap">
        <textarea
          ref="composerRef"
          v-model="inputText"
          placeholder="给搭子发指令..."
          rows="1"
          @keydown="onKeydown"
          @input="handleInput"
          @paste="fileUploader?.handlePaste($event)"
        />
        <div v-if="inputText.trim()" class="cp-input-stats">
          <span class="cp-input-tokens" title="估算 token 数">≈{{ inputTokenCount }} tokens</span>
        </div>
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
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: 10px;
  font-size: 10px; font-weight: 700; font-family: 'SF Mono', monospace;
  border: 1px solid var(--line); transition: all .3s;
  min-width: 100px;
}
.cp-token-meter.ok { color: #4caf50; border-color: #c8e6c9; }
.cp-token-meter.warn { color: #ff9800; border-color: #ff9800; background: rgba(255,152,0,.06); }
.cp-token-meter.warn .cp-token-bar { background: #ff9800; }
.cp-token-meter.danger { color: #e53935; border-color: #e53935; background: rgba(229,57,53,.06); animation: pulse-danger 1.5s infinite; }
.cp-token-meter.danger .cp-token-bar { background: #e53935; }
.cp-token-bar-wrap {
  width: 40px; height: 4px; border-radius: 2px;
  background: var(--line); overflow: hidden; flex-shrink: 0;
}
.cp-token-bar {
  height: 100%; border-radius: 2px;
  background: #4caf50; transition: width .4s ease, background .3s;
  min-width: 2px;
}
.cp-token-overflow {
  font-size: 12px; cursor: help;
}

/* 输入区 token 统计 */
.cp-input-stats {
  display:flex; justify-content:flex-end; padding:2px 8px 0;
}
.cp-input-tokens {
  font-size:10px; color:var(--ink3); font-family:'SF Mono',monospace;
}
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
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink1);
  font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .12s;
}
.cp-model-btn:hover { border-color: var(--olive); }

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

/* 引用回复条 */
.cp-reply-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 14px;
  background: rgba(107,142,35,.06);
  border-top: 1px solid rgba(107,142,35,.15);
  border-bottom: 1px solid rgba(107,142,35,.1);
  flex-shrink: 0;
}
.cp-reply-bar-content {
  flex: 1; min-width: 0;
  font-size: 11px; line-height: 1.4;
  overflow: hidden;
}
.cp-reply-bar-label {
  color: var(--olive-dark); font-weight: 600;
  margin-right: 4px;
}
.cp-reply-bar-text {
  color: var(--ink3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cp-reply-bar-close {
  border: none; background: none;
  color: var(--ink3); cursor: pointer;
  padding: 2px; border-radius: 4px;
}
.cp-reply-bar-close:hover { color: var(--ink1); background: rgba(0,0,0,.05); }

/* Input — from code.html line 374-388 */
.cp-input-area {
  padding: 10px 14px;
  border-top: 1px solid var(--border2);
  background: var(--surface);
  flex-shrink: 0;
  max-height: 38vh;
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
  min-height: 24px;
  max-height: min(220px, 30vh);
  line-height: 1.55;
  padding: 6px 6px 6px 0;
  overflow-y: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
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
.cp-capability-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding: 4px 6px 6px;
}
.cp-capability-btn {
  min-width: 0;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink3);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.cp-capability-btn:hover,
.cp-capability-btn.active {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: rgba(107,142,35,.08);
}
.cp-model-item.local {
  color: var(--ink);
}

/* 多模型并行 */
.cp-parallel-toggle {
  padding: 2px 8px; border: 1px solid var(--border);
  border-radius: 10px; background: var(--surface);
  font-size: 10px; font-weight: 700; color: var(--ink3);
  cursor: pointer; font-family: inherit;
  transition: all .15s;
}
.cp-parallel-toggle:hover { border-color: var(--olive); color: var(--olive); }
.cp-parallel-toggle.active {
  border-color: var(--olive); color: #fff;
  background: var(--olive);
}
.cp-model-check { margin-right: 4px; opacity: 0.7; }
.cp-model-item.parallel { padding-left: 8px; }

/* 药丸开关 */
.cp-pill-toggle {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px 3px 4px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--surface-alt);
  cursor: pointer; font-family: inherit; transition: all .25s;
}
.cp-pill-toggle:hover { border-color: var(--olive); }
.cp-pill-toggle.on { background: var(--olive); border-color: var(--olive); }

/* 联网搜索开关 */
.cp-search-toggle {
  display: flex; align-items: center; gap: 3px;
  padding: 3px 8px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--surface-alt);
  color: var(--ink3); font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all .25s;
}
.cp-search-toggle:hover { border-color: var(--olive); color: var(--olive); }
.cp-search-toggle.on {
  background: #1a73e8; border-color: #1a73e8; color: #fff;
}
.cp-search-toggle .mso { font-size: 14px; }

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
    min-height: 24px;
    max-height: 120px;
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

/* ─── P0-4: 欢迎页建议卡片 ─── */
.cp-welcome-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  max-width: 420px;
  margin: 24px auto 0;
}
.cp-welcome-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 14px 12px; border: 1px solid var(--line);
  border-radius: 12px; background: var(--surface-alt);
  cursor: pointer; font-family: inherit;
  transition: all .15s; text-align: center;
}
.cp-welcome-card:hover {
  border-color: var(--olive);
  background: rgba(107,142,35,.04);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(107,142,35,.08);
}
.cp-welcome-card-icon {
  font-size: 22px !important;
  color: var(--olive);
}
.cp-welcome-card-label {
  font-size: 13px; font-weight: 700;
  color: var(--ink1);
}
.cp-welcome-card-hint {
  font-size: 10px; color: var(--ink3);
}

/* ─── P0-1: 编辑消息内联输入 ─── */
.cp-edit-inline {
  display: flex; gap: 6px; align-items: flex-end;
  padding: 6px 0; width: 100%;
}
.cp-edit-inline textarea {
  flex: 1; border: 1px solid var(--olive);
  border-radius: 8px; padding: 8px 12px;
  font-size: 13px; font-family: inherit;
  color: var(--ink); background: var(--surface);
  resize: vertical; min-height: 40px;
  outline: none;
}
.cp-edit-inline-actions {
  display: flex; gap: 4px; flex-shrink: 0;
}
.cp-edit-inline-btn {
  padding: 5px 12px; border-radius: 6px;
  font-size: 11px; font-weight: 700; cursor: pointer;
  border: none; font-family: inherit; transition: all .12s;
}
.cp-edit-inline-btn.confirm {
  background: var(--olive); color: #fff;
}
.cp-edit-inline-btn.cancel {
  background: var(--surface); color: var(--ink3);
  border: 1px solid var(--line);
}

</style>
