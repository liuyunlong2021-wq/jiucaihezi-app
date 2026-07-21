<script setup lang="ts">
/**
 * ChatPanel — 对话面板容器
 *
 * 手动工作台执行原则：
 *   用户手动选择 Skill / 项目文件夹 / Model，OpenCode 被动工具由官方 runtime 和权限系统决定。
 */
import { ref, nextTick, watch, computed, onMounted, onBeforeUnmount, onUnmounted } from 'vue'
import {
  useChat,
  type ChatMessage,
  type DirectAttachmentRef,
  type OpenCodeSessionAction,
} from '@/composables/useChat'
import { useCreativeChat } from '@/composables/creativeChat'
import { useAgentStore } from '@/stores/agentStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useChatModeStore, type ChatMode } from '@/stores/chatModeStore'
import { useCreativeSessionStore } from '@/stores/creativeSessionStore'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { SkillDetail, SkillDirectoryNode } from '@/types/skillsManage'
import { useProjectStore } from '@/stores/projectStore'
import { useOpenCodeSyncStore } from '@/stores/openCodeSyncStore'
import MessageBubble from './MessageBubble.vue'
import MediaTaskBubble from './MediaTaskBubble.vue'
import FileUploader from './FileUploader.vue'
import ChatScrollNav from './ChatScrollNav.vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { consumeLastEvent, emitEvent, onEvent } from '@/utils/eventBus'
import SessionContextUsage from './SessionContextUsage.vue'
import MentionPopover from './MentionPopover.vue'
import SkillPickerBar from './SkillPickerBar.vue'
import PermissionDock from './PermissionDock.vue'
import QuestionDock from './QuestionDock.vue'
import TodoDock from './TodoDock.vue'
import { useFilteredList } from '@/composables/useFilteredList'
import {
  getPlainText,
  extractPills,
  createPill,
  addPart,
  getCursorPosition,
  setEditorText,
} from '@/composables/useContentEditable'
import type { AtOption, SlashCommand } from '@/types/mention'
import SessionShareNotice from './SessionShareNotice.vue'
import RevertDock from './RevertDock.vue'
import FollowupDock from './FollowupDock.vue'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { KB_COMMAND_PRESETS, COMMAND_TABS, type KbCommandPreset } from '@/data/kbCommandPresets'
import { getMediaModel } from '@/data/mediaModelCapabilities'
import {
  dedupeOfficeDownloadFiles,
  extractOfficeDownloadFiles,
  type OfficeDownloadFile,
} from '@/utils/officeDownloads'
import { getModelProviderId } from '@/utils/providerConfig'
import { isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import { resolveTextModelSelection } from '@/utils/modelSelection'
import { isTauriRuntime } from '@/utils/tauriEnv'
import {
  createRuntimeProjectFileService,
  flattenProjectResourceChange,
  onProjectResourceChange,
} from '@/services/projectFileService'
import { createProjectFileActions } from '@/services/projectFileActions'
import type { ProjectResource } from '@/utils/projectResource'
import { markSetupWizardDone } from '@/utils/localCapabilities'
import { resolveOpenCodeP3KeyAction, shouldShowTabCloseCommand } from '@/utils/openCodeP3UiPolicy'
import type { ModelEntry } from '@/stores/agentStore'
import type { ResolvedDirectAttachment } from '@/utils/directMessageBuilder'
import { resolveModelInputModalities } from '@/runtime/direct/modelInputCapabilities'
import { confirmAction } from '@/utils/confirmAction'
import { ensureOpenCodeServer } from '@/opencodeClient/daemon'
import { createJiucaiOpenCodeClient } from '@/opencodeClient/client'
import {
  listOpenCodeCommands,
  type OpenCodeCommandOption,
  type OpenCodeSkillOption,
} from '@/opencodeClient/catalog'
import { projectStoredNewApiForOpenCode } from '@/opencodeClient/providerProjection'
import { getPluginHost } from '@/plugin'
import type { LocalCreativeSkill } from '@/runtime/direct/desktopProjectTools'
import { mergeCreativeSkillCatalog } from '@/runtime/direct/creativeSkillCatalog'
import { buildEcommercePlannerPrompt } from '@/runtime/workbench/ecommercePlanner'
import {
  buildMediaPlanPolicy,
  parseMediaPlan,
  replaceMediaPlanModelId,
  updateMediaPlanParameters,
  validateMediaPlan,
  type MediaPlanParameterPatch,
} from '@/runtime/workbench/mediaPlan'
import {
  buildExplicitMediaReferences,
  buildMediaReferencePolicy,
  buildRecentTaskReferences,
  createMediaContextSnapshot,
  extractProjectMediaReferencePaths,
  materializeMediaPlanReferences,
  normalizeProjectMediaReferencePath,
  projectResourceForMediaTask,
  reconcileProjectMediaReferences,
  refreshMediaPlanReferenceValues,
  withMediaReferences,
  type MediaContextSnapshot,
} from '@/runtime/workbench/mediaReference'
import type { EcommerceDraft } from '@/stores/ecommerceWorkbenchStore'
import {
  loadWebSkillByName,
  loadWebSkillCatalog,
  readWebSkillResource,
  type WebSkillCatalogEntry,
} from '@/utils/skillContentResolver'
import { buildOpenCodeTimelineRows, type OpenCodeTimelineRow } from '@/opencodeClient/timelineRows'
import {
  listOpenCodeChatMessages,
  prefetchOpenCodeSession,
  listOpenCodeSessions,
} from '@/opencodeClient/session'
type DisplayChatMessage = ChatMessage & {
  latestToolResult?: string
}

function buildLatestToolResultByAssistantId(messages: ChatMessage[]): Map<string, string> {
  const toolOwnerByCallId = new Map<string, string>()
  const resultByAssistantId = new Map<string, string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls || []) toolOwnerByCallId.set(call.id, message.id)
      continue
    }
    if (message.role !== 'tool' || !message.toolCallId) continue
    const assistantId = toolOwnerByCallId.get(message.toolCallId)
    const result = String(message.content || '').trim()
    if (assistantId && result) resultByAssistantId.set(assistantId, result)
  }
  return resultByAssistantId
}

function flattenSkillFiles(nodes: SkillDirectoryNode[]): string[] {
  return nodes.flatMap(node =>
    node.is_dir ? flattenSkillFiles(node.children || []) : [node.relative_path],
  )
}

function createDesktopProjectTextFiles(projectDir: string) {
  return {
    async read(relativePath: string) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const file = await invoke<{ content: string }>('dev_read_file', {
          input: { root: projectDir, relativePath, maxBytes: 2_000_000 },
        })
        return file.content
      } catch {
        return null
      }
    },
  }
}

function skillDirectory(detail: SkillDetail): string {
  return (detail.dir_path || detail.canonical_path || detail.file_path).replace(/\/SKILL\.md$/i, '')
}

/** Pseudo-message for turn dividers (interrupted / compaction) */
interface DividerMessage {
  id: string
  role: 'divider'
  content: string
  timestamp: number
  finishReason?: string
}

type CreativeToolApprovalDecision = 'always' | 'once' | 'reject'
interface PendingCreativeToolApproval {
  message: string
  resolve: (decision: CreativeToolApprovalDecision) => void
}

interface PendingRetryConfirmation {
  resolve: (confirmed: boolean) => void
}

function creativeTerminalApprovalMessage(command: string, reason: string): string {
  const lower = command.toLowerCase()
  if (lower.includes('ffmpeg') && /(frame|fps=|scene|tile)/.test(lower))
    return '读取视频信息并截取视频画面'
  if (lower.includes('ffprobe')) return '读取视频信息'
  if (lower.includes('ffmpeg')) return '处理视频画面'
  if (/(whisper|transcrib)/.test(lower)) return '把视频内容转成文字'
  if (/(mkdir|cp |mv )/.test(lower)) return '整理本次创作素材'
  const plain = reason.split(/[。；;\n]/)[0]?.trim() || ''
  return plain.slice(0, 24) || '继续完成这次创作'
}

function creativeToolApprovalMessage(call: {
  function: { name: string; arguments: string }
}): string {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    /* The runtime reports malformed tool arguments. */
  }
  if (call.function.name === 'terminal')
    return creativeTerminalApprovalMessage(String(args.command || ''), String(args.reason || ''))
  if (call.function.name === 'read') return '查看文件内容'
  if (call.function.name === 'glob') return '查找相关文件'
  if (call.function.name === 'grep') return '搜索文件内容'
  if (call.function.name === 'write' || call.function.name === 'edit') return '修改文件内容'
  return '继续完成这次创作'
}

const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const chatModeStore = useChatModeStore()
const creativeSessionStore = useCreativeSessionStore()
const skillsManageStore = useSkillsManageStore()
const projectStore = useProjectStore()
const openCodeSyncStore = useOpenCodeSyncStore()
const mediaTaskStore = useMediaTaskStore()
const {
  isStreaming: isCreativeStreaming,
  send: sendCreative,
  cancel: cancelCreative,
} = useCreativeChat()
const pendingCreativeToolApproval = ref<PendingCreativeToolApproval | null>(null)
const pendingRetryConfirmation = ref<PendingRetryConfirmation | null>(null)
// gatewayStore removed - use isCloudLoggedIn() or isCloudReady instead
const isMember = computed(() => true) // All features now available once logged in
const sessionLoadPromise = isTauriRuntime() ? Promise.resolve() : sessionStore.loadAllSessions()

function isMediaModel(modelId: string): false | 'image' | 'video' | 'audio' {
  const model = getMediaModel(modelId)
  if (!model) return false
  return model.task === 'ai-app' ? 'video' : model.task
}

function requiresCreationPanelMediaModel(modelId: string): boolean {
  const model = getMediaModel(modelId)
  if (!model) return false
  return model.provider.startsWith('runninghub-') || model.id === 'suno-custom-song'
}

const {
  messages,
  isStreaming: isOpenCodeStreaming,
  sendMessage,
  stopStream: stopOpenCodeStream,
  clearMessages,
  loadMessages,
  pendingPermissions,
  pendingQuestions,
  sessionTodos,
  sessionDiffs,
  turnDiffs,
  sessionShareUrl,
  respondPermission,
  replyQuestion,
  rejectQuestion,
  sessionRevertItems,
  restoringRevertId,
  sessionFollowups,
  sendingFollowupId,
  restoreRevertItem,
  sendFollowup,
  editFollowup,
  activeOpenCodeSessionId,
  runOpenCodeSessionAction,
  runSlashCommand,
  runShellCommand,
  getActiveOpenCodeSessionId,
  openCodeContextUsage,
  autoDetectedSkillName,
} = useChat()

function stopStream() {
  settleCreativeToolApproval('reject')
  cancelCreative()
  stopOpenCodeStream()
}

function settleCreativeToolApproval(decision: CreativeToolApprovalDecision) {
  const pending = pendingCreativeToolApproval.value
  if (!pending) return
  pendingCreativeToolApproval.value = null
  pending.resolve(decision)
}

async function requestMediaSpecialistConsent(): Promise<CreativeToolApprovalDecision> {
  if (localStorage.getItem('jcCreativeMediaSpecialistConsent') === 'allowed') return 'always'
  return await new Promise<CreativeToolApprovalDecision>(resolve => {
    pendingCreativeToolApproval.value = {
      message: '本轮媒体将由 Gemini 3.5 Flash 读取，仍使用当前 K 计费',
      resolve: decision => {
        if (decision === 'always') {
          localStorage.setItem('jcCreativeMediaSpecialistConsent', 'allowed')
        }
        resolve(decision)
      },
    }
  })
}

function isMediaEnhancementEnabled(): boolean {
  return localStorage.getItem('jcCreativeMediaEnhancementEnabled') !== 'false'
}

function settleRetryConfirmation(confirmed: boolean) {
  const pending = pendingRetryConfirmation.value
  if (!pending) return
  pendingRetryConfirmation.value = null
  pending.resolve(confirmed)
}

const baseComposerCommands = [
  {
    command: 'new',
    label: '新建会话',
    source: '韭菜盒子会话',
    group: 'Session',
    icon: 'add_circle',
  },
  { command: 'undo', label: '撤销上轮', source: '韭菜盒子会话', group: 'Session', icon: 'undo' },
  { command: 'redo', label: '重做上轮', source: '韭菜盒子会话', group: 'Session', icon: 'redo' },
  {
    command: 'share',
    label: '分享会话',
    source: '韭菜盒子会话',
    group: 'Session',
    icon: 'ios_share',
  },
  {
    command: 'unshare',
    label: '取消分享',
    source: '韭菜盒子会话',
    group: 'Session',
    icon: 'link_off',
  },
  {
    command: 'fork',
    label: 'Fork 会话分支',
    source: '韭菜盒子会话',
    group: 'Session',
    icon: 'call_split',
  },
  { command: 'archive', label: '归档', source: '韭菜盒子会话', group: 'Session', icon: 'archive' },
  {
    command: 'diff',
    label: 'Review / Diff',
    source: '韭菜盒子会话',
    group: 'Session',
    icon: 'difference',
  },
  {
    command: 'mcp',
    label: '外部工具扩展',
    source: 'External tools',
    group: '高级扩展',
    icon: 'extension',
  },
  {
    command: 'open',
    label: '打开项目文件',
    source: 'Custom file.open',
    group: '文件 / 上下文',
    icon: 'folder_open',
  },
  {
    command: 'context',
    label: '添加选区上下文',
    source: 'Custom context.addSelection',
    group: '文件 / 上下文',
    icon: 'playlist_add',
  },
  {
    command: 'terminal',
    label: 'Terminal 面板',
    source: 'Local UI terminal.toggle',
    group: '高级命令 / Terminal',
    icon: 'terminal',
  },
  {
    command: 'terminal.new',
    label: '新建 Terminal',
    source: 'Local UI terminal.new',
    group: '高级命令 / Terminal',
    icon: 'add_to_queue',
  },
  {
    command: 'message.previous',
    label: '上一条消息',
    source: 'Local UI message.previous',
    group: '消息导航',
    icon: 'keyboard_arrow_up',
  },
  {
    command: 'message.next',
    label: '下一条消息',
    source: 'Local UI message.next',
    group: '消息导航',
    icon: 'keyboard_arrow_down',
  },
  {
    command: 'tab.close',
    label: '关闭当前文件 Tab',
    source: 'Local UI tab.close',
    group: '文件 / 视图',
    icon: 'close',
  },
  {
    command: 'fileTree.toggle',
    label: '显示/隐藏文件树',
    source: 'Local UI fileTree.toggle',
    group: '文件 / 视图',
    icon: 'dock_to_right',
  },
  {
    command: 'skill',
    label: 'Skill 命令',
    source: 'Skill',
    group: 'Skill / 外部工具 / Custom',
    icon: 'psychology',
  },
]

const isMobileView = ref(window.innerWidth <= 768)
const isWebRuntime = computed(() => !isTauriRuntime())
const _onResize = () => {
  isMobileView.value = window.innerWidth <= 768
  void nextTick(() => resizeComposer())
}
onMounted(() => window.addEventListener('resize', _onResize))
onUnmounted(() => window.removeEventListener('resize', _onResize))

const messagesContainer = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLDivElement | null>(null)
const showModelMenu = ref(false)
const modelBtnRef = ref<HTMLElement | null>(null)
const modelMenuStyle = ref<Record<string, string>>({})
const showShellCommandMenu = ref(false)
const showComposerCommandMenu = ref(false)
const showKbCommandMenu = ref(false)
const commandActiveTab = ref('设置')
const filteredCommands = computed(() =>
  KB_COMMAND_PRESETS.filter(c => c.tab === commandActiveTab.value),
)
const previewImageUrl = ref<string | null>(null)
const previewImageMime = ref('image/png')
const previewImageTitle = ref('')
// ─── @mention + / 弹窗状态（照抄 OpenCode transient-state.ts）───
const popover = ref<'at' | 'slash' | null>(null)

// ponytail: 桌面端 eager 加载 skill
if (isTauriRuntime()) {
  void agentStore.refreshSkills()
}

// ─── / 斜杠指令（照抄 OpenCode slashCommands）：builtin + custom(skill)───
const slashCommands = computed<SlashCommand[]>(() => {
  // builtin: 3 条内置指令
  const builtin: SlashCommand[] = [
    {
      id: 'clear',
      trigger: 'clear',
      title: '清空上下文',
      description: '清除当前会话历史',
      type: 'builtin',
    },
    {
      id: 'new-session',
      trigger: 'new',
      title: '新建会话',
      description: '开始一个新的对话',
      type: 'builtin',
    },
  ]
  // custom: 所有已安装 skill → source: 'skill'
  const skills = agentStore.getMySkills() || []
  const custom: SlashCommand[] = skills.map(s => ({
    id: `skill.${s.id}`,
    trigger: s.name || s.id,
    title: s.name || s.id,
    description: (s as any).description || '',
    type: 'custom' as const,
    source: 'skill' as const,
  }))
  return [...custom, ...builtin]
})

// ─── @ 数据源：agent（照抄 OpenCode agentList — 注意：agent 不是 skill！）───
const agentList = computed<AtOption[]>(() => {
  // ponytail: OpenCode 的 agent 是内置 agent（plan/build），不是用户的 skill
  // 我们暂不暴露内置 agent，返回空数组
  return []
})

// ─── @ 数据源：resource（照抄 OpenCode mcpResourceList）───
const mcpResourceList = computed<AtOption[]>(() => {
  // ponytail: 待 OpenCode SDK 就绪后对接 sync().data.mcp_resource
  return []
})

// ─── @ 数据源：reference（照抄 OpenCode referenceList）───
const referenceList = computed<AtOption[]>(() => {
  // ponytail: 待 .opencode.json 就绪后对接 SDK v2.reference.list()
  return []
})

// ─── @ 数据源：recent files（照抄 OpenCode recent）───
const recentFiles = computed<AtOption[]>(() => {
  // ponytail: 返回当前打开的文件 tabs
  return []
})

// ─── @ useFilteredList（照抄 OpenCode prompt-input.tsx L690-770）───
const atItems = async (query: string): Promise<AtOption[]> => {
  const refs = referenceList.value
  const agents = agentList.value
  const resources = mcpResourceList.value
  const recent = recentFiles.value

  if (!query.trim()) return [...refs, ...agents, ...resources, ...recent]

  // ponytail: 有查询词时搜索项目文件
  const files: AtOption[] = []
  // TODO: files.searchFilesAndDirectories(query) via Tauri or OpenCode SDK
  return [...refs, ...agents, ...resources, ...recent, ...files]
}

const atKey = (item: AtOption): string => {
  if (item.type === 'agent') return `agent:${item.name}`
  if (item.type === 'resource') return `resource:${item.uri}`
  if (item.type === 'reference') return `reference:${item.name}`
  return `file:${item.path}`
}

const atGroupBy = (item: AtOption): string => {
  if (item.type === 'reference') return 'reference'
  if (item.type === 'agent') return 'agent'
  if (item.type === 'resource') return 'resource'
  if (item.recent) return 'recent'
  return 'file'
}

const atGroupOrder: Record<string, number> = {
  reference: 0,
  agent: 1,
  resource: 2,
  recent: 3,
  file: 4,
}

const {
  flat: atFlat,
  active: atActive,
  onInput: atOnInput,
  onKeyDown: atOnKeyDown,
  setActive: setAtActive,
  clear: clearAtFilter,
} = useFilteredList<AtOption>({
  items: atItems,
  key: atKey,
  groupBy: atGroupBy,
  sortGroupsBy: (a, b) => (atGroupOrder[a.category] ?? 99) - (atGroupOrder[b.category] ?? 99),
  noInitialSelection: true,
})

// ─── / useFilteredList ───
const slashKey = (cmd: SlashCommand): string => cmd.id
const {
  flat: slashFlat,
  active: slashActive,
  onInput: slashOnInput,
  onKeyDown: slashOnKeyDown,
  setActive: setSlashActive,
} = useFilteredList<SlashCommand>({
  items: () => slashCommands.value,
  key: slashKey,
  noInitialSelection: true,
})

const selectedProjectDir = computed(() => projectStore.projectDir.value)

function toggleModeMenu(event: Event) {
  event.stopPropagation()
  showModeMenu.value = !showModeMenu.value
  showModelMenu.value = false
  showKbCommandMenu.value = false
}

function toggleKbCommandMenu(event: Event) {
  event.stopPropagation()
  showKbCommandMenu.value = !showKbCommandMenu.value
  showModeMenu.value = false
  showModelMenu.value = false
  showComposerCommandMenu.value = false
  showShellCommandMenu.value = false
}

function fillKbCommand(preset: KbCommandPreset) {
  setEditorText(composerRef.value, preset.template)
  showKbCommandMenu.value = false
  void nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
  })
}

const agentMode = computed(() => chatModeStore.mode)
const isCreativeMode = computed(() => !isWebRuntime.value && agentMode.value === 'creative')
const isStreaming = computed(() =>
  isCreativeMode.value ? isCreativeStreaming.value : isOpenCodeStreaming.value,
)
const showModeMenu = ref(false)
const agentModeLabel = computed(() =>
  agentMode.value === 'creative' ? '创' : agentMode.value === 'plan' ? '文' : '武',
)
const agentModeTitle = computed(() => {
  if (agentMode.value === 'creative') return '创模式：Skill、项目文件与创作面板'
  if (agentMode.value === 'plan') return '文模式：不操控电脑'
  return '武模式：直接操控电脑'
})
const currentDesktopOpenCodeAgent = computed<'build' | 'plan' | undefined>(() => {
  const mode = agentMode.value
  return isTauriRuntime() && (mode === 'build' || mode === 'plan') ? mode : undefined
})
function selectAgentMode(mode: ChatMode) {
  const shouldRefreshOpenCodeCatalog =
    isTauriRuntime() && isCreativeMode.value && mode !== 'creative'
  chatModeStore.setMode(mode)
  if (shouldRefreshOpenCodeCatalog) {
    void refreshOpenCodeSkills()
    void refreshOpenCodeCommands()
  }
  showModeMenu.value = false
}
const shellCommandText = ref('')
const localCommandNotice = ref('')
const builtInSkills = ref<WebSkillCatalogEntry[]>([])
const openCodeSkillLoading = ref(false)
const openCodeSkillError = ref('')
const selectedOpenCodeSkill = ref(localStorage.getItem('jc_opencode_skill') || '')
const openCodeCustomCommands = ref<OpenCodeCommandOption[]>([])
const openCodeCommandError = ref('')
const activeEditorFileId = ref<string | null>(null)
const currentModelEntry = computed(() =>
  agentStore.availableModels.find(m => m.id === agentStore.currentModel),
)
const fileUploader = ref<InstanceType<typeof FileUploader> | null>(null)
const projectFiles = createRuntimeProjectFileService()
const projectFileActions = createProjectFileActions(projectFiles)

function activeMediaOwner(): string {
  return isTauriRuntime()
    ? selectedProjectDir.value
    : String(projectStore.webProjectId.value || '')
}

function isMediaPlanBlocked(message: ChatMessage): boolean {
  return Boolean(
    message.mediaPlan?.mediaOwner && message.mediaPlan.mediaOwner !== activeMediaOwner(),
  )
}

function mediaPlanDisplayError(message: ChatMessage): string | undefined {
  if (isMediaPlanBlocked(message)) return '参考素材属于其他项目，请回到原项目或移除素材。'
  return message.mediaPlanError?.startsWith('参考素材属于其他项目')
    ? undefined
    : message.mediaPlanError
}

async function addPastedProjectMediaReferences(text: string): Promise<boolean> {
  const paths = extractProjectMediaReferencePaths(text)
  if (!paths.length) return true
  const owner = activeMediaOwner()
  if (!owner) return false

  const resources: ProjectResource[] = []
  const externalPaths: string[] = []
  for (const rawPath of paths) {
    const runtime = isTauriRuntime() ? 'desktop' : 'web'
    const normalized = normalizeProjectMediaReferencePath(rawPath, owner, runtime)
    if (!normalized) {
      if (runtime === 'desktop' && /^(?:[a-z]:[\\/]|\/)/i.test(rawPath)) {
        externalPaths.push(rawPath)
        continue
      }
      fileUploader.value?.reportError(`不是当前项目内的安全素材路径：${rawPath}`)
      return false
    }
    const matches = await projectFiles.searchPaths(owner, normalized, 20)
    const resource = matches.find(item => item.path === normalized && item.kind === 'media')
    if (!resource) {
      fileUploader.value?.reportError(`找不到当前项目素材：${rawPath}`)
      return false
    }
    resources.push(resource)
  }
  await fileUploader.value?.addProjectResources(resources, 'project')
  if (externalPaths.length && !(await importDesktopChatPaths(externalPaths))) return false
  return true
}

async function importDesktopChatPaths(paths: string[]): Promise<boolean> {
  const owner = projectStore.projectDir.value
  if (!owner) {
    fileUploader.value?.reportError('请先选择项目文件夹')
    return false
  }
  try {
    const resources = await projectFileActions.importDesktopPaths({
      owner,
      paths,
      targetPath: 'jc-imports',
    })
    await fileUploader.value?.addProjectResources(resources)
    return true
  } catch (error) {
    fileUploader.value?.reportError(
      `导入失败: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

async function addProjectMediaReferences(payload: unknown) {
  const data = payload as {
    resources?: ProjectResource[]
    source?: 'project' | 'canvas'
  } | null
  if (!data?.resources?.length) return
  await fileUploader.value?.addProjectResources(data.resources, data.source || 'project')
}

const offMediaReferenceAdd = onEvent('media-reference:add', addProjectMediaReferences)
const pendingMediaReference = consumeLastEvent('media-reference:add')
if (pendingMediaReference) void addProjectMediaReferences(pendingMediaReference[0])
onBeforeUnmount(offMediaReferenceAdd)

const offMediaReferenceResourceChange = onProjectResourceChange(change => {
  let changed = false
  for (const entry of flattenProjectResourceChange(change)) {
    if (entry.type !== 'renamed' && entry.type !== 'deleted') continue
    for (const message of messages.value) {
      if (!message.mediaPlan?.mediaReferences?.length) continue
      const references = reconcileProjectMediaReferences(message.mediaPlan.mediaReferences, entry)
      if (
        references.every(
          (reference, index) => reference === message.mediaPlan!.mediaReferences![index],
        )
      )
        continue
      changed = true
      message.mediaPlan = withMediaReferences(message.mediaPlan, references)
      const invalid = references.find(reference => reference.invalidReason)
      if (invalid) {
        message.mediaPlanStatus = 'failed'
        message.mediaPlanError = invalid.invalidReason
      }
    }
  }
  if (changed) void persistCurrentSession()
})
onBeforeUnmount(offMediaReferenceResourceChange)

const offDesktopProjectDrop = onEvent('project:desktop-drop', (payload: unknown) => {
  const drop = payload as { target?: string; paths?: string[] }
  if (drop.target === 'chat' && Array.isArray(drop.paths)) void importDesktopChatPaths(drop.paths)
})
onBeforeUnmount(offDesktopProjectDrop)
const scrollNav = ref<InstanceType<typeof ChatScrollNav> | null>(null)
const sessionHydrating = ref(false)
const attachedFileCount = computed(() => fileUploader.value?.attachedFiles?.length || 0)
const isFileProcessing = computed(() => Boolean(fileUploader.value?.isProcessing))
const hasInputText = ref(false)
const canSend = computed(
  () =>
    (hasInputText.value || attachedFileCount.value > 0) &&
    !isFileProcessing.value &&
    !sessionHydrating.value,
)
const canCompactContext = computed(
  () =>
    !isWebRuntime.value &&
    !isStreaming.value &&
    !sessionHydrating.value &&
    Boolean(activeOpenCodeSessionId.value) &&
    messages.value.some(message => message.role !== 'system'),
)

const effectiveDesktopSkills = computed(() =>
  mergeCreativeSkillCatalog(skillsManageStore.centralSkills, builtInSkills.value),
)
const desktopProductSkills = computed<OpenCodeSkillOption[]>(() =>
  effectiveDesktopSkills.value.map(skill => ({
    name: skill.name,
    label: skill.name,
    description: skill.description || undefined,
    location: skill.source === 'local' ? 'local' : 'builtin',
  })),
)
const webBuiltInSkills = computed<OpenCodeSkillOption[]>(() => {
  const seen = new Set<string>()
  return [...agentStore.loadSkills(), ...agentStore.getPresetSkills()]
    .filter(skill => {
      const key = skill.name || skill.id
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(skill => ({
      name: skill.name,
      label: skill.name,
      description: skill.description || undefined,
      location: String(skill.skillContent || ''),
      content: String(skill.skillContent || ''),
    }))
})
const selectableOpenCodeSkills = computed<OpenCodeSkillOption[]>(() => {
  if (isTauriRuntime()) return desktopProductSkills.value
  const seen = new Set<string>()
  const merged: OpenCodeSkillOption[] = []
  for (const skill of webBuiltInSkills.value) {
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
const effectiveOpenCodeSkillName = computed(() => selectedOpenCodeSkillOption.value?.name || '')
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
  const base = baseComposerCommands.filter(
    item =>
      !hiddenComposerSessionCommands.has(item.command) &&
      (item.command !== 'tab.close' || shouldShowTabCloseCommand(activeEditorFileId.value)),
  )
  const seen = new Set(base.map(item => item.command))
  const dynamicCommands = openCodeCustomCommands.value
    .filter(
      item => item.slash && !seen.has(item.slash) && !hiddenComposerSessionCommands.has(item.slash),
    )
    .map(item => {
      const command = String(item.slash || '')
      return {
        command,
        label: item.label,
        source: item.source,
        group: 'Skill / 外部工具 / Custom',
        icon:
          item.source === 'MCP' ? 'extension' : item.source === 'Skill' ? 'psychology' : 'terminal',
      }
    })
  return [...base, ...dynamicCommands]
})
const desktopMediaMessages = computed<ChatMessage[]>(() => {
  if (isWebRuntime.value) return []
  const directory = selectedProjectDir.value || openCodeSyncStore.activeDirectory
  return mediaTaskStore.chatTasksFor(openCodeSyncStore.activeSessionId, directory).flatMap(task => [
    {
      id: `${task.id}:prompt`,
      role: 'user',
      content: task.prompt,
      timestamp: task.createdAt,
      images: task.referenceImages.length ? task.referenceImages : undefined,
    },
    {
      id: task.chatMessageId || `${task.id}:bubble`,
      role: 'assistant',
      content: `[MEDIA_TASK:${task.id}]`,
      timestamp: task.createdAt + 1,
      isMediaTask: true,
      mediaTaskId: task.id,
    },
  ])
})
const displayMessages = computed(() => {
  let lastOfficeFiles: OfficeDownloadFile[] = []
  const latestToolResultByAssistantId = buildLatestToolResultByAssistantId(messages.value)
  const sourceMessages = isWebRuntime.value
    ? messages.value
    : [...messages.value, ...desktopMediaMessages.value].sort(
        (a, b) => (a.timestamp || 0) - (b.timestamp || 0),
      )
  const enrichedMessages = sourceMessages.map(message => {
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

  return (
    enrichedMessages
      .filter(m => {
        if (m.role === 'system') return false
        if (m.role === 'tool') return false // 工具返回值不显示，LLM 会在回复中解释
        if (m.content && String(m.content).trim()) return true
        if (m.reasoningContent && String(m.reasoningContent).trim()) return true
        if (m.toolCalls && m.toolCalls.length > 0) return true
        if (
          m.openCodeParts &&
          m.openCodeParts.some(part => part.type !== 'text' || Boolean(part.text?.trim()))
        )
          return true
        if (m.isMediaTask) return true
        return false
      })
      // ponytail: 插入 TurnDivider — 中断/压缩分隔线（对齐 OpenCode message-timeline.tsx constructMessageRows）
      // 天花板: 仅检测 finishReason，未解析 MessageAbortedError 的 name 字段。
      // 升级路径: 如果以后有更细粒度的中止原因，扩展为 error.name 匹配。
      .reduce((acc: DisplayChatMessage[], msg) => {
        acc.push(msg)
        if (msg.role !== 'assistant') return acc
        // 中断分隔线
        if (msg.finishReason === 'abort') {
          acc.push({
            id: `divider-aborted-${msg.id}`,
            role: 'divider',
            content: '已中断',
            timestamp: msg.timestamp,
          } as DisplayChatMessage)
        }
        // 压缩分隔线 — 检测 openCodeParts 中是否有 compaction 类型
        if (msg.openCodeParts?.some(p => p.type === 'compaction')) {
          acc.push({
            id: `divider-compaction-${msg.id}`,
            role: 'divider',
            content: '上下文已压缩',
            timestamp: msg.timestamp,
          } as DisplayChatMessage)
        }
        return acc
      }, [])
  )
})
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

// 打开右侧审查栏，和官方 OpenCode 一样把 diff 放在独立侧栏。
function scrollToDiffReview() {
  if (isCreativeMode.value) return
  emitEvent('switch-panel', 'review')
}

// ─── 虚拟列表（ponytail: 全量渲染几百条消息时 DOM 节点过万，虚拟化为 ~20 条可见）───
// 上限：@tanstack/vue-virtual 的 getTotalSize 在 count=0 时返回 0，外层 v-if 防空。
// 升级路径：如果动态高度估算不准（estimateSize + measureElement 已覆盖绝大部分场景），可调大 overscan。
const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayMessages.value.length,
    getScrollElement: () => messagesContainer.value,
    estimateSize: () => 200, // 含代码块/工具卡片的平均高度，首次渲染前估值
    overscan: 8,
    measureElement: (el: Element) => {
      const h = el.getBoundingClientRect().height
      return h > 0 ? h : 120
    },
  })),
)

// measureElement 适配 Vue ref 回调类型（Element | ComponentPublicInstance → Element | null）
function measureVirtualElement(el: unknown) {
  if (el instanceof Element) {
    virtualizer.value.measureElement(el)
  }
}

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
    fetch(p.url)
      .then(r => r.blob())
      .then(blob => {
        const ext = p.type === 'video' ? 'mp4' : 'png'
        const mime = p.type === 'video' ? 'video/mp4' : 'image/png'
        const file = new File([blob], p.name || `media_${Date.now()}.${ext}`, { type: mime })
        fileUploader.value?.addExternalFiles([file])
      })
      .catch(() => {
        /* silently fail */
      })
  }
})
onBeforeUnmount(offSendToChat)

function appendChatInput(payload: unknown) {
  if (!isMember.value) return
  const text = String(payload || '').trim()
  if (!text) return
  const editorText = (composerRef.value?.textContent || '').trim()
  setEditorText(composerRef.value, editorText ? `${editorText}\n\n${text}` : text)
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
  if (isCreativeMode.value) return
  const { sessionId, title } = (payload as { sessionId?: string; title?: string }) || {}
  if (!sessionId || !title) return
  try {
    await openCodeSyncStore.renameSession(sessionId, title)
  } catch (e) {
    console.warn('[JC] OpenCode session rename sync failed:', e)
  }
})
onBeforeUnmount(offRenameOpenCodeSession)

// P2-2: FileTree 查看详情 → 打开上下文面板
const offViewSessionDetail = onEvent('view-session-detail', () => {
  emitEvent('switch-panel', 'context')
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
  setEditorText(
    composerRef.value,
    [
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
    ].join('\n'),
  )
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
  if (state.index === -1) state.draft = composerRef.value ? getPlainText(composerRef.value) : ''
  let next = state.index + direction
  if (next < -1) next = -1
  if (next >= pool.length) next = pool.length - 1
  recallState.value = { index: next, draft: state.draft }
  setEditorText(composerRef.value, next === -1 ? state.draft : pool[pool.length - 1 - next])
  void nextTick(() => resizeComposer())
}
function resetRecall() {
  recallState.value = { index: -1, draft: '' }
}

// 当前 sessionId
let currentSessionId = ''
let sessionLoadRequestId = 0
let rawSyncStartMessageCount = 0
let localCommandNoticeTimer: ReturnType<typeof setTimeout> | null = null
let skipNextPersist = false
let mediaSubmitPending = false
let pendingCreativeSessionId = ''
let pendingCreativeMessages: ChatMessage[] | null = null
let pendingCreativeRunId = 0
let nextCreativeRunId = 0

// ponytail: Web 端需要 IndexedDB 持久化（无 OpenCode Server），桌面端由 OpenCode Server 管理
async function persistCurrentSession() {
  if (isCreativeMode.value) {
    if (currentSessionId && messages.value.length)
      await creativeSessionStore.saveSession(currentSessionId, messages.value)
    return
  }
  if (!isWebRuntime.value || !currentSessionId || messages.value.length === 0) return
  await sessionStore.saveSession(
    currentSessionId,
    '',
    messages.value.map(m => ({ ...m })),
    { openCodeSessionId: getActiveOpenCodeSessionId() || undefined },
  )
}
async function flushCurrentSessionPersist() {
  await persistCurrentSession()
}

async function syncCurrentSessionToRaw() {}

const offEditorFileChanged = onEvent('editor-file-changed', (payload: unknown) => {
  const fileId = (payload as { fileId?: string | null } | null)?.fileId
  activeEditorFileId.value = fileId ? String(fileId) : null
})
const offSelectSkill = onEvent('select-skill', (payload: unknown) => {
  const name = typeof payload === 'string' ? payload : (payload as any)?.name || ''
  if (name) selectOpenCodeSkill(name)
})
onBeforeUnmount(offEditorFileChanged)
onBeforeUnmount(offSelectSkill)

// 自动滚动到底部
watch(
  messages,
  () => {
    nextTick(() => {
      scrollNav.value?.scheduleAutoScrollIfNeeded()
    })
    skipNextPersist = false
  },
  { deep: true },
)

onBeforeUnmount(() => {
  if (localCommandNoticeTimer) clearTimeout(localCommandNoticeTimer)
  settleCreativeToolApproval('reject')
  settleRetryConfirmation(false)
})

async function startOutputFollow() {
  await nextTick()
  scrollNav.value?.startStickyFollow()
}

function beginCreativeSessionHydration() {
  ++sessionLoadRequestId
  currentSessionId = ''
  sessionHydrating.value = true
  loadMessages([], { agentId: '', skillContent: '' })
}

watch(
  isCreativeMode,
  creative => {
    if (!creative) return
    stopOpenCodeStream()
    beginCreativeSessionHydration()
  },
  { flush: 'sync' },
)

watch(
  () => creativeSessionStore.currentProjectId,
  () => {
    if (isCreativeMode.value) beginCreativeSessionHydration()
  },
  { flush: 'sync' },
)

// 切换对话时加载历史消息
watch(
  () => sessionStore.activeSessionId,
  async newId => {
    if (isCreativeMode.value) return
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
      if (!isWebRuntime.value) {
        const directory = selectedProjectDir.value || openCodeSyncStore.activeDirectory
        await openCodeSyncStore.openSession(directory, newId)
        return
      }
      await sessionLoadPromise
      const history = await sessionStore.loadSessionMessages(newId)
      if (requestId !== sessionLoadRequestId || sessionStore.activeSessionId !== newId) return
      const session = sessionStore.projectSessions.find(s => s.id === newId)
      let effectiveHistory = history
      if (session?.openCodeSessionId) {
        try {
          const projectedConfig = await projectStoredNewApiForOpenCode({
            currentModel: agentStore.currentModel,
            models: agentStore.availableModels,
          })
          const handle = await ensureOpenCodeServer({
            config: projectedConfig,
            directory: selectedProjectDir.value || undefined,
          })
          const client = createJiucaiOpenCodeClient(handle, selectedProjectDir.value || undefined)
          await prefetchOpenCodeSession(client, session.openCodeSessionId)
          const openCodeHistory = await listOpenCodeChatMessages(
            client,
            session.openCodeSessionId,
            {
              preferCache: true,
              directory: selectedProjectDir.value || handle.directory,
            },
          )
          effectiveHistory = openCodeHistory.length ? openCodeHistory : history
        } catch {
          effectiveHistory = history
        }
      }
      if (isMember.value) agentStore.currentAgent = null
      rawSyncStartMessageCount = 0
      skipNextPersist = true
      loadMessages(effectiveHistory, {
        agentId: '',
        skillContent: '',
        openCodeSessionId: session?.openCodeSessionId,
      })
      void nextTick(() => resizeComposer())
    } finally {
      if (requestId === sessionLoadRequestId) sessionHydrating.value = false
    }
  },
  { immediate: true },
)

watch(
  () => [isCreativeMode.value, creativeSessionStore.activeSessionId] as const,
  async ([creative, sessionId]) => {
    const isPendingActiveCreativeSession =
      sessionId === pendingCreativeSessionId &&
      sessionId === currentSessionId &&
      messages.value === pendingCreativeMessages
    if (!creative || isPendingActiveCreativeSession) return
    if (sessionId === currentSessionId && messages.value.length) return
    const requestId = ++sessionLoadRequestId
    sessionHydrating.value = true
    try {
      await creativeSessionStore.loadAllSessions()
      if (
        requestId !== sessionLoadRequestId ||
        !isCreativeMode.value ||
        creativeSessionStore.activeSessionId !== sessionId ||
        sessionId === pendingCreativeSessionId
      )
        return
      const history = sessionId ? await creativeSessionStore.loadSessionMessages(sessionId) : []
      if (
        requestId !== sessionLoadRequestId ||
        !isCreativeMode.value ||
        creativeSessionStore.activeSessionId !== sessionId ||
        sessionId === pendingCreativeSessionId
      )
        return
      currentSessionId = sessionId
      loadMessages(history, { agentId: '', skillContent: '' })
    } finally {
      if (requestId === sessionLoadRequestId) sessionHydrating.value = false
    }
  },
  { immediate: true },
)

async function restoreActiveSession() {
  if (isCreativeMode.value) return
  if (!isWebRuntime.value) return
  await sessionStore.loadAllSessions()
  const activeId = String(sessionStore.activeSessionId || '').trim()
  if (!activeId) return
  if (activeId === currentSessionId && messages.value.length > 0) return

  const requestId = ++sessionLoadRequestId
  currentSessionId = activeId
  sessionHydrating.value = true
  try {
    const history = await sessionStore.loadSessionMessages(activeId)
    if (requestId !== sessionLoadRequestId) return
    if (!history.length) return

    const session = sessionStore.projectSessions.find(s => s.id === activeId)
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
  {
    icon: 'build',
    label: '创建/修改Skill',
    hint: '打包、调试、发布',
    prompt: '帮我创建一个Skill，功能是：',
  },
  {
    icon: 'download',
    label: '安装GitHub项目',
    hint: '克隆→配置→运行',
    prompt: '请帮我安装 [网址]，放到 [本地路径]。',
  },
]

function useWelcomeSuggestion(prompt: string) {
  setEditorText(composerRef.value, prompt)
  void nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
    // 把光标移到末尾
    const ta = composerRef.value
    if (ta && 'setSelectionRange' in ta) {
      ;(ta as unknown as HTMLTextAreaElement).setSelectionRange(prompt.length, prompt.length)
    }
  })
}

// 发送消息：提交当前手动选择的 Skill / 项目文件夹 / Tool / Model
interface InternalCreativeSend {
  text: string
  skillPrompt?: string
  images?: string[]
  files?: Array<{ name: string; content: string }>
  captureMediaPlan?: boolean
}

function attachMediaPlan(message: ChatMessage, mediaContext: MediaContextSnapshot) {
  try {
    const plan = materializeMediaPlanReferences(parseMediaPlan(message.content), mediaContext)
    validateMediaPlan(plan)
    message.mediaPlan = plan
    message.content = replaceMediaPlanModelId(message.content, plan.modelId)
    message.mediaPlanStatus = 'ready'
    message.mediaPlanError = undefined
  } catch {
    // 普通回复没有计划块是正常路径；非法计划不触发付费任务。
  }
}

async function handleSend(internal?: InternalCreativeSend | Event) {
  const options =
    internal && typeof internal === 'object' && 'text' in internal
      ? (internal as InternalCreativeSend)
      : undefined
  const editor = composerRef.value
  if (!editor && !options) return
  const pendingMediaType = isMediaModel(agentStore.currentModel)
  if (pendingMediaType && isMember.value && mediaSubmitPending) return
  const plainText = options?.text ?? getPlainText(editor!)
  if (!options && !(await addPastedProjectMediaReferences(plainText))) return
  const hasText = plainText.trim().length > 0
  const hasAttachments = options ? false : (fileUploader.value?.attachedFiles?.length || 0) > 0
  const isFileProcessing = options ? false : fileUploader.value?.isProcessing

  if ((!hasText && !hasAttachments) || isFileProcessing || (sessionHydrating.value && !options))
    return

  if (isStreaming.value) {
    stopStream()
    await new Promise(r => setTimeout(r, 200))
  }

  const text = plainText.trim() || (hasAttachments ? '请分析这些文件' : '')
  // 清空编辑器
  const replyContext = options ? null : replyTarget.value
  if (!options) {
    editor!.textContent = ''
    hasInputText.value = false
    resetRecall()
    replyTarget.value = null
    void nextTick(() => resetComposer({ focus: true }))
  }

  // 收集引用文件
  const refFiles = options ? [] : [...referenceFiles.value]
  if (!options) referenceFiles.value = []

  // 收集附件（ponytail: 直连模式不做 OCR，图片直接喂给模型）
  const attachedFiles = options ? [] : fileUploader.value?.attachedFiles || []
  const turnMessageId = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const images: string[] = []
  const files: Array<{ name: string; content: string }> = options?.files ? [...options.files] : []
  const terminalAttachments: Array<{ name: string; inputPath: string }> = []
  const mediaReferenceInputs: Parameters<typeof buildExplicitMediaReferences>[1] = []
  const modelAttachments: ResolvedDirectAttachment[] = []
  const attachmentRefs: DirectAttachmentRef[] = []

  for (const [index, af] of attachedFiles.entries()) {
    const name = af.file?.name || 'file'
    if (af.modelValue && af.modelKind) {
      const id = `${turnMessageId}:${index}`
      modelAttachments.push({
        id,
        name,
        mime: af.file.type || 'application/octet-stream',
        size: af.file.size,
        kind: af.modelKind,
        value: af.modelValue,
      })
      attachmentRefs.push({
        id,
        name,
        mime: af.file.type || 'application/octet-stream',
        size: af.file.size,
        kind: af.modelKind,
        source: af.referenceSource || (af.resource ? 'project' : 'upload'),
        resource: af.resource,
        cachePath: af.mediaInputPath,
      })
    }
    const imageValue = !af.textContent ? af.remoteUrl || af.preview : undefined
    if (imageValue) {
      images.push(imageValue)
      mediaReferenceInputs.push({
        name,
        kind: 'image',
        value: imageValue,
        source: af.referenceSource || (af.resource ? 'project' : 'attachment'),
        resource: af.resource,
      })
    }
    if (af.mediaReferenceValue) {
      mediaReferenceInputs.push({
        name,
        kind: 'video',
        value: af.mediaReferenceValue,
        source: af.referenceSource || (af.resource ? 'project' : 'attachment'),
        resource: af.resource,
      })
    }
    if (af.mediaInputPath) {
      terminalAttachments.push({ name, inputPath: af.mediaInputPath })
    }
    if (af.textContent) {
      const content = af.mediaInputPath
        ? af.textContent.replace(/^本地缓存:.*$/m, `终端附件: {{attachment:${name}}}`)
        : af.textContent
      files.push({ name, content })
    }
  }

  for (const [index, image] of (options?.images || []).entries()) {
    mediaReferenceInputs.push({
      name: `参考图 ${index + 1}`,
      kind: 'image',
      value: image,
      source: 'attachment',
    })
  }

  const mediaOwner = activeMediaOwner()
  const explicitReferences = buildExplicitMediaReferences(turnMessageId, mediaReferenceInputs)
  const recentReferences =
    mediaOwner && currentSessionId
      ? buildRecentTaskReferences(mediaTaskStore.tasks, {
          owner: mediaOwner,
          sessionId: currentSessionId,
        })
      : []
  const mediaContext = createMediaContextSnapshot({
    owner: mediaOwner,
    sessionId: currentSessionId,
    explicitReferences,
    recentReferences,
  })
  const mediaPlanPolicy = buildMediaPlanPolicy(buildMediaReferencePolicy(mediaContext))

  // 清空附件
  if (!options) fileUploader.value?.clearAll()

  if (isCreativeMode.value && !isMediaModel(agentStore.currentModel)) {
    try {
      await refreshProductSkillCatalog()
    } catch (error) {
      setLocalCommandNotice(
        `Skill 目录加载失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
    if (!selectedProjectDir.value) {
      setLocalCommandNotice('请先选择项目文件夹。')
      return
    }
    if (!currentSessionId || !currentSessionId.startsWith('creative_')) {
      currentSessionId = creativeSessionStore.createPendingSession()
    }
    if (!currentSessionId) return
    const creativeSessionId = currentSessionId
    const creativeRunId = ++nextCreativeRunId
    let creativeToolAlwaysAllowed = false
    const creativeMessages = messages.value
    const userMessage: ChatMessage = {
      id: turnMessageId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: (options?.images || images).length ? options?.images || images : undefined,
      files: files.length ? files : undefined,
      attachments: attachmentRefs.length ? attachmentRefs : undefined,
    }
    const assistantMessage: ChatMessage = {
      id: `assistant_${Date.now().toString(36)}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      modelId: agentStore.currentModel,
      modelProviderId: currentModelEntry.value?.providerId,
    }
    creativeMessages.push(userMessage, assistantMessage)
    const reactiveAssistantMessage = creativeMessages[creativeMessages.length - 1]!
    pendingCreativeSessionId = creativeSessionId
    pendingCreativeMessages = creativeMessages
    pendingCreativeRunId = creativeRunId
    try {
      await creativeSessionStore.saveSession(creativeSessionId, creativeMessages)
      creativeSessionStore.switchSession(creativeSessionId)
      await sendCreative({
        projectDir: selectedProjectDir.value,
        modelId: agentStore.currentModel,
        modelProviderId: currentModelEntry.value?.providerId,
        messages: creativeMessages,
        mediaPlanPolicy,
        skillPrompt:
          options?.skillPrompt ||
          (effectiveOpenCodeSkillName.value
            ? `当前用户明确选择了 Skill「${effectiveOpenCodeSkillName.value}」。请先调用 skill 工具加载这个精确名称，再按其内容完成任务。`
            : undefined),
        projectMemoryFiles: createDesktopProjectTextFiles(selectedProjectDir.value),
        attachments: terminalAttachments,
        modelAttachments,
        modelInputModalities: currentModelEntry.value
          ? resolveModelInputModalities(currentModelEntry.value)
          : undefined,
        availableModels: agentStore.availableModels,
        confirmMediaSpecialist: requestMediaSpecialistConsent,
        mediaEnhancementEnabled: isMediaEnhancementEnabled(),
        modelToolCall: currentModelEntry.value?.toolCall,
        onMediaSpecialist: modelId => {
          reactiveAssistantMessage.mediaReaderModelId = modelId
        },
        skillCatalog: effectiveDesktopSkills.value.map(
          ({ id, name, description, triggers, commands, files }) => ({
            id,
            name,
            description,
            triggers,
            commands,
            files,
          }),
        ),
        loadSkill: async name => {
          const selected = effectiveDesktopSkills.value.find(item => item.name === name)
          if (!selected) return null
          if (selected.source === 'builtin') {
            const skill = await loadWebSkillByName(selected.id)
            return {
              content: skill.content,
              resources: skill.files.filter(path => path !== 'SKILL.md'),
              readResource: relative => readWebSkillResource(skill.baseDirectory, relative),
            }
          }
          const skill = skillsManageStore.centralSkills.find(item => item.id === selected.id)
          if (!skill) return null
          const { invoke } = await import('@tauri-apps/api/core')
          const [detail, content] = await Promise.all([
            invoke<SkillDetail>('get_skill_detail', { skillId: skill.id }),
            invoke<string>('read_skill_content', { skillId: skill.id }),
          ])
          if (!content.trim()) return null
          const directory = skillDirectory(detail)
          const context = { skillId: detail.id, agentId: null, rowId: detail.row_id ?? null }
          const tree = await invoke<SkillDirectoryNode[]>('list_skill_directory', {
            dirPath: directory,
            context,
          })
          const resources = flattenSkillFiles(tree).filter(path => path !== 'SKILL.md')
          const localSkill: LocalCreativeSkill = {
            content,
            resources,
            readResource: relative =>
              invoke<string>('read_file_by_path', { path: `${directory}/${relative}`, context }),
          }
          return localSkill
        },
        confirmTool: async call => {
          if (creativeToolAlwaysAllowed) return true
          return await new Promise<boolean>(resolve => {
            pendingCreativeToolApproval.value = {
              message: creativeToolApprovalMessage(call),
              resolve: decision => {
                if (decision === 'always') creativeToolAlwaysAllowed = true
                resolve(decision !== 'reject')
              },
            }
          })
        },
        onToolCall: call => {
          reactiveAssistantMessage.toolCalls = [...(reactiveAssistantMessage.toolCalls || []), call]
          reactiveAssistantMessage.toolProgress = [
            ...(reactiveAssistantMessage.toolProgress || []),
            {
              toolCallId: call.id,
              name: call.function.name,
              phase: 'executing',
              args: call.function.arguments,
              result: null,
              isError: false,
              startedAtMs: Date.now(),
              finishedAtMs: null,
            },
          ]
        },
        onToolResult: (call, result, status) => {
          reactiveAssistantMessage.toolStatus = status
          reactiveAssistantMessage.toolProgress = (reactiveAssistantMessage.toolProgress || []).map(
            step =>
              step.toolCallId === call.id
                ? {
                    ...step,
                    phase: 'result',
                    result,
                    isError: status === 'failed',
                    finishedAtMs: Date.now(),
                  }
                : step,
          )
          creativeMessages.push({
            id: `tool_${call.id}_${Date.now().toString(36)}`,
            role: 'tool',
            content: result,
            timestamp: Date.now(),
            toolCallId: call.id,
            toolName: call.function.name,
            toolStatus: status,
          })
        },
        onText: value => {
          reactiveAssistantMessage.content = value
        },
        onFinishReason: reason => {
          reactiveAssistantMessage.finishReason = reason || 'stop'
        },
      })
      if (options?.captureMediaPlan !== false) {
        attachMediaPlan(reactiveAssistantMessage, mediaContext)
      }
      reactiveAssistantMessage.finishReason ||= 'stop'
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        reactiveAssistantMessage.toolStatus = 'cancelled'
        reactiveAssistantMessage.finishReason = 'abort'
      } else {
        const failure = `创作模式请求失败：${error instanceof Error ? error.message : String(error)}`
        reactiveAssistantMessage.content = [reactiveAssistantMessage.content, failure]
          .filter(Boolean)
          .join('\n\n')
        reactiveAssistantMessage.finishReason = 'network_error'
      }
    } finally {
      try {
        await creativeSessionStore.saveSession(creativeSessionId, creativeMessages)
        if (
          isCreativeMode.value &&
          creativeSessionStore.activeSessionId === creativeSessionId &&
          messages.value !== creativeMessages
        ) {
          currentSessionId = creativeSessionId
          loadMessages(creativeMessages, { agentId: '', skillContent: '' })
        }
      } finally {
        if (pendingCreativeRunId === creativeRunId) {
          pendingCreativeSessionId = ''
          pendingCreativeMessages = null
          pendingCreativeRunId = 0
        }
      }
    }
    return
  }

  // ─── 媒体模型拦截：如果当前模型是媒体生成模型，走 Task Engine ───
  const currentModelId = agentStore.currentModel
  const mediaType = isMediaModel(currentModelId)
  if (mediaType && isMember.value) {
    if (mediaSubmitPending) return
    mediaSubmitPending = true
    try {
      // 首次发消息时创建 session
      if ((isWebRuntime.value || isCreativeMode.value) && !currentSessionId) {
        if (isCreativeMode.value) currentSessionId = creativeSessionStore.startNewSession()
        else {
          currentSessionId = sessionStore.startNewSession('')
        }
        rawSyncStartMessageCount = 0
      }

      // 插入用户消息
      const userMsgId = 'msg_' + Date.now().toString(36) + '_u'
      if (isWebRuntime.value || isCreativeMode.value) {
        messages.value.push({
          id: userMsgId,
          role: 'user',
          content: text,
          timestamp: Date.now(),
          images: images.length > 0 ? images : undefined,
        })
      }

      if (requiresCreationPanelMediaModel(currentModelId)) {
        if (!isWebRuntime.value && !isCreativeMode.value) {
          setLocalCommandNotice(
            `当前模型需要完整参数，请到创作面板或画布中使用「${agentStore.modelLabel}」。`,
          )
          return
        }
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
      let mediaSessionId: string | undefined
      let mediaDirectory: string | undefined
      let mediaCleanupToken: string | undefined
      try {
        if (!isWebRuntime.value && !isCreativeMode.value) {
          const projectedConfig = await projectStoredNewApiForOpenCode({
            currentModel: agentStore.currentModel,
            models: agentStore.availableModels,
          })
          await openCodeSyncStore.ensureConnected({
            config: projectedConfig,
            directory: selectedProjectDir.value || undefined,
          })
          mediaDirectory = selectedProjectDir.value || openCodeSyncStore.activeDirectory
          if (!mediaDirectory) throw new Error('请先选择项目文件夹')
          const sessionResult = await openCodeSyncStore.ensureSessionWithOwnership({
            directory: mediaDirectory,
            title: text,
          })
          mediaSessionId = sessionResult.sessionID
          mediaCleanupToken = sessionResult.cleanupToken
          currentSessionId = mediaSessionId
          sessionStore.switchSession(mediaSessionId)
        } else if (isCreativeMode.value) {
          mediaDirectory = selectedProjectDir.value
          if (!mediaDirectory) throw new Error('请先选择项目文件夹')
          if (!currentSessionId) currentSessionId = creativeSessionStore.startNewSession()
          mediaSessionId = currentSessionId
          creativeSessionStore.switchSession(currentSessionId)
        }
        taskId = await mediaTaskStore.submitTask({
          type: mediaType,
          model: currentModelId,
          modelLabel: agentStore.modelLabel,
          prompt: text,
          referenceImages: images,
          source: 'chat',
          chatMessageId: taskMsgId,
          sessionId: mediaSessionId,
          directory: mediaDirectory,
          imageParams:
            mediaType === 'image'
              ? {
                  model: currentModelId,
                  prompt: text,
                  image: images.length > 1 ? images : images[0],
                }
              : undefined,
          videoParams:
            mediaType === 'video'
              ? {
                  model: currentModelId,
                  prompt: text,
                  imageUrl: images[0],
                  imageUrls: images.length > 1 ? images : undefined,
                }
              : undefined,
          audioParams: mediaType === 'audio' ? { model: currentModelId, prompt: text } : undefined,
        })
      } catch (error) {
        if (!isWebRuntime.value && !isCreativeMode.value) {
          if (mediaSessionId && mediaCleanupToken) {
            try {
              const cleaned = await openCodeSyncStore.cleanupCreatedSessionIfExclusive(
                mediaSessionId,
                mediaCleanupToken,
              )
              if (cleaned) {
                currentSessionId = ''
                sessionStore.switchSession('')
              }
            } catch (cleanupError) {
              console.warn('[JC] failed to clean up media session:', cleanupError)
            }
          }
          setLocalCommandNotice(
            `媒体任务提交失败：${error instanceof Error ? error.message : '请稍后重试'}`,
          )
          return
        }
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

      if (isWebRuntime.value) {
        // Web 继续把占位消息写入本地会话；Desktop 直接投影持久化媒体任务。
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
      } else if (isCreativeMode.value) {
        messages.value.push({
          id: taskMsgId,
          role: 'assistant',
          content: `[MEDIA_TASK:${taskId}]`,
          timestamp: Date.now(),
          isMediaTask: true,
          mediaTaskId: taskId,
        })
        await persistCurrentSession()
      }
      await nextTick()
      scrollNav.value?.scheduleAutoScrollIfNeeded()
      return // 不走文本 LLM 流程
    } finally {
      mediaSubmitPending = false
    }
  }

  // Web 端首次发消息时创建本地 session；Desktop 由 OpenCode session.create 返回真实 ses_*。
  if (isWebRuntime.value && !currentSessionId) {
    currentSessionId = sessionStore.startNewSession('')
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

  if (!isWebRuntime.value && !hasAttachments && sendText.startsWith('/')) {
    await startOutputFollow()
    await runVisibleSlashText(sendText, {
      ...currentOpenCodeCommandOptions(),
      modelId: chatModelId,
      modelProviderId: chatModelEntry?.providerId,
    })
    await persistCurrentSession()
    return
  }

  if (!isWebRuntime.value && !hasAttachments && sendText.startsWith('!')) {
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
  let preinsertedWebUserMessage = false

  if (isWebRuntime.value) {
    messages.value.push({
      id: turnMessageId,
      role: 'user',
      content: sendText,
      timestamp: Date.now(),
      agentName: isMember.value ? skillName || agentStore.modelLabel : agentStore.modelLabel,
      images: images.length > 0 ? images : undefined,
      files: files.length > 0 ? files : undefined,
      attachments: attachmentRefs.length ? attachmentRefs : undefined,
    })
    preinsertedWebUserMessage = true
    await persistCurrentSession()
  }
  // ─── 插件 hook: chat.send.before ───
  const host = getPluginHost()
  let pluginModifiedText = sendText
  ;(host as any).triggerChatSendBefore?.({
    text: sendText,
    modelId: chatModelId,
    sessionId: currentSessionId,
    modifyText: (newText: string) => {
      pluginModifiedText = newText
    },
  })
  const finalSendText = pluginModifiedText

  const sendPromise = sendMessage(finalSendText, {
    agentName: isMember.value ? skillName || agentStore.modelLabel : agentStore.modelLabel,
    skillName: isMember.value ? skillName || undefined : undefined,
    sessionId: currentSessionId,
    images: images.length > 0 ? images : undefined,
    files: files.length > 0 ? files : undefined,
    attachments: attachmentRefs.length ? attachmentRefs : undefined,
    modelAttachments: modelAttachments.length ? modelAttachments : undefined,
    modelInputModalities: chatModelEntry
      ? resolveModelInputModalities(chatModelEntry)
      : undefined,
    confirmMediaSpecialist: requestMediaSpecialistConsent,
    mediaEnhancementEnabled: isMediaEnhancementEnabled(),
    modelId: chatModelId,
    modelProviderId: chatModelEntry?.providerId,
    mediaPlanPolicy,
    chatMode: currentDesktopOpenCodeAgent.value,
    openCodeAgent: currentDesktopOpenCodeAgent.value,
    openCodeProjectDir: selectedProjectDir.value || undefined,
    _skipUserMessageInsert: preinsertedWebUserMessage,
  })
  await nextTick()
  scrollNav.value?.startStickyFollow()
  await persistCurrentSession()
  try {
    await sendPromise
  } catch {
    setEditorText(composerRef.value, finalSendText)
    hasInputText.value = true
    await nextTick()
    resizeComposer()
    composerRef.value?.focus()
    return
  }
  if (!isWebRuntime.value) {
    currentSessionId = getActiveOpenCodeSessionId()
    sessionStore.switchSession(currentSessionId)
  }

  // ─── 插件 hook: chat.receive.after ───
  const lastAssistantMsg = [...messages.value].reverse().find(m => m.role === 'assistant')
  if (lastAssistantMsg) {
    if (isWebRuntime.value) attachMediaPlan(lastAssistantMsg, mediaContext)
    ;(host as any).triggerChatReceiveAfter?.({
      content: lastAssistantMsg.content,
      modelId: chatModelId,
      sessionId: currentSessionId,
    })
  }

  // 5. 保存到 IndexedDB
  await persistCurrentSession()
}

function bytesToDataUrl(bytes: Uint8Array, mimeType = 'application/octet-stream'): Promise<string> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('参考素材读取失败'))
    reader.readAsDataURL(new Blob([copy.buffer], { type: mimeType }))
  })
}

async function approveMediaPlan(messageId: string) {
  const message = messages.value.find(item => item.id === messageId)
  if (!message?.mediaPlan || !['ready', 'failed'].includes(message.mediaPlanStatus || '')) return
  message.mediaPlanStatus = 'submitting'
  message.mediaPlanError = undefined
  const currentOwner = activeMediaOwner()
  if (message.mediaPlan.mediaOwner && message.mediaPlan.mediaOwner !== currentOwner) {
    message.mediaPlanStatus = 'failed'
    message.mediaPlanError = '参考素材属于其他项目，请回到原项目或重新选择素材。'
    return
  }
  const invalidReference = message.mediaPlan.mediaReferences?.find(
    reference => reference.invalidReason,
  )
  if (invalidReference) {
    message.mediaPlanStatus = 'failed'
    message.mediaPlanError = invalidReference.invalidReason
    return
  }
  try {
    message.mediaPlan = await refreshMediaPlanReferenceValues(message.mediaPlan, {
      readProject: async locator => {
        const binary = await projectFiles.readBinary({
          runtime: locator.runtime,
          owner: locator.owner,
          path: locator.path,
          id: locator.id,
          name: locator.path.split('/').pop() || locator.path,
          isDirectory: false,
          kind: 'media',
        })
        return bytesToDataUrl(binary.data, binary.mimeType)
      },
      readTask: async taskId => {
        const task = mediaTaskStore.getTask(taskId)
        if (task?.status !== 'success') return ''
        const resource = projectResourceForMediaTask(task)
        if (resource) {
          try {
            const binary = await projectFiles.readBinary(resource)
            return bytesToDataUrl(binary.data, binary.mimeType)
          } catch {
            // The immutable verified result URL remains the compatibility fallback.
          }
        }
        return task.resultUrl || ''
      },
    })
    validateMediaPlan(message.mediaPlan)
  } catch (error) {
    message.mediaPlanStatus = 'failed'
    message.mediaPlanError = error instanceof Error ? error.message : String(error)
    return
  }
  emitEvent('switch-panel', 'creation')
  emitEvent('media-plan-approved', {
    sessionId: currentSessionId,
    messageId,
    plan: message.mediaPlan,
  })
}

function removeMediaReference(messageId: string, referenceId: string) {
  const message = messages.value.find(item => item.id === messageId)
  if (!message?.mediaPlan || message.mediaPlanStatus === 'submitting') return
  const references = (message.mediaPlan.mediaReferences || []).filter(
    reference => reference.id !== referenceId,
  )
  message.mediaPlan = withMediaReferences(
    {
      ...message.mediaPlan,
      referenceIds: (message.mediaPlan.referenceIds || []).filter(id => id !== referenceId),
      mediaOwner: references.length ? message.mediaPlan.mediaOwner : undefined,
    },
    references,
  )
  message.content = replaceMediaPlanModelId(message.content, message.mediaPlan.modelId)
  try {
    validateMediaPlan(message.mediaPlan)
    message.mediaPlanStatus = 'ready'
    message.mediaPlanError = undefined
  } catch (error) {
    message.mediaPlanStatus = 'failed'
    message.mediaPlanError = error instanceof Error ? error.message : String(error)
  }
  void persistCurrentSession()
}

function updateMessageMediaPlanParameters(messageId: string, patch: MediaPlanParameterPatch) {
  const message = messages.value.find(item => item.id === messageId)
  if (!message?.mediaPlan || ['submitting', 'submitted'].includes(message.mediaPlanStatus || '')) return
  try {
    message.mediaPlan = updateMediaPlanParameters(message.mediaPlan, patch)
    message.content = replaceMediaPlanModelId(message.content, message.mediaPlan.modelId)
    message.mediaPlanStatus = 'ready'
    message.mediaPlanError = undefined
  } catch (error) {
    message.mediaPlanStatus = 'failed'
    message.mediaPlanError = error instanceof Error ? error.message : String(error)
  }
  void persistCurrentSession()
}

const offMediaPlanSubmitted = onEvent('media-plan-submitted', (payload: unknown) => {
  const result = payload as { sessionId?: string; messageId?: string; taskId?: string }
  if (!result.messageId || !result.taskId) return
  const message = messages.value.find(item => item.id === result.messageId)
  if (!message) return
  message.mediaPlanStatus = 'submitted'
  message.mediaTaskId = result.taskId
  if (!messages.value.some(item => item.mediaTaskId === result.taskId)) {
    messages.value.push({
      id: `media_plan_task_${result.taskId}`,
      role: 'assistant',
      content: `[MEDIA_TASK:${result.taskId}]`,
      timestamp: Date.now(),
      isMediaTask: true,
      mediaTaskId: result.taskId,
    })
  }
  void persistCurrentSession()
})

const offMediaPlanFailed = onEvent('media-plan-failed', (payload: unknown) => {
  const result = payload as { messageId?: string; error?: string }
  if (!result.messageId) return
  const message = messages.value.find(item => item.id === result.messageId)
  if (!message) return
  message.mediaPlanStatus = 'failed'
  message.mediaPlanError = result.error || '媒体计划提交失败。'
  void persistCurrentSession()
})

onBeforeUnmount(offMediaPlanSubmitted)
onBeforeUnmount(offMediaPlanFailed)

const offEcommercePlanRequest = onEvent('ecommerce-plan-request', async (payload: unknown) => {
  const request = payload as {
    sessionId?: string
    draft?: EcommerceDraft
    images?: string[]
  } | null
  const draft = request?.draft
  if (!draft) return
  if (!isCreativeMode.value) {
    emitEvent('ecommerce-media-plan-failed', { error: '电商工作台需要先进入桌面端创模式。' })
    return
  }
  if (request?.sessionId?.startsWith('creative_')) {
    currentSessionId = request.sessionId
    creativeSessionStore.switchSession(request.sessionId)
  }

  const startIndex = messages.value.length
  await handleSend({
    text: buildEcommercePlannerPrompt(draft),
    skillPrompt:
      '本轮为电商商品图规划。请先调用 skill 工具加载精确名称「JC-电商商品图」，再按其规则完成本轮。',
    images: request?.images,
    captureMediaPlan: false,
  })
  const assistant = messages.value
    .slice(startIndex)
    .reverse()
    .find(message => message.role === 'assistant')
  const sessionId = currentSessionId
  try {
    if (!assistant?.content) throw new Error('模型没有返回可审阅的媒体计划。')
    const plan = parseMediaPlan(assistant.content)
    if (request?.images?.length) plan.referenceImages = [...request.images]
    validateMediaPlan(plan)
    emitEvent('ecommerce-media-plan-ready', { sessionId, plan })
  } catch (error) {
    emitEvent('ecommerce-media-plan-failed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
onBeforeUnmount(offEcommercePlanRequest)

const offEcommerceCustomWorkbenchRequest = onEvent(
  'ecommerce-custom-workbench-request',
  async (payload: unknown) => {
    const request = payload as {
      sessionId?: string
      skillId?: string
      skillName?: string
      prompt?: string
      resultHeading?: string
      images?: string[]
    } | null
    if (
      !request?.skillId ||
      !request.skillName ||
      !request.prompt ||
      !request.resultHeading ||
      !request.images?.length
    )
      throw new Error('反推工作台缺少 Skill、动作或图片。')
    if (!isCreativeMode.value) throw new Error('反推工作台需要先进入桌面端创模式。')
    if (request.sessionId?.startsWith('creative_')) {
      currentSessionId = request.sessionId
      creativeSessionStore.switchSession(request.sessionId)
    }

    const startIndex = messages.value.length
    await handleSend({
      text: request.prompt,
      skillPrompt: `本轮为自建电商工作台任务。请先调用 skill 工具加载精确名称「${request.skillName}」，再按其规则完成本轮。`,
      images: request.images,
    })
    const assistant = messages.value
      .slice(startIndex)
      .reverse()
      .find(message => message.role === 'assistant')
    if (!assistant?.content?.trim()) throw new Error('模型没有返回可展示的结果。')
    emitEvent('ecommerce-custom-workbench-completed', {
      sessionId: currentSessionId,
      skillId: request.skillId,
      resultHeading: request.resultHeading,
      content: assistant.content,
    })
  },
)
onBeforeUnmount(offEcommerceCustomWorkbenchRequest)

const offEcommerceProductImagePromptRequest = onEvent(
  'ecommerce-product-image-prompt-request',
  async (payload: unknown) => {
    const request = payload as {
      sessionId?: string
      sourceSkillId?: string
      reversePrompt?: string
      productImage?: string
      intent?: string
    } | null
    if (
      !request?.sessionId ||
      !request.sourceSkillId ||
      !request.reversePrompt ||
      !request.productImage
    )
      throw new Error('商品图复刻缺少反推提示词或产品图。')
    if (!isCreativeMode.value) throw new Error('商品图复刻需要先进入桌面端创模式。')
    if (request.sessionId.startsWith('creative_')) {
      currentSessionId = request.sessionId
      creativeSessionStore.switchSession(request.sessionId)
    }

    const startIndex = messages.value.length
    await handleSend({
      text: [
        '请把下方的参考图反推提示词应用到用户上传的产品图上，生成一条可直接用于 GPT Image 2 官方图生图的中文提示词。',
        '必须保留用户产品图中可见的产品本体、包装、文字、材质和结构；只借鉴参考图的构图、光线、色彩和镜头语言，不复制竞品品牌、商标或包装文字。',
        '只输出最终中文提示词正文，不要标题、JSON、分析、教程、参数建议或 Markdown 代码块。不要调用 CLI、媒体 API、任务轮询或下载工具。',
        `参考图反推提示词：\n${request.reversePrompt}`,
        `用户需求：\n${request.intent?.trim() || '将参考图的画面语言应用到我的产品图，生成可用于电商展示的商品图。'}`,
      ].join('\n\n'),
      skillPrompt:
        '本轮为电商商品图复刻提示词阶段。请先调用 skill 工具加载精确名称「gpt-image」，仅根据其提示词方法完成规划，不执行其中的 CLI/API 生成步骤。',
      images: [request.productImage],
    })
    const assistant = messages.value
      .slice(startIndex)
      .reverse()
      .find(message => message.role === 'assistant')
    if (!assistant?.content?.trim()) throw new Error('模型没有返回商品图提示词。')
    emitEvent('ecommerce-product-image-prompt-completed', {
      sessionId: currentSessionId,
      sourceSkillId: request.sourceSkillId,
      prompt: assistant.content.trim(),
    })
  },
)
onBeforeUnmount(offEcommerceProductImagePromptRequest)

const offEcommercePlanSettled = onEvent(
  'ecommerce-media-plan-settled',
  async (payload: unknown) => {
    const result = payload as {
      sessionId?: string
      taskId?: string
      status?: string
      projectPath?: string
      assetUri?: string
      error?: string
    }
    const sessionId = String(result.sessionId || '')
    if (!sessionId.startsWith('creative_') || !result.taskId) return

    const succeeded = result.status === 'success'
    const location = result.projectPath || result.assetUri || ''
    const content = succeeded
      ? `商品图任务已完成${location ? `：${location}` : '。结果已在创作面板和画布中显示。'}`
      : `商品图任务失败：${result.error || '请查看创作面板后重试。'}`

    if (isCreativeMode.value && currentSessionId === sessionId) {
      messages.value.push({
        id: `ecommerce_task_${result.taskId}`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
      })
      await creativeSessionStore.saveSession(sessionId, messages.value)
    }

  },
)
onBeforeUnmount(offEcommercePlanSettled)

// ─── P0-1: 原地编辑 user 消息 ───
const editingMessageId = ref<string | null>(null)
const editingMessageContent = ref('')

async function editUserMessage(messageId: string) {
  const msg = messages.value.find(m => m.id === messageId && m.role === 'user')
  if (!msg) return
  // 如果后面有 assistant 回复，先截断
  const index = messages.value.findIndex(m => m.id === messageId)
  if (index >= 0 && index < messages.value.length - 1) {
    if (!(await confirmAction('编辑此消息将删除后续对话，确定继续？'))) return
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
const replyTarget = ref<{
  messageId: string
  content: string
  role: string
  agentName?: string
} | null>(null)

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

// ─── 子 Agent Tabs ───
const subtaskSessions = ref<
  Array<{ sessionId: string; label: string; status: 'running' | 'done' | 'error' }>
>([])
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
  setEditorText(composerRef.value, newContent)
  void nextTick(() => {
    resizeComposer()
    handleSend()
  })
}

// ─── P0-2: 重新生成 assistant 回复 ───
async function regenerateAssistantMessage(messageId: string) {
  if (isCreativeMode.value) {
    setLocalCommandNotice('创模式暂不支持重新生成，请在输入框中重新发送同一要求。')
    return
  }
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
    agentName: isMember.value ? skillName || agentStore.modelLabel : agentStore.modelLabel,
    skillName: isMember.value ? skillName || undefined : undefined,
    sessionId: currentSessionId,
    images: userMsg.images,
    files: userMsg.files,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    chatMode: currentDesktopOpenCodeAgent.value,
    openCodeAgent: currentDesktopOpenCodeAgent.value,
    openCodeProjectDir: selectedProjectDir.value || undefined,
  })
  await syncCurrentSessionToRaw()
}

async function startNewCreativeSession() {
  const previousSessionId = currentSessionId
  const previousMessages = messages.value
  cancelCreative()
  pendingCreativeSessionId = ''
  pendingCreativeMessages = null
  pendingCreativeRunId = 0
  currentSessionId = ''
  rawSyncStartMessageCount = 0
  creativeSessionStore.switchSession('')
  loadMessages([], { agentId: '', skillContent: '' })
  if (previousSessionId && previousMessages.length) {
    await creativeSessionStore.saveSession(previousSessionId, previousMessages)
  }
}

// 新对话
function startNew() {
  if (isCreativeMode.value) {
    void startNewCreativeSession()
    return
  }
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
    }
    return
  }
  void (async () => {
    await runSessionAction('new')
  })()
}

// 切换模型
function selectModel(model: ModelEntry, event?: Event) {
  event?.stopPropagation()
  agentStore.setModel(model.id, getModelProviderId(model))
  showModelMenu.value = false
}

function toggleModelMenu(event?: Event) {
  event?.stopPropagation()
  showModelMenu.value = !showModelMenu.value
  // ponytail: Teleport 到 body 后手动定位，避免被父容器 overflow/z-index 裁剪
  if (showModelMenu.value && modelBtnRef.value) {
    const rect = modelBtnRef.value.getBoundingClientRect()
    modelMenuStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    }
  }
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
  try {
    await refreshProductSkillCatalog()
    if (isCreativeMode.value) {
      openCodeSkillError.value = ''
      return
    }
    if (!isTauriRuntime()) {
      openCodeSkillError.value = ''
      return
    }
    openCodeSkillError.value = ''
  } catch (error: any) {
    const msg = error?.message || ''
    if (msg.includes('API Key')) {
      openCodeSkillError.value = ''
    } else {
      openCodeSkillError.value = msg || 'Skill 目录加载失败'
    }
  } finally {
    openCodeSkillLoading.value = false
  }
}

async function refreshProductSkillCatalog() {
  const [builtIn] = await Promise.all([
    loadWebSkillCatalog(),
    isTauriRuntime() ? skillsManageStore.loadCentralSkills({ scan: true }) : Promise.resolve(),
  ])
  builtInSkills.value = builtIn
}

async function refreshOpenCodeCommands() {
  if (isCreativeMode.value) return
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
    if (isCreativeMode.value) return
    const handle = await ensureOpenCodeServer({
      config: projectedConfig,
      directory: selectedProjectDir.value || undefined,
    })
    if (isCreativeMode.value) return
    openCodeCustomCommands.value = await listOpenCodeCommands(
      createJiucaiOpenCodeClient(handle, selectedProjectDir.value || undefined),
      {
        directory: selectedProjectDir.value || handle.directory,
      },
    )
    openCodeCommandError.value = ''
  } catch (error: any) {
    openCodeCustomCommands.value = []
    openCodeCommandError.value = error?.message || '韭菜盒子命令列表读取失败'
  }
}

function currentOpenCodeCommandOptions() {
  const skillName = effectiveOpenCodeSkillName.value
  return {
    agentName: isMember.value ? skillName || agentStore.modelLabel : agentStore.modelLabel,
    skillName: isMember.value ? skillName || undefined : undefined,
    sessionId: currentSessionId,
    modelId: agentStore.currentModel,
    modelProviderId: currentModelEntry.value?.providerId,
    chatMode: currentDesktopOpenCodeAgent.value,
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
  if (isCreativeMode.value) {
    if (action === 'new') await startNewCreativeSession()
    else setLocalCommandNotice('创模式不支持这些会话操作。')
    return
  }
  clearLocalCommandNotice()
  if (action === 'compact' && !canCompactContext.value) {
    setLocalCommandNotice('当前没有可压缩的上下文，或会话仍在执行/加载中。')
    return
  }
  if (action === 'delete') {
    const ok = await confirmAction('确认删除当前会话？此操作会删除本机保存的会话数据。', {
      title: '删除会话',
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
    currentSessionId = result.forkedSessionID
    rawSyncStartMessageCount = 0
    sessionStore.switchSession(currentSessionId)
  } else if (action === 'delete') {
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

function openSlashCommandPalette() {
  if (isWebRuntime.value) return
  showComposerCommandMenu.value = !showComposerCommandMenu.value
  showShellCommandMenu.value = false
}

function openShellCommandPrompt() {
  if (isWebRuntime.value) return
  showShellCommandMenu.value = !showShellCommandMenu.value
  showComposerCommandMenu.value = false
  nextTick(() => composerRef.value?.focus())
}

function openMcpToolPanel() {
  emitEvent('switch-panel', 'settings')
  emitEvent('open-mcp-extensions')
  setLocalCommandNotice('已打开 MCP 扩展。扩展工具需用户显式加入并启用，不作为聊天 slash 发送。')
}

function openProjectFilePicker() {
  fileUploader.value?.triggerFileInput()
  setLocalCommandNotice('已打开项目文件选择器。文件会作为显式附件加入当前输入。')
}

function addSelectionContext() {
  const selectedText =
    typeof window !== 'undefined' ? window.getSelection()?.toString().trim() || '' : ''
  if (!selectedText) {
    setLocalCommandNotice(
      '没有检测到可添加的选区。请先在页面中选中文本，或从文件树使用“引用到对话”。',
    )
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
  if (isCreativeMode.value) return
  if (!sessionId) return
  try {
    await persistCurrentSession()
    const directory = selectedProjectDir.value || openCodeSyncStore.activeDirectory
    await openCodeSyncStore.openSession(directory, sessionId)
    currentSessionId = sessionId
    rawSyncStartMessageCount = 0
    sessionStore.switchSession(sessionId)
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
    setLocalCommandNotice(
      '已打开 Terminal 命令输入。Shell 不常驻主输入区，只在高级命令中显式启用。',
    )
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
    setLocalCommandNotice('Skill 命令请使用上方 Skill 选择器。内置 Skill 不会被前端自动改写。')
    return true
  }
  return false
}

async function runVisibleSlashText(text: string, options = currentOpenCodeCommandOptions()) {
  if (isCreativeMode.value) {
    setLocalCommandNotice('创模式不执行斜杠命令，请直接描述创作需求。')
    return
  }
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
  if (isCreativeMode.value) return
  await restoreRevertItem(id, currentOpenCodeCommandOptions())
  await persistCurrentSession()
}

async function sendFollowupItem(id: string) {
  if (isCreativeMode.value) return
  await startOutputFollow()
  await sendFollowup(id, currentOpenCodeCommandOptions())
  await persistCurrentSession()
}

function editFollowupItem(id: string) {
  const text = editFollowup(id)
  if (!text) return
  setEditorText(composerRef.value, text)
  showShellCommandMenu.value = false
  nextTick(() => {
    resizeComposer()
    composerRef.value?.focus()
  })
}

async function submitShellCommand() {
  if (isWebRuntime.value) return
  if (isCreativeMode.value) {
    setLocalCommandNotice('创模式不执行终端命令。')
    return
  }
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
  // ─── popover 键盘协调（照抄 OpenCode handleKeyDown）───
  if (popover.value) {
    if (e.key === 'Tab') {
      e.preventDefault()
      selectPopoverActive()
      return
    }
    const nav = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter'
    const ctrlNav =
      e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'n' || e.key === 'p')
    if (nav || ctrlNav) {
      if (popover.value === 'at') {
        atOnKeyDown(e)
        e.preventDefault()
        return
      }
      if (popover.value === 'slash') {
        slashOnKeyDown(e)
        e.preventDefault()
        return
      }
    }
    if (e.key === 'Escape') {
      closePopover()
      e.preventDefault()
      return
    }
    return
  }
  // ─── #16 输入历史 ↑↓ 导航（照抄 OpenCode canNavigateHistoryAtCursor）───
  const editor = composerRef.value
  if (editor && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey) {
    const text = editor.textContent || ''
    const pos = getCursorPosition(editor)
    const atStart = pos === 0
    const atEnd = pos === text.length
    if (e.key === 'ArrowUp' && atStart && text.length === 0) {
      e.preventDefault()
      stepInputRecall(1)
      return
    }
    if (atStart || atEnd) {
      // 允许在编辑器首尾用 ↑↓ 导航
      return
    }
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
  const isTextInput =
    target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable
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
  if (!(await confirmAction(`撤销本轮将删除该消息及之后的 ${affected.length} 条消息，确定继续？`)))
    return
  void invalidateConversationMessages(affected.map(m => m.id))
  messages.value.splice(index)
  void persistCurrentSession()
}

// P1-4: fork 分叉新会话 — 以当前消息为起点创建新会话
async function forkMessage(messageId: string) {
  if (isCreativeMode.value) {
    setLocalCommandNotice('创模式暂不支持会话分叉，请新建创作会话后继续。')
    return
  }
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const prefixMessages = messages.value.slice(0, index + 1)
  // 提取前缀消息的纯文本作为新会话上下文
  const contextText = prefixMessages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${(m.content || '').slice(0, 500)}`)
    .join('\n')
  setEditorText(
    composerRef.value,
    `以下为从之前会话分叉的上下文：\n\n${contextText}\n\n---\n请继续。`,
  )
  // 创建新会话
  openCodeSyncStore.newDraft()
  currentSessionId = ''
  rawSyncStartMessageCount = 0
  sessionStore.switchSession('')
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
  } catch {
    /* ponytail: download is best-effort */
  }
}

// 重新发送 — 有附件时直接重发，无附件时填回输入框
async function retryMessage(messageId: string) {
  const index = messages.value.findIndex(msg => msg.id === messageId)
  if (index === -1) return
  const msg = messages.value[index]
  if (msg && msg.role === 'user') {
    const hasFollowingMessages = index < messages.value.length - 1
    if (hasFollowingMessages) {
      const confirmed = await new Promise<boolean>(resolve => {
        pendingRetryConfirmation.value = { resolve }
      })
      if (!confirmed) return
    }
    void invalidateConversationMessages(messages.value.slice(index).map(message => message.id))
    messages.value.splice(index)
    void persistCurrentSession()

    if (isCreativeMode.value) {
      await handleSend({
        text: msg.content || '请继续。',
        images: msg.images,
        files: msg.files,
      })
      return
    }

    // 有附件 → Web 端不自动重试，桌面端直接重发
    if (msg.images?.length || msg.files?.length) {
      if (isWebRuntime.value) {
        // Web 端：填回输入框让用户重新发送（重新走 handleSend）
        setEditorText(composerRef.value, msg.content || '请分析这些文件')
        void nextTick(() => {
          resizeComposer()
          focusComposerInput()
        })
        return
      }
      // 桌面端：直接重发
      const skillName = effectiveOpenCodeSkillName.value
      await sendMessage(msg.content || '请分析这些文件', {
        agentName: isMember.value ? skillName || agentStore.modelLabel : agentStore.modelLabel,
        skillName: isMember.value ? skillName || undefined : undefined,
        sessionId: currentSessionId,
        images: msg.images,
        files: msg.files,
        modelId: agentStore.currentModel,
        modelProviderId: currentModelEntry.value?.providerId,
        chatMode: currentDesktopOpenCodeAgent.value,
        openCodeAgent: currentDesktopOpenCodeAgent.value,
        openCodeProjectDir: selectedProjectDir.value || undefined,
      })
      await persistCurrentSession()
      await syncCurrentSessionToRaw()
      return
    }

    // 无附件 → 填回输入框
    setEditorText(composerRef.value, msg.content)
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
  el.style.paddingRight = '0px'
  el.classList.remove('cp-composer-overflow')
  el.scrollTop = 0
  if (options.focus) el.focus()
}

// ChatGPT-like 输入框：自动增高，到上限后内部滚动，清空后恢复紧凑高度。
function resizeComposer(target?: HTMLTextAreaElement) {
  const el = target || composerRef.value
  if (!el) return
  const value = target ? target.value : el.textContent || ''
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

function handleInput(_e: Event) {
  resetRecall()
  const editor = composerRef.value
  if (!editor) return

  const rawText = editor.textContent || ''
  resizeComposer()
  hasInputText.value = rawText.trim().length > 0
  const cursorPos = getCursorPosition(editor)
  const textBefore = rawText.slice(0, cursorPos)

  // ─── #25 光标自动滚动（照抄 OpenCode）───
  // 输入时确保光标可见，如果光标在可视区域外则滚动
  queueMicrotask(() => {
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      if (rect.bottom > editorRect.bottom - 4 || rect.top < editorRect.top + 4) {
        range.startContainer.parentElement?.scrollIntoView?.({ block: 'nearest' })
      }
    }
    // ─── #26 滚动渐变遮罩（照抄 OpenCode）───
    const overflow = editor.scrollHeight > editor.clientHeight
    editor.classList.toggle('cp-composer-overflow', overflow)
  })

  // @ 检测 — 只在光标前查找
  const atMatch = textBefore.match(/@(\S*)$/)
  // / 检测 — 行首或空格后
  const slashMatch = rawText.match(/^\/(\S*)$/)

  if (atMatch) {
    atOnInput(atMatch[1])
    popover.value = 'at'
  } else if (slashMatch) {
    slashOnInput(slashMatch[1])
    popover.value = 'slash'
  } else {
    closePopover()
  }
  // #28: 每次输入后同步 DOM↔Prompt 状态
  reconcileComposerState()
}

function closePopover() {
  popover.value = null
  clearAtFilter()
}

// ─── selectPopoverActive（照抄 OpenCode selectPopoverActive L893-900）───
function selectPopoverActive() {
  if (popover.value === 'at') {
    const items = atFlat.value
    if (items.length === 0) return
    const active = atActive.value
    const item = items.find((e: AtOption) => atKey(e) === active) ?? items[0]
    if (item) handleAtSelect(item)
    return
  }
  if (popover.value === 'slash') {
    const items = slashFlat.value
    if (items.length === 0) return
    const active = slashActive.value
    const item = items.find((e: SlashCommand) => slashKey(e) === active) ?? items[0]
    if (item) handleSlashSelect(item)
    return
  }
}

// ─── #21 占位符循环（照抄 OpenCode placeholder.ts）───
const PLACEHOLDER_CYCLE = [
  '给Skill发指令... 输入 @ 提及文件或Skill，/ 查看指令',
  '试试 / 快速选择 Skill，或 @ 提及文件和参考',
  '输入内容后 Enter 发送，Shift+Enter 换行',
]
let placeholderCycleTimer: ReturnType<typeof setInterval> | null = null

function onComposerFocus() {
  if (placeholderCycleTimer) return
  let i = 0
  placeholderCycleTimer = setInterval(() => {
    const el = composerRef.value
    if (!el || el.textContent?.trim()) return // 有内容时不循环
    i = (i + 1) % PLACEHOLDER_CYCLE.length
    el.setAttribute('data-placeholder', PLACEHOLDER_CYCLE[i])
  }, 4000)
}
onUnmounted(() => {
  if (placeholderCycleTimer) clearInterval(placeholderCycleTimer)
})

// ─── #19/20 粘贴规范化（照抄 OpenCode paste.ts）───
const LARGE_PASTE_CHARS = 8000
const LARGE_PASTE_BREAKS = 120

async function onComposerPaste(e: ClipboardEvent) {
  // 如果有文件，交给 fileUploader
  if (e.clipboardData?.files.length) {
    e.preventDefault()
    fileUploader.value?.handlePaste(e)
    return
  }
  const text = e.clipboardData?.getData('text/plain')
  if (!text) return

  // #20 大文本粘贴检测
  let breaks = 0
  for (const c of text) {
    if (c === '\n') breaks++
    if (breaks >= LARGE_PASTE_BREAKS) break
  }
  if (text.length >= LARGE_PASTE_CHARS || breaks >= LARGE_PASTE_BREAKS) {
    e.preventDefault()
    const ok = await confirmAction(`粘贴文本较长（${text.length} 字符，${breaks} 行）。确认粘贴？`)
    if (!ok) return
  }

  // #19 规范化换行符 \r\n → \n
  e.preventDefault()
  const normalized = text.replace(/\r\n?/g, '\n')
  document.execCommand('insertText', false, normalized)
}

// ─── #28 DOM↔Prompt 双向同步（照抄 OpenCode reconcile）───
// 每次 handleInput 后检查 pill 完整性，清理被删除的 pill 对应的内部状态
function reconcileComposerState() {
  const editor = composerRef.value
  if (!editor) return
  const pills = editor.querySelectorAll('[data-type="file"], [data-type="agent"]')
  const pillTexts = new Set<string>()
  pills.forEach(p => pillTexts.add(p.textContent || ''))
  // 清理已不在 DOM 中的引用状态（后续可扩展）
}

// ─── @ 选中（照抄 OpenCode handleAtSelect）───
function handleAtSelect(option: AtOption) {
  const editor = composerRef.value
  if (!editor) return

  try {
    if (option.type === 'agent') {
      addPart(editor, { type: 'agent', name: option.name, content: '@' + option.name })
    } else if (option.type === 'reference') {
      addPart(editor, {
        type: 'file',
        path: option.path,
        content: '@' + option.name,
        mime: 'application/x-directory',
      })
    } else if (option.type === 'resource') {
      addPart(editor, {
        type: 'file',
        path: option.uri,
        content: '@' + option.name,
        mime: option.mime ?? 'text/plain',
        url: option.uri,
        source: { type: 'resource', uri: option.uri },
      })
    } else {
      addPart(editor, { type: 'file', path: option.path, content: '@' + option.display })
    }
  } finally {
    closePopover()
    editor.focus()
  }
}

// ─── / 选中 ───
function handleSlashSelect(cmd: SlashCommand) {
  const editor = composerRef.value
  // 清除残留的 / 文本
  if (editor) editor.textContent = ''
  closePopover()
  if (cmd.source === 'skill') {
    selectOpenCodeSkill(cmd.title)
  } else if (cmd.id === 'clear' || cmd.id === 'new-session') {
    if (isCreativeMode.value) {
      void startNewCreativeSession()
      return
    }
    if (cmd.id === 'clear') void clearMessages()
    else emitEvent('create-open-code-session', {})
  }
}

onMounted(async () => {
  await Promise.all([sessionLoadPromise, mediaTaskStore.init()])
  void restoreActiveSession()
  void refreshProductSkillCatalog()
  // 静默拉取 OpenCode 官方 model / skill / command 列表（不阻塞 UI）
  // 等待 apiKey 状态确定后再拉模型，避免 Key 未就绪时走到 OpenCode 兜底
  void Promise.resolve((window as any).__JC_API_KEY_READY__).then(() => {
    void agentStore.fetchModels({ shouldSkipOpenCode: () => isCreativeMode.value }).finally(() => {
      if (isTauriRuntime() && !isCreativeMode.value) {
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
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  isDragOver.value = true
  fileUploader.value?.handleDragOver(e)
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragLeaveTimer = setTimeout(() => {
    isDragOver.value = false
  }, 100)
  fileUploader.value?.handleDragLeave(e)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  const projectMedia = e.dataTransfer?.getData('application/x-jc-media-reference')
  if (projectMedia) {
    try {
      const resources = JSON.parse(projectMedia) as ProjectResource[]
      if (Array.isArray(resources) && resources.length) {
        void fileUploader.value?.addProjectResources(resources, 'project')
        return
      }
    } catch {
      fileUploader.value?.reportError('项目素材拖拽数据无效')
      return
    }
  }
  fileUploader.value?.handleDrop(e)
}
</script>

<template>
  <div
    class="cp"
    data-project-drop-target="chat"
    @dragover.prevent.stop="onDragOver"
    @dragleave.prevent.stop="onDragLeave"
    @drop.prevent.stop="onDrop"
  >
    <!-- 拖拽上传覆盖层 -->
    <div v-if="isDragOver" class="cp-drag-overlay">
      <JcIcon name="upload_file" style="font-size: 48px" />
      <span>松开上传文件</span>
    </div>
    <!-- Header -->
    <div class="cp-header">
      <div class="cp-title">
        <button class="cp-new-chat-btn" @click="startNew" title="新建会话">
          <JcIcon name="add_circle" style="font-size: 16px" />
          <span>新建会话</span>
        </button>
      </div>
      <div class="cp-actions">
        <!-- 模型选择 -->
        <div class="cp-model-wrap">
          <button ref="modelBtnRef" class="cp-model-btn" @click="toggleModelMenu($event)">
            <JcIcon name="deployed_code" style="font-size: 14px" />
            {{ agentStore.currentModel }}
          </button>
          <Teleport to="body">
            <div v-if="showModelMenu" class="cp-model-menu" :style="modelMenuStyle" @click.stop>
              <div
                v-if="agentStore.openCodeTextModels.length === 0"
                class="cp-model-empty"
                :class="{ 'cp-model-error': Boolean(agentStore.modelsFetchError) }"
              >
                {{ agentStore.modelsFetchError ? '模型列表未就绪' : '正在读取模型列表' }}
              </div>
              <button
                v-for="m in agentStore.openCodeTextModels"
                :key="m.id"
                class="cp-model-item"
                :class="{ active: m.id === agentStore.currentModel }"
                :title="m.id"
                @click="selectModel(m, $event)"
              >
                <span class="cp-model-label">{{ m.id }}</span>
              </button>
            </div>
          </Teleport>
        </div>
        <!-- 上下文用量圆环按钮 (对齐官方 SessionContextUsage) -->
        <SessionContextUsage
          :total="openCodeContextUsage?.total ?? 0"
          :limit="openCodeContextUsage?.limit"
          :usage="openCodeContextUsage?.usage"
          :cost="openCodeContextUsage?.cost"
          @toggle-context="emitEvent('switch-panel', 'context')"
        />
      </div>
    </div>

    <!-- Messages -->
    <!-- 消息区 (带滚动导航) -->
    <div
      ref="messagesContainer"
      class="cp-messages"
      @dragover.prevent="fileUploader?.handleDragOver($event)"
      @dragleave.prevent="fileUploader?.handleDragLeave($event)"
      @drop.prevent="fileUploader?.handleDrop($event)"
    >
      <!-- Welcome -->
      <div v-if="messages.length === 0" class="cp-welcome">
        <h2 class="serif">韭菜盒子</h2>
        <p>国产Codex</p>
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

      <!-- Message list (virtual) -->
      <!-- ponytail: 虚拟列表通过 absolute 定位只渲染可见消息，
           流式指示器/变更摘要位于虚拟区域之后，自然流底部可见。-->
      <div
        v-if="displayMessages.length > 0"
        style="position: relative; width: 100%"
        :style="{ height: `${virtualizer.getTotalSize()}px` }"
      >
        <template v-for="virtualRow in virtualizer.getVirtualItems()" :key="virtualRow.key">
          <div
            :ref="
              el => {
                measureVirtualElement(el)
              }
            "
            :data-index="virtualRow.index"
            style="position: absolute; top: 0; left: 0; width: 100%"
            :style="{ transform: `translateY(${virtualRow.start}px)` }"
          >
            <!-- msg = displayMessages[virtualRow.index] -->
            <!-- ponytail: TurnDivider 必须第一个分支，避免 TS 联合类型访问不存在的字段 -->
            <div
              v-if="displayMessages[virtualRow.index].role === 'divider'"
              class="cp-turn-divider"
            >
              <hr />
              <span>{{ displayMessages[virtualRow.index].content }}</span>
              <hr />
            </div>
            <div v-else-if="displayMessages[virtualRow.index].isMediaTask" class="msg assistant">
              <div class="msg-meta">
                <div class="msg-meta-avatar"><JcIcon name="palette" style="font-size: 14px" /></div>
                <span class="msg-meta-name">媒体生成</span>
              </div>
              <div class="msg-bubble">
                <MediaTaskBubble
                  :task-id="
                    displayMessages[virtualRow.index].mediaTaskId ||
                    displayMessages[virtualRow.index].content.slice(12, -1)
                  "
                />
              </div>
            </div>
            <template
              v-else-if="
                displayMessages[virtualRow.index].role === 'user' &&
                displayMessages[virtualRow.index].summaryDiffs?.length
              "
            >
              <template
                v-for="row in openCodeRowsForMessage(displayMessages[virtualRow.index])"
                :key="row.key"
              >
                <div
                  v-if="row.type === 'diff-summary'"
                  class="cp-opencode-row cp-opencode-diff-summary"
                >
                  <button type="button" class="cp-diff-summary-btn" @click="scrollToDiffReview()">
                    <JcIcon name="difference" />
                    <span class="cp-diff-summary-label">变更 · {{ row.files.length }} 个文件</span>
                    <span v-if="row.totalAdditions > 0" class="cp-diff-summary-add"
                      >+{{ row.totalAdditions }}</span
                    >
                    <span v-if="row.totalDeletions > 0" class="cp-diff-summary-del"
                      >-{{ row.totalDeletions }}</span
                    >
                    <JcIcon name="arrow_downward" class="cp-diff-summary-arrow" />
                  </button>
                </div>
              </template>
              <MessageBubble
                :message-id="displayMessages[virtualRow.index].id"
                :content="displayMessages[virtualRow.index].content"
                :role="displayMessages[virtualRow.index].role"
                :agent-id="displayMessages[virtualRow.index].agentId"
                :agent-name="displayMessages[virtualRow.index].agentName"
                :model-id="displayMessages[virtualRow.index].modelId"
                :model-provider-id="displayMessages[virtualRow.index].modelProviderId"
                :images="displayMessages[virtualRow.index].images"
                :files="displayMessages[virtualRow.index].files"
                :timestamp="displayMessages[virtualRow.index].timestamp"
                :open-code-parts="displayMessages[virtualRow.index].openCodeParts"
                @delete="deleteMessage"
                @edit="editUserMessage"
              />
            </template>
            <template v-else-if="hasOpenCodeTimeline(displayMessages[virtualRow.index])">
              <div class="cp-opencode-clean">
                <template
                  v-for="row in openCodeRowsForMessage(displayMessages[virtualRow.index])"
                  :key="row.key"
                >
                  <MessageBubble
                    v-if="row.type === 'assistant-part'"
                    :message-id="displayMessages[virtualRow.index].id"
                    content=""
                    role="assistant"
                    :agent-id="displayMessages[virtualRow.index].agentId"
                    :agent-name="displayMessages[virtualRow.index].agentName"
                    :finish-reason="displayMessages[virtualRow.index].finishReason"
                    :timestamp="displayMessages[virtualRow.index].timestamp"
                    :trace-summary="displayMessages[virtualRow.index].traceSummary"
                    :is-streaming-message="
                      isAssistantStreamingMessage(displayMessages[virtualRow.index])
                    "
                    :open-code-parts="row.parts"
                    @retry="retryMessage"
                    @delete="deleteMessage"
                    @edit="editUserMessage"
                    @regenerate="regenerateAssistantMessage"
                    @reply="setReplyTarget"
                    @edit-assistant="editAssistantMessage"
                    @open-subtask="openSubtaskSession"
                    @revert="revertMessage"
                    @fork="forkMessage"
                    @preview-image="openImagePreview"
                    @download-image="downloadImageUrl"
                  />
                  <MessageBubble
                    v-else-if="row.type === 'context-group'"
                    :message-id="displayMessages[virtualRow.index].id"
                    content=""
                    role="assistant"
                    :agent-id="displayMessages[virtualRow.index].agentId"
                    :agent-name="displayMessages[virtualRow.index].agentName"
                    :finish-reason="displayMessages[virtualRow.index].finishReason"
                    :timestamp="displayMessages[virtualRow.index].timestamp"
                    :trace-summary="displayMessages[virtualRow.index].traceSummary"
                    :is-streaming-message="
                      isAssistantStreamingMessage(displayMessages[virtualRow.index])
                    "
                    :open-code-parts="row.parts"
                    @retry="retryMessage"
                    @delete="deleteMessage"
                    @edit="editUserMessage"
                    @regenerate="regenerateAssistantMessage"
                    @reply="setReplyTarget"
                    @edit-assistant="editAssistantMessage"
                    @open-subtask="openSubtaskSession"
                    @revert="revertMessage"
                    @fork="forkMessage"
                    @preview-image="openImagePreview"
                    @download-image="downloadImageUrl"
                  />
                  <div
                    v-else-if="row.type === 'thinking'"
                    class="cp-opencode-row cp-opencode-thinking"
                  >
                    <JcIcon name="psychology" />
                    <span>{{ row.reasoningHeading || '韭菜盒子正在思考' }}</span>
                  </div>
                  <div
                    v-else-if="row.type === 'system-event'"
                    class="cp-opencode-row cp-opencode-system"
                  >
                    <JcIcon name="notes" />
                    <span>{{ row.text }}</span>
                  </div>
                  <div v-else-if="row.type === 'error'" class="cp-opencode-row cp-opencode-error">
                    <JcIcon name="error" />
                    <span>{{ row.text }}</span>
                  </div>
                  <div
                    v-else-if="row.type === 'turn-divider'"
                    class="cp-opencode-row cp-opencode-divider"
                  >
                    <span>{{ row.label === 'compaction' ? '上下文已压缩' : '执行已中断' }}</span>
                  </div>
                  <div
                    v-else-if="row.type === 'diff-summary'"
                    class="cp-opencode-row cp-opencode-diff-summary"
                  >
                    <button type="button" class="cp-diff-summary-btn" @click="scrollToDiffReview()">
                      <JcIcon name="difference" />
                      <span class="cp-diff-summary-label"
                        >变更 · {{ row.files.length }} 个文件</span
                      >
                      <span v-if="row.totalAdditions > 0" class="cp-diff-summary-add"
                        >+{{ row.totalAdditions }}</span
                      >
                      <span v-if="row.totalDeletions > 0" class="cp-diff-summary-del"
                        >-{{ row.totalDeletions }}</span
                      >
                      <JcIcon name="arrow_downward" class="cp-diff-summary-arrow" />
                    </button>
                  </div>
                </template>
              </div>
            </template>
            <MessageBubble
              v-else
              :message-id="displayMessages[virtualRow.index].id"
              :content="displayMessages[virtualRow.index].content"
              :role="displayMessages[virtualRow.index].role"
              :agent-id="displayMessages[virtualRow.index].agentId"
              :agent-name="displayMessages[virtualRow.index].agentName"
              :model-id="displayMessages[virtualRow.index].modelId"
              :model-provider-id="displayMessages[virtualRow.index].modelProviderId"
              :media-reader-model-id="displayMessages[virtualRow.index].mediaReaderModelId"
              :tool-calls="displayMessages[virtualRow.index].toolCalls"
              :tool-progress="displayMessages[virtualRow.index].toolProgress"
              :tool-name="displayMessages[virtualRow.index].toolName"
              :office-download-files="displayMessages[virtualRow.index].officeDownloadFiles"
              :images="displayMessages[virtualRow.index].images"
              :files="displayMessages[virtualRow.index].files"
              :finish-reason="displayMessages[virtualRow.index].finishReason"
              :reasoning-content="displayMessages[virtualRow.index].reasoningContent"
              :timestamp="displayMessages[virtualRow.index].timestamp"
              :search-results="displayMessages[virtualRow.index].searchResults"
              :trace-summary="displayMessages[virtualRow.index].traceSummary"
              :tool-result="displayMessages[virtualRow.index].latestToolResult"
              :tool-result-status="displayMessages[virtualRow.index].toolStatus"
              :is-streaming-message="isAssistantStreamingMessage(displayMessages[virtualRow.index])"
              :open-code-parts="displayMessages[virtualRow.index].openCodeParts"
              :media-plan="displayMessages[virtualRow.index].mediaPlan"
              :media-plan-status="displayMessages[virtualRow.index].mediaPlanStatus"
              :media-plan-error="mediaPlanDisplayError(displayMessages[virtualRow.index])"
              :media-plan-blocked="isMediaPlanBlocked(displayMessages[virtualRow.index])"
              :is-editing="editingAssistantId === displayMessages[virtualRow.index].id"
              :editing-content="
                editingAssistantId === displayMessages[virtualRow.index].id
                  ? editingAssistantContent
                  : undefined
              "
              @retry="retryMessage"
              @delete="deleteMessage"
              @edit="editUserMessage"
              @regenerate="regenerateAssistantMessage"
              @reply="setReplyTarget"
              @edit-assistant="editAssistantMessage"
              @open-subtask="openSubtaskSession"
              @preview-image="openImagePreview"
              @download-image="downloadImageUrl"
              @update:editing-content="(c: string) => (editingAssistantContent = c)"
              @confirm-edit="confirmEditAssistant"
              @cancel-edit="cancelEditAssistant"
              @approve-media-plan="approveMediaPlan"
              @remove-media-reference="removeMediaReference"
              @update-media-plan-parameters="updateMessageMediaPlanParameters"
            />
          </div>
        </template>
      </div>

      <!-- Streaming indicator (virtual list 之后，自然流底部可见) -->
      <div
        v-if="
          isStreaming &&
          (!messages.length ||
            messages[messages.length - 1]?.role === 'user' ||
            !messages[messages.length - 1]?.content)
        "
        class="msg assistant"
      >
        <div class="msg-meta">
          <div class="msg-meta-avatar"><JcIcon name="smart_toy" style="font-size: 14px" /></div>
          <span class="msg-meta-name">{{
            effectiveOpenCodeSkillName || agentStore.modelLabel
          }}</span>
        </div>
        <div class="msg-bubble">
          <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
        </div>
      </div>
    </div>

    <!-- 🔧 Phase B v2: 变更摘要（基于 turnDiffs/sessionDiffs，消息流末尾始终可见） -->
    <div v-if="!isCreativeMode && turnDiffs.length > 0" class="cp-diff-summary-row">
      <button type="button" class="cp-diff-summary-btn" @click="scrollToDiffReview()">
        <JcIcon name="difference" />
        <span class="cp-diff-summary-label"> 本轮变更 · {{ turnDiffs.length }} 个文件 </span>
        <span class="cp-diff-summary-add"
          >+{{ turnDiffs.reduce((s, d) => s + (d.additions || 0), 0) }}</span
        >
        <span class="cp-diff-summary-del"
          >-{{ turnDiffs.reduce((s, d) => s + (d.deletions || 0), 0) }}</span
        >
        <JcIcon name="arrow_downward" class="cp-diff-summary-arrow" />
      </button>
    </div>

    <!-- 滚动导航（对标 OpenCode stickyScroll） -->
    <ChatScrollNav
      ref="scrollNav"
      :container="messagesContainer"
      :is-streaming="isStreaming"
      :messages="messages"
    />

    <!-- P1-1: 图片预览灯箱 -->
    <Teleport to="body">
      <div v-if="previewImageUrl" class="cp-image-lightbox" @click.self="closeImagePreview">
        <button class="cp-lightbox-close" @click="closeImagePreview">✕</button>
        <img :src="previewImageUrl" :alt="previewImageTitle" />
        <div class="cp-lightbox-info">{{ previewImageTitle }}</div>
      </div>
    </Teleport>

    <div v-if="localCommandNotice" class="cp-session-notice local">
      {{ localCommandNotice }}
    </div>
    <div
      v-if="pendingRetryConfirmation"
      class="cp-creative-approval"
      role="alertdialog"
      aria-live="assertive"
    >
      <span class="cp-creative-approval-message">重新发送将删除该消息及之后的所有对话。</span>
      <div class="cp-creative-approval-actions">
        <button
          type="button"
          class="cp-creative-approval-reject"
          @click="settleRetryConfirmation(false)"
        >
          取消
        </button>
        <button
          type="button"
          class="cp-creative-approval-always"
          @click="settleRetryConfirmation(true)"
        >
          重新发送
        </button>
      </div>
    </div>
    <div
      v-if="pendingCreativeToolApproval"
      class="cp-creative-approval"
      role="alertdialog"
      aria-live="assertive"
    >
      <span class="cp-creative-approval-message">{{ pendingCreativeToolApproval.message }}</span>
      <div class="cp-creative-approval-actions">
        <button
          type="button"
          class="cp-creative-approval-reject"
          @click="settleCreativeToolApproval('reject')"
        >
          拒绝
        </button>
        <button
          type="button"
          class="cp-creative-approval-once"
          @click="settleCreativeToolApproval('once')"
        >
          允许
        </button>
        <button
          type="button"
          class="cp-creative-approval-always"
          @click="settleCreativeToolApproval('always')"
        >
          始终允许
        </button>
      </div>
    </div>
    <PermissionDock
      v-if="!isWebRuntime && !isCreativeMode"
      :requests="pendingPermissions"
      @decide="respondPermission"
    />
    <QuestionDock
      v-if="!isWebRuntime && !isCreativeMode"
      :requests="pendingQuestions"
      @reply="replyQuestion"
      @reject="rejectQuestion"
    />
    <TodoDock v-if="!isWebRuntime && !isCreativeMode" :todos="sessionTodos" />
    <RevertDock
      v-if="!isWebRuntime && !isCreativeMode"
      :items="sessionRevertItems"
      :restoring="restoringRevertId"
      :disabled="isStreaming"
      @restore="restoreRevert"
    />
    <FollowupDock
      v-if="!isWebRuntime && !isCreativeMode"
      :items="sessionFollowups"
      :sending="sendingFollowupId"
      @send="sendFollowupItem"
      @edit="editFollowupItem"
    />
    <SessionShareNotice
      v-if="!isWebRuntime && !isCreativeMode && sessionShareUrl"
      :url="sessionShareUrl"
      @dismiss="sessionShareUrl = ''"
    />
    <!-- 附件预览 -->
    <FileUploader ref="fileUploader" />

    <!-- 输入区顶栏：Skill + 指令 + 文/武/直连同排 -->
    <div class="cp-composer-toprow">
      <SkillPickerBar
        v-if="isMember"
        :skills="selectableOpenCodeSkills"
        :selected-skill-name="effectiveOpenCodeSkillName"
        :auto-detected-name="autoDetectedSkillName"
        :loading="openCodeSkillLoading"
        :error="openCodeSkillError"
        :web-mode="!isTauriRuntime()"
        :mention-active="popover !== null"
        @select="selectOpenCodeSkill"
        @refresh="refreshOpenCodeSkills"
      />
      <div class="cp-toprow-actions">
        <div class="cp-kb-command-wrap">
          <button class="ci-btn cp-kb-command-btn" title="指令" @click="toggleKbCommandMenu">
            指令
          </button>
          <div v-if="showKbCommandMenu" class="cp-kb-command-menu" @click.stop>
            <div class="cp-kb-command-tabs">
              <button
                v-for="tab in COMMAND_TABS"
                :key="tab"
                class="cp-kb-command-tab"
                :class="{ active: commandActiveTab === tab }"
                @click="commandActiveTab = tab"
              >
                {{ tab }}
              </button>
            </div>
            <div class="cp-kb-command-grid">
              <button
                v-for="preset in filteredCommands"
                :key="preset.title"
                type="button"
                class="cp-kb-command-card"
                @click="fillKbCommand(preset)"
              >
                <strong>{{ preset.title }}</strong>
                <small>{{ preset.desc }}</small>
              </button>
            </div>
          </div>
        </div>
        <div v-if="!isWebRuntime" class="cp-mode-wrap">
          <button class="cp-mode-btn" @click="toggleModeMenu($event)" :title="agentModeTitle">
            {{ agentModeLabel }}
          </button>
          <div v-if="showModeMenu" class="cp-mode-menu" @click.stop>
            <button
              class="cp-mode-item"
              :class="{ active: agentMode === 'build' }"
              @click="selectAgentMode('build')"
            >
              <span>武</span>
              <span class="cp-mode-desc">直接操控电脑，用于编程、调试、文件管理</span>
            </button>
            <button
              class="cp-mode-item"
              :class="{ active: agentMode === 'plan' }"
              @click="selectAgentMode('plan')"
            >
              <span>文</span>
              <span class="cp-mode-desc">不操控电脑，用于写作、分析、方案规划</span>
            </button>
            <button
              class="cp-mode-item"
              :class="{ active: agentMode === 'creative' }"
              @click="selectAgentMode('creative')"
            >
              <span>创</span>
              <span class="cp-mode-desc">使用 Skill、项目文件、媒体与画布</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 引用文件条 -->
    <div v-if="referenceFiles.length > 0" class="cp-ref-bar">
      <div v-for="(rf, i) in referenceFiles" :key="rf.name" class="cp-ref-chip">
        <JcIcon name="attach_file" style="font-size: 13px" />
        <span class="cp-ref-name">{{ rf.name }}</span>
        <button class="cp-ref-remove" @click="removeReference(i)">
          <JcIcon name="close" style="font-size: 12px" />
        </button>
      </div>
    </div>

    <!-- 引用回复条 -->
    <div v-if="replyTarget" class="cp-reply-bar">
      <div class="cp-reply-bar-content">
        <span class="cp-reply-bar-label"
          >回复 {{ replyTarget.role === 'user' ? '用户' : replyTarget.agentName || '助手' }}：</span
        >
        <span class="cp-reply-bar-text">{{ replyTarget.content }}</span>
      </div>
      <button class="cp-reply-bar-close" @click="clearReplyTarget">
        <JcIcon name="close" style="font-size: 14px" />
      </button>
    </div>

    <!-- 输入区 -->
    <div class="cp-input-area">
      <div class="cp-input-wrap">
        <form
          v-if="showShellCommandMenu && !isWebRuntime"
          class="cp-shell-command-box"
          @submit.prevent="submitShellCommand"
        >
          <JcIcon name="terminal" />
          <input
            v-model="shellCommandText"
            type="text"
            placeholder="shell command"
            aria-label="终端命令"
          />
          <button type="submit">运行</button>
        </form>
        <!-- Phase C: 引用回复气泡 -->
        <div v-if="replyTarget" class="reply-bubble">
          <div class="reply-bubble-head">
            <JcIcon name="reply" />
            <span class="reply-bubble-role">{{
              replyTarget.role === 'user'
                ? '引用用户消息'
                : replyTarget.agentName
                  ? `引用 ${replyTarget.agentName}`
                  : '引用回复'
            }}</span>
            <button class="reply-bubble-close" @click="clearReplyTarget" title="取消引用">
              &times;
            </button>
          </div>
          <div class="reply-bubble-text">
            {{ replyTarget.content.slice(0, 200)
            }}{{ replyTarget.content.length > 200 ? '...' : '' }}
          </div>
        </div>
        <div class="cp-composer-relative">
          <div
            ref="composerRef"
            class="cp-composer-editable"
            contenteditable="true"
            :aria-busy="isStreaming"
            data-placeholder="给Skill发指令... 输入 @ 提及文件或Skill，/ 查看指令"
            @input="handleInput"
            @keydown="onKeydown"
            @paste="onComposerPaste"
            @focus="onComposerFocus"
          />
          <!-- MentionPopover 移出 cp-composer-relative，避免被 overflow 裁剪 -->
          <MentionPopover
            :popover="popover"
            :at-flat="atFlat"
            :at-active="atActive"
            :at-key="atKey"
            :slash-flat="slashFlat"
            :slash-active="slashActive"
            :slash-key="slashKey"
            @at-select="handleAtSelect"
            @slash-select="handleSlashSelect"
            @set-at-active="setAtActive"
            @set-slash-active="setSlashActive"
          />
        </div>
        <div class="cp-input-actions">
          <button class="ci-btn" title="上传文件" @click="fileUploader?.triggerFileInput()">
            <JcIcon name="attach_file" />
          </button>
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

.cp-creative-approval {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 12px 0;
  padding: 7px 8px 7px 12px;
  border: 1px solid color-mix(in srgb, var(--olive) 45%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 86%, var(--olive-pale));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--ink) 9%, transparent);
  color: var(--ink1);
  font-size: 12px;
  line-height: 1.35;
}
.cp-creative-approval-message {
  min-width: 0;
  flex: 1;
}
.cp-creative-approval-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
}
.cp-creative-approval-actions button {
  min-height: 28px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink2);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 4px 9px;
}
.cp-creative-approval-actions button:hover,
.cp-creative-approval-actions button:focus-visible {
  border-color: var(--olive);
  color: var(--olive-dark);
  outline: none;
}
.cp-creative-approval-always {
  border-color: var(--olive) !important;
  background: var(--olive) !important;
  color: #fff !important;
}
.cp-creative-approval-reject {
  color: var(--ink3) !important;
}
@media (max-width: 560px) {
  .cp-creative-approval {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }
  .cp-creative-approval-actions {
    align-self: flex-end;
  }
}

/* 拖拽上传覆盖层 */
.cp-drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(107, 142, 35, 0.08);
  border: 3px dashed var(--olive);
  border-radius: 12px;
  color: var(--olive);
  font-size: 16px;
  font-weight: 700;
  pointer-events: none;
  animation: drag-pulse 0.8s ease infinite alternate;
}
@keyframes drag-pulse {
  from {
    background: rgba(107, 142, 35, 0.05);
  }
  to {
    background: rgba(107, 142, 35, 0.15);
  }
}

/* Header — from code.html line 208-219 */
.cp-header {
  height: var(--app-header-height);
  box-sizing: border-box;
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
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid var(--olive);
  border-radius: 8px;
  background: transparent;
  color: var(--olive);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.cp-new-chat-btn:hover {
  background: var(--olive);
  color: #fff;
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
/* ponytail: @container 回退 — 旧版 Safari (Intel Mac macOS≤12) 不支持，用 @media 兜底 */
@media (max-width: 320px) {
  .cp-new-chat-btn span:not(.mso) {
    display: none;
  }
  .cp-new-chat-btn {
    padding: 5px 8px;
  }
}
@container (max-width: 320px) {
  .cp-new-chat-btn span:not(.mso) {
    display: none;
  }
  .cp-new-chat-btn {
    padding: 5px 8px;
  }
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
  0% {
    opacity: 1;
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
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
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-model-btn:hover {
  border-color: var(--olive);
}

.cp-model-btn:hover {
  border-color: rgba(213, 199, 135, 0.45);
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cp-act-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  border-radius: 8px;
  color: var(--ink2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
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
  scrollbar-gutter: stable;
  scrollbar-width: auto;
  scrollbar-color: color-mix(in srgb, var(--olive) 62%, transparent) transparent;
}
.cp-messages::-webkit-scrollbar {
  width: 18px;
}
.cp-messages::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 999px;
}
.cp-messages::-webkit-scrollbar-thumb {
  min-height: 44px;
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
.msg.user {
  align-items: flex-end;
}
.msg.assistant {
  align-items: flex-start;
}
.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 2px 4px;
  font-size: 11px;
  color: var(--ink3);
  opacity: 0.72;
}
.msg.user .msg-meta {
  justify-content: flex-end;
}
.msg-meta-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--olive-dark);
}
.msg.user .msg-meta-avatar {
  background: rgba(244, 241, 232, 0.92);
  color: var(--ink2);
  border: 1px solid color-mix(in srgb, #f4f1e8 78%, var(--border));
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
.msg-body {
  white-space: pre-wrap;
}
.msg-action-row {
  opacity: 0.72;
  transform: translateY(0);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
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
  width: 6px;
  height: 6px;
  background: var(--ink3);
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 0.6s infinite alternate;
}
.typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes bounce {
  to {
    transform: translateY(-4px);
    opacity: 0.4;
  }
}

/* 引用回复条 */
.cp-reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px;
  background: rgba(107, 142, 35, 0.06);
  border-top: 1px solid rgba(107, 142, 35, 0.15);
  border-bottom: 1px solid rgba(107, 142, 35, 0.1);
  flex-shrink: 0;
}
.cp-reply-bar-content {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  overflow: hidden;
}
.cp-reply-bar-label {
  color: var(--olive-dark);
  font-weight: 600;
  margin-right: 4px;
}
.cp-reply-bar-text {
  color: var(--ink3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-reply-bar-close {
  border: none;
  background: none;
  color: var(--ink3);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
}
.cp-reply-bar-close:hover {
  color: var(--ink1);
  background: rgba(0, 0, 0, 0.05);
}

/* Input — from code.html line 374-388 */
.cp-input-area {
  padding: 10px 14px;
  border-top: 1px solid var(--border2);
  background: var(--surface);
  flex-shrink: 0;
  max-height: 38vh;
  overflow: visible;
}
.cp-input-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 12px 12px 10px;
  transition: border-color 0.2s;
  overflow: visible;
}
.cp-composer-relative {
  position: relative;
  min-width: 0;
  overflow: visible;
}

/* 输入区顶栏：Skill + 指令 + 文/武/直连 同排 */
.cp-composer-toprow {
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid var(--line);
  position: relative;
  min-height: 38px;
}
/* 第一步：Skill 面板拉出文档流，不再撑高整排 */
.cp-composer-toprow :deep(.spb-panel) {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  z-index: 200;
}
.cp-composer-toprow .spb {
  flex: 1;
  min-width: 0;
  border-bottom: none;
}
.cp-toprow-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 10px;
  flex-shrink: 0;
  margin-left: auto;
}
.cp-toprow-actions .cp-kb-command-wrap {
  position: relative;
}
.cp-toprow-actions .cp-kb-command-btn {
  width: auto;
  min-width: 36px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  height: 26px;
  line-height: 20px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink1);
  cursor: pointer;
  white-space: nowrap;
}
.cp-toprow-actions .cp-kb-command-btn:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
}
.cp-toprow-actions .cp-mode-wrap {
  position: relative;
}
.cp-toprow-actions .cp-mode-btn {
  height: 26px;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink1);
  cursor: pointer;
  white-space: nowrap;
}
.cp-toprow-actions .cp-mode-btn:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
}
/* 第二步：指令 + 模式菜单统一向上弹出 */
.cp-toprow-actions .cp-kb-command-menu {
  position: absolute;
  top: auto;
  bottom: 100%;
  right: 0;
  margin-top: 0;
  margin-bottom: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px;
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 200;
}
.cp-kb-command-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.cp-kb-command-tab {
  padding: 5px 12px;
  border: none;
  background: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink3);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-family: inherit;
}
.cp-kb-command-tab:hover {
  color: var(--ink1);
}
.cp-kb-command-tab.active {
  color: var(--ink1);
  border-bottom-color: var(--olive);
}
.cp-kb-command-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.cp-toprow-actions .cp-mode-menu {
  position: absolute;
  top: auto;
  bottom: 100%;
  right: 0;
  margin-top: 0;
  margin-bottom: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4px;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 200;
}
.cp-toprow-actions .cp-mode-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 8px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink1);
}
.cp-toprow-actions .cp-mode-item:hover,
.cp-toprow-actions .cp-mode-item.active {
  background: var(--olive-pale);
}
.cp-toprow-actions .cp-mode-desc {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink3);
  white-space: normal;
}

/* P1-1: 图片预览灯箱 */
.cp-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
.cp-image-lightbox img {
  max-width: 90vw;
  max-height: 80vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.cp-lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  cursor: pointer;
  color: #fff;
  font-size: 24px;
  padding: 8px 14px;
  border-radius: 8px;
  z-index: 1;
}
.cp-lightbox-close:hover {
  background: rgba(255, 255, 255, 0.25);
}
.cp-lightbox-info {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  margin-top: 12px;
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
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
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
/* ─── #26 滚动渐变遮罩（照抄 OpenCode）─── */
.cp-composer-overflow::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 24px;
  background: linear-gradient(transparent, var(--surface-alt));
  pointer-events: none;
  border-radius: 0 0 4px 4px;
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
  padding: 0;
  overflow-y: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
/* ─── contenteditable 替代 textarea ─── */
.cp-composer-editable {
  width: 100%;
  min-height: 24px;
  max-height: min(220px, 30vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--olive) 62%, transparent) transparent;
  font-size: 14px;
  font-family: inherit;
  color: var(--ink);
  line-height: 1.55;
  outline: none;
  border: none;
  background: none;
  padding: 0;
  word-break: break-word;
}
.cp-composer-editable::-webkit-scrollbar {
  width: 12px;
}
.cp-composer-editable::-webkit-scrollbar-track {
  background: transparent;
}
.cp-composer-editable::-webkit-scrollbar-thumb {
  min-height: 36px;
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--olive) 68%, transparent);
  background-clip: content-box;
}
.cp-composer-editable::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--olive-dark) 78%, transparent);
  background-clip: content-box;
}
.cp-composer-editable:empty::before {
  content: attr(data-placeholder);
  color: var(--ink3);
  pointer-events: none;
}
/* ─── pill 样式（照抄 OpenCode Tailwind）─── */
.cp-composer-editable [data-type='file'] {
  color: var(--olive);
  background: var(--olive-pale);
  border-radius: 4px;
  padding: 0 2px;
}
.cp-composer-editable [data-type='agent'] {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.08);
  border-radius: 4px;
  padding: 0 2px;
}
.cp-input-actions {
  position: static;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ci-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  border-radius: 50%;
  color: var(--ink3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.12s;
}
.ci-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
/* 指令下拉卡片网格（5列） */
.cp-kb-command-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  text-align: left;
  font: inherit;
  min-width: 0;
}
.cp-kb-command-card:hover,
.cp-kb-command-card:focus-visible {
  border-color: var(--olive);
  background: var(--olive-pale);
  outline: none;
}
.cp-kb-command-card strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink1);
  line-height: 1.3;
}
.cp-kb-command-card small {
  font-size: 11px;
  color: var(--ink3);
  line-height: 1.35;
}
.cp-send,
.cp-stop {
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
.cp-send:hover {
  transform: scale(1.05);
}
.cp-send:disabled {
  opacity: 0.4;
  cursor: default;
  transform: none;
}
.cp-stop {
  background: var(--jc-error);
  color: #fff;
}
.cp-stop:hover {
  transform: scale(1.05);
}

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
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 360px;
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
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 14px;
  border-top: 1px solid var(--line);
  background: var(--surface-alt);
  animation: ref-slide 0.2s ease;
}
@keyframes ref-slide {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.cp-ref-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 6px;
  border-radius: 8px;
  background: rgba(107, 142, 35, 0.1);
  border: 1px solid rgba(107, 142, 35, 0.2);
  font-size: 11px;
  color: var(--olive-dark);
  font-weight: 600;
  animation: ref-chip-in 0.15s ease;
}
@keyframes ref-chip-in {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
.cp-ref-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-ref-remove {
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink3);
  transition: all 0.12s;
}
.cp-ref-remove:hover {
  background: rgba(200, 0, 0, 0.1);
  color: #c00;
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
  .cp-input-area {
    padding: 6px 8px;
  }
  .cp-input-wrap {
    padding: 10px;
    border-radius: 12px;
    gap: 8px;
  }
  .cp-header {
    padding: 0 8px;
  }
  .cp-actions {
    gap: 4px;
    overflow-x: visible;
    flex-wrap: wrap;
  }
  .cp-send,
  .cp-stop {
    height: 32px;
    min-width: 32px;
    padding: 0 8px;
  }
  .ci-btn {
    width: 28px;
    height: 28px;
  }
  .cp-messages {
    padding: 10px 8px;
  }
  .cp-welcome h2 {
    font-size: 20px;
  }
  .cp-welcome p {
    font-size: 13px;
  }

  /* ─── 输入区顶栏手机端紧凑化 ─── */
  .cp-composer-toprow {
    min-height: 32px;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px 4px;
  }
  .cp-composer-toprow :deep(.spb) {
    font-size: 11px;
  }
  .cp-toprow-actions {
    gap: 2px;
    padding-right: 4px;
  }
  .cp-toprow-actions .cp-kb-command-btn {
    font-size: 11px;
    padding: 2px 8px;
    height: 24px;
    min-width: 28px;
  }
  .cp-toprow-actions .cp-mode-btn {
    font-size: 11px;
    padding: 2px 6px;
    height: 24px;
  }

  /* ─── 指令弹窗手机端全宽 ─── */
  .cp-toprow-actions .cp-kb-command-menu {
    width: calc(100vw - 16px);
    max-width: 560px;
    right: auto;
    left: -4px;
    max-height: 50vh;
    padding: 6px;
    border-radius: 10px;
  }

  /* ─── 指令卡片手机端 2 列 ─── */
  .cp-kb-command-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
  }
  .cp-kb-command-card {
    padding: 8px 10px;
  }
  .cp-kb-command-card strong {
    font-size: 11px;
  }
  .cp-kb-command-card small {
    font-size: 10px;
  }

  /* ─── 模式菜单手机端适配 ─── */
  .cp-toprow-actions .cp-mode-menu {
    right: auto;
    left: -4px;
    min-width: auto;
    width: calc(100vw - 16px);
    max-width: 320px;
  }
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-alt);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  text-align: center;
}
.cp-welcome-card:hover {
  border-color: var(--olive);
  background: rgba(107, 142, 35, 0.04);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(107, 142, 35, 0.08);
}
.cp-welcome-card-icon {
  font-size: 22px !important;
  color: var(--olive);
}
.cp-welcome-card-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink1);
}
.cp-welcome-card-hint {
  font-size: 10px;
  color: var(--ink3);
}

/* ─── P0-1: 编辑消息内联输入 ─── */
.cp-edit-inline {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  padding: 6px 0;
  width: 100%;
}
.cp-edit-inline textarea {
  flex: 1;
  border: 1px solid var(--olive);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--ink);
  background: var(--surface);
  resize: vertical;
  min-height: 40px;
  outline: none;
}
.cp-edit-inline-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.cp-edit-inline-btn {
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: all 0.12s;
}
.cp-edit-inline-btn.confirm {
  background: var(--olive);
  color: #fff;
}
.cp-edit-inline-btn.cancel {
  background: var(--surface);
  color: var(--ink3);
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
.cp-opencode-divider::before {
  left: 0;
}
.cp-opencode-divider::after {
  right: 0;
}
.cp-opencode-divider span {
  display: inline-block;
  padding: 2px 10px;
  background: var(--bg);
  position: relative;
  z-index: 1;
  border-radius: 3px;
}

/* ─── TurnDivider（中断/压缩分隔线，对齐 OpenCode message-timeline.tsx）─── */
.cp-turn-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  padding: 0 8px;
}
.cp-turn-divider hr {
  flex: 1;
  border: none;
  border-top: 1px solid var(--line);
  margin: 0;
}
.cp-turn-divider span {
  flex-shrink: 0;
  color: var(--ink3);
  font-size: 11px;
  font-weight: 500;
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
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--olive) 40%, transparent);
  }
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--olive) 0%, transparent);
  }
}

/* ─── 项目选择器 ─── */
.cp-project-wrap {
  position: relative;
}
.cp-project-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-project-btn.active {
  color: var(--olive-dark);
  border-color: var(--olive);
}
.cp-project-btn:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
}
.cp-project-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4px;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 320px;
  overflow-y: auto;
}
.cp-project-section {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cp-project-item {
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
  gap: 8px;
}
.cp-project-item:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.cp-project-item.active {
  background: rgba(213, 199, 135, 0.18);
  color: var(--olive-dark);
}
.cp-project-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.cp-project-divider {
  height: 1px;
  background: var(--border);
  margin: 2px 8px;
}

/* ─── 模式切换（已移至 .cp-toprow-actions，旧全局样式移除） ─── */

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
.reply-bubble-close:hover {
  color: var(--ink);
}
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
  transition: background 0.12s;
}
.subtask-tab:hover {
  background: var(--olive-pale);
  color: var(--ink1);
}
.subtask-tab.active {
  color: var(--olive-dark);
  background: var(--olive-pale);
  font-weight: 700;
}
.subtask-done {
  color: #1b7a1b;
  font-weight: 700;
}
.subtask-running {
  color: var(--olive);
  animation: subtask-pulse 1s ease-in-out infinite;
}
@keyframes subtask-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
