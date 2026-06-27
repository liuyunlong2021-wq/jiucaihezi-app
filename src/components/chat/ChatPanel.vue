<script setup lang="ts">
/**
 * ChatPanel — 对话面板容器
 *
 * 手动工作台执行原则：
 *   用户手动选择 Skill / 项目文件夹 / Model，OpenCode 被动工具由官方 runtime 和权限系统决定。
 */
import { ref, nextTick, watch, computed, onMounted, onBeforeUnmount, onUnmounted } from 'vue'
import { useChat, type ChatMessage, type OpenCodeSessionAction } from '@/composables/useChat'
import { useAgentStore } from '@/stores/agentStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import MessageBubble from './MessageBubble.vue'
import MediaTaskBubble from './MediaTaskBubble.vue'
import FileUploader from './FileUploader.vue'
import ChatScrollNav from './ChatScrollNav.vue'
import { consumeLastEvent, emitEvent, onEvent } from '@/utils/eventBus'
import AgentStatusBar from './AgentStatusBar.vue'
import ContextUsagePanel from './ContextUsagePanel.vue'
import MentionPopup, { type MentionItem } from './MentionPopup.vue'
import SkillPickerBar from './SkillPickerBar.vue'
import PermissionDock from './PermissionDock.vue'
import QuestionDock from './QuestionDock.vue'
import TodoDock from './TodoDock.vue'
import DiffReviewDock from './DiffReviewDock.vue'
import SessionShareNotice from './SessionShareNotice.vue'
import RevertDock from './RevertDock.vue'
import FollowupDock from './FollowupDock.vue'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { KB_COMMAND_PRESETS, type KbCommandPreset } from '@/data/kbCommandPresets'
import { getMediaModel } from '@/data/mediaModelCapabilities'
import { dedupeOfficeDownloadFiles, extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { getModelProviderId } from '@/utils/providerConfig'
import { isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import { resolveTextModelSelection } from '@/utils/modelSelection'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { markSetupWizardDone } from '@/utils/localCapabilities'
import { isSkillContentResolved } from '@/utils/agentRuntime'
import {
  needsServerParse,
  parseFilesOnServer,
  type AttachmentDocument,
} from '@/utils/webChatAttachments'
import { resolveOpenCodeP3KeyAction, shouldShowTabCloseCommand } from '@/utils/openCodeP3UiPolicy'
import type { ModelEntry } from '@/stores/agentStore'
import { confirmAction } from '@/utils/confirmAction'
import { ensureOpenCodeServer } from '@/opencodeClient/daemon'
import { createJiucaiOpenCodeClient } from '@/opencodeClient/client'
import {
  listOpenCodeCommands,
  listOpenCodeSkills,
  type OpenCodeCommandOption,
  type OpenCodeSkillOption,
} from '@/opencodeClient/catalog'
import { projectStoredNewApiForOpenCode } from '@/opencodeClient/providerProjection'
import { buildOpenCodeTimelineRows, type OpenCodeTimelineRow } from '@/opencodeClient/timelineRows'
import { listOpenCodeChatMessages, prefetchOpenCodeSession } from '@/opencodeClient/session'
import {
  buildContinuationChildrenByParent,
  buildLatestToolResultByAssistantId,
  collectContinuationThreadIds,
  getContinuationTailMessage,
} from './display/continuationDisplayModel'
import { KB_COMMAND_PRESETS } from '@/data/kbCommandPresets'

type DisplayChatMessage = ChatMessage & {
  latestToolResult?: string
}

const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const skillsManageStore = useSkillsManageStore()
const mediaTaskStore = useMediaTaskStore()
// gatewayStore removed - use isCloudLoggedIn() or isCloudReady instead
const isMember = computed(() => true)  // All features now available once logged in
const sessionLoadPromise = sessionStore.loadAllSessions()

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
  agentPhase, agentDetail, currentToolProgress, toolHistory, pendingPermissions, pendingQuestions, sessionTodos,
  sessionDiffs, turnDiffs, sessionCommandNotice, sessionShareUrl, respondPermission, replyQuestion, rejectQuestion,
  sessionRevertItems, restoringRevertId, sessionFollowups, sendingFollowupId,
  restoreRevertItem, sendFollowup, editFollowup, activeOpenCodeSessionId,
  runOpenCodeSessionAction, runSlashCommand, runShellCommand, getActiveOpenCodeSessionId,
  openCodeContextUsage } = useChat()

const baseComposerCommands = [
  { command: 'new', label: '新建会话', source: 'OpenCode session', group: 'Session', icon: 'add_circle' },
  { command: 'undo', label: '撤销上轮', source: 'OpenCode session', group: 'Session', icon: 'undo' },
  { command: 'redo', label: '重做上轮', source: 'OpenCode session', group: 'Session', icon: 'redo' },
  { command: 'share', label: '分享会话', source: 'OpenCode session', group: 'Session', icon: 'ios_share' },
  { command: 'unshare', label: '取消分享', source: 'OpenCode session', group: 'Session', icon: 'link_off' },
  { command: 'fork', label: 'Fork 会话分支', source: 'OpenCode session', group: 'Session', icon: 'call_split' },
  { command: 'archive', label: '归档', source: 'OpenCode session', group: 'Session', icon: 'archive' },
  { command: 'diff', label: 'Review / Diff', source: 'OpenCode session', group: 'Session', icon: 'difference' },
  { command: 'mcp', label: '外部工具扩展', source: 'External tools', group: '高级扩展', icon: 'extension' },
  { command: 'open', label: '打开项目文件', source: 'Custom file.open', group: '文件 / 上下文', icon: 'folder_open' },
  { command: 'context', label: '添加选区上下文', source: 'Custom context.addSelection', group: '文件 / 上下文', icon: 'playlist_add' },
  { command: 'terminal', label: 'Terminal 面板', source: 'Local UI terminal.toggle', group: '高级命令 / Terminal', icon: 'terminal' },
  { command: 'terminal.new', label: '新建 Terminal', source: 'Local UI terminal.new', group: '高级命令 / Terminal', icon: 'add_to_queue' },
  { command: 'message.previous', label: '上一条消息', source: 'Local UI message.previous', group: '消息导航', icon: 'keyboard_arrow_up' },
  { command: 'message.next', label: '下一条消息', source: 'Local UI message.next', group: '消息导航', icon: 'keyboard_arrow_down' },
  { command: 'tab.close', label: '关闭当前文件 Tab', source: 'Local UI tab.close', group: '文件 / 视图', icon: 'close' },
  { command: 'fileTree.toggle', label: '显示/隐藏文件树', source: 'Local UI fileTree.toggle', group: '文件 / 视图', icon: 'dock_to_right' },
  { command: 'skill', label: 'Skill 命令', source: 'Skill', group: 'Skill / 外部工具 / Custom', icon: 'psychology' },
]

const inputText = ref('')
const isMobileView = ref(window.innerWidth <= 768)
const isWebRuntime = computed(() => !isTauriRuntime())
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
const showShellCommandMenu = ref(false)
const showKbCommandMenu = ref(false)
const previewImageUrl = ref<string | null>(null)
const previewImageMime = ref('image/png')
const previewImageTitle = ref('')
const showContextPanel = ref(false)
const showMentionPopup = ref(false)
const mentionCursorPos = ref(0)
const mentionSelectedIdx = ref(0)

// P3-1: @-提及 可用条目
const mentionItems = computed<MentionItem[]>(() => {
  const items: MentionItem[] = [
    { type: 'file', value: 'CLAUDE.md', label: 'CLAUDE.md', group: '文件' },
    { type: 'file', value: 'AGENTS.md', label: 'AGENTS.md', group: '文件' },
  ]
  // agent 条目：当前已安装的 skill
  const skills = agentStore.getMySkills() || []
  for (const skill of skills) {
    const name = skill.name || skill.id || ''
    if (name) items.push({ type: 'agent', value: skill.id || name, label: name, group: 'Skill' })
  }
  return items
})

const selectedProjectDir = ref(localStorage.getItem('jc_project_dir') || '')
const selectedProjectName = computed(() => {
  if (!selectedProjectDir.value) return ''
  const parts = selectedProjectDir.value.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || ''
})
const showProjectMenu = ref(false)
const recentProjectDirs = ref<string[]>(JSON.parse(localStorage.getItem('jc_project_dirs') || '[]'))

function selectProject(dir: string) {
  selectedProjectDir.value = dir
  localStorage.setItem('jc_project_dir', dir)
  if (dir && !recentProjectDirs.value.includes(dir)) {
    recentProjectDirs.value.unshift(dir)
    if (recentProjectDirs.value.length > 10) recentProjectDirs.value.pop()
    localStorage.setItem('jc_project_dirs', JSON.stringify(recentProjectDirs.value))
  }
  showProjectMenu.value = false
}

async function pickProjectFolder() {
  showProjectMenu.value = false
  if (!isTauriRuntime()) return
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, title: '选择项目文件夹' })
    if (typeof selected === 'string') selectProject(selected)
  } catch (e) {
    console.warn('项目文件夹选择失败', e)
  }
}

function toggleProjectMenu(event: Event) {
  event.stopPropagation()
  showProjectMenu.value = !showProjectMenu.value
  showModeMenu.value = false
  showModelMenu.value = false
  showKbCommandMenu.value = false
}

function toggleModeMenu(event: Event) {
  event.stopPropagation()
  showModeMenu.value = !showModeMenu.value
  showProjectMenu.value = false
  showModelMenu.value = false
  showKbCommandMenu.value = false
}

function toggleKbCommandMenu(event: Event) {
  event.stopPropagation()
  showKbCommandMenu.value = !showKbCommandMenu.value
  showProjectMenu.value = false
  showModeMenu.value = false
  showModelMenu.value = false
  showComposerCommandMenu.value = false
  showShellCommandMenu.value = false
}

function fillKbCommand(preset: KbCommandPreset) {
  inputText.value = preset.template
  showKbCommandMenu.value = false
  void nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
  })
}

function clearProject() {
  selectedProjectDir.value = ''
  localStorage.removeItem('jc_project_dir')
  showProjectMenu.value = false
}

type AgentMode = 'build' | 'plan' | 'direct'
const savedAgentMode = localStorage.getItem('jc_agent_mode') as AgentMode | null
const agentMode = ref<AgentMode>(savedAgentMode === 'plan' || savedAgentMode === 'direct' ? savedAgentMode : 'build')
const showModeMenu = ref(false)
const agentModeLabel = computed(() => agentMode.value === 'plan' ? '文' : agentMode.value === 'direct' ? '直连' : '武')
const agentModeTitle = computed(() => {
  if (agentMode.value === 'plan') return '文模式：不操控电脑'
  if (agentMode.value === 'direct') return '直连模式：不使用 OpenCode'
  return '武模式：直接操控电脑'
})
const currentDesktopOpenCodeAgent = computed(() =>
  isTauriRuntime() && agentMode.value !== 'direct' ? agentMode.value : undefined,
)
function selectAgentMode(mode: AgentMode) {
  agentMode.value = mode
  localStorage.setItem('jc_agent_mode', mode)
  showModeMenu.value = false
}
const shellCommandText = ref('')
const localCommandNotice = ref('')
const openCodeSkills = ref<OpenCodeSkillOption[]>([])
const openCodeSkillLoading = ref(false)
const openCodeSkillError = ref('')
const selectedOpenCodeSkill = ref(localStorage.getItem('jc_opencode_skill') || '')
const openCodeCustomCommands = ref<OpenCodeCommandOption[]>([])
const openCodeCommandError = ref('')
const activeEditorFileId = ref<string | null>(null)
const currentModelEntry = computed(() => agentStore.availableModels.find(m => m.id === agentStore.currentModel))
const fileUploader = ref<InstanceType<typeof FileUploader> | null>(null)
const scrollNav = ref<InstanceType<typeof ChatScrollNav> | null>(null)
const sessionHydrating = ref(false)
const attachedFileCount = computed(() => fileUploader.value?.attachedFiles?.length || 0)
const isFileProcessing = computed(() => Boolean(fileUploader.value?.isProcessing))
const canSend = computed(() => (
  Boolean(inputText.value.trim()) || attachedFileCount.value > 0
) && !isFileProcessing.value && !sessionHydrating.value)
const canCompactContext = computed(() =>
  !isWebRuntime.value
  && !isStreaming.value
  && !sessionHydrating.value
  && Boolean(activeOpenCodeSessionId.value)
  && messages.value.some(message => message.role !== 'system')
)

const centralOpenCodeSkills = computed<OpenCodeSkillOption[]>(() =>
  skillsManageStore.centralSkills.map(skill => ({
    name: skill.name,
    label: skillsManageStore.getSkillDisplayName(skill),
    description: skill.description || undefined,
    location: skill.canonical_path || skill.file_path,
  }))
)
const webBuiltInSkills = computed<OpenCodeSkillOption[]>(() => {
  if (isTauriRuntime()) return []
  const seen = new Set<string>()
  return [
    ...agentStore.loadSkills(),
    ...agentStore.getPresetSkills(),
  ].filter(skill => {
    const key = skill.name || skill.id
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).map(skill => ({
    name: skill.name,
    label: skill.name,
    description: skill.description || undefined,
    location: String(skill.skillContent || ''),
    content: String(skill.skillContent || ''),
  }))
})
const selectableOpenCodeSkills = computed<OpenCodeSkillOption[]>(() => {
  const seen = new Set<string>()
  const merged: OpenCodeSkillOption[] = []
  for (const skill of webBuiltInSkills.value) {
    if (!skill.name || seen.has(skill.name)) continue
    seen.add(skill.name)
    merged.push(skill)
  }
  for (const skill of centralOpenCodeSkills.value) {
    if (!skill.name || seen.has(skill.name)) continue
    seen.add(skill.name)
    merged.push(skill)
  }
  for (const skill of openCodeSkills.value) {
    if (!skill.name || seen.has(skill.name)) continue
    seen.add(skill.name)
    merged.push(skill)
  }
  return merged
})
const selectedOpenCodeSkillOption = computed(() => {
  const selectedName = selectedOpenCodeSkill.value
  if (!selectedName) return null
  return selectableOpenCodeSkills.value.find(skill => skill.name === selectedName) || null
})
const effectiveOpenCodeSkillName = computed(() =>
  selectedOpenCodeSkillOption.value?.name || ''
)
const hiddenComposerSessionCommands = new Set(['compact', 'summarize'])
const sessionActionBySlash: Partial<Record<string, OpenCodeSessionAction>> = {
  new: 'new',
  compact: 'compact',
  summarize: 'compact',
  undo: 'undo',
  redo: 'redo',
  share: 'share',
  unshare: 'unshare',
  fork: 'fork',
  archive: 'archive',
  diff: 'diff',
  delete: 'delete',
}
const composerCommands = computed(() => {
  const base = baseComposerCommands.filter(item =>
    !hiddenComposerSessionCommands.has(item.command)
    && (item.command !== 'tab.close' || shouldShowTabCloseCommand(activeEditorFileId.value))
  )
  const seen = new Set(base.map(item => item.command))
  const dynamicCommands = openCodeCustomCommands.value
    .filter(item => item.slash && !seen.has(item.slash) && !hiddenComposerSessionCommands.has(item.slash))
    .map(item => {
      const command = String(item.slash || '')
      return {
        command,
        label: item.label,
        source: item.source,
        group: 'Skill / 外部工具 / Custom',
        icon: item.source === 'MCP' ? 'extension' : item.source === 'Skill' ? 'psychology' : 'terminal',
      }
    })
  return [...base, ...dynamicCommands]
})
const displayMessages = computed(() => {
  let lastOfficeFiles: OfficeDownloadFile[] = []
  const latestToolResultByAssistantId = buildLatestToolResultByAssistantId(messages.value)
  const groupedContinuationParts = buildContinuationChildrenByParent(messages.value)
  const continuationChildIds = new Set<string>()
  for (const children of groupedContinuationParts.values()) {
    for (const child of children) continuationChildIds.add(child.id)
  }
  const enrichedMessages = messages.value
    .map((message) => {
      const messageFiles = dedupeOfficeDownloadFiles([
        ...(message.officeDownloadFiles || []),
        ...extractOfficeDownloadFiles(message.content || ''),
      ])

      if (message.role === 'tool') {
        if (messageFiles.length) lastOfficeFiles = messageFiles
        return { ...message, officeDownloadFiles: messageFiles.length ? messageFiles : undefined }
      }

      if (message.role === 'user') {
        lastOfficeFiles = []
        return message
      }

      if (message.role === 'assistant') {
        const latestToolResult = latestToolResultByAssistantId.get(message.id)
        if (messageFiles.length) {
          lastOfficeFiles = messageFiles
          return { ...message, officeDownloadFiles: messageFiles, latestToolResult }
        }
        if (!message.toolCalls?.length && lastOfficeFiles.length) {
          return { ...message, officeDownloadFiles: lastOfficeFiles, latestToolResult }
        }
        if (latestToolResult) return { ...message, latestToolResult }
      }

      return message
    }) as DisplayChatMessage[]

  return enrichedMessages.filter(m => {
    if (m.role === 'system') return false
    if (m.role === 'tool') return false  // 工具返回值不显示，LLM 会在回复中解释
    if (m.isContinuationPrompt) return false
    if (continuationChildIds.has(m.id)) return false
    if (m.content && String(m.content).trim()) return true
    if (m.reasoningContent && String(m.reasoningContent).trim()) return true
    if (m.toolCalls && m.toolCalls.length > 0) return true
    if (m.openCodeParts && m.openCodeParts.some(part => part.type !== 'text' || Boolean(part.text?.trim()))) return true
    if (m.isMediaTask) return true
    return false
  })
})
const continuationChildrenByParent = computed(() => buildContinuationChildrenByParent(messages.value))

function isAssistantStreamingMessage(message: DisplayChatMessage): boolean {
  if (!isStreaming.value) return false
  if (message.role !== 'assistant') return false
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const candidate = messages.value[index]
    if (candidate.role === 'assistant') return candidate.id === message.id
  }
  return false
}

function hasOpenCodeTimeline(message: DisplayChatMessage): boolean {
  return message.role === 'assistant' && Boolean(message.openCodeParts?.length)
}

function openCodeRowsForMessage(message: DisplayChatMessage): OpenCodeTimelineRow[] {
  return buildOpenCodeTimelineRows([message], {
    isStreaming: isAssistantStreamingMessage(message),
    activeAssistantMessageId: message.id,
  })
}

// 🔧 Phase B: 滚动到 DiffReviewDock 区域
const flashTimer = ref<ReturnType<typeof setTimeout> | null>(null)
function scrollToDiffReview() {
  const el = document.querySelector('[data-component="session-diff-summary"]')
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 短暂高亮闪烁
  el.classList.add('cp-diff-flash')
  if (flashTimer.value) clearTimeout(flashTimer.value)
  flashTimer.value = setTimeout(() => {
    el.classList.remove('cp-diff-flash')
    flashTimer.value = null
  }, 1200)
}
onBeforeUnmount(() => {
  if (flashTimer.value) {
    clearTimeout(flashTimer.value)
    flashTimer.value = null
  }
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

function appendChatInput(payload: unknown) {
  if (!isMember.value) return
  const text = String(payload || '').trim()
  if (!text) return
  inputText.value = inputText.value.trim()
    ? `${inputText.value.trim()}\n\n${text}`
    : text
  void nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
  })
}

const offAppendChatInput = onEvent('append-chat-input', appendChatInput)
onMounted(() => {
  const pending = consumeLastEvent('append-chat-input')
  if (pending?.length) appendChatInput(pending[0])
})
onBeforeUnmount(offAppendChatInput)

// P1-3: rename session → 同步到 OpenCode remote（best-effort）
const offRenameOpenCodeSession = onEvent('rename-open-code-session', async (payload: unknown) => {
  const { sessionId, title } = (payload as { sessionId?: string; title?: string }) || {}
  if (!sessionId || !title) return
  try {
    const { ensureOpenCodeServer } = await import('@/opencodeClient/daemon')
    const { createJiucaiOpenCodeClient } = await import('@/opencodeClient/client')
    const handle = await ensureOpenCodeServer({ config: {} })
    if (!handle) return
    const client = createJiucaiOpenCodeClient(handle)
    await (client.session as any).update({ sessionID: sessionId, title })
  } catch (e) {
    console.warn('[JC] OpenCode session rename sync failed:', e)
  }
})
onBeforeUnmount(offRenameOpenCodeSession)

// P2-2: FileTree 查看详情 → 打开 Context 面板
const offViewSessionDetail = onEvent('view-session-detail', () => {
  showContextPanel.value = true
})
onBeforeUnmount(offViewSessionDetail)

async function loadSkillUriContent(skillUri: string): Promise<string> {
  const relativePath = skillUri.replace(/^skill:\/\//, '').replace(/^\/+/, '')
  if (!relativePath || relativePath.includes('..') || relativePath.includes('\0')) return ''
  try {
    const url = new URL(`/skills/${relativePath}`, window.location.href).toString()
    const response = await fetch(url)
    if (!response.ok) return ''
    return (await response.text()).slice(0, 50_000)
  } catch {
    return ''
  }
}

const offSkillModifyRequested = onEvent('skill-modify-requested', async (payload: unknown) => {
  if (!isMember.value) return
  const p = payload as { id?: string; name?: string; skillContent?: string }
  if (!p?.id || !p.name) return
  let content = (p.skillContent || '').trim()
  if (content.startsWith('skill://')) {
    content = (await loadSkillUriContent(content)).trim()
  }
  inputText.value = [
    `请帮我修改这个 Skill：「${p.name}」。`,
    '',
    `内部保存目标：这是已有 Skill，最终保存时请调用 save_skill 并传入 target_skill_id="${p.id}"，覆盖原 Skill，不要新建重复 Skill。`,
    '',
    '当前 SKILL.md：',
    '```md',
    content || '(当前没有可用的 SKILL.md 内容，请先帮我补齐标准 SKILL.md。)',
    '```',
    '',
    '我的修改要求：',
  ].join('\n')
  resetRecall()
  void nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
  })
})
onBeforeUnmount(offSkillModifyRequested)

function removeReference(index: number) {
  referenceFiles.value.splice(index, 1)
}

function setLocalCommandNotice(text: string) {
  localCommandNotice.value = text
  if (localCommandNoticeTimer) clearTimeout(localCommandNoticeTimer)
  localCommandNoticeTimer = setTimeout(() => {
    localCommandNotice.value = ''
    localCommandNoticeTimer = null
  }, 8000)
}

function clearLocalCommandNotice() {
  localCommandNotice.value = ''
  if (localCommandNoticeTimer) {
    clearTimeout(localCommandNoticeTimer)
    localCommandNoticeTimer = null
  }
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

// 当前 sessionId
let currentSessionId = ''
let sessionLoadRequestId = 0
let rawSyncStartMessageCount = 0
let persistTimer: ReturnType<typeof setTimeout> | null = null
let localCommandNoticeTimer: ReturnType<typeof setTimeout> | null = null

async function persistCurrentSession() {
  if (!currentSessionId || messages.value.length === 0) return
  const messageSnapshot = messages.value.map(message => ({ ...message }))
  await sessionStore.saveSession(
    currentSessionId,
    '',
    messageSnapshot,
    { openCodeSessionId: getActiveOpenCodeSessionId() || undefined },
  )
}

async function flushCurrentSessionPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  await persistCurrentSession()
}

async function syncCurrentSessionToRaw() {}

const offEditorFileChanged = onEvent('editor-file-changed', (payload: unknown) => {
  const fileId = (payload as { fileId?: string | null } | null)?.fileId
  activeEditorFileId.value = fileId ? String(fileId) : null
})
onBeforeUnmount(offEditorFileChanged)

// 自动滚动到底部
watch(messages, () => {
  nextTick(() => {
    scrollNav.value?.scheduleAutoScrollIfNeeded()
  })
  if (currentSessionId && !sessionHydrating.value) {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void persistCurrentSession()
    }, 350)
  }
}, { deep: true })

onBeforeUnmount(() => {
  if (persistTimer) clearTimeout(persistTimer)
  if (localCommandNoticeTimer) clearTimeout(localCommandNoticeTimer)
})

async function startOutputFollow() {
  await nextTick()
  scrollNav.value?.startStickyFollow()
}

// 切换对话时加载历史消息
watch(() => sessionStore.activeSessionId, async (newId) => {
  const requestId = ++sessionLoadRequestId
  if (!newId) {
    void clearMessages()
    currentSessionId = ''
    rawSyncStartMessageCount = 0
    sessionHydrating.value = false
    return
  }
  if (newId === currentSessionId) return
  currentSessionId = newId
  sessionHydrating.value = true
  try {
    await sessionLoadPromise
    const history = await sessionStore.loadSessionMessages(newId)
    if (requestId !== sessionLoadRequestId || sessionStore.activeSessionId !== newId) return
    const session = sessionStore.sessions.find(s => s.id === newId)
    let effectiveHistory = history
    if (session?.openCodeSessionId) {
      try {
        const projectedConfig = await projectStoredNewApiForOpenCode({
          currentModel: agentStore.currentModel,
          models: agentStore.availableModels,
        })
        const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: selectedProjectDir.value || undefined })
        const client = createJiucaiOpenCodeClient(handle, selectedProjectDir.value || undefined)
        await prefetchOpenCodeSession(client, session.openCodeSessionId)
        const openCodeHistory = await listOpenCodeChatMessages(client, session.openCodeSessionId, {
          preferCache: true,
          directory: selectedProjectDir.value || handle.directory,
        })
        effectiveHistory = openCodeHistory.length ? openCodeHistory : history
      } catch {
        effectiveHistory = history
      }
    }
    if (isMember.value) agentStore.currentAgent = null
    rawSyncStartMessageCount = 0
    loadMessages(effectiveHistory, {
      agentId: '',
      skillContent: '',
      openCodeSessionId: session?.openCodeSessionId,
    })
    void nextTick(() => resizeComposer())
  } finally {
    if (requestId === sessionLoadRequestId) sessionHydrating.value = false
  }
}, { immediate: true })

async function restoreActiveSession() {
  if (!isWebRuntime.value) return
  await sessionStore.loadAllSessions()
  const activeId = String(sessionStore.activeSessionId || localStorage.getItem('jc_active_session') || '').trim()
  if (!activeId) return
  if (activeId === currentSessionId && messages.value.length > 0) return

  const requestId = ++sessionLoadRequestId
  currentSessionId = activeId
  sessionHydrating.value = true
  try {
    const history = await sessionStore.loadSessionMessages(activeId)
    if (requestId !== sessionLoadRequestId) return
    if (!history.length) return

    const session = sessionStore.sessions.find(s => s.id === activeId)
    if (sessionStore.activeSessionId !== activeId) {
      sessionStore.switchSession(activeId)
    }
    if (isMember.value) agentStore.currentAgent = null
    rawSyncStartMessageCount = 0
    loadMessages(history, {
      agentId: '',
      skillContent: '',
      openCodeSessionId: session?.openCodeSessionId,
    })
    void nextTick(() => resizeComposer())
  } finally {
    if (requestId === sessionLoadRequestId) sessionHydrating.value = false
  }
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

// 发送消息：提交当前手动选择的 Skill / 项目文件夹 / Tool / Model
async function handleSend() {
  const hasText = inputText.value.trim().length > 0
  const hasAttachments = (fileUploader.value?.attachedFiles?.length || 0) > 0
  const isFileProcessing = fileUploader.value?.isProcessing

  if ((!hasText && !hasAttachments) || isFileProcessing || sessionHydrating.value) return

  // 对齐官方：AI 工作中允许发送，自动打断当前轮
  if (isStreaming.value) {
    stopStream()
    await new Promise(r => setTimeout(r, 200))
  }

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
  // Web 端策略：
  //   - 所有非文本文件（图片/PDF/Office）→ 8091 解析 → OCR Markdown
  //   - preview 仅用于 UI 展示，不阻止 OCR
  //   - 文本文件 → 本地直读 textContent，不消耗 8091 资源
  //   - vision 模型可以保留图片 URL 作为辅助输入，但 OCR 文本仍是主要证据
  const attachedFiles = fileUploader.value?.attachedFiles || []
  const memberAttachedFiles = attachedFiles
  const images: string[] = []
  const files: Array<{ name: string; content: string }> = []
  /** Web 端：需要走 8091 服务端解析的文件（含图片/PDF/Office） */
  const serverParseFiles: File[] = []
  /** 已经本地读取成功的文本文件，LLM 可直接用 */
  const localTextFiles: Array<{ name: string; content: string }> = []

  for (const af of memberAttachedFiles) {
    const isWeb = !isTauriRuntime()

    // 图片预览 URL 保留（vision 模型可用作辅助）
    if (af.remoteUrl && !af.textContent) {
      images.push(af.remoteUrl)
    } else if (af.preview && !af.textContent) {
      images.push(af.preview)
    }

    // 文本内容 → 本地直读结果
    if (af.textContent) {
      localTextFiles.push({ name: af.file.name, content: af.textContent })
    }

    // 双端通用：判断是否需要服务端解析（图片走 OCR，PDF/Office 走文档解析）
    if (needsServerParse(af.file.name)) {
      // 图片即使有 preview 也要走 OCR（preview 只是缩略图，OCR 才是文本）
      // PDF/Office 没有 textContent 也走 OCR
      serverParseFiles.push(af.file)
    }
  }

  // 本地文本文件直接进入 files（不需要 8091）
  files.push(...localTextFiles)

  // 清空附件
  fileUploader.value?.clearAll()

  // ─── 媒体模型拦截：如果当前模型是媒体生成模型，走 Task Engine ───
  const currentModelId = agentStore.currentModel
  const mediaType = isMediaModel(currentModelId)
  if (mediaType && isMember.value) {
    // 首次发消息时创建 session
    if (!currentSessionId) {
      currentSessionId = sessionStore.startNewSession(
        '',
      )
      rawSyncStartMessageCount = 0
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
      })
      await persistCurrentSession()
      await syncCurrentSessionToRaw()
      await nextTick()
      scrollNav.value?.scheduleAutoScrollIfNeeded()
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
      })
      await persistCurrentSession()
      await syncCurrentSessionToRaw()
      await nextTick()
      scrollNav.value?.scheduleAutoScrollIfNeeded()
      return
    }

    // 插入任务占位消息（assistant 角色，content 标记 taskId）
    messages.value.push({
      id: taskMsgId,
      role: 'assistant',
      content: `[MEDIA_TASK:${taskId}]`,
      timestamp: Date.now(),
      isMediaTask: true,
      mediaTaskId: taskId,
    })

    await persistCurrentSession()
    await syncCurrentSessionToRaw()
    await nextTick()
    scrollNav.value?.scheduleAutoScrollIfNeeded()
    return // 不走文本 LLM 流程
  }

  // 1. 首次发消息时创建 session
  if (!currentSessionId) {
    currentSessionId = sessionStore.startNewSession(
      '',
    )
    rawSyncStartMessageCount = 0
    sessionStore.switchSession(currentSessionId)
  }

  // 2. 合并引用文件到 files
  for (const rf of refFiles) {
    files.push({ name: rf.name, content: rf.content })
  }
  // 3. 发送消息（只使用用户当前显式选择的配置）
  const chatModelId = isMember.value
    ? agentStore.currentModel
    : resolveTextModelSelection(agentStore.currentModel, agentStore.availableModels)
  const chatModelEntry = agentStore.availableModels.find(m => m.id === chatModelId)

  // 拼接引用回复上下文
  let sendText = replyContext
    ? `[引用回复] 用户引用了之前的消息: 「${replyContext.content}」\n\n${text}`
    : text

  if (agentMode.value !== 'direct' && !isWebRuntime.value && !hasAttachments && sendText.startsWith('/')) {
    await startOutputFollow()
    await runVisibleSlashText(sendText, {
      ...currentOpenCodeCommandOptions(),
      modelId: chatModelId,
      modelProviderId: chatModelEntry?.providerId,
    })
    await persistCurrentSession()
    return
  }

  if (agentMode.value !== 'direct' && !isWebRuntime.value && !hasAttachments && sendText.startsWith('!')) {
    await startOutputFollow()
    await runShellCommand(sendText.slice(1), {
      ...currentOpenCodeCommandOptions(),
      modelId: chatModelId,
      modelProviderId: chatModelEntry?.providerId,
    })
    await persistCurrentSession()
    return
  }

  const skillName = effectiveOpenCodeSkillName.value
  await sessionStore.saveSessionPreview(
    currentSessionId,
    '',
    {
      id: `preview_${Date.now().toString(36)}`,
      role: 'user',
      content: sendText,
      timestamp: Date.now(),
      agentName: isMember.value ? (skillName || agentStore.modelLabel) : agentStore.modelLabel,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
    },
    { openCodeSessionId: getActiveOpenCodeSessionId() || undefined },
  )
  let preinsertedWebUserMessage = false

  // ─── 双端通用：将需要服务端解析的文件上传到 8091 ───
  let parsedAttachments: AttachmentDocument[] | undefined
  if (serverParseFiles.length > 0) {
    try {
      const result = await parseFilesOnServer(serverParseFiles, (fileName, status) => {
        // 状态回调：可用于未来在 UI 中展示逐文件进度
        if (status === 'error') {
          console.warn('[JC] 8091 parse failed:', fileName)
        }
      })
      // 收集成功的解析结果
      const docs: AttachmentDocument[] = []
      for (const [/* fileName */, doc] of result.documents) {
        docs.push(doc)
      }
      if (docs.length > 0) {
        parsedAttachments = docs
      }
      // 如果有失败的文件，在 assistant 消息中追加警告
      if (result.failures.size > 0) {
        const failedNames = [...result.failures.keys()].join('、')
        console.warn('[JC] 8091 parse failures:', failedNames, result.failures)
        // 将失败信息追加到用户消息中，让用户知道
        const origText = sendText
        sendText = origText + `\n\n[系统提示：以下文件解析失败，未进入上下文: ${failedNames}]`
      }
    } catch {
      // 8091 完全不可用
      console.warn('[JC] 8091 attachment-processor unavailable')
      sendText = sendText + '\n\n[系统提示：附件解析服务暂时不可用，文件内容未进入上下文]'
    }
  }

  if (isWebRuntime.value) {
    messages.value.push({
      id: `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: sendText,
      timestamp: Date.now(),
      agentName: isMember.value ? (skillName || agentStore.modelLabel) : agentStore.modelLabel,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
      parsedAttachments: parsedAttachments,
    })
    preinsertedWebUserMessage = true
    await persistCurrentSession()
  }
  const sendPromise = sendMessage(sendText, {
    agentName: isMember.value ? (skillName || agentStore.modelLabel) : agentStore.modelLabel,
    skillName: isMember.value ? skillName || undefined : undefined,
    sessionId: currentSessionId,
    images: images.length > 0 ? images : undefined,
    files: files.length > 0 ? files : undefined,
    parsedAttachments: parsedAttachments,
    modelId: chatModelId,
    modelProviderId: chatModelEntry?.providerId,
    chatMode: isTauriRuntime() ? agentMode.value : undefined,
    openCodeAgent: currentDesktopOpenCodeAgent.value,
    openCodeProjectDir: selectedProjectDir.value || undefined,
    _skipUserMessageInsert: preinsertedWebUserMessage,
  })
  await nextTick()
  scrollNav.value?.startStickyFollow()
  await persistCurrentSession()
  await sendPromise

  // 5. 保存到 IndexedDB
  await persistCurrentSession()
}

// ─── P0-1: 原地编辑 user 消息 ───
const editingMessageId = ref<string | null>(null)
const editingMessageContent = ref('')

async function editUserMessage(messageId: string) {
  const msg = messages.value.find(m => m.id === messageId && m.role === 'user')
  if (!msg) return
  // 如果后面有 assistant 回复，先截断
  const index = messages.value.findIndex(m => m.id === messageId)
  if (index >= 0 && index < messages.value.length - 1) {
    if (!await confirmAction('编辑此消息将删除后续对话，确定继续？')) return
    void invalidateConversationMessages(messages.value.slice(index + 1).map(message => message.id))
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
    void invalidateConversationMessages([msgId])
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

async function continueAssistantMessage(messageId: string) {
  const tail = getContinuationTailMessage(messages.value, messageId)
  if (!tail || isStreaming.value) return
  const threadIds = collectContinuationThreadIds(messages.value, messageId)
  void invalidateConversationMessages(threadIds)
  await sendMessage('请从上一条回复中断的位置继续，不要重复已经写过的内容。', {
    agentName: tail.agentName || (isMember.value ? (effectiveOpenCodeSkillName.value || agentStore.modelLabel) : agentStore.modelLabel),
    skillName: isMember.value ? effectiveOpenCodeSkillName.value || undefined : undefined,
    sessionId: currentSessionId || undefined,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    chatMode: isTauriRuntime() ? agentMode.value : undefined,
    openCodeAgent: currentDesktopOpenCodeAgent.value,
    openCodeProjectDir: selectedProjectDir.value || undefined,
    _continuationParentId: messageId,
    _isContinuationPrompt: true,
  })
  await persistCurrentSession()
}

// ─── 子 Agent Tabs ───
const subtaskSessions = ref<Array<{ sessionId: string; label: string; status: 'running' | 'done' | 'error' }>>([])
const activeSubtaskId = ref('')

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
  const invalidatedIds = messages.value.slice(index).map(message => message.id)

  // 更新消息内容
  messages.value[index].content = newContent
  editingMessageId.value = null
  editingMessageContent.value = ''

  // 删除该消息之后的所有消息
  messages.value.splice(index + 1)
  void invalidateConversationMessages(invalidatedIds)

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
  const invalidatedIds = messages.value.slice(userMsgIndex + 1).map(message => message.id)
  // 删除从该 user 消息之后的所有消息
  messages.value.splice(userMsgIndex + 1)
  void invalidateConversationMessages(invalidatedIds)

  void persistCurrentSession()

  // 重新发送
  await startOutputFollow()
  const skillName = effectiveOpenCodeSkillName.value
  await sendMessage(userMsg.content, {
    agentName: isMember.value ? (skillName || agentStore.modelLabel) : agentStore.modelLabel,
    skillName: isMember.value ? skillName || undefined : undefined,
    sessionId: currentSessionId,
    images: userMsg.images,
    files: userMsg.files,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    chatMode: isTauriRuntime() ? agentMode.value : undefined,
    openCodeAgent: currentDesktopOpenCodeAgent.value,
    openCodeProjectDir: selectedProjectDir.value || undefined,
  })
  await persistCurrentSession()
  await syncCurrentSessionToRaw()
}

// 新对话
function startNew() {
  if (isWebRuntime.value) {
    const previousSessionId = currentSessionId
    const previousMessages = messages.value.map(message => ({ ...message }))
    currentSessionId = ''
    rawSyncStartMessageCount = 0
    sessionHydrating.value = true
    sessionStore.switchSession('')
    void clearMessages().finally(() => {
      sessionHydrating.value = false
    })
    if (previousSessionId && previousMessages.length) {
      void sessionStore.saveSession(previousSessionId, '', previousMessages)
        .finally(() => sessionStore.loadAllSessions())
    }
    return
  }
  void (async () => {
    await flushCurrentSessionPersist()
    await runSessionAction('new')
  })()
}

// 切换模型
function selectModel(model: ModelEntry) {
  agentStore.setModel(model.id, getModelProviderId(model))
  showModelMenu.value = false
}

function toggleModelMenu() {
  showModelMenu.value = !showModelMenu.value
}

function selectOpenCodeSkill(skillName: string) {
  selectedOpenCodeSkill.value = skillName
  if (skillName) {
    localStorage.setItem('jc_opencode_skill', skillName)
    // Skill 执行以 OpenCode 官方 skill.name 为准；清掉旧 agentStore 选择避免双重语义。
    agentStore.selectAgent('')
  } else {
    localStorage.removeItem('jc_opencode_skill')
  }
}

async function refreshOpenCodeSkills() {
  openCodeSkillLoading.value = true
  let refreshError = ''
  if (!isTauriRuntime()) {
    openCodeSkills.value = webBuiltInSkills.value
    openCodeSkillError.value = ''
    openCodeSkillLoading.value = false
    return
  }
  if (isTauriRuntime()) {
    try {
      await skillsManageStore.loadCentralSkills({ scan: true })
    } catch (error: any) {
      refreshError = error?.message || 'Central Skills scan failed'
    }
  }
  try {
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: agentStore.currentModel,
      models: agentStore.availableModels,
    })
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: selectedProjectDir.value || undefined })
    const skills = await listOpenCodeSkills(createJiucaiOpenCodeClient(handle, selectedProjectDir.value || undefined), {
      directory: selectedProjectDir.value || handle.directory,
    })
    openCodeSkills.value = skills
    openCodeSkillError.value = refreshError
  } catch (error: any) {
    openCodeSkills.value = []
    openCodeSkillError.value = refreshError || error?.message || 'OpenCode skill.list failed'
  } finally {
    openCodeSkillLoading.value = false
  }
}

async function refreshOpenCodeCommands() {
  if (isWebRuntime.value) {
    openCodeCustomCommands.value = []
    openCodeCommandError.value = ''
    return
  }
  try {
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: agentStore.currentModel,
      models: agentStore.availableModels,
    })
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: selectedProjectDir.value || undefined })
    openCodeCustomCommands.value = await listOpenCodeCommands(createJiucaiOpenCodeClient(handle, selectedProjectDir.value || undefined), {
      directory: selectedProjectDir.value || handle.directory,
    })
    openCodeCommandError.value = ''
  } catch (error: any) {
    openCodeCustomCommands.value = []
    openCodeCommandError.value = error?.message || 'OpenCode command.list failed'
  }
}

function currentOpenCodeCommandOptions() {
  const skillName = effectiveOpenCodeSkillName.value
  return {
    agentName: isMember.value ? (skillName || agentStore.modelLabel) : agentStore.modelLabel,
    skillName: isMember.value ? skillName || undefined : undefined,
    sessionId: currentSessionId,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    chatMode: isTauriRuntime() ? agentMode.value : undefined,
    openCodeAgent: currentDesktopOpenCodeAgent.value,
    openCodeProjectDir: selectedProjectDir.value || undefined,
  }
}

async function runSessionAction(action: OpenCodeSessionAction) {
  if (isWebRuntime.value) {
    if (action === 'new') {
      await clearMessages()
      currentSessionId = ''
      rawSyncStartMessageCount = 0
      sessionStore.switchSession('')
    }
    return
  }
  clearLocalCommandNotice()
  if (action === 'compact' && !canCompactContext.value) {
    setLocalCommandNotice('当前没有可压缩的 OpenCode 上下文，或会话仍在执行/加载中。')
    return
  }
  const previousSessionId = currentSessionId
  if (action === 'delete') {
    const ok = await confirmAction('确认删除当前 OpenCode 会话？此操作会删除内核侧会话数据。', {
      title: '删除 OpenCode 会话',
      okLabel: '删除',
      cancelLabel: '取消',
      kind: 'error',
    })
    if (!ok) return
  }
  if (action === 'new' || action === 'fork') {
    await flushCurrentSessionPersist()
  }
  const result = await runOpenCodeSessionAction(action, currentOpenCodeCommandOptions())
  if (!result.ok) {
    return
  }
  if (action === 'fork' && result.forkedSessionID) {
    currentSessionId = sessionStore.startNewSession(
      '',
    )
    rawSyncStartMessageCount = 0
    await persistCurrentSession()
    sessionStore.switchSession(currentSessionId)
  } else if (action === 'delete') {
    if (previousSessionId) await sessionStore.deleteSession(previousSessionId)
    currentSessionId = ''
    rawSyncStartMessageCount = 0
    sessionStore.switchSession('')
  } else if (action === 'new') {
    currentSessionId = ''
    rawSyncStartMessageCount = 0
    sessionStore.switchSession('')
  } else if (currentSessionId) {
    await persistCurrentSession()
  }
}

function openShellCommandPrompt() {
  if (isWebRuntime.value || agentMode.value === 'direct') return
  showShellCommandMenu.value = !showShellCommandMenu.value
  nextTick(() => composerRef.value?.focus())
}

function openMcpToolPanel() {
  emitEvent('switch-panel', 'tools')
  emitEvent('open-external-tool-extensions')
  setLocalCommandNotice('已打开外部工具扩展。扩展工具需用户显式加入并启用，不作为聊天 slash 发送。')
}

function openProjectFilePicker() {
  fileUploader.value?.triggerFileInput()
  setLocalCommandNotice('已打开项目文件选择器。文件会作为显式附件加入当前输入。')
}

function addSelectionContext() {
  const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() || '' : ''
  if (!selectedText) {
    setLocalCommandNotice('没有检测到可添加的选区。请先在页面中选中文本，或从文件树使用“引用到对话”。')
    return
  }
  const name = `选区上下文 ${new Date().toLocaleTimeString()}`
  referenceFiles.value.push({ name, content: selectedText.slice(0, 20_000) })
  setLocalCommandNotice('已添加选区上下文。该内容会作为用户显式引用随下一条消息发送。')
}

function focusComposerInput() {
  showShellCommandMenu.value = false
  void nextTick(() => composerRef.value?.focus())
}

function navigateMessageByCommand(_direction: 'previous' | 'next') {
  // 滚动导航按钮已移除，保留函数占位避免破坏调用链
}

function toggleFileTreeByCommand() {
  emitEvent('toggle-file-tree')
  setLocalCommandNotice('已切换文件树显示状态。')
}

function closeCurrentEditorTab() {
  if (!activeEditorFileId.value) {
    setLocalCommandNotice('当前没有可关闭的文件 Tab。')
    return
  }
  emitEvent('editor-close-current-tab', { fileId: activeEditorFileId.value })
  setLocalCommandNotice('已请求关闭当前文件 Tab。')
}

async function openSubtaskSession(sessionId: string) {
  if (!sessionId) return
  try {
    await persistCurrentSession()
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: agentStore.currentModel,
      models: agentStore.availableModels,
    })
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: selectedProjectDir.value || undefined })
    const childMessages = await listOpenCodeChatMessages(
      createJiucaiOpenCodeClient(handle, selectedProjectDir.value || undefined),
      sessionId,
      { directory: selectedProjectDir.value || handle.directory },
    )
    if (!childMessages.length) {
      setLocalCommandNotice(`子任务会话 ${sessionId} 暂无可显示消息。`)
      return
    }
    const childLocalSessionId = sessionStore.startNewSession(
      '',
    )
    currentSessionId = childLocalSessionId
    rawSyncStartMessageCount = 0
    loadMessages(childMessages, {
      agentId: '',
      skillContent: '',
      openCodeSessionId: sessionId,
    })
    await persistCurrentSession()
    sessionStore.switchSession(childLocalSessionId)
    setLocalCommandNotice(`已打开子任务会话：${sessionId}`)
  } catch (error: any) {
    setLocalCommandNotice(`打开子任务会话失败：${error?.message || String(error)}`)
  }
}

function runLocalOpenCodeUiCommand(command: string): boolean {
  if (command === 'mcp') {
    openMcpToolPanel()
    return true
  }
  if (command === 'terminal' || command === 'terminal.toggle') {
    openShellCommandPrompt()
    setLocalCommandNotice('已打开 Terminal 命令输入。Shell 不常驻主输入区，只在高级命令中显式启用。')
    return true
  }
  if (command === 'terminal.new') {
    showShellCommandMenu.value = true
    shellCommandText.value = ''
    void nextTick(() => composerRef.value?.focus())
    setLocalCommandNotice('已打开新的 Terminal 命令输入。命令需用户确认后才会运行。')
    return true
  }
  if (command === 'open' || command === 'file.open') {
    openProjectFilePicker()
    return true
  }
  if (command === 'context' || command === 'selection' || command === 'context.addselection') {
    addSelectionContext()
    return true
  }
  if (command === 'message.previous') {
    navigateMessageByCommand('previous')
    return true
  }
  if (command === 'message.next') {
    navigateMessageByCommand('next')
    return true
  }
  if (command === 'tab.close') {
    closeCurrentEditorTab()
    return true
  }
  if (command === 'filetree.toggle' || command === 'filetree') {
    toggleFileTreeByCommand()
    return true
  }
  if (command === 'input.focus' || command === 'focus') {
    focusComposerInput()
    return true
  }
  if (command === 'skill') {
    setLocalCommandNotice('Skill 命令请使用上方 Skill 选择器或 OpenCode skill tool。内置 Skill 不会被前端自动改写。')
    return true
  }
  return false
}

async function runVisibleSlashText(text: string, options = currentOpenCodeCommandOptions()) {
  const command = text.trim().replace(/^\//, '').split(/\s+/)[0]?.toLowerCase()
  if (!command) return
  if (command === 'model') {
    showModelMenu.value = true
    return
  }
  if (runLocalOpenCodeUiCommand(command)) return
  const action = sessionActionBySlash[command]
  if (action) {
    await runSessionAction(action)
    return
  }
  clearLocalCommandNotice()
  await runSlashCommand(text, options)
}

async function runVisibleSlashCommand(command: string) {
  await startOutputFollow()
  await runVisibleSlashText(`/${command}`, currentOpenCodeCommandOptions())
  await persistCurrentSession()
}

async function restoreRevert(id: string) {
  await restoreRevertItem(id, currentOpenCodeCommandOptions())
  await persistCurrentSession()
}

async function sendFollowupItem(id: string) {
  await startOutputFollow()
  await sendFollowup(id, currentOpenCodeCommandOptions())
  await persistCurrentSession()
}

function editFollowupItem(id: string) {
  const text = editFollowup(id)
  if (!text) return
  inputText.value = text
  showShellCommandMenu.value = false
  nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
  })
}

async function submitShellCommand() {
  if (isWebRuntime.value) return
  const command = shellCommandText.value.trim()
  if (!command) return
  clearLocalCommandNotice()
  await startOutputFollow()
  await runShellCommand(command, currentOpenCodeCommandOptions())
  shellCommandText.value = ''
  showShellCommandMenu.value = false
  await persistCurrentSession()
}

// 键盘事件 (V4 chatKeydown 行 10678)
function onKeydown(e: KeyboardEvent) {
  // P3-1: @-提及弹窗键盘导航
  if (showMentionPopup.value) {
    const items = mentionItems.value
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionSelectedIdx.value = Math.min(mentionSelectedIdx.value + 1, items.length - 1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); mentionSelectedIdx.value = Math.max(mentionSelectedIdx.value - 1, 0); return }
    if (e.key === 'Enter') { e.preventDefault(); if (items[mentionSelectedIdx.value]) { onMentionSelect(items[mentionSelectedIdx.value]) }; return }
    if (e.key === 'Escape') { e.preventDefault(); showMentionPopup.value = false; return }
    return
  }
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

function onGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const isTextInput = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable
  const action = resolveOpenCodeP3KeyAction({
    key: e.key,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    isTextInput,
    isTauriRuntime: isTauriRuntime(),
    hasActiveEditorFile: Boolean(activeEditorFileId.value),
  })
  if (!action) return
  e.preventDefault()
  if (action === 'focus-input') focusComposerInput()
  else if (action === 'message-previous') navigateMessageByCommand('previous')
  else if (action === 'message-next') navigateMessageByCommand('next')
  else if (action === 'toggle-file-tree') toggleFileTreeByCommand()
  else if (action === 'close-tab') {
    closeCurrentEditorTab()
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))

// 删除消息
function deleteMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  messages.value = messages.value.filter(message => message.id !== messageId)
  void persistCurrentSession()
}

// P1-4: revert 撤销本轮 — 删除该消息及之后所有消息
async function revertMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const affected = messages.value.slice(index)
  if (!await confirmAction(`撤销本轮将删除该消息及之后的 ${affected.length} 条消息，确定继续？`)) return
  void invalidateConversationMessages(affected.map(m => m.id))
  messages.value.splice(index)
  void persistCurrentSession()
}

// P1-4: fork 分叉新会话 — 以当前消息为起点创建新会话
async function forkMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const prefixMessages = messages.value.slice(0, index + 1)
  // 提取前缀消息的纯文本作为新会话上下文
  const contextText = prefixMessages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${(m.content || '').slice(0, 500)}`)
    .join('\n')
  inputText.value = `以下为从之前会话分叉的上下文：\n\n${contextText}\n\n---\n请继续。`
  // 创建新会话
  currentSessionId = sessionStore.startNewSession(agentStore.modelLabel)
  rawSyncStartMessageCount = 0
  await persistCurrentSession()
  await nextTick()
  resizeComposer()
  focusComposerInput()
}

// P1-1: 图片预览 + 下载
function openImagePreview(payload: { url: string; mime: string; title: string }) {
  previewImageUrl.value = payload.url
  previewImageMime.value = payload.mime
  previewImageTitle.value = payload.title
}
function closeImagePreview() {
  previewImageUrl.value = null
}
async function downloadImageUrl(url: string) {
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = url.split('/').pop() || 'image.png'
    a.click()
  } catch { /* ponytail: download is best-effort */ }
}

// 重新发送 — 有附件时直接重发，无附件时填回输入框
async function retryMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const msg = messages.value[index]
  if (msg && msg.role === 'user') {
    const hasFollowingMessages = index < messages.value.length - 1
    if (hasFollowingMessages && !await confirmAction('重新发送将删除该消息及之后的所有对话，确定继续？')) {
      return
    }
    void invalidateConversationMessages(messages.value.slice(index).map(message => message.id))
    messages.value.splice(index)
    void persistCurrentSession()

    // 有附件 → Web 端不自动重试（需要重新走 8091 OCR），桌面端直接重发
    if (msg.images?.length || msg.files?.length) {
      if (isWebRuntime.value) {
        // Web 端：填回输入框让用户重新发送（重新走 handleSend → 8091 OCR）
        inputText.value = msg.content || '请分析这些文件'
        void nextTick(() => { resizeComposer(); focusComposerInput() })
        return
      }
      // 桌面端：直接重发
      if (!currentSessionId) {
        currentSessionId = sessionStore.startNewSession(
          '',
        )
        rawSyncStartMessageCount = 0
      }
      const skillName = effectiveOpenCodeSkillName.value
      await sendMessage(msg.content || '请分析这些文件', {
        agentName: isMember.value ? (skillName || agentStore.modelLabel) : agentStore.modelLabel,
        skillName: isMember.value ? skillName || undefined : undefined,
        sessionId: currentSessionId,
        images: msg.images,
        files: msg.files,
        modelId: agentStore.currentModel,
        modelProviderId: currentModelEntry.value?.providerId,
        chatMode: isTauriRuntime() ? agentMode.value : undefined,
        openCodeAgent: currentDesktopOpenCodeAgent.value,
        openCodeProjectDir: selectedProjectDir.value || undefined,
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

async function invalidateConversationMessages(messageIds: string[]) {
  void currentSessionId
  void messageIds
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
  const ta = e.target as HTMLTextAreaElement
  resizeComposer(ta)
  // P3-1: 检测 @ 触发提及弹窗
  const pos = ta.selectionStart || 0
  mentionCursorPos.value = pos
  const textBefore = inputText.value.slice(0, pos)
  const atMatch = textBefore.match(/(^|[\s\n])@([^\s\n]*)$/)
  showMentionPopup.value = !!atMatch
}

function onMentionSelect(payload: { type: 'file' | 'agent'; value: string; label: string }) {
  showMentionPopup.value = false
  const pos = mentionCursorPos.value
  const textBefore = inputText.value.slice(0, pos)
  const textAfter = inputText.value.slice(pos)
  // 替换 @filter 为 @label + 空格
  const atIdx = textBefore.lastIndexOf('@')
  if (atIdx === -1) return
  const newBefore = textBefore.slice(0, atIdx) + `@${payload.label} `
  inputText.value = newBefore + textAfter
  void nextTick(() => {
    const ta = composerRef.value
    if (ta) {
      const newPos = newBefore.length
      ta.setSelectionRange(newPos, newPos)
      ta.focus()
    }
  })
}

onMounted(async () => {
  await Promise.all([
    sessionLoadPromise,
    mediaTaskStore.init(),
  ])
  void restoreActiveSession()
  // 静默拉取 OpenCode 官方 model / skill / command 列表（不阻塞 UI）
  // 等待 apiKey 状态确定后再拉模型，避免 Key 未就绪时走到 OpenCode 兜底
  void Promise.resolve((window as any).__JC_API_KEY_READY__).then(() => {
    void agentStore.fetchModels().finally(() => {
      if (isTauriRuntime()) {
        void refreshOpenCodeSkills()
        void refreshOpenCodeCommands()
      }
    })
  })
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
    @click="showProjectMenu = false; showModeMenu = false; showKbCommandMenu = false"
  >
    <!-- 拖拽上传覆盖层 -->
    <div v-if="isDragOver" class="cp-drag-overlay">
      <JcIcon name="upload_file" style="font-size:48px" />
      <span>松开上传文件</span>
    </div>
    <!-- Header -->
    <div class="cp-header">
      <div class="cp-title">
        <button class="cp-new-chat-btn" @click="startNew" title="新建会话">
          <JcIcon name="add_circle" style="font-size:16px" />
          <span>新建会话</span>
        </button>
      </div>
      <div v-if="!isWebRuntime" class="cp-project-wrap">
        <button class="cp-project-btn" :class="{ active: !!selectedProjectDir }" @click="toggleProjectMenu($event)" title="选择项目">
          <JcIcon name="folder" style="font-size:14px" />
          <span>{{ selectedProjectName || '选择项目' }}</span>
          <JcIcon name="expand_more" style="font-size:12px" />
        </button>
        <div v-if="showProjectMenu" class="cp-project-menu" @click.stop>
          <div v-if="recentProjectDirs.length" class="cp-project-section">
            <button
              v-for="dir in recentProjectDirs"
              :key="dir"
              class="cp-project-item"
              :class="{ active: dir === selectedProjectDir }"
              :title="dir"
              @click="selectProject(dir)"
            >
              <JcIcon name="folder" style="font-size:14px" />
              <span class="cp-project-label">{{ dir.split('/').filter(Boolean).pop() }}</span>
              <JcIcon name="check" style="font-size:14px" v-if="dir === selectedProjectDir" />
            </button>
          </div>
          <div class="cp-project-divider"></div>
          <button class="cp-project-item" @click="pickProjectFolder">
            <JcIcon name="create_new_folder" style="font-size:14px" />
            <span>添加新项目</span>
          </button>
          <button v-if="selectedProjectDir" class="cp-project-item" @click="clearProject">
            <JcIcon name="folder_off" style="font-size:14px" />
            <span>不使用项目</span>
          </button>
        </div>
      </div>
      <div class="cp-actions">
        <!-- 模型选择 -->
        <div class="cp-model-wrap">
          <button class="cp-model-btn" @click="toggleModelMenu">
            <JcIcon name="deployed_code" style="font-size: 14px;" />
            {{ agentStore.currentModel }}
          </button>
          <div v-if="showModelMenu" class="cp-model-menu">
            <div
              v-if="agentStore.openCodeTextModels.length === 0"
              class="cp-model-empty"
              :class="{ 'cp-model-error': Boolean(agentStore.modelsFetchError) }"
            >
              {{ agentStore.modelsFetchError ? (isWebRuntime ? '云端模型列表未就绪' : 'OpenCode 官方模型列表未就绪') : (isWebRuntime ? '正在读取云端模型列表' : '正在读取 OpenCode 官方模型列表') }}
            </div>
            <button
              v-for="m in agentStore.openCodeTextModels"
              :key="m.id"
              class="cp-model-item"
              :class="{ active: m.id === agentStore.currentModel }"
              :title="m.id"
              @click="selectModel(m)"
            >
              <span class="cp-model-label">{{ m.id }}</span>
            </button>
          </div>
        </div>
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
            <JcIcon :name="card.icon" class="cp-welcome-card-icon" />
            <span class="cp-welcome-card-label">{{ card.label }}</span>
            <span class="cp-welcome-card-hint">{{ card.hint }}</span>
          </button>
        </div>
      </div>

      <!-- Sub Agent Tabs (Phase F) -->
      <div v-if="subtaskSessions.length" class="subtask-tabs">
        <button
          v-for="tab in subtaskSessions"
          :key="tab.sessionId"
          class="subtask-tab"
          :class="{ active: tab.sessionId === activeSubtaskId }"
          @click="activeSubtaskId = tab.sessionId"
        >
          <span class="subtask-tab-label">{{ tab.label || '子任务' }}</span>
          <span v-if="tab.status === 'done'" class="subtask-done">✓</span>
          <span v-else-if="tab.status === 'running'" class="subtask-running">●</span>
        </button>
      </div>

      <!-- Message list -->
      <template v-for="msg in displayMessages" :key="msg.id">
        <!-- 媒体任务气泡 -->
        <div v-if="msg.isMediaTask" class="msg assistant">
          <div class="msg-meta">
            <div class="msg-meta-avatar"><JcIcon name="palette" style="font-size:14px" /></div>
            <span class="msg-meta-name">媒体生成</span>
          </div>
          <div class="msg-bubble">
            <MediaTaskBubble :task-id="msg.mediaTaskId || msg.content.slice(12, -1)" />
          </div>
        </div>
        <!-- Phase B: user message 携带 summaryDiffs 时，先渲染 diff-summary 再渲染消息气泡 -->
        <template v-else-if="msg.role === 'user' && msg.summaryDiffs?.length">
          <template v-for="row in openCodeRowsForMessage(msg)" :key="row.key">
            <div v-if="row.type === 'diff-summary'" class="cp-opencode-row cp-opencode-diff-summary">
              <button
                type="button"
                class="cp-diff-summary-btn"
                @click="scrollToDiffReview()"
              >
                <JcIcon name="difference" />
                <span class="cp-diff-summary-label">
                  变更 · {{ row.files.length }} 个文件
                </span>
                <span v-if="row.totalAdditions > 0" class="cp-diff-summary-add">+{{ row.totalAdditions }}</span>
                <span v-if="row.totalDeletions > 0" class="cp-diff-summary-del">-{{ row.totalDeletions }}</span>
                <JcIcon name="arrow_downward" class="cp-diff-summary-arrow" />
              </button>
            </div>
          </template>
          <MessageBubble
            :message-id="msg.id"
            :content="msg.content"
            :role="msg.role"
            :images="msg.images"
            :files="msg.files"
            :timestamp="msg.timestamp"
            @delete="deleteMessage"
            @edit="editUserMessage"
          />
        </template>
        <template v-else-if="hasOpenCodeTimeline(msg)">
          <div class="cp-opencode-clean">
          <template v-for="row in openCodeRowsForMessage(msg)" :key="row.key">
            <MessageBubble
              v-if="row.type === 'assistant-part'"
              :message-id="msg.id"
              content=""
              role="assistant"
              :agent-id="msg.agentId"
              :agent-name="msg.agentName"
              :finish-reason="msg.finishReason"
              :timestamp="msg.timestamp"
              :trace-summary="msg.traceSummary"
              :is-streaming-message="isAssistantStreamingMessage(msg)"
              :open-code-parts="row.parts"
              :usage="msg.usage"
              @retry="retryMessage"
              @delete="deleteMessage"
              @edit="editUserMessage"
              @regenerate="regenerateAssistantMessage"
              @reply="setReplyTarget"
              @continue="continueAssistantMessage"
              @edit-assistant="editAssistantMessage"
              @open-subtask="openSubtaskSession"
              @revert="revertMessage"
              @fork="forkMessage"
              @preview-image="openImagePreview"
              @download-image="downloadImageUrl"
            />
            <MessageBubble
              v-else-if="row.type === 'context-group'"
              :message-id="msg.id"
              content=""
              role="assistant"
              :agent-id="msg.agentId"
              :agent-name="msg.agentName"
              :finish-reason="msg.finishReason"
              :timestamp="msg.timestamp"
              :trace-summary="msg.traceSummary"
              :is-streaming-message="isAssistantStreamingMessage(msg)"
              :open-code-parts="row.parts"
              :usage="msg.usage"
              @retry="retryMessage"
              @delete="deleteMessage"
              @edit="editUserMessage"
              @regenerate="regenerateAssistantMessage"
              @reply="setReplyTarget"
              @continue="continueAssistantMessage"
              @edit-assistant="editAssistantMessage"
              @open-subtask="openSubtaskSession"
              @revert="revertMessage"
              @fork="forkMessage"
              @preview-image="openImagePreview"
              @download-image="downloadImageUrl"
            />
            <div v-else-if="row.type === 'thinking'" class="cp-opencode-row cp-opencode-thinking">
              <JcIcon name="psychology" />
              <span>{{ row.reasoningHeading || 'OpenCode 正在思考' }}</span>
            </div>
            <div v-else-if="row.type === 'system-event'" class="cp-opencode-row cp-opencode-system">
              <JcIcon name="notes" />
              <span>{{ row.text }}</span>
            </div>
            <div v-else-if="row.type === 'error'" class="cp-opencode-row cp-opencode-error">
              <JcIcon name="error" />
              <span>{{ row.text }}</span>
            </div>
            <div v-else-if="row.type === 'turn-divider'" class="cp-opencode-row cp-opencode-divider">
              <span>{{ row.label === 'compaction' ? '上下文已压缩' : '执行已中断' }}</span>
            </div>
            <!-- Phase B: diff-summary row（per-user-message 变更摘要） -->
            <div v-else-if="row.type === 'diff-summary'" class="cp-opencode-row cp-opencode-diff-summary">
              <button
                type="button"
                class="cp-diff-summary-btn"
                @click="scrollToDiffReview()"
              >
                <JcIcon name="difference" />
                <span class="cp-diff-summary-label">
                  变更 · {{ row.files.length }} 个文件
                </span>
                <span v-if="row.totalAdditions > 0" class="cp-diff-summary-add">+{{ row.totalAdditions }}</span>
                <span v-if="row.totalDeletions > 0" class="cp-diff-summary-del">-{{ row.totalDeletions }}</span>
                <JcIcon name="arrow_downward" class="cp-diff-summary-arrow" />
              </button>
            </div>
          </template>
          </div>
        </template>
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
          :trace-summary="msg.traceSummary"
          :tool-result="msg.latestToolResult"
          :continuation-parts="continuationChildrenByParent.get(msg.id)"
          :is-streaming-message="isAssistantStreamingMessage(msg)"
          :open-code-parts="msg.openCodeParts"
          :usage="msg.usage"
          :is-editing="editingAssistantId === msg.id"
          :editing-content="editingAssistantId === msg.id ? editingAssistantContent : undefined"
          @retry="retryMessage"
          @delete="deleteMessage"
          @edit="editUserMessage"
          @regenerate="regenerateAssistantMessage"
          @reply="setReplyTarget"
          @continue="continueAssistantMessage"
          @edit-assistant="editAssistantMessage"
          @open-subtask="openSubtaskSession"
          @preview-image="openImagePreview"
          @download-image="downloadImageUrl"
          @update:editing-content="(c: string) => editingAssistantContent = c"
          @confirm-edit="confirmEditAssistant"
          @cancel-edit="cancelEditAssistant"
        />
      </template>

      <!-- Streaming indicator -->
      <div v-if="isStreaming && (!messages.length || !messages[messages.length - 1]?.content)" class="msg assistant">
        <div class="msg-meta">
          <div class="msg-meta-avatar"><JcIcon name="smart_toy" style="font-size: 14px;" /></div>
          <span class="msg-meta-name">{{ effectiveOpenCodeSkillName || agentStore.modelLabel }}</span>
        </div>
        <div class="msg-bubble">
          <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
        </div>
      </div>
    </div>

    <!-- 🔧 Phase B v2: 变更摘要（基于 turnDiffs/sessionDiffs，消息流末尾始终可见） -->
    <div v-if="turnDiffs.length > 0" class="cp-diff-summary-row">
      <button
        type="button"
        class="cp-diff-summary-btn"
        @click="scrollToDiffReview()"
      >
        <JcIcon name="difference" />
        <span class="cp-diff-summary-label">
          本轮变更 · {{ turnDiffs.length }} 个文件
        </span>
        <span class="cp-diff-summary-add">+{{ turnDiffs.reduce((s, d) => s + (d.additions || 0), 0) }}</span>
        <span class="cp-diff-summary-del">-{{ turnDiffs.reduce((s, d) => s + (d.deletions || 0), 0) }}</span>
        <JcIcon name="arrow_downward" class="cp-diff-summary-arrow" />
      </button>
    </div>

    <!-- 滚动导航（移到对话框右侧） -->
    <ChatScrollNav ref="scrollNav" :container="messagesContainer" :is-streaming="isStreaming" :messages="messages" />

    <!-- P1-1: 图片预览灯箱 -->
    <Teleport to="body">
      <div v-if="previewImageUrl" class="cp-image-lightbox" @click.self="closeImagePreview">
        <button class="cp-lightbox-close" @click="closeImagePreview">✕</button>
        <img :src="previewImageUrl" :alt="previewImageTitle" />
        <div class="cp-lightbox-info">{{ previewImageTitle }}</div>
      </div>
    </Teleport>

    <div v-if="sessionCommandNotice" class="cp-session-notice">
      {{ sessionCommandNotice }}
    </div>
    <div v-if="localCommandNotice" class="cp-session-notice local">
      {{ localCommandNotice }}
    </div>
    <PermissionDock v-if="!isWebRuntime" :requests="pendingPermissions" @decide="respondPermission" />
    <QuestionDock v-if="!isWebRuntime" :requests="pendingQuestions" @reply="replyQuestion" @reject="rejectQuestion" />
    <TodoDock v-if="!isWebRuntime" :todos="sessionTodos" />
    <RevertDock
      v-if="!isWebRuntime"
      :items="sessionRevertItems"
      :restoring="restoringRevertId"
      :disabled="isStreaming"
      @restore="restoreRevert"
    />
    <FollowupDock
      v-if="!isWebRuntime"
      :items="sessionFollowups"
      :sending="sendingFollowupId"
      @send="sendFollowupItem"
      @edit="editFollowupItem"
    />
    <SessionShareNotice v-if="!isWebRuntime && sessionShareUrl" :url="sessionShareUrl" @dismiss="sessionShareUrl = ''" />
    <DiffReviewDock v-if="!isWebRuntime" :diffs="sessionDiffs" />

    <!-- 附件预览 -->
    <FileUploader ref="fileUploader" />

    <!-- Skill快捷按钮栏 -->
    <SkillPickerBar
      v-if="isMember"
      :skills="selectableOpenCodeSkills"
      :selected-skill-name="effectiveOpenCodeSkillName"
      :loading="openCodeSkillLoading"
      :error="openCodeSkillError"
      :web-mode="!isTauriRuntime()"
      :mention-active="showMentionPopup"
      @select="selectOpenCodeSkill"
      @refresh="refreshOpenCodeSkills"
    />


    <!-- 引用文件条 -->
    <div v-if="referenceFiles.length > 0" class="cp-ref-bar">
      <div v-for="(rf, i) in referenceFiles" :key="rf.name" class="cp-ref-chip">
        <JcIcon name="attach_file" style="font-size:13px" />
        <span class="cp-ref-name">{{ rf.name }}</span>
        <button class="cp-ref-remove" @click="removeReference(i)">
          <JcIcon name="close" style="font-size:12px" />
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
        <JcIcon name="close" style="font-size:14px" />
      </button>
    </div>

    <!-- 输入区 -->
    <div class="cp-input-area">
      <div class="cp-input-wrap">
        <form v-if="showShellCommandMenu && !isWebRuntime && agentMode !== 'direct'" class="cp-shell-command-box" @submit.prevent="submitShellCommand">
          <JcIcon name="terminal" />
          <input
            v-model="shellCommandText"
            type="text"
            placeholder="shell command"
            aria-label="OpenCode Shell 命令"
          />
          <button type="submit">运行</button>
        </form>
        <!-- Phase C: 引用回复气泡 -->
        <div v-if="replyTarget" class="reply-bubble">
          <div class="reply-bubble-head">
            <JcIcon name="reply" />
            <span class="reply-bubble-role">{{ replyTarget.role === 'user' ? '引用用户消息' : replyTarget.agentName ? `引用 ${replyTarget.agentName}` : '引用回复' }}</span>
            <button class="reply-bubble-close" @click="clearReplyTarget" title="取消引用">&times;</button>
          </div>
          <div class="reply-bubble-text">{{ replyTarget.content.slice(0, 200) }}{{ replyTarget.content.length > 200 ? '...' : '' }}</div>
        </div>
        <div class="cp-composer-relative">
          <MentionPopup
            :text="inputText"
            :cursor-pos="mentionCursorPos"
            :visible="showMentionPopup"
            :items="mentionItems"
            :selected-idx="mentionSelectedIdx"
            @update:selected-idx="mentionSelectedIdx = $event"
            @select="onMentionSelect"
            @close="showMentionPopup = false"
          />
          <textarea
            ref="composerRef"
            v-model="inputText"
            :aria-busy="isStreaming"
            placeholder="给Skill发指令... 输入 @ 提及文件或Skill"
            rows="1"
            @keydown="onKeydown"
            @input="handleInput"
            @paste="fileUploader?.handlePaste($event)"
          />
        </div>
        <div class="cp-input-actions">
          <div class="cp-kb-command-wrap">
            <button class="ci-btn cp-kb-command-btn" title="指令" @click="toggleKbCommandMenu">
              指令
            </button>
            <div v-if="showKbCommandMenu" class="cp-kb-command-menu" @click.stop>
              <button
                v-for="preset in KB_COMMAND_PRESETS"
                :key="preset.title"
                type="button"
                class="cp-kb-command-item"
                @click="fillKbCommand(preset)"
              >
                <span class="cp-kb-command-icon">{{ preset.icon }}</span>
                <span class="cp-kb-command-copy">
                  <strong>{{ preset.title }}</strong>
                  <small>{{ preset.desc }}</small>
                </span>
                <span class="cp-kb-command-fill">填入</span>
              </button>
            </div>
          </div>
          <button v-if="!isWebRuntime && agentMode !== 'direct'" class="ci-btn" title="OpenCode 命令" aria-label="OpenCode 命令" @click="openSlashCommandPalette">
            <JcIcon name="keyboard_command_key" />
          </button>
          <div v-if="!isWebRuntime" class="cp-mode-wrap">
            <button class="cp-mode-btn" @click="toggleModeMenu($event)" :title="agentModeTitle">
              {{ agentModeLabel }}
              <JcIcon name="expand_more" style="font-size:12px" />
            </button>
            <div v-if="showModeMenu" class="cp-mode-menu" @click.stop>
              <button class="cp-mode-item" :class="{ active: agentMode === 'build' }" @click="selectAgentMode('build')">
                <span>武</span>
                <span class="cp-mode-desc">直接操控电脑，用于编程、调试、文件管理</span>
              </button>
              <button class="cp-mode-item" :class="{ active: agentMode === 'plan' }" @click="selectAgentMode('plan')">
                <span>文</span>
                <span class="cp-mode-desc">不操控电脑，用于写作、分析、方案规划</span>
              </button>
              <button class="cp-mode-item" :class="{ active: agentMode === 'direct' }" @click="selectAgentMode('direct')">
                <span>直连</span>
                <span class="cp-mode-desc">直连模式：不使用 OpenCode，用于普通对话</span>
              </button>
            </div>
          </div>
          <button class="ci-btn" title="上传文件" @click="fileUploader?.triggerFileInput()">
            <JcIcon name="attach_file" />
          </button>
          <div v-if="isTauriRuntime()" class="cp-kb-wrap">
            <button class="ci-btn cp-kb-btn" title="知识库指令模板" @click.stop="showKbMenu = !showKbMenu">
              指令
            </button>
            <div v-if="showKbMenu" class="cp-kb-menu" @click.stop>
              <div class="cp-kb-menu-head">常用指令模板</div>
              <button
                v-for="preset in KB_COMMAND_PRESETS"
                :key="preset.title"
                class="cp-kb-item"
                @click="inputText = preset.template; showKbMenu = false; composerRef?.focus()"
              >
                <span class="cp-kb-icon">{{ preset.icon }}</span>
                <span class="cp-kb-copy">
                  <span class="cp-kb-title">{{ preset.title }}</span>
                  <span class="cp-kb-desc">{{ preset.desc }}</span>
                </span>
              </button>
            </div>
          </div>
          <button
            v-if="isStreaming"
            class="cp-stop"
            @click="stopStream"
            title="停止生成"
            aria-label="停止生成"
          >
            <JcIcon name="stop" />
          </button>
          <button
            v-else
            class="cp-send"
            :disabled="!canSend"
            @click="handleSend"
            aria-label="发送消息"
          >
            <JcIcon name="send" />
          </button>
        </div>
      </div>
      <!-- 状态条（composer 底部，对齐 OpenCode footer statusline） -->
      <AgentStatusBar
        :phase="agentPhase"
        :detail="agentDetail"
        :tool-progress="currentToolProgress"
        :tool-history="toolHistory"
        :token-usage="openCodeContextUsage"
        @open-context-panel="showContextPanel = !showContextPanel"
      />
      <ContextUsagePanel
        v-if="showContextPanel && openCodeContextUsage"
        :usage="openCodeContextUsage"
        @close="showContextPanel = false"
      />
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
  container-type: inline-size;
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
.cp-new-chat-btn:disabled {
  opacity: 0.45;
  cursor: default;
  background: transparent;
  color: var(--ink3);
  border-color: var(--border);
}
.cp-new-chat-btn:disabled:hover {
  background: transparent;
  color: var(--ink3);
}
@container (max-width: 320px) {
  .cp-new-chat-btn span:not(.mso) { display: none; }
  .cp-new-chat-btn { padding: 5px 8px; }
}
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
.cp-session-notice {
  border-top: 1px solid var(--border);
  padding: 6px 12px;
  background: color-mix(in srgb, var(--surface) 88%, var(--olive-pale));
  color: var(--ink2);
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.cp-session-notice.local {
  background: color-mix(in srgb, var(--surface) 92%, var(--paper));
  color: var(--ink3);
}
.cp-model-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 220px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink1);
  font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .12s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  scrollbar-width: auto;
  scrollbar-color: color-mix(in srgb, var(--olive) 62%, transparent) color-mix(in srgb, var(--olive-pale) 52%, transparent);
}
.cp-messages::-webkit-scrollbar { width: 12px; }
.cp-messages::-webkit-scrollbar-track {
  background: color-mix(in srgb, var(--olive-pale) 48%, transparent);
  border-radius: 999px;
}
.cp-messages::-webkit-scrollbar-thumb {
  min-height: 56px;
  border: 3px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--olive) 68%, transparent);
  background-clip: content-box;
}
.cp-messages::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--olive-dark) 78%, transparent);
  background-clip: content-box;
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
  margin: 0 2px 4px;
  font-size: 11px;
  color: var(--ink3);
  opacity: .72;
}
.msg.user .msg-meta { justify-content: flex-end; }
.msg-meta-avatar {
  width: 18px; height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center; justify-content: center;
  background: transparent;
  color: var(--olive-dark);
}
.msg.user .msg-meta-avatar {
  background: rgba(244, 241, 232, 0.92);
  color: var(--ink2);
  border: 1px solid color-mix(in srgb, #F4F1E8 78%, var(--border));
}
.msg-meta-name {
  font-weight: 600;
  color: var(--ink3);
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
  border-bottom-right-radius: 8px;
}
.msg.assistant .msg-bubble {
  background: var(--surface-alt);
  color: var(--ink);
  border: 1px solid var(--border);
  border-bottom-left-radius: 8px;
}
.msg-body { white-space: pre-wrap; }
.msg-action-row {
  opacity: .72;
  transform: translateY(0);
  transition: opacity .14s ease, transform .14s ease;
}
.msg:hover .msg-action-row,
.msg:focus-within .msg-action-row {
  opacity: 1;
}

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
  position: relative;
  display: block;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 8px 162px 8px 12px;
  transition: border-color 0.2s;
}
.cp-composer-relative { position: relative; }

/* P1-1: 图片预览灯箱 */
.cp-image-lightbox {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
  flex-direction: column;
}
.cp-image-lightbox img {
  max-width: 90vw; max-height: 80vh;
  border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.cp-lightbox-close {
  position: absolute; top: 16px; right: 16px;
  background: rgba(255,255,255,0.15); border: none; cursor: pointer;
  color: #fff; font-size: 24px; padding: 8px 14px; border-radius: 8px;
  z-index: 1;
}
.cp-lightbox-close:hover { background: rgba(255,255,255,0.25); }
.cp-lightbox-info {
  color: rgba(255,255,255,0.7); font-size: 13px; margin-top: 12px;
}
.cp-composer-command-menu,
.cp-shell-command-box {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 6px);
  z-index: 90;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
}
.cp-composer-command-menu {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 3px;
  padding: 5px;
}
.cp-composer-command-heading {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 7px 4px;
  border-bottom: 1px solid var(--line);
  color: var(--ink1);
  font-size: 12px;
  font-weight: 850;
}
.cp-composer-command-heading b {
  color: var(--ink3);
  font-size: 10px;
  font-weight: 750;
}
.cp-composer-command-error {
  grid-column: 1 / -1;
  padding: 4px 7px;
  color: var(--jc-error);
  font-size: 10px;
  font-weight: 750;
}
.cp-composer-command-menu button {
  min-width: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink2);
  cursor: pointer;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 1px 7px;
  padding: 7px 8px;
  text-align: left;
  font: inherit;
}
.cp-composer-command-menu button:hover,
.cp-composer-command-menu button:focus-visible {
  background: var(--olive-pale);
  color: var(--olive-dark);
  outline: none;
}
.cp-composer-command-menu .mso {
  grid-row: span 3;
  font-size: 16px;
}
.cp-composer-command-menu span:not(.mso) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 800;
}
.cp-composer-command-menu b {
  color: var(--ink3);
  font-size: 10px;
  font-weight: 700;
}
.cp-composer-command-menu small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  font-size: 9px;
  font-weight: 650;
  line-height: 1.25;
}
.cp-shell-command-box {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
}
.cp-shell-command-box .mso {
  color: var(--olive-dark);
  font-size: 17px;
}
.cp-shell-command-box input {
  min-width: 0;
  flex: 1;
  border: none;
  outline: none;
  background: var(--surface-alt);
  color: var(--ink1);
  border-radius: 7px;
  padding: 7px 8px;
  font: inherit;
  font-size: 12px;
}
.cp-shell-command-box button {
  border: 1px solid var(--olive);
  border-radius: 7px;
  background: var(--olive);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  padding: 7px 10px;
}
.cp-input-wrap:focus-within {
  border-color: var(--olive);
}
.cp-input-wrap textarea {
  width: 100%;
  display: block;
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
  padding: 3px 0;
  overflow-y: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.cp-input-actions {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 3px;
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
.cp-kb-command-wrap {
  position: relative;
}
.cp-kb-command-btn {
  width: auto;
  min-width: 42px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}
.cp-kb-command-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 95;
  width: min(420px, calc(100vw - 28px));
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(0,0,0,.14);
}
.cp-kb-command-item {
  width: 100%;
  min-width: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink1);
  cursor: pointer;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  text-align: left;
  font: inherit;
}
.cp-kb-command-item:hover,
.cp-kb-command-item:focus-visible {
  background: var(--olive-pale);
  outline: none;
}
.cp-kb-command-icon {
  font-size: 18px;
}
.cp-kb-command-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.cp-kb-command-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 850;
}
.cp-kb-command-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  font-size: 10px;
  line-height: 1.35;
}
.cp-kb-command-fill {
  color: var(--olive-dark);
  font-size: 11px;
  font-weight: 850;
}
.cp-send, .cp-stop {
  height: 32px;
  min-width: 32px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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
.cp-model-error {
  color: var(--jc-error);
  letter-spacing: 0;
  line-height: 1.4;
}
.cp-model-empty {
  padding: 8px 12px;
  color: var(--ink3);
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
}
.cp-model-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-model-meta {
  flex-shrink: 0;
  color: var(--ink3);
  font-size: 10px;
  font-weight: 700;
}
.cp-model-item.local {
  color: var(--ink);
}

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
  .cp-actions { gap: 4px; overflow-x: visible; flex-wrap: wrap; }
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

.cp-opencode-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 82%;
  margin: 2px 0 6px 38px;
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink3);
  font-size: 12px;
}
.cp-opencode-error {
  border-color: color-mix(in srgb, #c62828 42%, var(--line));
  color: #b42318;
}
.cp-opencode-system {
  color: var(--ink3);
}
.cp-opencode-divider {
  align-self: center;
  margin: 8px 0;
  max-width: none;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  text-align: center;
  position: relative;
}
.cp-opencode-divider::before,
.cp-opencode-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 50px);
  height: 1px;
  background: var(--line);
}
.cp-opencode-divider::before { left: 0; }
.cp-opencode-divider::after { right: 0; }
.cp-opencode-divider span {
  display: inline-block;
  padding: 2px 10px;
  background: var(--bg);
  position: relative;
  z-index: 1;
  border-radius: 3px;
}

/* ─── Phase B: diff-summary row（每轮变更摘要） ─── */
.cp-opencode-diff-summary {
  border: none;
  background: transparent;
  margin: 2px 0 4px 0;
  padding: 0;
}
.cp-opencode-diff-summary .cp-diff-summary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--olive) 35%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 92%, var(--olive));
  color: var(--ink2);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.cp-opencode-diff-summary .cp-diff-summary-btn:hover {
  border-color: var(--olive);
  background: color-mix(in srgb, var(--surface) 82%, var(--olive));
  color: var(--olive-dark);
}
.cp-diff-summary-row {
  display: flex;
  justify-content: flex-start;
  margin: 4px 0 8px 38px;
}
.cp-diff-summary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, var(--olive) 35%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, var(--olive));
  color: var(--ink2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.cp-diff-summary-btn:hover {
  border-color: var(--olive);
  background: color-mix(in srgb, var(--surface) 80%, var(--olive));
  color: var(--olive-dark);
}
.cp-diff-summary-label {
  color: var(--ink1);
}
.cp-diff-summary-add {
  color: #2e7d32;
  font-weight: 700;
}
.cp-diff-summary-del {
  color: #c62828;
  font-weight: 700;
}
.cp-diff-summary-arrow {
  font-size: 14px;
  color: var(--ink3);
}
.cp-diff-flash {
  animation: cp-diff-flash-anim 0.6s ease-in-out 2;
}
@keyframes cp-diff-flash-anim {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--olive) 40%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--olive) 0%, transparent); }
}

/* ─── 项目选择器 ─── */
.cp-project-wrap {
  position: relative;
}
.cp-project-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 8px; background: transparent;
  color: var(--ink3); font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all .15s;
  max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cp-project-btn.active {
  color: var(--olive-dark); border-color: var(--olive);
}
.cp-project-btn:hover { border-color: var(--olive); color: var(--olive-dark); }
.cp-project-menu {
  position: absolute; top: 100%; left: 0; margin-top: 4px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 4px; min-width: 220px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 100;
  display: flex; flex-direction: column; gap: 1px;
  max-height: 320px; overflow-y: auto;
}
.cp-project-section {
  display: flex; flex-direction: column; gap: 1px;
}
.cp-project-item {
  padding: 7px 12px; border: none; background: none;
  border-radius: 8px; font-size: 12px; font-weight: 600;
  color: var(--ink2); cursor: pointer; text-align: left;
  font-family: inherit; transition: all .12s;
  display: flex; align-items: center; gap: 8px;
}
.cp-project-item:hover { background: var(--olive-pale); color: var(--olive-dark); }
.cp-project-item.active { background: rgba(213,199,135,0.18); color: var(--olive-dark); }
.cp-project-label {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
}
.cp-project-divider {
  height: 1px; background: var(--border); margin: 2px 8px;
}

/* ─── 模式切换 ─── */
.cp-mode-wrap {
  position: relative;
}
.cp-mode-btn {
  display: flex; align-items: center; gap: 3px;
  padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 8px; background: transparent;
  color: var(--ink2); font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: all .15s;
  white-space: nowrap; letter-spacing: 0.5px;
}
.cp-mode-btn:hover { border-color: var(--olive); color: var(--olive-dark); }
.cp-mode-menu {
  position: absolute; bottom: 100%; right: 0; margin-bottom: 6px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 6px; min-width: 240px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 200;
  display: flex; flex-direction: column; gap: 2px;
}
.cp-mode-item {
  padding: 10px 14px; border: none; background: none;
  border-radius: 8px; cursor: pointer; text-align: left;
  font-family: inherit; transition: all .12s;
  display: flex; flex-direction: column; gap: 4px;
}
.cp-mode-item:hover { background: var(--olive-pale); }
.cp-mode-item.active { background: rgba(213,199,135,0.18); }
.cp-mode-item > span:first-child { font-size: 15px; font-weight: 800; color: var(--ink); letter-spacing: 1px; }
.cp-mode-desc { font-size: 11px; color: var(--ink3); font-weight: 400; line-height: 1.4; }

/* Phase C: 引用回复气泡 */
.reply-bubble {
  margin: 0 12px 8px;
  border: 1px solid color-mix(in srgb, var(--olive) 35%, var(--line));
  border-left: 3px solid var(--olive);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 92%, var(--olive-pale));
  padding: 6px 10px;
}
.reply-bubble-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.reply-bubble-head .mso {
  font-size: 14px;
  color: var(--olive-dark);
}
.reply-bubble-role {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: var(--olive-dark);
}
.reply-bubble-close {
  border: none;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
.reply-bubble-close:hover { color: var(--ink); }
.reply-bubble-text {
  font-size: 12px;
  color: var(--ink2);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* Phase F: 子 Agent Tabs */
.subtask-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 12px 0;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  flex-shrink: 0;
}
.subtask-tab {
  padding: 5px 12px;
  font-size: 11px;
  border: none;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
  border-radius: 7px 7px 0 0;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: background .12s;
}
.subtask-tab:hover { background: var(--olive-pale); color: var(--ink1); }
.subtask-tab.active {
  color: var(--olive-dark);
  background: var(--olive-pale);
  font-weight: 700;
}
.subtask-done { color: #1b7a1b; font-weight: 700; }
.subtask-running { color: var(--olive); animation: subtask-pulse 1s ease-in-out infinite; }
@keyframes subtask-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
