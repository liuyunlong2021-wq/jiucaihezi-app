<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ProjectFileTree from '@/components/filetree/ProjectFileTree.vue'
import ChatScrollNav from '@/components/chat/ChatScrollNav.vue'
import MediaTaskBubble from '@/components/chat/MediaTaskBubble.vue'
import SkillInstallCard from '@/components/chat/SkillInstallCard.vue'
import ToolApprovalStrip from '@/components/chat/ToolApprovalStrip.vue'
import MemorySettings from './MemorySettings.vue'
import MemoryMarkdown from './MemoryMarkdown.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { useProjectStore } from '@/stores/projectStore'
import { consumeLastEvent, emitEvent, onEvent } from '@/utils/eventBus'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { createProjectFileActions, mediaMimeForPath } from '@/services/projectFileActions'
import type { ProjectResourceOpenResult } from '@/services/projectExplorerService'
import { openProjectResource } from '@/services/projectExplorerService'
import {
  appendMemoryRound,
  createMemoryConversation,
  initializeMemoryProject,
  inspectMemoryProject,
  renameMemoryConversation,
  type MemoryConversation,
} from '@/runtime/memory/memoryProject'
import { runMemoryChat } from '@/runtime/memory/memoryChat'
import type { DirectToolCall, DirectToolExecutionEvent } from '@/runtime/direct/directTypes'
import { isRecoverableDirectTransportFailure } from '@/runtime/direct/directEngine'
import {
  parseMediaPlans,
  stripMediaPlanBlocks,
  type MediaPlan,
} from '@/runtime/workbench/mediaPlan'
import {
  buildExplicitMediaReferences,
  buildMediaReferencePolicy,
  createMediaContextSnapshot,
  materializeMediaPlanReferences,
  projectResourceForMediaTask,
  refreshMediaPlanReferenceValues,
  type MediaContextSnapshot,
  type MediaReferenceResolvers,
} from '@/runtime/workbench/mediaReference'
import {
  parseSkillInstallPlan,
  stripSkillInstallBlock,
  type SkillInstallPlan,
} from '@/runtime/memory/skillInstall'
import { getCursorPosition, getPlainText, setEditorText } from '@/composables/useContentEditable'
import { detectFileType, processFile } from '@/composables/useFileUpload'
import { useFilteredList } from '@/composables/useFilteredList'
import type { DirectMessageFile, ResolvedDirectAttachment } from '@/utils/directMessageBuilder'
import type { SkillConfig } from '@/types/skill'
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'
import { uint8ArrayToBase64 } from '@/utils/exportSave'
import { confirmAction } from '@/utils/confirmAction'
import { safePrompt } from '@/utils/safePrompt'
import type { ConversationAttachment, ConversationMode, ConversationTurn } from '@/runtime/memory/conversationTranscript'
import type { ProjectResource } from '@/utils/projectResource'
import { projectTextSync } from '@/services/projectTextSync'
import { readClipboardImageFile, shouldReadNativeClipboardImage, writeClipboardText } from '@/utils/clipboard'
import { findWikiBacklinks, resolveWikiLinkTarget } from '@/runtime/memory/markdownLinks'
import { highlightCode } from '@/utils/highlight'
import { materialMarkdownPath, nextMaterialMarkdownPath, nextMaterialPath, nextOriginalMaterialPath } from '@/utils/projectMaterials'
import { parseScene3DResultMarkers, serializeScene3DDocument, stripScene3DResultMarkers, type Scene3DDocument } from '@/runtime/memory/scene3d'
import { serializeJsonCanvas, type JsonCanvasDocument } from '@/runtime/memory/jsonCanvas'

const projectStore = useProjectStore()
const agentStore = useAgentStore()
const mediaTaskStore = useMediaTaskStore()
const files = createRuntimeProjectFileService()
const fileActions = createProjectFileActions(files)
const desktopRuntime = isTauriRuntime()
const mobileRuntime = isTauriMobileRuntime()
const desktopOnlyRuntime = desktopRuntime && !mobileRuntime
const CreationPanel = defineAsyncComponent(() => import('@/components/creation/CreationPanel.vue'))
const Model3DViewer = defineAsyncComponent(() => import('@/components/media/Model3DViewer.vue'))
const Scene3DEditor = defineAsyncComponent(() => import('./Scene3DEditor.vue'))
const ProjectMapViewer = defineAsyncComponent(() => import('./ProjectMapViewer.vue'))
const opened = ref<ProjectResourceOpenResult | null>(null)
const previewResource = ref<ProjectResourceOpenResult | null>(null)
const recordingScene = ref<Scene3DDocument | null>(null)
const recordingSceneEditor = ref<{ recordVideo: (signal?: AbortSignal) => Promise<Blob> } | null>(null)
const sceneInstruction = ref('')
const sceneInstructionSending = ref(false)
const projectMapReturn = ref<{ resource: Extract<ProjectResourceOpenResult, { type: 'project-map' }>; viewport: { x: number; y: number; zoom: number } } | null>(null)
const projectMapViewport = ref<{ x: number; y: number; zoom: number } | null>(null)
const backlinks = ref<ProjectResource[]>([])
const editingMarkdown = ref(false)
const markdownDraft = ref('')
const markdownSavePending = ref(false)
const markdownSaveError = ref('')
const markdownEditorRef = ref<HTMLTextAreaElement | null>(null)
const markdownHighlightRef = ref<HTMLElement | null>(null)
const conversations = ref<MemoryConversation[]>([])
const conversationPickerOpen = ref(false)
const conversationSearch = ref('')
const conversationPickerRef = ref<HTMLElement | null>(null)
const input = ref('')
const attachments = ref<ResolvedDirectAttachment[]>([])
const referencedFiles = ref<DirectMessageFile[]>([])
const selectedSkillNames = ref<string[]>([])
const mentionOpen = ref(false)
const executionMode = ref<ConversationMode>('memory')
const modelPickerOpen = ref(false)
const modelPickerRef = ref<HTMLElement | null>(null)
const sending = ref(false)
const projectActionPending = ref(false)
const memoryReady = ref(false)
const streamingText = ref('')
const pendingUserTurn = ref<ConversationTurn | null>(null)
const copiedTurnId = ref('')
const status = ref('')
const error = ref('')
type MemoryToolApprovalDecision = 'always' | 'once' | 'reject'
const pendingMemoryToolApproval = ref<{
  message: string
  resolve: (decision: MemoryToolApprovalDecision) => void
} | null>(null)
const memoryToolAlwaysAllowedConversations = new Set<string>()
const referencingDocuments = new Set<string>()
type MemoryRunStep = { id: string; label: string; state: 'running' | 'done' | 'failed' }
const runVisible = ref(false)
const runElapsed = ref(0)
const runSteps = ref<MemoryRunStep[]>([])
const settingsOpen = ref(false)
const treeOpen = ref(true)
const messagesEl = ref<HTMLElement | null>(null)
const memoryScrollNav = ref<InstanceType<typeof ChatScrollNav> | null>(null)
const composerRef = ref<HTMLElement | null>(null)
const mentionPopoverRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const mediaUrl = ref('')
const modelData = ref<ArrayBuffer | null>(null)
const mediaPlans = ref<Record<string, MediaPlan[]>>({})
const creationMounted = ref(false)
const creationOpen = ref(false)
const creationFocused = ref(false)
const creationPanelRef = ref<{ flushCanvasSave: () => Promise<void> } | null>(null)
const creationClosing = ref(false)
const creationWidth = ref(Number(localStorage.getItem('jcMemoryCreationWidth')) || 620)
const creationResizing = ref(false)
const skillInstallPlans = ref<Record<string, SkillInstallPlan>>({})
const skillInstallStatus = ref<Record<string, 'ready' | 'installing' | 'installed' | 'failed'>>({})
const skillInstallErrors = ref<Record<string, string>>({})
const transientAttachments = ref<Record<string, ResolvedDirectAttachment[]>>({})
let abortController: AbortController | null = null
let mediaObjectUrl = ''
let projectGeneration = 0
let backlinkGeneration = 0
let sendInFlight = false
let memoryRunGeneration = 0
let offOpenResource: (() => void) | null = null
let offToggleTree: (() => void) | null = null
let offReferenceFile: (() => void) | null = null
let offMediaReferenceAdd: (() => void) | null = null
let offSwitchPanel: (() => void) | null = null
let stopProjectWatch: (() => void) | null = null
let creationResizeStartX = 0
let creationResizeStartWidth = 0
let creationResizeFrame = 0
let runTimer: ReturnType<typeof setInterval> | null = null
let sceneSaveQueue = Promise.resolve()
let projectMapSaveQueue = Promise.resolve()

const MEMORY_TREE_WIDTH = 280
const MEMORY_CHAT_MIN = 420
const MEMORY_CREATION_MIN = 520

function clampCreationWidth(width: number): number {
  const treeWidth = treeOpen.value ? MEMORY_TREE_WIDTH : 0
  const max = Math.max(MEMORY_CREATION_MIN, window.innerWidth - treeWidth - MEMORY_CHAT_MIN)
  return Math.max(MEMORY_CREATION_MIN, Math.min(max, width))
}

function prepareCreationLayout() {
  if (window.innerWidth <= 760) return
  if (treeOpen.value && window.innerWidth - MEMORY_TREE_WIDTH < MEMORY_CHAT_MIN + MEMORY_CREATION_MIN)
    treeOpen.value = false
  const available = window.innerWidth - (treeOpen.value ? MEMORY_TREE_WIDTH : 0)
  const saved = Number(localStorage.getItem('jcMemoryCreationWidth'))
  creationWidth.value = clampCreationWidth(saved || Math.round(available * 0.33))
}

function openCreationHost() {
  prepareCreationLayout()
  creationMounted.value = true
  creationOpen.value = true
}

async function closeCreationHost(): Promise<boolean> {
  if (!creationMounted.value) return true
  if (creationClosing.value) return false
  creationClosing.value = true
  try {
    await creationPanelRef.value?.flushCanvasSave()
    creationOpen.value = false
    creationFocused.value = false
    creationMounted.value = false
    return true
  } catch (cause) {
    error.value = `创作画布保存失败：${cause instanceof Error ? cause.message : String(cause)}`
    return false
  } finally {
    creationClosing.value = false
  }
}

function resizeCreationPanel(clientX: number) {
  creationWidth.value = clampCreationWidth(
    creationResizeStartWidth - (clientX - creationResizeStartX),
  )
}

function moveCreationResize(event: PointerEvent) {
  if (!creationResizing.value) return
  if (creationResizeFrame) cancelAnimationFrame(creationResizeFrame)
  creationResizeFrame = requestAnimationFrame(() => {
    resizeCreationPanel(event.clientX)
    creationResizeFrame = 0
  })
}

function stopCreationResize() {
  if (!creationResizing.value) return
  creationResizing.value = false
  window.removeEventListener('pointermove', moveCreationResize)
  window.removeEventListener('pointerup', stopCreationResize)
  window.removeEventListener('pointercancel', stopCreationResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (creationResizeFrame) cancelAnimationFrame(creationResizeFrame)
  creationResizeFrame = 0
  localStorage.setItem('jcMemoryCreationWidth', String(Math.round(creationWidth.value)))
}

function startCreationResize(event: PointerEvent) {
  if (creationFocused.value || window.innerWidth <= 760) return
  creationResizeStartX = event.clientX
  creationResizeStartWidth = creationWidth.value
  creationResizing.value = true
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', moveCreationResize)
  window.addEventListener('pointerup', stopCreationResize)
  window.addEventListener('pointercancel', stopCreationResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function resizeCreationForWindow() {
  if (creationOpen.value && window.innerWidth > 760)
    creationWidth.value = clampCreationWidth(creationWidth.value)
}

const conversation = computed(() => opened.value?.type === 'conversation' ? opened.value : null)
const projectOwner = computed(() => desktopRuntime
  ? projectStore.projectDir.value
  : projectStore.webProjectId.value)
type MemoryMentionOption =
  | { type: 'file'; display: string; description: string; resource: ProjectResource }
  | { type: 'skill'; display: string; description: string; name: string }

const mentionItems = async (query: string): Promise<MemoryMentionOption[]> => {
  const skills = agentStore.getCustomSkills()
    .filter(skill => skill.enabled !== false)
    .map(skill => ({
      type: 'skill' as const,
      display: skill.name,
      description: skill.description,
      name: skill.name,
    }))
  const owner = projectOwner.value
  const resources = !owner ? [] : await (query.trim()
    ? files.searchPaths(owner, query.trim(), 40)
    : files.list(owner))
  const projectOptions = resources
    .filter(resource => !resource.isDirectory
      && !resource.path.startsWith('.raw/对话记录/')
      && (resource.kind !== 'binary' || isOfficeResource(resource)))
    .slice(0, 40)
    .map(resource => ({
      type: 'file' as const,
      display: resource.path,
      description: resource.kind === 'media' ? '项目媒体' : '项目文件',
      resource,
    }))
  return query.trim() ? [...skills, ...projectOptions] : [...skills.slice(0, 5), ...projectOptions]
}
const mentionKey = (item: MemoryMentionOption) => item.type === 'skill'
  ? `skill:${item.name}`
  : `file:${item.resource.path}`
const {
  flat: mentionFlat,
  active: mentionActive,
  onInput: mentionOnInput,
  onKeyDown: mentionOnKeyDown,
  setActive: setMentionActive,
  clear: clearMentionFilter,
} = useFilteredList<MemoryMentionOption>({
  items: mentionItems,
  key: mentionKey,
  filterKeys: ['display', 'description'],
  noInitialSelection: true,
})
const conversationTurns = computed(() => conversation.value?.transcript.turns || [])
const timelineTurns = computed<ConversationTurn[]>(() => {
  const turns = pendingUserTurn.value ? [...conversationTurns.value, pendingUserTurn.value] : conversationTurns.value
  if (!sending.value || !streamingText.value) return turns
  return [...turns, {
    id: 'streaming-assistant',
    role: 'assistant',
    content: streamingText.value,
    createdAt: new Date().toISOString(),
  }]
})
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
const visibleRunSteps = computed(() => runSteps.value.slice(-5))

onMounted(async () => {
  offOpenResource = onEvent('memory:open-resource', resource => void openResource(resource as ProjectResourceOpenResult))
  offToggleTree = onEvent('toggle-file-tree', () => { treeOpen.value = !treeOpen.value })
  offReferenceFile = onEvent('reference-file', payload => {
    void addReferencedFile(payload).catch(cause => {
      error.value = `引用失败：${cause instanceof Error ? cause.message : String(cause)}`
    })
  })
  offMediaReferenceAdd = onEvent('media-reference:add', payload => void addProjectMediaReferences(payload))
  offSwitchPanel = onEvent('switch-panel', mode => {
    if (mode === 'creation') openCreationHost()
  })
  const pendingMediaReference = consumeLastEvent('media-reference:add')
  if (pendingMediaReference) void addProjectMediaReferences(pendingMediaReference[0])
  document.addEventListener('pointerdown', closeModelPicker)
  document.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('resize', resizeCreationForWindow)
  stopProjectWatch = watch(projectOwner, owner => void openProject(owner), { immediate: true })
  await Promise.all([
    refreshSkills().catch(() => {}),
    agentStore.fetchModels().catch(() => {}),
    mediaTaskStore.init(),
  ])
})

onBeforeUnmount(() => {
  offOpenResource?.()
  offToggleTree?.()
  offReferenceFile?.()
  offMediaReferenceAdd?.()
  offSwitchPanel?.()
  document.removeEventListener('pointerdown', closeModelPicker)
  document.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', resizeCreationForWindow)
  stopCreationResize()
  stopProjectWatch?.()
  stopRunTimer()
  projectGeneration++
  settleMemoryToolApproval('reject')
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
  return id.startsWith('rh-') || id.includes('/rh-') || id.includes('runninghub') || id === 'jina-search' || id === 'jina-reader'
}

function closeModelPicker(event: PointerEvent) {
  if (modelPickerOpen.value && !modelPickerRef.value?.contains(event.target as Node)) modelPickerOpen.value = false
  if (conversationPickerOpen.value && !conversationPickerRef.value?.contains(event.target as Node)) conversationPickerOpen.value = false
  if (mentionOpen.value
    && !composerRef.value?.contains(event.target as Node)
    && !mentionPopoverRef.value?.contains(event.target as Node)) closeMention()
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && previewResource.value) closePreview()
}

function selectModel(modelId: string) {
  agentStore.setModel(modelId)
  modelPickerOpen.value = false
}

async function openProject(owner: string) {
  if (sending.value) stop()
  if (!await closeCreationHost()) return
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
    void projectTextSync.open(owner, projectStore.projectName.value).catch(() => {})
  } catch (cause) {
    if (generation !== projectGeneration) return
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function refreshProjectView(owner = projectOwner.value) {
  if (!owner) return
  const state = await inspectMemoryProject(owner, files)
  memoryReady.value = state.initialized
  conversations.value = state.conversations
  if (conversation.value) {
    const current = state.conversations.find(item => item.resource.path === conversation.value?.resource.path)
    if (current) await openResource(await openProjectResource(files, current.resource))
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
    void projectTextSync.open(owner, projectStore.projectName.value).catch(() => {})
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
  memoryScrollNav.value?.scheduleAutoScrollIfNeeded()
})

watch(streamingText, async text => {
  if (!text) return
  await nextTick()
  memoryScrollNav.value?.scheduleAutoScrollIfNeeded()
})

async function openResource(resource: ProjectResourceOpenResult) {
  if (resource.type === 'scene3d' && !desktopOnlyRuntime) return
  if (resource.type === 'canvas') {
    emitEvent('canvas:open', { path: resource.resource.path })
    openCreationHost()
    return
  }
  error.value = ''
  if (!sending.value) {
    status.value = ''
    runVisible.value = false
  }
  streamingText.value = ''
  editingMarkdown.value = false
  markdownSaveError.value = ''
  if (resource.type === 'conversation') {
    backlinks.value = []
    closePreview()
    opened.value = resource
    rememberConversation({ resource: resource.resource, transcript: resource.transcript })
    conversationPickerOpen.value = false
    conversationSearch.value = ''
    executionMode.value = [...resource.transcript.turns].reverse()
      .find(turn => turn.role === 'user' && turn.mode)?.mode || 'memory'
    await nextTick()
    memoryScrollNav.value?.startStickyFollow()
    let previousUserTurnId = ''
    for (const turn of resource.transcript.turns) {
      if (turn.role === 'user') {
        previousUserTurnId = turn.id
        continue
      }
      if (turn.role !== 'assistant') continue
      try {
        const mediaContext = conversationMediaContext(resource.transcript.turns, previousUserTurnId)
        mediaPlans.value[turn.id] = await Promise.all(parseMediaPlans(turn.content)
          .map(plan => resolveMediaPlanReferences(plan, mediaContext)))
      } catch { /* ordinary assistant reply */ }
      try {
        skillInstallPlans.value[turn.id] = parseSkillInstallPlan(turn.content)
        skillInstallStatus.value[turn.id] ||= 'ready'
      } catch { /* ordinary assistant reply */ }
    }
  } else {
    releaseMediaUrl()
    previewResource.value = resource
    if (resource.type === 'editor') void loadBacklinks(resource.resource)
    else backlinks.value = []
  }
  if (resource.type === 'media') {
    try {
      const binary = await files.readBinary(resource.resource)
      const data = new Uint8Array(binary.data.byteLength)
      data.set(binary.data)
      if (resource.mediaKind === 'model3d') {
        modelData.value = data.buffer
      } else {
        mediaObjectUrl = URL.createObjectURL(new Blob(
          [data.buffer],
          { type: binary.mimeType || resource.resource.mimeType },
        ))
        mediaUrl.value = mediaObjectUrl
      }
    } catch {
      mediaUrl.value = ''
      modelData.value = null
    }
  }
  if (window.innerWidth <= 760) treeOpen.value = false
}

function startMarkdownEdit() {
  if (previewResource.value?.type !== 'editor') return
  markdownDraft.value = previewResource.value.text.content
  markdownSaveError.value = ''
  editingMarkdown.value = true
  void nextTick(() => markdownEditorRef.value?.focus())
}

function cancelMarkdownEdit() {
  editingMarkdown.value = false
  markdownSaveError.value = ''
}

function syncMarkdownEditorScroll() {
  if (!markdownEditorRef.value || !markdownHighlightRef.value) return
  markdownHighlightRef.value.scrollTop = markdownEditorRef.value.scrollTop
  markdownHighlightRef.value.scrollLeft = markdownEditorRef.value.scrollLeft
}

async function saveMarkdownEdit() {
  const current = previewResource.value
  if (current?.type !== 'editor' || markdownSavePending.value) return
  markdownSavePending.value = true
  markdownSaveError.value = ''
  try {
    const result = await files.writeText(current.resource, markdownDraft.value, current.text.revision)
    if (result.status === 'conflict') {
      markdownSaveError.value = '文件已在其他位置更新。当前草稿已保留，请核对后再处理。'
      return
    }
    if (result.status !== 'saved') throw new Error('文件已不存在')
    editingMarkdown.value = false
    await openResource(await openProjectResource(files, current.resource))
  } catch (cause) {
    markdownSaveError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    markdownSavePending.value = false
  }
}

async function openWikiResource(resource: ProjectResource) {
  await openResource(await openProjectResource(files, resource))
}

async function handleMarkdownClick(event: MouseEvent) {
  const copyButton = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-code-copy="1"]')
  if (copyButton) {
    const code = copyButton.closest('.md-code')?.querySelector('code')?.textContent || ''
    if (!code) return
    const copied = await writeClipboardText(code)
    copyButton.classList.toggle('copied', copied)
    const label = copyButton.querySelector('.md-code-copy-label')
    if (label) label.textContent = copied ? '已复制' : '复制失败'
    window.setTimeout(() => {
      copyButton.classList.remove('copied')
      if (label) label.textContent = '复制'
    }, copied ? 1200 : 1800)
    return
  }
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#jc-file="]')
  if (!anchor) return
  event.preventDefault()
  const owner = projectOwner.value
  if (!owner) return
  const target = decodeURIComponent(anchor.getAttribute('href')!.slice('#jc-file='.length))
  const sourcePath = (event.currentTarget as HTMLElement).dataset.wikiSource || ''
  const resource = resolveWikiLinkTarget(target, sourcePath, await files.list(owner))
  if (!resource) {
    error.value = `文件不存在：${target}`
    return
  }
  await openWikiResource(resource)
}

async function loadBacklinks(target: ProjectResource) {
  const generation = ++backlinkGeneration
  const resources = (await files.list(target.owner)).filter(resource =>
    !resource.isDirectory && /\.md$/i.test(resource.path),
  )
  const sources: Array<{ resource: ProjectResource; content: string }> = []
  for (const resource of resources) {
    try {
      sources.push({ resource, content: (await files.readText(resource)).content })
    } catch { /* unreadable files are not backlink sources */ }
  }
  if (generation === backlinkGeneration && previewResource.value?.resource.path === target.path) {
    backlinks.value = findWikiBacklinks(target, sources)
  }
}

function rememberConversation(next: MemoryConversation) {
  const index = conversations.value.findIndex(item => item.resource.path === next.resource.path)
  if (index < 0) conversations.value.push(next)
  else conversations.value[index] = next
}

async function copyTurn(turn: ConversationTurn) {
  if (!await writeClipboardText(displayTurnContent(turn))) return
  copiedTurnId.value = turn.id
  setTimeout(() => {
    if (copiedTurnId.value === turn.id) copiedTurnId.value = ''
  }, 1500)
}

async function selectConversation(item: MemoryConversation) {
  if (sending.value) stop()
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
  const message = mobileRuntime
    ? `永久删除对话“${item.transcript.title}”？此操作无法恢复。`
    : `删除对话“${item.transcript.title}”？`
  if (!(await confirmAction(message, {
    title: mobileRuntime ? '永久删除对话' : '删除对话',
    okLabel: mobileRuntime ? '永久删除' : '删除',
  }))) return
  try {
    const plan = await files.planBatch({ kind: 'delete', resources: [item.resource] })
    const result = await files.executeBatch(plan)
    if (result.failures.length) throw new Error(result.failures[0].message)
    memoryToolAlwaysAllowedConversations.delete(item.transcript.id)
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
  backlinkGeneration++
  backlinks.value = []
  editingMarkdown.value = false
  markdownSaveError.value = ''
  previewResource.value = null
  projectMapReturn.value = null
  projectMapViewport.value = null
  releaseMediaUrl()
}

async function returnFromPreview() {
  if (!projectMapReturn.value) return closePreview()
  const target = projectMapReturn.value
  projectMapReturn.value = null
  projectMapViewport.value = target.viewport
  await openResource(target.resource)
}

async function openProjectMapPath(rawPath: string, viewport: { x: number; y: number; zoom: number }) {
  const current = previewResource.value
  if (current?.type !== 'project-map' || !rawPath || rawPath.startsWith('/') || /^[a-z]:[\\/]/i.test(rawPath)) return
  const clean = rawPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (clean.split('/').includes('..')) return
  const directory = current.resource.path.includes('/') ? current.resource.path.replace(/\/[^/]+$/, '') : ''
  const listed = await files.list(projectOwner.value)
  const candidates = [clean, `${clean}.md`, directory && `${directory}/${clean}`, directory && `${directory}/${clean}.md`].filter(Boolean)
  const resource = candidates.map(path => listed.find(item => item.path === path)).find(Boolean)
    || listed.find(item => item.path.endsWith(`/${clean}`) || item.path.endsWith(`/${clean}.md`))
  if (!resource) { error.value = `项目地图引用不存在：${rawPath}`; return }
  projectMapReturn.value = { resource: current, viewport }
  projectMapViewport.value = viewport
  await openResource(await openProjectResource(files, resource))
}

function saveProjectMap(next: JsonCanvasDocument) {
  const path = previewResource.value?.resource.path
  projectMapSaveQueue = projectMapSaveQueue.then(async () => {
    const current = previewResource.value
    if (current?.type !== 'project-map' || current.resource.path !== path) return
    const content = serializeJsonCanvas(next)
    const result = await files.writeText(current.resource, content, current.text.revision)
    if (result.status !== 'saved') {
      error.value = result.status === 'conflict' ? '项目地图已在其他位置修改，请关闭后重新打开' : '项目地图文件不存在'
      return
    }
    previewResource.value = { ...current, document: next, text: { ...current.text, content, revision: result.revision } }
  }).catch(cause => { error.value = `项目地图保存失败：${cause instanceof Error ? cause.message : String(cause)}` })
}

async function previewProjectResource(resource: ProjectResource) {
  if (!resource.owner || resource.owner !== projectOwner.value) {
    error.value = '该结果属于其他项目，请先切换到对应项目'
    return
  }
  try {
    if (resource.kind === 'project-map') projectMapViewport.value = null
    await openResource(await openProjectResource(files, resource))
  } catch (cause) {
    error.value = `预览失败: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

async function send() {
  const active = conversation.value
  const message = input.value.trim()
  const pendingAttachments = attachments.value.slice()
  const pendingMode = executionMode.value
  if (!active || (!message && !pendingAttachments.length && !referencedFiles.value.length && !selectedSkillNames.value.length) || sending.value || sendInFlight) return
  sendInFlight = true
  const runGeneration = ++memoryRunGeneration
  sending.value = true
  const userTurn: ConversationTurn = {
    id: `turn-${crypto.randomUUID()}`,
    role: 'user',
    content: message || '请查看以下附件。',
    createdAt: new Date().toISOString(),
    attachments: attachmentMetadata(pendingAttachments),
    mode: pendingMode,
  }
  const title = !active.transcript.turns.some(turn => turn.role === 'user') && active.transcript.title === '新对话'
    ? (message || pendingAttachments[0]?.name || '新对话').replace(/\s+/g, ' ').slice(0, 28)
    : undefined
  pendingUserTurn.value = userTurn
  beginRunStatus()
  void nextTick(() => memoryScrollNav.value?.startStickyFollow())
  error.value = ''
  status.value = '正在思考'
  streamingText.value = ''
  abortController = new AbortController()
  let replyCompleted = false
  try {
    const mediaContext = conversationMediaContext(
      [...active.transcript.turns, userTurn],
      userTurn.id,
      pendingAttachments,
    )
    const reply = await runMemoryChat({
      projectId: active.resource.owner,
      conversationTurns: active.transcript.turns,
      userTurn,
      rawPath: active.resource.path,
      modelId: agentStore.currentModel,
      mode: pendingMode,
      mediaReferencePolicy: buildMediaReferencePolicy(mediaContext),
      attachments: pendingAttachments,
      files: referencedFiles.value,
      selectedSkillNames: selectedSkillNames.value,
      recordSceneVideo,
      signal: abortController.signal,
      onToolEvent: updateRunTool,
      onRetry(attempt, total) {
        status.value = `通道超时，正在重连 ${attempt}/${total}`
      },
      confirmTool: async call => {
        if (memoryToolAlwaysAllowedConversations.has(active.transcript.id) && call.function.name !== 'delete') return true
        return await new Promise<boolean>(resolve => {
          pendingMemoryToolApproval.value = {
            message: memoryToolApprovalMessage(call),
            resolve: decision => {
              if (decision === 'always' && call.function.name !== 'delete') memoryToolAlwaysAllowedConversations.add(active.transcript.id)
              resolve(decision !== 'reject')
            },
          }
        })
      },
      onText(text) {
        status.value = '正在整理回答'
        streamingText.value = text
      },
    })
    replyCompleted = true
    if (runGeneration !== memoryRunGeneration) return
    const complete = await appendMemoryRound(active.resource, userTurn, reply, files, title)
    if (runGeneration !== memoryRunGeneration) return
    if (pendingAttachments.length) transientAttachments.value[userTurn.id] = pendingAttachments
    const completeResource = await openProjectResource(files, complete.resource)
    rememberConversation(complete)
    opened.value = completeResource
    streamingText.value = ''
    const turn = complete.transcript.turns.at(-1)
    if (turn?.role === 'assistant') {
      try {
        mediaPlans.value[turn.id] = await Promise.all(parseMediaPlans(turn.content)
          .map(plan => resolveMediaPlanReferences(plan, mediaContext)))
        const firstPlan = mediaPlans.value[turn.id][0]
        if (firstPlan) await openMediaPlanInCreation(turn.id, 0, firstPlan)
      } catch { /* no media plan */ }
      try {
        skillInstallPlans.value[turn.id] = parseSkillInstallPlan(turn.content)
        skillInstallStatus.value[turn.id] = 'ready'
      } catch { /* no Skill install plan */ }
    }
    attachments.value = []
    referencedFiles.value = []
    selectedSkillNames.value = []
    input.value = ''
    setEditorText(composerRef.value, '')
    streamingText.value = ''
    status.value = '已完成'
    stopRunTimer()
  } catch (cause) {
    if (runGeneration !== memoryRunGeneration) return
    const aborted = cause instanceof DOMException && cause.name === 'AbortError'
    if (aborted) status.value = '已停止'
    else {
      status.value = '处理失败'
      error.value = cause instanceof Error ? cause.message : String(cause)
      if (!replyCompleted && isRecoverableDirectTransportFailure(cause)) {
        const interruptedReply = [
          streamingText.value.trim(),
          '> 本轮因网络或上游服务中断，已保留当前结果。继续前请先检查项目现状，避免重复写入或外部操作。',
        ].filter(Boolean).join('\n\n')
        try {
          if (runGeneration !== memoryRunGeneration) return
          const interrupted = await appendMemoryRound(active.resource, userTurn, interruptedReply, files, title)
          if (runGeneration !== memoryRunGeneration) return
          if (pendingAttachments.length) transientAttachments.value[userTurn.id] = pendingAttachments
          rememberConversation(interrupted)
          opened.value = await openProjectResource(files, interrupted.resource)
          attachments.value = []
          referencedFiles.value = []
          selectedSkillNames.value = []
          input.value = ''
          setEditorText(composerRef.value, '')
          streamingText.value = ''
        } catch (persistCause) {
          error.value += `；中断记录保存失败：${persistCause instanceof Error ? persistCause.message : String(persistCause)}`
        }
      }
    }
    stopRunTimer()
  } finally {
    pendingUserTurn.value = null
    settleMemoryToolApproval('reject')
    sending.value = false
    abortController = null
    sendInFlight = false
  }
}

function stop() {
  memoryRunGeneration++
  settleMemoryToolApproval('reject')
  abortController?.abort()
}

function settleMemoryToolApproval(decision: MemoryToolApprovalDecision) {
  const pending = pendingMemoryToolApproval.value
  if (!pending) return
  pendingMemoryToolApproval.value = null
  pending.resolve(decision)
}

function memoryToolApprovalMessage(call: DirectToolCall): string {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(call.function.arguments || '{}') } catch { /* runtime reports malformed arguments */ }
  if (call.function.name === 'terminal') return String(args.reason || '').split(/[。；;\n]/)[0]?.trim().slice(0, 24) || '执行本机命令'
  if (call.function.name === 'export_3d_scene_video') return '调用本机 FFmpeg 导出 MP4'
  if (call.function.name === 'delete') return `删除项目资源：${String(args.path || '')}`
  if (call.function.name === 'wiki') return '修改项目 Wiki'
  if (call.function.name === 'write' || call.function.name === 'edit') return `修改项目外文件：${String(args.path || '')}`
  return '允许扩展工具继续操作'
}

function beginRunStatus() {
  stopRunTimer()
  runVisible.value = true
  runElapsed.value = 0
  runSteps.value = []
  const startedAt = Date.now()
  runTimer = setInterval(() => { runElapsed.value = Math.floor((Date.now() - startedAt) / 1000) }, 1000)
}

function stopRunTimer() {
  if (runTimer) clearInterval(runTimer)
  runTimer = null
}

function updateRunTool(event: DirectToolExecutionEvent) {
  const label = memoryToolLabel(event.call.function.name)
  if (event.type === 'tool_execution_start') {
    runSteps.value.push({ id: event.call.id, label, state: 'running' })
    status.value = `正在${label}`
    return
  }
  const step = runSteps.value.find(item => item.id === event.call.id)
  if (step) step.state = event.status === 'succeeded' ? 'done' : 'failed'
  status.value = '正在等待模型继续处理'
}

function memoryToolLabel(name: string): string {
  return ({
    skill: '加载 Skill',
    wiki: '检查 Wiki',
    wiki_search: '搜索 Wiki',
    read: '读取文件',
    glob: '查找文件',
    grep: '搜索内容',
    write: '写入文件',
    edit: '编辑文件',
    mkdir: '创建文件夹',
    move: '移动文件',
    delete: '删除文件',
    export_markdown_png: '导出 Markdown 图片',
    create_document: '生成文档',
    create_html: '生成网页',
    export_markdown_slides: '生成幻灯片',
    create_3d_scene: '搭建 3D 白膜',
    terminal: '执行命令',
  } as Record<string, string>)[name] || '使用扩展工具'
}

function formatRunElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

async function addReferencedFile(payload: unknown) {
  executionMode.value = 'memory'
  const reference = payload as { resource?: ProjectResource } | null
  if (reference?.resource) {
    await addProjectFileReference(reference.resource)
    return
  }
  const file = payload as DirectMessageFile | null
  if (!file?.name || !file.content || referencedFiles.value.some(item => item.name === file.name)) return
  referencedFiles.value.push({ name: file.name, content: file.content })
}

function isOfficeResource(resource: Pick<ProjectResource, 'name' | 'mimeType'>): boolean {
  const type = detectFileType(new File([], resource.name, { type: resource.mimeType || '' }))
  return type === 'office' || type === 'pdf'
}

async function addProjectFileReference(resource: ProjectResource) {
  executionMode.value = 'memory'
  if (isOfficeResource(resource)) {
    const referenceKey = `${resource.runtime}:${resource.owner}:${resource.path}`
    if (referencingDocuments.has(referenceKey)
      || attachments.value.some(item => item.resourcePath === resource.path)) return
    referencingDocuments.add(referenceKey)
    try {
      const listed = await files.list(resource.owner)
      const existing = new Set(listed.map(item => item.path))
      const preferredPath = resource.path.startsWith('.raw/jc-media/文档/') ? materialMarkdownPath(resource.path) : ''
      const legacyPath = resource.path.startsWith('.raw/jc-media/文档/') ? `${resource.path}.md` : ''
      let readablePath = preferredPath && existing.has(preferredPath)
        ? preferredPath
        : legacyPath && existing.has(legacyPath) ? legacyPath : ''
      let content = ''
      if (readablePath) {
        content = (await files.readText(listed.find(item => item.path === readablePath)!)).content
      } else {
        let localError = ''
        if (resource.runtime === 'desktop') {
          const { invoke } = await import('@tauri-apps/api/core')
          const result = await invoke<{ status: string; content: string; outputPath?: string; truncated?: boolean; message?: string }>('document_path_to_markdown_file', {
            input: {
              sourcePath: `${resource.owner}/${resource.path}`,
              outputDir: `${resource.owner}/.raw/jc-media/文档`,
              maxChars: 20_000_000,
            },
          })
          if (result.status === 'success' && result.content && !result.truncated) {
            readablePath = `.raw/jc-media/文档/${String(result.outputPath || '').replace(/\\/g, '/').split('/').pop() || materialMarkdownPath(resource.path).split('/').pop()}`
            content = result.content
          } else {
            localError = result.message || '本地文档转换不可用'
          }
        }
        if (!content) {
          if ((resource.size || 0) > 20 * 1024 * 1024) throw new Error(`${localError || '本地文档转换不可用'}，且文件超过云端 20 MB 上限`)
          const binary = await files.readBinary(resource)
          const data = new Uint8Array(binary.data.byteLength)
          data.set(binary.data)
          const file = new File([data.buffer], resource.name, {
            type: binary.mimeType || resource.mimeType || 'application/octet-stream',
          })
          const processed = await processFile(file, { maxTextLength: 20_000_000 })
          if (processed.status !== 'ready' || !processed.textContent || processed.truncated) throw new Error(processed.error || localError || '文档转换失败')
          readablePath = preferredPath || nextMaterialMarkdownPath(resource.path, existing)
          await files.createText(resource.owner, readablePath, processed.textContent)
          content = processed.textContent
        }
      }
      if (!attachments.value.some(item => item.readablePath === readablePath)) attachments.value.push({
        id: crypto.randomUUID(), name: resource.name, mime: resource.mimeType || 'application/octet-stream',
        size: resource.size || 0, kind: 'file', value: '', resourcePath: resource.path,
        readablePath, characterCount: content.length,
      })
    } finally {
      referencingDocuments.delete(referenceKey)
    }
    return
  }
  const text = await files.readText(resource)
  if (!attachments.value.some(item => item.resourcePath === resource.path)) attachments.value.push({
    id: crypto.randomUUID(), name: resource.name, mime: resource.mimeType || 'text/plain', size: text.size,
    kind: 'file', value: '', resourcePath: resource.path, readablePath: resource.path,
    characterCount: text.content.length,
  })
}

async function addProjectMediaReferences(payload: unknown) {
  executionMode.value = 'memory'
  const resources = (payload as { resources?: ProjectResource[] } | null)?.resources || []
  for (const resource of resources) {
    if (resource.isDirectory || resource.kind !== 'media'
      || attachments.value.some(attachment => attachment.resourcePath === resource.path)) continue
    try {
      const binary = await fileActions.readMedia(resource)
      const mime = binary.mimeType || resource.mimeType || mediaMimeForPath(resource.path) || 'application/octet-stream'
      const bytes = new Uint8Array(binary.data.byteLength)
      bytes.set(binary.data)
      const file = new File([bytes.buffer], resource.name, { type: mime })
      attachments.value.push({
        id: crypto.randomUUID(),
        name: resource.name,
        mime,
        size: binary.size,
        kind: mime.startsWith('image/') ? 'image'
          : mime.startsWith('video/') ? 'video'
            : mime.startsWith('audio/') ? 'audio' : 'file',
        value: await readDataUrl(file),
        resourcePath: resource.path,
      })
      await nextTick()
      composerRef.value?.focus()
    } catch (cause) {
      error.value = `引用失败：${cause instanceof Error ? cause.message : String(cause)}`
    }
  }
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
  const editor = event.currentTarget as HTMLElement
  input.value = getPlainText(editor)
  const cursorPos = getCursorPosition(editor)
  const match = input.value.slice(0, cursorPos || input.value.length).match(/@(\S*)$/)
  if (match) {
    mentionOpen.value = true
    mentionOnInput(match[1])
  } else {
    closeMention()
  }
  resizeComposer()
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (mentionOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMention()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      const item = mentionFlat.value.find(option => mentionKey(option) === mentionActive.value) || mentionFlat.value[0]
      if (item) void selectMention(item)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      mentionOnKeyDown(event)
      return
    }
  }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}

function closeMention() {
  mentionOpen.value = false
  clearMentionFilter()
}

async function selectMention(option: MemoryMentionOption) {
  try {
    executionMode.value = 'memory'
    if (option.type === 'skill') {
      if (!selectedSkillNames.value.includes(option.name)) selectedSkillNames.value.push(option.name)
    } else if (option.resource.kind === 'media') {
      await addProjectMediaReferences({ resources: [option.resource] })
    } else {
      await addProjectFileReference(option.resource)
    }
    input.value = input.value.replace(/@([^\s@]*)$/, '')
    setEditorText(composerRef.value, input.value)
    await nextTick()
    resizeComposer()
  } catch (cause) {
    error.value = `引用失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    closeMention()
    composerRef.value?.focus()
  }
}

function selectExecutionMode(mode: ConversationMode) {
  executionMode.value = mode
  if (mode === 'quick') {
    attachments.value = []
    referencedFiles.value = []
    selectedSkillNames.value = []
  }
}

async function handleComposerPaste(event: ClipboardEvent) {
  const imageFiles = Array.from(event.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  const text = event.clipboardData?.getData('text/plain') || ''
  event.preventDefault()
  if (imageFiles.length) {
    await addAttachmentFiles(imageFiles)
    return
  }
  if (shouldReadNativeClipboardImage(imageFiles.length, text, desktopRuntime, mobileRuntime)) {
    const image = await readClipboardImageFile()
    if (image) await addAttachmentFiles([image])
    return
  }

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
  await agentStore.refreshSkills()
}

async function selectFiles(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files || [])
  try {
    error.value = ''
    await addAttachmentFiles(selected)
  } catch (cause) {
    error.value = `附件处理失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    status.value = ''
    ;(event.target as HTMLInputElement).value = ''
  }
}

async function addAttachmentFiles(selected: File[]) {
  executionMode.value = 'memory'
  const owner = projectOwner.value
  if (!owner || !memoryReady.value) throw new Error('请先创建记忆空间')
  const existing = new Set((await files.list(owner)).map(resource => resource.path))
  const resolved: ResolvedDirectAttachment[] = []
  const failures: string[] = []
  for (const file of selected) {
    try {
    const mime = file.type || 'application/octet-stream'
      const type = detectFileType(file)
      if (type === 'office' || type === 'pdf' || type === 'text') {
        const originalPath = nextOriginalMaterialPath(file.name, existing)
        const textContent = type === 'text' ? await file.text() : ''
        const resource = type === 'text'
          ? await files.createText(owner, originalPath, textContent)
          : await files.importBinary({
              owner, path: originalPath, data: new Uint8Array(await file.arrayBuffer()), mimeType: mime,
            })
        existing.add(resource.path)
        if (type === 'text') {
          resolved.push({
            id: crypto.randomUUID(), name: file.name, mime, size: file.size, kind: 'file', value: '',
            resourcePath: resource.path, readablePath: resource.path, characterCount: textContent.length,
          })
          continue
        }
      status.value = `正在解析 ${file.name}`
        const processed = await processFile(file, { maxTextLength: 20_000_000 })
        if (processed.status !== 'ready' || !processed.textContent || processed.truncated) {
          throw new Error(processed.truncated
            ? '文档超过当前安全解析上限，原件已保存'
            : `${processed.error || '文档转换失败'}，原件已保存，可从 .raw/jc-media/文档 重新引用`)
        }
        const readablePath = nextMaterialMarkdownPath(resource.path, existing)
        await files.createText(owner, readablePath, processed.textContent)
        existing.add(readablePath)
        resolved.push({
          id: crypto.randomUUID(), name: file.name, mime, size: file.size, kind: 'file', value: '',
          resourcePath: resource.path, readablePath, characterCount: processed.textContent.length,
        })
        continue
      }
      if (!['image', 'video', 'audio'].includes(type)) {
        const originalPath = nextOriginalMaterialPath(file.name, existing)
        const resource = await files.importBinary({
          owner, path: originalPath, data: new Uint8Array(await file.arrayBuffer()), mimeType: mime,
        })
        existing.add(resource.path)
        resolved.push({
          id: crypto.randomUUID(), name: file.name, mime, size: file.size, kind: 'file',
          value: await readDataUrl(file), resourcePath: resource.path,
        })
        continue
      }
      const resource = await fileActions.importMedia({
        owner,
        path: nextMaterialPath(
          `.raw/jc-media/${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}`,
          file.name,
          existing,
        ),
        data: new Uint8Array(await file.arrayBuffer()),
        mimeType: mime,
      })
      existing.add(resource.path)
      resolved.push({
        id: crypto.randomUUID(), name: file.name, mime, size: file.size,
        kind: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file',
        value: await readDataUrl(file), resourcePath: resource.path,
      })
    } catch (cause) {
      failures.push(`${file.name}：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  const byId = new Map(attachments.value.map(attachment => [attachment.id, attachment]))
  for (const attachment of resolved) byId.set(attachment.id, attachment)
  attachments.value = [...byId.values()]
  if (failures.length) throw new Error(failures.join('；'))
}

function mediaPlanKey(turnId: string, planIndex: number): string {
  return `${turnId}:${planIndex}`
}

function mediaTaskIdForPlan(turnId: string, planIndex: number): string {
  const sessionId = conversation.value?.transcript.id
  return mediaTaskStore.tasks.find(task =>
    task.sessionId === sessionId && task.chatMessageId === mediaPlanKey(turnId, planIndex),
  )?.id || ''
}

function mediaPlanResources(plan: MediaPlan): ProjectResource[] {
  const resources = (plan.mediaReferences || []).flatMap(reference => {
    if (reference.locator.type === 'project') {
      const locator = reference.locator
      return [{
        runtime: locator.runtime,
        owner: locator.owner,
        path: locator.path,
        id: locator.id,
        name: reference.label,
        isDirectory: false,
        kind: 'media' as const,
      }]
    }
    if (reference.locator.type === 'task') {
      const resource = projectResourceForMediaTask(mediaTaskStore.getTask(reference.locator.taskId) || {
        id: '', type: '', status: '', createdAt: 0,
      })
      return resource ? [resource] : []
    }
    return []
  })
  return [...new Map(resources.map(resource => [`${resource.owner}:${resource.path}`, resource])).values()]
}

async function openMediaPlanInCreation(turnId: string, planIndex: number, plan: MediaPlan) {
  const active = conversation.value
  if (!active) return
  openCreationHost()
  await nextTick()
  emitEvent('memory-media-plan-load', {
    plan,
    resources: mediaPlanResources(plan),
    origin: {
      key: mediaPlanKey(turnId, planIndex),
      owner: active.resource.owner,
      conversationPath: active.resource.path,
      conversationId: active.transcript.id,
    },
  })
}

async function openCreationForCurrentConversation() {
  const active = conversation.value
  if (!active) return
  openCreationHost()
  await nextTick()
  emitEvent('memory-media-plan-load', {
    origin: {
      key: `direct:${active.transcript.id}`,
      owner: active.resource.owner,
      conversationPath: active.resource.path,
      conversationId: active.transcript.id,
    },
  })
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
  const content = stripScene3DResultMarkers(stripSkillInstallBlock(turn.content))
  if (mediaResultTaskId(turn)) return ''
  return mediaPlans.value[turn.id]?.length ? stripMediaPlanBlocks(content) : content
}

function sceneCards(turn: ConversationTurn) {
  return desktopOnlyRuntime && turn.role === 'assistant' ? parseScene3DResultMarkers(turn.content) : []
}

async function openSceneCard(path: string) {
  const resource = (await files.list(projectOwner.value)).find(item => item.path === path)
  if (!resource) {
    error.value = '白膜场景文件不存在，请检查文件树'
    return
  }
  await previewProjectResource(resource)
}

function saveScene3D(next: Scene3DDocument) {
  const path = previewResource.value?.resource.path
  sceneSaveQueue = sceneSaveQueue.then(async () => {
    const current = previewResource.value
    if (current?.type !== 'scene3d' || current.resource.path !== path) return
    const content = serializeScene3DDocument(next)
    const result = await files.writeText(current.resource, content, current.text.revision)
    if (result.status !== 'saved') {
      error.value = result.status === 'conflict' ? '白膜场景已在其他位置修改，请关闭后重新打开' : '白膜场景文件不存在'
      return
    }
    previewResource.value = { ...current, text: { ...current.text, content, revision: result.revision } }
  }).catch(cause => { error.value = `白膜场景保存失败：${cause instanceof Error ? cause.message : String(cause)}` })
}

async function saveSceneScreenshot(blob: Blob, title: string) {
  const owner = projectOwner.value
  if (!owner) return
  const existing = new Set((await files.list(owner)).map(item => item.path))
  const resource = await files.importBinary({
    owner,
    path: nextMaterialPath('.raw/jc-media/图片', `${title}.png`, existing),
    data: new Uint8Array(await blob.arrayBuffer()),
    mimeType: 'image/png',
  })
  status.value = `截图已保存：${resource.path}`
}

async function saveSceneVideo(blob: Blob, title: string) {
  const owner = projectOwner.value
  if (!owner || !desktopOnlyRuntime) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<{ path: string }>('dev_export_scene_video', {
      input: {
        root: owner,
        dataBase64: uint8ArrayToBase64(new Uint8Array(await blob.arrayBuffer())),
        mimeType: blob.type,
        outputFilename: `${title}.mp4`,
      },
    })
    status.value = `视频已保存：${result.path}`
  } catch (cause) {
    error.value = `3D 手动录制保存失败：${cause instanceof Error ? cause.message : String(cause)}`
  }
}

async function refreshOpenScene(path: string) {
  const current = previewResource.value
  if (current?.type !== 'scene3d' || current.resource.path !== path) return
  try { previewResource.value = await openProjectResource(files, current.resource) }
  catch (cause) { error.value = `3D 场景刷新失败：${cause instanceof Error ? cause.message : String(cause)}` }
}

async function sendSceneInstruction() {
  const current = previewResource.value
  const instruction = sceneInstruction.value.trim()
  if (current?.type !== 'scene3d' || !instruction || sceneInstructionSending.value || sending.value) return
  sceneInstructionSending.value = true
  const draft = input.value
  input.value = `当前打开的 3D 场景路径是：${current.resource.path}\n请先读取这个场景。除非我明确说“重做”或“重新生成”，否则只用 edit_3d_scene 做增量修改。我的修改要求：${instruction}`
  setEditorText(composerRef.value, input.value)
  sceneInstruction.value = ''
  try {
    await send()
    await refreshOpenScene(current.resource.path)
  } finally {
    input.value = draft
    setEditorText(composerRef.value, draft)
    sceneInstructionSending.value = false
  }
}

async function recordSceneVideo(document: Scene3DDocument, signal?: AbortSignal): Promise<Blob> {
  recordingScene.value = document
  await nextTick()
  for (let index = 0; index < 600 && !recordingSceneEditor.value; index += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
  if (!recordingSceneEditor.value) throw new Error('3D 动画录制器启动失败')
  try { return await recordingSceneEditor.value.recordVideo(signal) }
  finally { recordingScene.value = null; await nextTick() }
}

function mediaResultTaskId(turn: ConversationTurn): string {
  if (turn.role !== 'assistant') return ''
  return /^\[媒体结果\]\n任务\s+(mtask_[^\s，。]+)/.exec(turn.content)?.[1] || ''
}

function attachmentMetadata(attachments: ResolvedDirectAttachment[]): ConversationAttachment[] {
  return attachments.map(({ id, name, mime, size, kind, resourcePath, readablePath, characterCount }) => ({
    id, name, mime, size, kind, projectPath: resourcePath, readablePath, characterCount,
  }))
}

function turnAttachments(turn: ConversationTurn): Array<ConversationAttachment & { value?: string }> {
  const previews = new Map((transientAttachments.value[turn.id] || []).map(attachment => [attachment.id, attachment.value]))
  return (turn.attachments || []).map(attachment => ({ ...attachment, value: previews.get(attachment.id) }))
}

function conversationMediaContext(
  turns: ConversationTurn[],
  explicitTurnId = '',
  liveAttachments: ResolvedDirectAttachment[] = [],
): MediaContextSnapshot {
  const owner = conversation.value?.resource.owner || projectOwner.value
  const liveByPath = new Map(liveAttachments.map(attachment => [attachment.resourcePath, attachment]))
  const references = turns.flatMap(turn => {
    if (turn.role !== 'user') return []
    const inputs = (turn.attachments || []).flatMap(attachment => {
      if (!attachment.projectPath || (attachment.kind !== 'image' && attachment.kind !== 'video')) return []
      const live = liveByPath.get(attachment.projectPath)
      const resource = attachmentResource(owner, attachment)
      return [{
        name: `${attachment.name}（${turn.createdAt.slice(0, 16).replace('T', ' ')}）`,
        kind: attachment.kind,
        value: live?.value || '',
        source: 'project' as const,
        resource,
      }]
    })
    return buildExplicitMediaReferences(turn.id, inputs)
      .map(reference => ({ ...reference, explicit: turn.id === explicitTurnId }))
  })
  return createMediaContextSnapshot({
    owner,
    sessionId: conversation.value?.transcript.id || '',
    explicitReferences: references,
  })
}

async function resolveMediaPlanReferences(plan: MediaPlan, context: MediaContextSnapshot): Promise<MediaPlan> {
  const materialized = materializeMediaPlanReferences(plan, context)
  return materialized.mediaReferences?.length
    ? await refreshMediaPlanReferenceValues(materialized, mediaReferenceResolvers())
    : materialized
}

function mediaReferenceResolvers(): MediaReferenceResolvers {
  return {
    async readProject(locator) {
      return fileActions.readMediaDataUrl({
        runtime: locator.runtime,
        owner: locator.owner,
        path: locator.path,
        id: locator.id,
        name: locator.path.split('/').pop() || locator.path,
        isDirectory: false,
        kind: 'media',
      })
    },
    async readTask(taskId) {
      const task = mediaTaskStore.getTask(taskId)
      if (task?.status !== 'success') return ''
      const resource = projectResourceForMediaTask(task)
      if (resource) {
        try { return await fileActions.readMediaDataUrl(resource) } catch { /* result URL fallback */ }
      }
      return task.resultUrl || ''
    },
  }
}

function attachmentResource(owner: string, attachment: ConversationAttachment): ProjectResource {
  return {
    runtime: desktopRuntime ? 'desktop' : 'web',
    owner,
    path: attachment.projectPath!,
    name: attachment.name,
    isDirectory: false,
    kind: 'media',
    mimeType: attachment.mime,
  }
}

function releaseMediaUrl() {
  if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl)
  mediaObjectUrl = ''
  mediaUrl.value = ''
  modelData.value = null
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
  <div
    class="memory-workbench"
    :class="{
      'tree-closed': !treeOpen,
      'desktop-runtime': desktopRuntime,
      'creation-open': creationOpen,
      'creation-focused': creationFocused,
      'creation-resizing': creationResizing,
    }"
    :style="{ '--memory-creation-width': `${creationWidth}px` }"
    data-tauri-drag-region
  >
    <aside class="memory-tree" :class="{ open: treeOpen }">
      <ProjectFileTree />
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
          <button
            v-if="conversation"
            class="icon-button"
            title="创作面板"
            @click="creationOpen ? closeCreationHost() : openCreationForCurrentConversation()"
          ><JcIcon name="palette" /></button>
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
        <div v-if="!timelineTurns.length" class="memory-empty-state">开始一段对话</div>
        <div v-else class="memory-message-list">
        <article
          v-for="turn in timelineTurns"
          :key="turn.id"
          class="memory-message"
          :class="[turn.role, { streaming: turn.id === 'streaming-assistant' }]"
        >
          <span class="memory-role">{{ turn.role === 'user' ? '你' : '韭菜盒子' }}</span>
          <div v-if="turn.role === 'user' && turnAttachments(turn).length" class="memory-message-attachments">
            <div v-for="attachment in turnAttachments(turn)" :key="attachment.id" class="memory-message-attachment" :class="attachment.kind">
              <img v-if="attachment.kind === 'image' && attachment.value" :src="attachment.value" :alt="attachment.name" />
              <template v-else><JcIcon :name="attachment.kind === 'video' ? 'movie' : attachment.kind === 'audio' ? 'music-note' : 'description'" /><span :title="attachment.name">{{ attachment.name }}</span></template>
            </div>
          </div>
          <MemoryMarkdown
            v-if="displayTurnContent(turn)"
            class="memory-message-text memory-markdown markdown-body"
            :data-wiki-source="conversation?.resource.path"
            :content="displayTurnContent(turn)"
            :render-id="turn.id"
            :streaming="turn.id === 'streaming-assistant'"
            @click="handleMarkdownClick"
          />
          <button
            v-if="turn.id !== 'streaming-assistant' && displayTurnContent(turn)"
            class="memory-message-copy"
            type="button"
            :title="copiedTurnId === turn.id ? '已复制' : '复制'"
            :aria-label="copiedTurnId === turn.id ? '已复制' : '复制消息'"
            @click="copyTurn(turn)"
          ><JcIcon :name="copiedTurnId === turn.id ? 'check' : 'content-copy'" /></button>
          <template v-for="(plan, planIndex) in mediaPlans[turn.id]" :key="mediaPlanKey(turn.id, planIndex)">
            <button
              type="button"
              class="memory-media-plan-link"
              @click="openMediaPlanInCreation(turn.id, planIndex, plan)"
            >
              <JcIcon name="palette" />
              <span>{{ plan.title }}</span>
              <small>在创作面板中调整</small>
            </button>
            <MediaTaskBubble
              v-if="mediaTaskIdForPlan(turn.id, planIndex)"
              :task-id="mediaTaskIdForPlan(turn.id, planIndex)"
            />
          </template>
          <MediaTaskBubble
            v-if="mediaResultTaskId(turn)"
            :task-id="mediaResultTaskId(turn)"
          />
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
          <button
            v-for="sceneCard in sceneCards(turn)"
            :key="sceneCard.path"
            type="button"
            class="memory-scene-card"
            @click="openSceneCard(sceneCard.path)"
          >
            <JcIcon name="view-in-ar" />
            <span><strong>{{ sceneCard.title }}</strong><small>{{ sceneCard.objectCount }} 个独立对象 · {{ sceneCard.formationCount }} 组排列</small></span>
            <em>打开场景</em>
          </button>
        </article>
        </div>
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
      <ChatScrollNav
        ref="memoryScrollNav"
        :container="messagesEl"
        :is-streaming="sending"
      />

      <footer v-if="conversation" class="memory-composer">
        <div class="memory-composer-tools">
          <div class="memory-mode-segment" role="group" aria-label="回答方式">
            <button
              type="button"
              :disabled="sending"
              :class="{ active: executionMode === 'quick' }"
              title="直接回答，不使用 Skill 和项目工具"
              @click="selectExecutionMode('quick')"
            >快速</button>
            <button
              type="button"
              :disabled="sending"
              :class="{ active: executionMode === 'memory' }"
              title="按需使用 Skill 和项目工具"
              @click="selectExecutionMode('memory')"
            >记忆</button>
          </div>
        </div>
        <div v-if="attachments.length" class="memory-attachments">
          <div v-for="file in attachments" :key="file.id" class="memory-attachment-chip">
            <img v-if="file.kind === 'image'" :src="file.value" :alt="file.name" />
            <JcIcon v-else :name="file.kind === 'video' ? 'movie' : file.kind === 'audio' ? 'music-note' : 'description'" />
            <span class="memory-attachment-copy">
              <span class="memory-attachment-name" :title="file.name">{{ file.name }}</span>
              <small v-if="file.readablePath">已保存 · 已解析 {{ (file.characterCount || 0).toLocaleString() }} 字</small>
            </span>
            <button title="移除附件" :disabled="sending" @click="attachments = attachments.filter(item => item.id !== file.id)">×</button>
          </div>
        </div>
        <div v-if="referencedFiles.length" class="memory-attachments memory-references">
          <div v-for="file in referencedFiles" :key="file.name" class="memory-attachment-chip">
            <JcIcon name="attach-file" />
            <span class="memory-attachment-name" :title="file.name">{{ file.name }}</span>
            <button title="移除引用" :disabled="sending" @click="referencedFiles = referencedFiles.filter(item => item.name !== file.name)">×</button>
          </div>
        </div>
        <div v-if="selectedSkillNames.length" class="memory-attachments memory-references">
          <div v-for="name in selectedSkillNames" :key="name" class="memory-attachment-chip">
            <JcIcon name="psychology" />
            <span class="memory-attachment-name" :title="name">Skill · {{ name }}</span>
            <button title="移除 Skill" :disabled="sending" @click="selectedSkillNames = selectedSkillNames.filter(item => item !== name)">×</button>
          </div>
        </div>
        <div v-if="runVisible" class="memory-run-status" :class="{ error: Boolean(error) }" aria-live="polite">
          <div class="memory-run-head">
            <JcIcon :name="error ? 'error' : status === '已完成' ? 'check_circle' : status === '已停止' ? 'stop' : 'sync'" :class="{ spinning: sending && !error }" />
            <strong>{{ status }}</strong>
            <span>{{ formatRunElapsed(runElapsed) }}</span>
          </div>
          <div v-if="(sending || error) && visibleRunSteps.length" class="memory-run-steps">
            <div v-for="step in visibleRunSteps" :key="step.id" :class="step.state">
              <JcIcon :name="step.state === 'done' ? 'check_circle' : step.state === 'failed' ? 'error' : 'sync'" :class="{ spinning: step.state === 'running' }" />
              <span>{{ step.label }}</span>
            </div>
          </div>
          <small v-if="error">{{ error }}</small>
        </div>
        <ToolApprovalStrip
          v-if="pendingMemoryToolApproval"
          :message="pendingMemoryToolApproval.message"
          @reject="settleMemoryToolApproval('reject')"
          @once="settleMemoryToolApproval('once')"
          @always="settleMemoryToolApproval('always')"
        />
        <div v-else-if="!runVisible && (status || error)" class="memory-status" :class="{ error: Boolean(error) }">{{ error || status }}</div>
        <div class="memory-input-row">
          <div v-show="mentionOpen && !sending" ref="mentionPopoverRef" class="memory-mention-popover" @mousedown.prevent>
            <div v-if="!mentionFlat.length" class="memory-mention-empty">没有匹配项</div>
            <button
              v-for="item in mentionFlat.slice(0, 12)"
              :key="mentionKey(item)"
              type="button"
              :class="{ active: mentionActive === mentionKey(item) }"
              @click="selectMention(item)"
              @pointermove="setMentionActive(mentionKey(item))"
            >
              <JcIcon :name="item.type === 'skill' ? 'psychology' : item.resource.kind === 'media' ? 'image' : 'description'" />
              <span class="memory-mention-name">{{ item.display }}</span>
              <span class="memory-mention-kind">{{ item.type === 'skill' ? 'Skill' : item.description }}</span>
            </button>
          </div>
          <input ref="fileInput" type="file" multiple hidden :disabled="sending" @change="selectFiles" />
          <button class="icon-button mobile-only memory-mobile-creation" title="打开创作面板" @click="creationOpen ? closeCreationHost() : openCreationForCurrentConversation()"><JcIcon name="palette" /></button>
          <button class="icon-button" title="添加附件" :disabled="sending" @click="fileInput?.click()"><JcIcon name="attach-file" /></button>
          <div
            ref="composerRef"
            class="memory-composer-editable"
            :contenteditable="!sending"
            data-placeholder="输入消息"
            @input="handleComposerInput"
            @keydown="handleComposerKeydown"
            @paste="handleComposerPaste"
          />
          <button v-if="sending" class="send-button" title="停止" @click="stop"><JcIcon name="stop" /></button>
          <button v-else class="send-button" title="发送" :disabled="!input.trim() && !attachments.length && !referencedFiles.length && !selectedSkillNames.length" @click="send"><JcIcon name="arrow-upward" /></button>
        </div>
      </footer>

      <section v-if="previewResource" class="memory-preview">
        <header class="memory-preview-header">
          <button class="memory-preview-back" @click="returnFromPreview"><JcIcon name="arrow-back" /><span>{{ projectMapReturn ? '返回项目地图' : '返回对话' }}</span></button>
          <strong>{{ previewResource.resource.name }}</strong>
          <div class="memory-preview-actions">
            <template v-if="previewResource.type === 'editor' && !editingMarkdown">
              <button class="icon-button" title="编辑 Markdown" @click="startMarkdownEdit"><JcIcon name="edit" /></button>
            </template>
            <template v-else-if="previewResource.type === 'editor'">
              <button class="icon-button" title="取消编辑" @click="cancelMarkdownEdit"><JcIcon name="close" /></button>
              <button class="icon-button" title="保存 Markdown" :disabled="markdownSavePending" @click="saveMarkdownEdit"><JcIcon name="save" /></button>
            </template>
            <button class="icon-button" title="关闭预览" @click="closePreview"><JcIcon name="close" /></button>
          </div>
        </header>
        <div v-if="previewResource.type === 'scene3d'" class="memory-scene-workspace">
          <Scene3DEditor
            :document="previewResource.document"
            @save="saveScene3D"
            @screenshot="saveSceneScreenshot"
            @video="saveSceneVideo"
          />
          <form v-if="desktopOnlyRuntime" class="memory-scene-composer" @submit.prevent="sendSceneInstruction">
            <input v-model="sceneInstruction" data-placeholder="直接说怎么修改当前场景" placeholder="直接说怎么修改当前场景" :disabled="sceneInstructionSending || sending" />
            <button type="submit" title="发送场景修改" :disabled="!sceneInstruction.trim() || sceneInstructionSending || sending"><JcIcon name="arrow-upward" /></button>
          </form>
        </div>
        <ProjectMapViewer
          v-else-if="previewResource.type === 'project-map'"
          :document="previewResource.document"
          :viewport="projectMapViewport"
          @open="openProjectMapPath"
          @save="saveProjectMap"
        />
        <div v-else-if="previewResource.type === 'editor'" class="memory-document">
          <MemoryMarkdown v-if="!editingMarkdown"
            class="memory-markdown markdown-body"
            :data-wiki-source="previewResource.resource.path"
            :content="previewResource.text.content"
            :render-id="previewResource.resource.path"
            :outline="/\.md$/i.test(previewResource.resource.path)"
            @click="handleMarkdownClick"
          />
          <div v-else class="memory-markdown-editor">
            <pre ref="markdownHighlightRef" aria-hidden="true" v-html="highlightCode(markdownDraft, 'markdown')"></pre>
            <textarea
              ref="markdownEditorRef"
              v-model="markdownDraft"
              spellcheck="false"
              aria-label="Markdown 原文编辑器"
              @scroll="syncMarkdownEditorScroll"
            ></textarea>
          </div>
          <p v-if="markdownSaveError" class="memory-editor-error">{{ markdownSaveError }}</p>
          <section v-if="backlinks.length" class="memory-backlinks">
            <h2>被以下文件引用</h2>
            <button v-for="source in backlinks" :key="source.path" type="button" @click="openWikiResource(source)">{{ source.path }}</button>
          </section>
        </div>
        <div v-else-if="previewResource.type === 'media'" class="memory-media">
          <img v-if="previewResource.mediaKind === 'image' && mediaUrl" :src="mediaUrl" :alt="previewResource.resource.name" />
          <video v-else-if="previewResource.mediaKind === 'video' && mediaUrl" :src="mediaUrl" controls />
          <audio v-else-if="previewResource.mediaKind === 'audio' && mediaUrl" :src="mediaUrl" controls />
          <Model3DViewer v-else-if="previewResource.mediaKind === 'model3d' && modelData" :data="modelData" />
          <p v-else>该媒体文件暂时无法在浏览器中预览。</p>
        </div>
        <div v-else class="memory-empty-state">该文件不支持直接预览，请从文件树菜单导出。</div>
      </section>
    </main>

    <aside v-if="creationMounted" class="memory-creation">
      <div
        v-if="!creationFocused"
        class="memory-creation-resizer"
        title="拖动调整创作面板宽度"
        @pointerdown.prevent="startCreationResize"
      />
      <CreationPanel ref="creationPanelRef" @preview-resource="previewProjectResource">
        <template #toolbar-actions>
          <button
            class="memory-creation-action"
            :title="creationFocused ? '退出专注创作' : '专注创作'"
            @click="creationFocused = !creationFocused"
          ><JcIcon name="fit-screen" /></button>
          <button
            class="memory-creation-action"
            title="收起创作面板"
            @click="closeCreationHost"
          ><JcIcon name="close" /></button>
        </template>
      </CreationPanel>
    </aside>

    <div v-if="settingsOpen" class="memory-settings-backdrop" @click="settingsOpen = false"></div>
    <aside class="memory-settings-drawer" :class="{ open: settingsOpen }">
      <header><strong>设置</strong><button class="icon-button" title="关闭" @click="settingsOpen = false"><JcIcon name="close" /></button></header>
      <MemorySettings
        :owner="projectOwner"
        :project-name="projectStore.projectName.value"
        @synced="refreshProjectView()"
      />
    </aside>
    <div v-if="recordingScene" class="memory-scene-recorder" aria-hidden="true">
      <Scene3DEditor ref="recordingSceneEditor" :document="recordingScene" recording-only />
    </div>
  </div>
</template>

<style scoped>
.memory-workbench { --memory-header-height: 52px; display: grid; grid-template-columns: 280px minmax(0, 1fr); width: 100vw; height: 100dvh; overflow: hidden; background: var(--paper); color: var(--ink1); font-size: var(--font-base); }
.memory-workbench.desktop-runtime { padding-top: 28px; box-sizing: border-box; }
.memory-scene-recorder { position: fixed; top: 0; left: -10000px; width: 640px; height: 640px; pointer-events: none; }
.memory-workbench.tree-closed { grid-template-columns: 0 minmax(0, 1fr); }
.memory-workbench.creation-open { grid-template-columns: 280px minmax(420px, 1fr) var(--memory-creation-width); }
.memory-workbench.creation-open.tree-closed { grid-template-columns: 0 minmax(420px, 1fr) var(--memory-creation-width); }
.memory-workbench.creation-focused { display: block; padding-top: 0; }
.memory-workbench.desktop-runtime.creation-focused { padding-top: 28px; }
.memory-workbench.creation-focused .memory-tree, .memory-workbench.creation-focused .memory-main { display: none; }
.memory-tree { min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--line); background: var(--surface); }
.memory-workbench.tree-closed .memory-tree { overflow: hidden; border-right: 0; }
.memory-main { position: relative; display: grid; grid-template-rows: var(--memory-header-height) minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
.memory-topbar { display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--line); }
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
.memory-messages { min-height: 0; overflow-y: scroll; padding: 24px max(20px, calc((100% - 820px) / 2)); scrollbar-gutter: stable; scrollbar-width: auto; scrollbar-color: color-mix(in srgb, var(--olive) 62%, transparent) transparent; }
.memory-messages::-webkit-scrollbar { width: 18px; }
.memory-messages::-webkit-scrollbar-track { border-radius: 999px; background: transparent; }
.memory-messages::-webkit-scrollbar-thumb { min-height: 44px; border: 3px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--olive) 68%, transparent); background-clip: content-box; }
.memory-messages::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--olive-dark) 78%, transparent); background-clip: content-box; }
.memory-message-list { width: 100%; }
.memory-message { position: relative; margin-bottom: 24px; padding-right: 30px; content-visibility: auto; }
.memory-message.user { margin-left: min(18%, 130px); padding: 12px 42px 12px 14px; border-radius: 8px; background: var(--surface); }
.memory-role { display: block; margin-bottom: 6px; color: var(--ink3); font-size: calc(var(--font-base) - 3px); font-weight: 700; }
.memory-message-attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.memory-message-attachment { display: flex; width: min(220px, 100%); height: 48px; align-items: center; gap: 8px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-alt); overflow: hidden; color: var(--ink3); }
.memory-message-attachment.image { width: 64px; padding: 0; }
.memory-message-attachment img { width: 100%; height: 100%; object-fit: cover; }
.memory-message-attachment span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(var(--font-base) - 2px); }
.memory-message-text { overflow-wrap: anywhere; }
.memory-backlinks { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--line); }
.memory-backlinks h2 { margin: 0 0 8px; font-size: 14px; }
.memory-backlinks button { display: block; width: 100%; padding: 7px 0; border: 0; background: transparent; color: var(--olive); cursor: pointer; font: inherit; text-align: left; }
.memory-preview-actions { display: flex; align-items: center; gap: 4px; }
.memory-scene-workspace { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; }
.memory-scene-composer { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--paper); }
.memory-scene-composer input { min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; }
.memory-scene-composer button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 6px; background: var(--olive); color: white; cursor: pointer; }
.memory-scene-composer button:disabled { cursor: default; opacity: .45; }
.memory-editor-error { margin: 10px 0; color: var(--danger, #b33); font-size: 13px; }
.memory-message-copy { position: absolute; top: 0; right: 0; display: flex; width: 26px; height: 26px; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--ink2); }
.memory-message-copy:hover { background: var(--surface-alt); color: var(--ink); }
.memory-media-plan-link { display: flex; width: 100%; min-height: 38px; align-items: center; gap: 8px; margin-top: 8px; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--olive) 28%, var(--line)); border-radius: 6px; background: color-mix(in srgb, var(--olive) 6%, var(--paper)); color: var(--ink1); cursor: pointer; font: inherit; text-align: left; }
.memory-media-plan-link:hover { border-color: var(--olive); }
.memory-media-plan-link .mso { color: var(--olive); }
.memory-media-plan-link span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-media-plan-link small { flex: 0 0 auto; color: var(--ink3); }
.memory-scene-card { display: flex; width: 100%; min-height: 58px; align-items: center; gap: 10px; margin-top: 8px; padding: 8px 10px; border: 1px solid color-mix(in srgb, #4b9978 38%, var(--line)); border-radius: 6px; background: color-mix(in srgb, #4b9978 7%, var(--paper)); color: var(--ink1); cursor: pointer; font: inherit; text-align: left; }
.memory-scene-card:hover { border-color: #4b9978; }
.memory-scene-card > .mso { flex: 0 0 auto; color: #398362; font-size: 22px; }
.memory-scene-card span { min-width: 0; display: grid; flex: 1; gap: 2px; }
.memory-scene-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.memory-scene-card small { color: var(--ink3); font-size: 11px; }
.memory-scene-card em { flex: 0 0 auto; color: #398362; font-size: 12px; font-style: normal; }
.memory-message.streaming { opacity: .85; }
.memory-composer { width: min(860px, calc(100% - 28px)); margin: 0 auto 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 26px rgb(0 0 0 / 8%); }
.memory-composer-tools { position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 10px 0; }
.memory-mode-segment { display: flex; padding: 2px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-mode-segment button { height: 24px; padding: 0 9px; border: 0; border-radius: 4px; background: transparent; color: var(--ink3); cursor: pointer; font: inherit; font-size: 12px; }
.memory-mode-segment button.active { background: var(--olive); color: white; }
.memory-input-row { position: relative; display: flex; align-items: flex-end; gap: 8px; padding: 10px; }
.memory-mention-popover { position: absolute; z-index: 60; right: 10px; bottom: calc(100% + 7px); left: 10px; max-height: min(320px, 42vh); overflow-y: auto; padding: 5px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 12px 30px rgb(0 0 0 / 16%); }
.memory-mention-popover > button { display: grid; width: 100%; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 7px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--ink1); cursor: pointer; font: inherit; text-align: left; }
.memory-mention-popover > button:hover, .memory-mention-popover > button.active { background: color-mix(in srgb, var(--olive) 14%, transparent); }
.memory-mention-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-mention-kind, .memory-mention-empty { color: var(--ink3); font-size: 11px; }
.memory-mention-empty { padding: 9px; }
.memory-composer-editable { min-width: 0; min-height: 24px; max-height: min(220px, 30vh); flex: 1; overflow-y: hidden; overscroll-behavior: contain; scrollbar-width: thin; border: 0; outline: 0; background: transparent; color: var(--ink1); font: inherit; font-size: var(--font-base); line-height: 1.55; overflow-wrap: anywhere; }
.memory-composer-editable:empty::before { color: var(--ink3); content: attr(data-placeholder); pointer-events: none; }
.memory-composer-editable::-webkit-scrollbar { width: 12px; }
.memory-composer-editable::-webkit-scrollbar-track { background: transparent; }
.memory-composer-editable::-webkit-scrollbar-thumb { min-height: 36px; border: 2px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--olive) 68%, transparent); background-clip: content-box; }
.send-button { border-color: var(--olive); background: var(--olive); color: white; }
.send-button:disabled { opacity: .4; cursor: default; }
.memory-status { padding: 6px 12px 0; color: var(--ink3); font-size: calc(var(--font-base) - 2px); }
.memory-status.error { color: var(--danger); }
.memory-run-status { margin: 7px 10px 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink2); font-size: calc(var(--font-base) - 2px); }
.memory-run-head { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 6px; }
.memory-run-head strong { overflow-wrap: anywhere; color: var(--ink1); font-weight: 600; }
.memory-run-head > span { color: var(--ink3); font-variant-numeric: tabular-nums; }
.memory-run-status .mso { font-size: 15px; }
.memory-run-status .spinning { animation: memory-run-spin .9s linear infinite; }
.memory-run-steps { display: grid; gap: 4px; margin: 7px 0 0 24px; }
.memory-run-steps > div { display: grid; grid-template-columns: 17px minmax(0, 1fr); align-items: center; gap: 4px; color: var(--ink3); }
.memory-run-steps > div.running { color: var(--ink1); }
.memory-run-steps > div.failed, .memory-run-status.error, .memory-run-status.error strong { color: var(--danger); }
.memory-run-status small { display: block; margin: 6px 0 0 24px; overflow-wrap: anywhere; }
@keyframes memory-run-spin { to { transform: rotate(360deg); } }
.memory-attachments { display: flex; gap: 6px; flex-wrap: wrap; padding: 5px 10px 0; }
.memory-attachment-chip { display: flex; height: 34px; max-width: 240px; align-items: center; gap: 5px; padding: 0 7px; box-sizing: border-box; border-radius: 5px; background: var(--surface); color: var(--ink2); font-size: calc(var(--font-base) - 3px); }
.memory-attachment-chip img { width: 26px; height: 26px; flex: 0 0 26px; border-radius: 4px; object-fit: cover; }
.memory-attachment-copy { display: grid; min-width: 0; line-height: 1.2; }
.memory-attachment-copy small { overflow: hidden; color: var(--ink3); text-overflow: ellipsis; white-space: nowrap; }
.memory-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-attachment-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.memory-document { min-height: 0; height: 100%; overflow-y: scroll; overflow-x: auto; overscroll-behavior: contain; scrollbar-gutter: stable; box-sizing: border-box; padding: 28px max(24px, calc((100% - 900px) / 2)); }
.memory-document, .memory-model-menu { scrollbar-color: color-mix(in srgb, var(--ink3) 48%, transparent) transparent; scrollbar-width: thin; }
.memory-document::-webkit-scrollbar, .memory-model-menu::-webkit-scrollbar { width: 10px; }
.memory-document::-webkit-scrollbar-thumb, .memory-model-menu::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--ink3) 48%, transparent); background-clip: content-box; }
.memory-media { display: grid; min-height: 0; padding: 20px; place-items: center; overflow: auto; }
.memory-media img, .memory-media video { max-width: 100%; max-height: 100%; object-fit: contain; }
.memory-media audio { width: min(620px, 100%); }
.memory-preview { position: absolute; z-index: 20; inset: var(--memory-header-height) 0 0; display: grid; grid-template-rows: 48px minmax(0, 1fr); min-height: 0; background: var(--paper); }
.memory-creation { position: relative; min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid var(--line); background: var(--surface); }
.memory-creation-resizer { position: absolute; z-index: 30; top: 0; bottom: 0; left: 0; width: 14px; cursor: col-resize; touch-action: none; }
.memory-creation-resizer::after { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: transparent; content: ''; transition: background .12s, box-shadow .12s; }
.memory-creation-resizer:hover::after, .memory-workbench.creation-resizing .memory-creation-resizer::after { background: var(--olive); box-shadow: 0 0 0 2px color-mix(in srgb, var(--olive) 12%, transparent); }
.memory-workbench.creation-resizing > * { transition: none !important; }
.memory-creation-action { display: grid; width: 28px; height: 28px; flex: 0 0 28px; padding: 0; place-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink2); cursor: pointer; }
.memory-creation-action:hover { border-color: var(--olive); color: var(--olive-dark); }
.memory-workbench.creation-focused .memory-creation { width: 100vw; height: 100dvh; border-left: 0; }
.memory-workbench.desktop-runtime.creation-focused .memory-creation { height: calc(100dvh - 28px); }
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
  .memory-workbench, .memory-workbench.desktop-runtime { display: block; height: 100dvh; padding-top: env(safe-area-inset-top, 0); box-sizing: border-box; }
  .memory-main { height: 100%; }
  .memory-tree { position: fixed; z-index: 38; inset: 0; width: auto; transform: translateX(-100%); transition: transform .18s ease; }
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
  .memory-mobile-creation { display: grid; }
  .memory-settings-drawer { top: env(safe-area-inset-top, 0); right: 0; bottom: 0; left: 0; width: auto; border-left: 0; }
  .memory-creation { position: fixed; z-index: 45; inset: 0; width: 100vw; height: 100dvh; border-left: 0; }
}
</style>
