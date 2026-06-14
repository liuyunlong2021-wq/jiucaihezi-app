<script setup lang="ts">
/**
 * FileTreePanel — 文件面板（Col 2）
 * 5个tab：会话、文本、媒体、知识库、搭子
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { distillHistoryToWiki } from '@/utils/brain'
import { useSkillEvolution } from '@/composables/useSkillEvolution'
import { useAgentStore } from '@/stores/agentStore'
import type { SkillConfig } from '@/types/skill'
import { useSessionStore } from '@/stores/sessionStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useVaultCompiler } from '@/composables/useVaultCompiler'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { createStarterCanvasDocument } from '@/stores/canvasStore'
import { pinKnowledge } from '@/composables/useBrain'
import { parseSkillMd } from '@/types/skill'
import { processFile } from '@/composables/useFileUpload'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import { getAll } from '@/utils/idb'
import { buildVaultExportPackage, importVaultPackage, parseVaultImportPackage } from '@/utils/vaultPackage'
import { buildVaultHealthReport, inspectVaultHealth, type VaultHealthResult } from '@/utils/vaultHealth'
import { buildCandidateAcceptancePatch, buildCandidateIgnorePatch, isPendingWikiCandidate } from '@/utils/vaultCandidate'
import { saveGeneratedFile } from '@/utils/exportSave'
import { countFolderFiles } from '@/utils/fileTreeView'
import { fileEntryToDownloadBlob } from '@/utils/fileDownload'
import { visibleMediaFiles } from '@/utils/fileEntryFilters'
import { isMeaningfulExtractedText, normalizeMarkdownFilename } from '@/utils/vaultIngestion'
import {
  compareFileEntries,
  DEFAULT_FILE_SORT_MODE,
  FILE_SORT_OPTIONS,
  isFileSortMode,
  type FileSortMode,
} from '@/utils/fileSort'

const props = withDefaults(defineProps<{
  isMember?: boolean
}>(), {
  isMember: false,
})

const fileStore = useFileStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const vaultStore = useVaultStore()
const { compileRawToWiki } = useVaultCompiler()

type Tab = 'history' | 'text' | 'media' | 'canvas' | 'knowledge' | 'skill'
const activeTab = ref<Tab>('history')
const searchQuery = ref('')
const selectAll = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const contextMenu = ref({ show: false, x: 0, y: 0, file: null as FileEntry | null })
const vaultImportInput = ref<HTMLInputElement | null>(null)
const SORT_STORAGE_KEY = 'jc_file_sort_mode'
const savedSortMode = localStorage.getItem(SORT_STORAGE_KEY)
const sortMode = ref<FileSortMode>(isFileSortMode(savedSortMode) ? savedSortMode : DEFAULT_FILE_SORT_MODE)
const currentSort = computed(() =>
  FILE_SORT_OPTIONS.find(option => option.mode === sortMode.value) || FILE_SORT_OPTIONS[0]
)

const tabItems = computed(() => [
  { key: 'history', icon: 'chat', label: '会话' },
  ...(props.isMember ? [
    { key: 'text', icon: 'article', label: '文本' },
    { key: 'media', icon: 'perm_media', label: '媒体' },
    { key: 'canvas', icon: 'account_tree', label: '画布' },
    { key: 'knowledge', icon: 'psychology', label: '知识库' },
    { key: 'skill', icon: 'smart_toy', label: '搭子' },
  ] : []),
] as const)

function canUseFileTab(tab: Tab): boolean {
  return tab === 'history' || props.isMember
}

const isHistoryOnlyMode = computed(() => activeTab.value === 'history' && !props.isMember)

function requireMemberAction(): boolean {
  if (props.isMember) return true
  closeAllMenus()
  activeTab.value = 'history'
  currentFolder.value = null
  browsingVaultId.value = null
  showToast('请登录后使用此功能')
  return false
}

const knowledgeKindLabels: Record<string, string> = {
  raw: '原始',
  summary: '摘要',
  page: '知识页',
  entity: '实体',
  relation: '关系',
  asset: '素材',
}

function normalizeHistoryPreviewText(value: unknown): string {
  return String(value || '')
    .replace(/\[MEDIA_TASK:[^\]]+\]/g, '媒体生成任务')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildHistoryPreviewFromMessages(record: any): string {
  const items = Array.isArray(record?.items) ? record.items : []
  const picked = [...items]
    .reverse()
    .find((item: any) => item?.role === 'assistant' || item?.role === 'user')
  return normalizeHistoryPreviewText(picked?.content).slice(0, 120)
}

const items = ref<FileEntry[]>([])
const isRefreshing = ref(false)
let loadRequestId = 0

async function loadHistoryItems(): Promise<FileEntry[]> {
  const conversations = await getAll('conversations')
  const messageRecords = await getAll('messages')
  const messageCounts = new Map(
    messageRecords
      .filter((record: any) => record?.id)
      .map((record: any) => [String(record.id), Array.isArray(record.items) ? record.items.length : 0])
  )
  const messagePreviews = new Map(
    messageRecords
      .filter((record: any) => record?.id)
      .map((record: any) => [String(record.id), buildHistoryPreviewFromMessages(record)])
  )

  return conversations
    .filter((conversation: any) => conversation?.id)
    .map((conversation: any) => {
      const id = String(conversation.id)
      const title = String(conversation.title || '历史会话')
      const updatedAt = Number(conversation.updatedAt || conversation.createdAt || Date.now())
      const vaultId = conversation.vaultId || undefined
      const messageCount = messageCounts.get(id) || 0
      const preview = normalizeHistoryPreviewText(conversation.preview || messagePreviews.get(id))
      return {
        id: `history_ref_${id}`,
        category: 'history',
        name: title,
        content: preview,
        mimeType: 'application/x-jiucaihezi-session',
        size: 0,
        createdAt: Number(conversation.createdAt || updatedAt),
        updatedAt,
        vaultId,
        kind: 'raw',
        sourceSessionId: id,
        metadata: {
          kind: 'session-history-ref',
          originalId: id,
          agentId: conversation.agentId || conversation.scopeKey || '',
          vaultId: vaultId || null,
          messageCount,
          messagePreview: preview,
        },
      } as FileEntry
    })
    .sort((a: FileEntry, b: FileEntry) => b.updatedAt - a.updatedAt)
}

// ─── 知识库 tab：vault 浏览状态 ───
const browsingVaultId = ref<string | null>(null)
type LastVaultHealthResult = {
  vaultId: string
  checkedAt: number
  stats: VaultHealthResult['stats']
  suggestions: string[]
  reportName: string
}
const lastVaultHealthResult = ref<LastVaultHealthResult | null>(null)

const visibleVaultHealthResult = computed(() => {
  if (activeTab.value !== 'knowledge' || !browsingVaultId.value) return null
  return lastVaultHealthResult.value?.vaultId === browsingVaultId.value
    ? lastVaultHealthResult.value
    : null
})

const healthMetricItems = computed(() => {
  const result = visibleVaultHealthResult.value
  if (!result) return []
  return [
    { label: '未整理资料', value: result.stats.unprocessedRaw, tone: result.stats.unprocessedRaw > 0 ? 'warning' : 'ok' },
    { label: '缺失引用', value: result.stats.missingSourceRefs, tone: result.stats.missingSourceRefs > 0 ? 'warning' : 'ok' },
    { label: '断链', value: result.stats.brokenLinks, tone: result.stats.brokenLinks > 0 ? 'warning' : 'ok' },
    { label: '孤立页面', value: result.stats.orphanPages, tone: result.stats.orphanPages > 0 ? 'warning' : 'ok' },
    { label: '冲突内容', value: result.stats.conflicts, tone: result.stats.conflicts > 0 ? 'warning' : 'ok' },
  ]
})

function enterVault(vaultId: string) {
  browsingVaultId.value = vaultId
  vaultStore.setActiveVault(vaultId)
  currentFolder.value = null
  loadTab()
}

function exitVaultBrowse() {
  browsingVaultId.value = null
  currentFolder.value = null
  items.value = []
}

// ─── 旧数据迁移（一次性） ───
const MIGRATION_FLAG = 'jc_vault_folder_migration_v1'

async function migrateOldKnowledgeEntries() {
  if (localStorage.getItem(MIGRATION_FLAG)) return
  try {
    const allKnowledge = await fileStore.loadByCategory('knowledge')
    // 找到没有 folderId 且不是 folder 类型的旧条目
    const orphans = allKnowledge.filter(f =>
      f.mimeType !== 'folder' &&
      !f.folderId &&
      !f.metadata?.isConfig &&
      !f.metadata?.vaultFolder
    )
    if (orphans.length === 0) {
      localStorage.setItem(MIGRATION_FLAG, '1')
      return
    }

    // 按 vaultId 分组
    const byVault = new Map<string, FileEntry[]>()
    const noVault: FileEntry[] = []
    for (const entry of orphans) {
      if (entry.vaultId) {
        const list = byVault.get(entry.vaultId) || []
        list.push(entry)
        byVault.set(entry.vaultId, list)
      } else {
        noVault.push(entry)
      }
    }

    // 有 vaultId 的：移入对应 vault 的 raw/ 文件夹
    for (const [vaultId, entries] of byVault) {
      const rawFolder = await fileStore.findVaultRootFolder(vaultId, 'raw')
      if (rawFolder) {
        for (const entry of entries) {
          await fileStore.updateFile(entry.id, {
            folderId: rawFolder.id,
            metadata: { ...(entry.metadata || {}), vaultFolder: 'raw', migrated: true },
          })
        }
      }
    }

    // 没有 vaultId 的：创建"未分类旧资料"vault 并移入
    if (noVault.length > 0) {
      let legacyVault = vaultStore.vaults.find(v => v.template === '_legacy_uncategorized')
      if (!legacyVault) {
        legacyVault = await vaultStore.createVault('未分类旧资料', 'general', {
          description: '从旧版本迁移的知识条目',
          oneLineDesc: '旧版本遗留的知识条目，请手动归类',
          template: '_legacy_uncategorized',
          rawFolders: ['对话记录', '旧资料'],
          wikiFolders: [],
        })
        // 等待骨架生成
        await new Promise(r => setTimeout(r, 500))
      }
      const rawFolder = await fileStore.findVaultRootFolder(legacyVault.id, 'raw')
      if (rawFolder) {
        // 在 raw/ 下找或建一个 "旧资料" 子文件夹
        let legacyFolder = await fileStore.findChildFolder(rawFolder.id, '旧资料', legacyVault.id)
        if (!legacyFolder) {
          legacyFolder = await fileStore.createFolder('旧资料', rawFolder.id, legacyVault.id)
        }
        for (const entry of noVault) {
          await fileStore.updateFile(entry.id, {
            vaultId: legacyVault.id,
            folderId: legacyFolder.id,
            metadata: { ...(entry.metadata || {}), vaultFolder: 'raw', migrated: true },
          })
        }
      }
    }

    localStorage.setItem(MIGRATION_FLAG, '1')
  } catch {
    // 迁移失败不阻塞
  }
}

function cycleSortMode() {
  const index = FILE_SORT_OPTIONS.findIndex(option => option.mode === sortMode.value)
  const next = FILE_SORT_OPTIONS[(index + 1) % FILE_SORT_OPTIONS.length]
  sortMode.value = next.mode
  localStorage.setItem(SORT_STORAGE_KEY, next.mode)
}

async function loadTab() {
  const requestId = ++loadRequestId
  const tab = activeTab.value
  const vaultId = vaultStore.activeVaultId
  const browsingId = browsingVaultId.value
  selectAll.value = false
  selectedIds.value.clear()
  let nextItems: FileEntry[] = []

  if (tab === 'media') {
    const images = await fileStore.loadByCategory('image')
    const videos = await fileStore.loadByCategory('video')
    nextItems = visibleMediaFiles([...images, ...videos])
  } else if (tab === 'history') {
    nextItems = await loadHistoryItems()
  } else if (tab === 'skill') {
    nextItems = await fileStore.loadByCategory('skill')
    // 严格过滤：只保留真正的搭子条目（有 skillId 或 kind 含 skill）
    nextItems = nextItems.filter(f => {
      const kind = String(f.metadata?.kind || '')
      return kind.includes('skill') || !!f.metadata?.skillId
    })
    if (nextItems.length === 0) {
      nextItems = agentStore.getMySkills().map((skill: any) => ({
        id: `skill_ref_${skill.id}`,
        category: 'skill',
        name: skill.name,
        content: skill.skillContent || '',
        mimeType: 'application/x-jiucaihezi-skill',
        size: 0,
        createdAt: skill.createdAt || Date.now(),
        updatedAt: skill.updatedAt || skill.createdAt || Date.now(),
        metadata: {
          kind: 'skill-ref',
          skillId: skill.id,
        },
      } as FileEntry))
    }
  } else if (tab === 'knowledge') {
    // 知识库 tab：如果在某个 vault 内部浏览，加载该 vault 的文件
    // 否则不加载（顶层显示 vault 卡片列表）
    if (browsingId) {
      nextItems = await fileStore.loadByCategory('knowledge', browsingId)
    } else {
      nextItems = []
    }
  } else {
    nextItems = await fileStore.loadByCategory(tab as any)
  }

  if (requestId !== loadRequestId || tab !== activeTab.value) return
  items.value = nextItems
  if (currentFolder.value) {
    const latestFolder = items.value.find(f => f.id === currentFolder.value?.id)
    currentFolder.value = latestFolder || null
  }
}

async function refreshCurrentTab() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    if (activeTab.value === 'knowledge') await vaultStore.loadAll()
    await loadTab()
  } finally {
    isRefreshing.value = false
  }
}

async function showHistoryAndRefresh() {
  activeTab.value = 'history'
  searchQuery.value = ''
  currentFolder.value = null
  browsingVaultId.value = null
  await refreshCurrentTab()
}

onMounted(async () => {
  await vaultStore.loadAll()
  loadTab()
})

// ─── 编辑状态同步 ───
const activeEditingId = ref<string | null>(null)
const offEditorChanged = onEvent('editor-file-changed', (payload: any) => {
  activeEditingId.value = payload?.fileId || null
})
const offRefreshList = onEvent('refresh-file-list', () => {
  refreshCurrentTab()
})
const offShowHistoryList = onEvent('show-history-list', () => {
  showHistoryAndRefresh()
})
const offSwitchFileTreeTab = onEvent('switch-filetree-tab', (tab: unknown) => {
  if (tab === 'canvas' || tab === 'history' || tab === 'text' || tab === 'media' || tab === 'knowledge' || tab === 'skill') {
    switchTab(tab)
  }
})
onBeforeUnmount(() => {
  offEditorChanged()
  offRefreshList()
  offShowHistoryList()
  offSwitchFileTreeTab()
})

function switchTab(tab: Tab) {
  if (!canUseFileTab(tab)) {
    activeTab.value = 'history'
    currentFolder.value = null
    browsingVaultId.value = null
    loadTab()
    return
  }
  activeTab.value = tab
  currentFolder.value = null
  browsingVaultId.value = null
  loadTab()
}

watch(() => props.isMember, (member) => {
  if (!member && activeTab.value !== 'history') switchTab('history')
})

// 消息搜索结果缓存（会话内搜索）
const messageSearchResults = ref<{
  sessionId: string
  sessionTitle: string
  messageIds: string[]
  snippets: string[]
  matchCount: number
  updatedAt: number
}[]>([])
let messageSearchTimer: ReturnType<typeof setTimeout> | null = null

// 搜索会话消息内容
async function doMessageSearch(query: string) {
  if (!query.trim() || activeTab.value !== 'history') {
    messageSearchResults.value = []
    return
  }
  try {
    messageSearchResults.value = await sessionStore.searchMessages(query)
  } catch {
    messageSearchResults.value = []
  }
}

watch(searchQuery, (q) => {
  if (activeTab.value !== 'history') return
  if (messageSearchTimer) clearTimeout(messageSearchTimer)
  messageSearchTimer = setTimeout(() => doMessageSearch(q), 300)
})

watch(activeTab, (tab) => {
  if (tab !== 'history' || !searchQuery.value.trim()) {
    messageSearchResults.value = []
  }
})

// 搭子仓库中的「添加到我的搭子/移出」会触发 refreshSkills → _skillsVersion
// FileTree 的 skill tab 需要响应式刷新
watch(() => agentStore.agents, () => {
  if (activeTab.value === 'skill') loadTab()
})

const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase()
  // 会话内搜索：当在历史 tab 搜索时，将消息搜索结果显示在顶部
  const msgResults = activeTab.value === 'history' ? messageSearchResults.value : []
  const extraItems: FileEntry[] = msgResults.map(r => ({
    id: `msgsearch_${r.sessionId}`,
    category: 'history' as const,
    name: `🔍 ${r.sessionTitle}（${r.matchCount} 条匹配）`,
    content: r.snippets.join('\n'),
    mimeType: 'application/x-jiucaihezi-session',
    size: 0,
    createdAt: r.updatedAt,
    updatedAt: r.updatedAt,
    sourceSessionId: r.sessionId,
    metadata: {
      kind: 'message-search-result',
      originalId: r.sessionId,
      messageIds: r.messageIds,
      snippets: r.snippets,
      matchCount: r.matchCount,
    },
  } as FileEntry))

  const filtered = q
    ? [...extraItems, ...items.value.filter(f => f.name.toLowerCase().includes(q))]
    : [...extraItems, ...items.value]
  return [...filtered].sort((a, b) => compareFileEntries(a, b, sortMode.value))
})

function toggleSelectAll() {
  selectAll.value = !selectAll.value
  if (selectAll.value) {
    selectedIds.value = new Set(displayFiles.value.map(f => f.id))
  } else {
    selectedIds.value.clear()
  }
}

function toggleItem(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

async function deleteSelected() {
  if (!requireMemberAction()) return
  if (selectedIds.value.size === 0) return
  if (!confirm(`确定删除 ${selectedIds.value.size} 个文件？`)) return
  for (const id of selectedIds.value) {
    await deleteFileAndDetach(id)
  }
  selectedIds.value.clear()
  selectAll.value = false
  await loadTab()
}

async function handleUpload(e: Event) {
  if (!requireMemberAction()) {
    const input = e.target as HTMLInputElement
    if (input) input.value = ''
    return
  }
  const input = e.target as HTMLInputElement
  if (!input.files) return
  for (const file of Array.from(input.files)) {
    try {
      const result = await processFile(file, { preferRemoteImage: true })
      if (activeTab.value === 'text') {
        // Office/PDF 文件：提取文本内容存储
        const content = result.textContent || await file.text()
        await fileStore.addText(file.name, content)
      } else if (activeTab.value === 'media') {
        const cat = file.type.startsWith('video/') ? 'video' : 'image'
        const content = result.remoteUrl || result.previewUrl || ''
        await fileStore.addMedia(file.name, content, cat, file.type)
      }
      await loadTab()
    } catch {
      // 回退到原始 FileReader
      const reader = new FileReader()
      reader.onload = async () => {
        const content = reader.result as string
        if (activeTab.value === 'text') await fileStore.addText(file.name, content)
        else if (activeTab.value === 'media') {
          const cat = file.type.startsWith('video/') ? 'video' : 'image'
          await fileStore.addMedia(file.name, content, cat, file.type)
        }
        await loadTab()
      }
      if (activeTab.value === 'media') reader.readAsDataURL(file)
      else reader.readAsText(file)
    }
  }
  input.value = ''
}

// ─── 空白处右键菜单 ───
const blankContextMenu = ref({ show: false, x: 0, y: 0 })
function openBlankContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (isHistoryOnlyMode.value) return
  // 只有点击空白处时才触发（排除点击具体 item）
  const target = e.target as HTMLElement
  if (target.closest('.fp-item') || target.closest('.fp-media-item') || target.closest('.fp-toolbar') || target.closest('.fp-tabs')) return
  blankContextMenu.value = { show: true, x: e.clientX, y: e.clientY }
}
function closeBlankContextMenu() { blankContextMenu.value.show = false }

function triggerVaultImport() {
  if (!requireMemberAction()) return
  closeBlankContextMenu()
  if (vaultImportInput.value) vaultImportInput.value.value = ''
  vaultImportInput.value?.click()
}

async function handleVaultImportFile(e: Event) {
  if (!requireMemberAction()) {
    const input = e.target as HTMLInputElement
    if (input) input.value = ''
    return
  }
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const preview = parseVaultImportPackage(text)
    const previewFileCount = preview.documents.filter(doc => doc.mimeType !== 'folder').length
    const previewMessage = [
      `将导入 ${preview.vaults.length} 个知识库、${previewFileCount} 个知识文件。`,
      '导入后会自动进入第一个知识库并刷新列表。',
      '继续导入吗？',
    ].join('\n')
    if (!confirm(previewMessage)) {
      showToast('已取消导入')
      return
    }

    showToast('正在导入知识库...')
    const summary = await importVaultPackage(text)
    await vaultStore.loadAll()
    await sessionStore.loadAllSessions()
    await fileStore.syncVaultKnowledgeToDisk(vaultStore.vaults.filter(vault =>
      summary.importedVaultIds.includes(vault.id)
    ))

    const firstVaultId = summary.importedVaultIds[0]
    if (firstVaultId) {
      activeTab.value = 'knowledge'
      browsingVaultId.value = firstVaultId
      currentFolder.value = null
      vaultStore.setActiveVault(firstVaultId)
    }
    await loadTab()
    showToast(`导入完成：${summary.vaults} 个知识库，${previewFileCount} 个知识文件`)
  } catch (err: any) {
    showToast(`导入失败：${err?.message || '文件格式不正确'}`)
  } finally {
    input.value = ''
  }
}

// ─── 文件右键菜单 ───
function openContextMenu(e: MouseEvent, file: FileEntry) {
  e.preventDefault()
  e.stopPropagation()
  if (isHistoryOnlyMode.value) return
  closeBlankContextMenu()
  contextMenu.value = { show: true, x: e.clientX, y: e.clientY, file }
}
function closeContextMenu() { contextMenu.value.show = false }

// 点击外部关闭所有菜单
function closeAllMenus() {
  closeContextMenu()
  closeBlankContextMenu()
}

function openInEditor() {
  const f = contextMenu.value.file; closeContextMenu()
  if (!f) return
  if (activeTab.value === 'history' && !props.isMember) {
    showToast('请登录后使用此功能')
    return
  }
  emitEvent('open-in-editor', { name: f.name, content: f.content, fileId: f.id })
  emitEvent('switch-panel', 'editor')
}

// ─── 空白处新建操作 ───

async function startRename() {
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  const newName = prompt('重命名为：', f.name)
  if (newName && newName !== f.name) {
    if (activeTab.value === 'canvas') {
      await fileStore.updateFile(f.id, { name: newName.trim().endsWith('.jccanvas') ? newName.trim() : newName.trim() + '.jccanvas' })
      await loadTab()
      showToast('画布已重命名')
      return
    }
    if (activeTab.value === 'knowledge' && f.metadata?.isVaultRoot) {
      await vaultStore.updateVault(f.vaultId || f.id, { name: newName.trim() })
      await vaultStore.loadAll()
      await loadTab()
      return
    }
    await fileStore.updateFile(f.id, { name: newName })
    await loadTab()
  }
}

async function deleteContextFile() {
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  if (!confirm(`确定删除 ${f.name} 吗？`)) return

  if (activeTab.value === 'skill' && f.mimeType === 'folder' && f.metadata?.skillId) {
    await agentStore.moveToPreset(f.metadata.skillId as string)
  } else if (f.mimeType === 'folder') {
    await deleteFolderWithChildren(f)
  } else {
    await deleteFileAndDetach(f.id)
  }
  await loadTab()
}

async function createNewFolder() {
  const name = prompt('文件夹名称', '新文件夹')
  const cat = activeTab.value === 'media' ? 'image' : activeTab.value
  if (name) await fileStore.addFile({ category: cat as any, name, content: '', mimeType: 'folder', size: 0, metadata: { isFolder: true, children: [], virtualCategory: activeTab.value } })
  await loadTab()
  closeBlankContextMenu()
}

function createNewAgent() {
  const name = prompt('搭子名称', '新搭子')
  if (name) {
    const skill = { id: 'skill_' + Date.now().toString(36), name, description: '', oneLineDesc: '', triggers: [], skillContent: '', references: [], examples: [], version: 1, source: 'user' as const, createdAt: Date.now(), updatedAt: Date.now(), evolutionLog: [] }
    agentStore.createAgent(skill)
    agentStore.moveToMy(skill.id)
  }
  closeBlankContextMenu()
}

function createNewKnowledge() {
  const vaultId = vaultStore.activeVaultId
  if (!vaultId) {
    showToast('请先在对话顶部绑定知识库')
    closeBlankContextMenu()
    return
  }
  const name = prompt('知识主题', '新知识点')
  if (name) {
    fileStore.addKnowledge({
      name,
      content: `# ${name}\n\n`,
      topic: vaultStore.activeVault?.name || '项目知识库',
      vaultId,
      kind: 'page',
      indexed: false,
      metadata: {
        vaultFolder: 'wiki',
        kind: 'user-draft',
        status: 'draft',
      },
    }).then(f => {
      emitEvent('open-in-editor', { name: f.name, content: f.content, fileId: f.id })
      emitEvent('switch-panel', 'editor')
    })
  }
  closeBlankContextMenu()
}

function emptyText() {
  if (activeTab.value === 'history') return '暂无会话记录'
  if (activeTab.value === 'knowledge') {
    return browsingVaultId.value ? '当前知识库为空' : '还没有知识库'
  }
  if (activeTab.value === 'skill') return '还没有搭子'
  if (activeTab.value === 'canvas') return '暂无画布文件'
  return '暂无文本文件'
}

function fileKindLabel(file: FileEntry): string {
  if (activeTab.value === 'history') return ''
  if (activeTab.value !== 'knowledge') return ''
  const legacyBucket = String(file.metadata?.migrationBucket || '')
  if (legacyBucket === 'global-legacy') return '全局旧资料'
  if (legacyBucket === 'skill-legacy') return '搭子旧资料'
  if (legacyBucket === 'uncategorized-legacy') return '未分类旧资料'
  if (legacyBucket === 'session-vault') return '已迁移'
  if (file.metadata?.kind === 'vault-hot-cache') return '热记忆'
  if (file.metadata?.kind === 'vault-index') return '索引'
  if (file.metadata?.kind === 'vault-lint-report') return '体检'
  if (isPendingWikiCandidate(file)) return '待审核'
  return file.kind ? knowledgeKindLabels[file.kind] || file.kind : ''
}

function historySubtext(file: FileEntry): string {
  const preview = normalizeHistoryPreviewText(file.metadata?.messagePreview || file.content)
  if (preview) return preview
  const count = Number(file.metadata?.messageCount || 0)
  return count > 0 ? `${count} 条消息` : '暂无消息内容'
}

// ─── 新建文本文档 ───
async function createNewCanvas() {
  if (!requireMemberAction()) return
  closeBlankContextMenu()
  const title = `新画布_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`.replace(/:/g, '-')
  const doc = createStarterCanvasDocument(title, `canvas_${Date.now().toString(36)}`)
  const file = await fileStore.addCanvas(title, JSON.stringify(doc, null, 2))
  activeTab.value = 'canvas'
  currentFolder.value = null
  browsingVaultId.value = null
  searchQuery.value = ''
  emitEvent('switch-workspace-mode', 'canvas')
  emitEvent('open-canvas-document', { fileId: file.id, name: file.name, content: file.content })
  await loadTab()
  showToast(`已新建并打开画布：${title}`)
}

async function createNewDoc() {
  if (!requireMemberAction()) return
  const name = `新文档_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  try {
    const file = await fileStore.addText(name, '')
    await loadTab()
    emitEvent('open-in-editor', { name: file.name, content: '', fileId: file.id })
    emitEvent('switch-panel', 'editor')
    showToast(`已创建：${name}`)
  } catch (e: any) {
    showToast(`创建失败: ${e?.message || '未知错误'}`)
  }
}

function appendToEditor() {
  const f = contextMenu.value.file; closeContextMenu()
  if (f) {
    emitEvent('import-to-editor', { content: f.content, agentName: f.name })
    emitEvent('switch-panel', 'editor')
  }
}

// ─── 底部快捷操作 ───
async function pasteFromClipboard() {
  if (!requireMemberAction()) return
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) { showToast('剪贴板为空'); return }
    const name = `粘贴_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    const file = await fileStore.addText(name, text)
    await loadTab()
    emitEvent('open-in-editor', { name: file.name, content: text, fileId: file.id })
    emitEvent('switch-panel', 'editor')
    showToast(`已粘贴创建：${name}`)
  } catch { showToast('无法读取剪贴板，请尝试右键粘贴') }
}

async function exportAllTexts() {
  if (!requireMemberAction()) return
  try {
    const files = await fileStore.loadByCategory('text')
    if (files.length === 0) { showToast('没有文本文件可导出'); return }
    const combined = files.map(f => `# ${f.name}\n\n${f.content}`).join('\n\n---\n\n')
    const blob = new Blob([combined], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `全部文本_${new Date().toLocaleDateString('zh-CN')}.md`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`已导出 ${files.length} 个文件`)
  } catch (e: any) {
    showToast(`导出失败: ${e?.message || '未知错误'}`)
  }
}
// ─── 合并所选（合并为文件夹） ───
async function mergeSelected() {
  if (!requireMemberAction()) return
  if (selectedIds.value.size < 2) return
  if (activeTab.value === 'knowledge' || activeTab.value === 'skill') return
  const folderName = prompt('文件夹名称', '新文件夹')
  if (!folderName) return
  const selected = displayFiles.value.filter(f => selectedIds.value.has(f.id))
  const category = activeTab.value === 'media'
    ? ((selected[0]?.category === 'video') ? 'video' : 'image')
    : activeTab.value as FileEntry['category']
  // 创建文件夹记录
  const folder = await fileStore.addFile({
    category,
    name: folderName,
    content: '',
    mimeType: 'folder',
    size: 0,
    metadata: { isFolder: true, children: Array.from(selectedIds.value), virtualCategory: activeTab.value },
  })
  // 将选中文件标记为属于该文件夹
  for (const id of selectedIds.value) {
    await fileStore.updateFile(id, { folderId: folder.id })
  }
  selectedIds.value.clear()
  selectAll.value = false
  await loadTab()
}

// ─── 搭子tab上传文件夹（解析 skill.md） ───
async function handleSkillUpload(e: Event) {
  if (!requireMemberAction()) {
    const input = e.target as HTMLInputElement
    if (input) input.value = ''
    return
  }
  const input = e.target as HTMLInputElement
  if (!input.files) return

  let foundSkill = false
  const files = Array.from(input.files)

  // 查找 skill.md 或 SKILL.md
  for (const file of files) {
    if (/skill\.md$/i.test(file.name)) {
      const text = await file.text()
      const parsed = parseSkillMd(text)

      if (parsed.name || parsed.skillContent) {
        const skill = {
          id: 'upload_' + Date.now().toString(36),
          name: parsed.name || '导入搭子',
          description: parsed.description || '',
          oneLineDesc: parsed.description || '',
          triggers: parsed.triggers || [],
          skillContent: parsed.skillContent || text,
          references: [],
          examples: [],
          version: 1,
          source: 'user' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          evolutionLog: [],
        }
        agentStore.createAgent(skill)
        agentStore.moveToMy(skill.id)
        foundSkill = true
      }
      break
    }
  }

  if (!foundSkill) {
    alert('未找到 SKILL.md 文件，无法导入搭子')
  } else {
    await loadTab()
  }
  input.value = ''
}

// ─── 搭子单文件上传 ───
async function handleSkillTextUpload(e: Event) {
  if (!requireMemberAction()) {
    const input = e.target as HTMLInputElement
    if (input) input.value = ''
    return
  }
  const input = e.target as HTMLInputElement
  if (!input.files?.[0]) return
  const file = input.files[0]
  const text = await file.text()
  if (!text.includes('name:') && !text.match(/^---/)) {
    alert('文件不是有效的 SKILL.md 格式'); return
  }
  const parsed = parseSkillMd(text)
  if (!parsed.name && !parsed.skillContent) { alert('无法解析 SKILL.md'); return }
  const skill = {
    id: 'upload_' + Date.now().toString(36),
    name: parsed.name || '导入搭子',
    description: parsed.description || '',
    oneLineDesc: parsed.description || '',
    triggers: parsed.triggers || [],
    skillContent: parsed.skillContent || text,
    references: [], examples: [], version: 1,
    source: 'user' as const, createdAt: Date.now(), updatedAt: Date.now(), evolutionLog: [],
  }
  agentStore.createAgent(skill)
  agentStore.moveToMy(skill.id)
  input.value = ''
}

// ─── 文件夹相关 ───
const currentFolder = ref<FileEntry | null>(null)

function openFolder(folder: FileEntry) {
  currentFolder.value = folder
}

function exitFolder() {
  currentFolder.value = null
}

async function createKnowledgeFolderFromBlank() {
  if (!requireMemberAction()) return
  closeBlankContextMenu()
  const vaultId = browsingVaultId.value || vaultStore.activeVaultId
  if (!vaultId) {
    showToast('请先进入一个知识库')
    return
  }
  const name = prompt('文件夹名称', '新资料')
  if (!name?.trim()) return

  let parent = currentFolder.value
  if (!parent) {
    parent = await fileStore.findVaultRootFolder(vaultId, 'raw') || null
  }
  if (!parent) {
    parent = await fileStore.addFile({
      category: 'knowledge',
      name: 'raw',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { vaultFolder: 'raw', isFolder: true },
    })
  }

  const vaultFolder = String(parent.metadata?.vaultFolder || 'raw')
  await fileStore.createFolder(name.trim(), parent.id, vaultId, {
    vaultFolder,
    isFolder: true,
    userCreated: true,
  })
  await loadTab()
  showToast(vaultFolder === 'raw' ? `已在 raw/ 下创建「${name.trim()}」` : `已创建「${name.trim()}」`)
}

function folderFileCount(folder: FileEntry) {
  return countFolderFiles(folder, items.value)
}

async function detachFromFolder(fileId: string) {
  const all = activeTab.value === 'media'
    ? visibleMediaFiles([...await fileStore.loadByCategory('image'), ...await fileStore.loadByCategory('video')])
    : await fileStore.loadByCategory(activeTab.value as any)
  const parents = all.filter(f => {
    const children = (f.metadata?.children as string[]) || []
    return f.mimeType === 'folder' && children.includes(fileId)
  })
  for (const parent of parents) {
    const children = ((parent.metadata?.children as string[]) || []).filter(id => id !== fileId)
    await fileStore.updateFile(parent.id, {
      metadata: { ...(parent.metadata || {}), children },
    })
  }
}

async function deleteFileAndDetach(fileId: string) {
  await detachFromFolder(fileId)
  await fileStore.deleteFile(fileId)
}

async function deleteFolderWithChildren(folder: FileEntry) {
  const all = await fileStore.loadByVault(folder.vaultId || vaultStore.activeVaultId || '')
  const children = all.filter(file => file.folderId === folder.id)
  const legacyChildren = (folder.metadata?.children as string[]) || []
  for (const child of children) {
    if (child.mimeType === 'folder') await deleteFolderWithChildren(child)
    else await fileStore.deleteFile(child.id)
  }
  for (const childId of legacyChildren) {
    if (!children.some(child => child.id === childId)) await fileStore.deleteFile(childId)
  }
  await fileStore.deleteFile(folder.id)
}

const displayItems = computed(() => {
  if (currentFolder.value) {
    const legacyChildren = new Set((currentFolder.value.metadata?.children as string[]) || [])
    return filteredItems.value.filter(f => f.folderId === currentFolder.value?.id || legacyChildren.has(f.id))
  }
  return filteredItems.value.filter(f => !f.folderId)
})

const folders = computed(() => {
  return displayItems.value.filter(f => f.mimeType === 'folder')
})

const displayFiles = computed(() => {
  return displayItems.value.filter(f => f.mimeType !== 'folder')
})


// ─── 核心联动逻辑 (V6 Evolution Workflow) ───
function showToast(msg: string) {
  // 简易 toast
  const div = document.createElement('div')
  div.style.position = 'fixed'
  div.style.top = '20px'
  div.style.left = '50%'
  div.style.transform = 'translateX(-50%)'
  div.style.background = 'rgba(0,0,0,0.8)'
  div.style.color = '#fff'
  div.style.padding = '8px 16px'
  div.style.borderRadius = '8px'
  div.style.zIndex = '100000'
  div.innerText = msg
  document.body.appendChild(div)
  setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity 0.3s'; setTimeout(() => div.remove(), 300) }, 2000)
}

async function distillHistory() {
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  if (!props.isMember) {
    showToast('请登录后使用此功能')
    return
  }
  showToast('长脑子提炼中...')
  try {
    const count = await distillHistoryToWiki(file, vaultStore.activeVaultId || undefined)
    showToast(count > 0 ? `提炼成功！生成了 ${count} 条结构化知识` : '提炼完成，但没有发现可复用知识')
    await loadTab()
  } catch (e: any) {
    showToast(`提炼失败: ${e.message}`)
  }
}

function collectDescendantFiles(root: FileEntry, allFiles: FileEntry[]): FileEntry[] {
  const files: FileEntry[] = []
  const stack = [root.id]
  while (stack.length) {
    const parentId = stack.pop()!
    for (const file of allFiles) {
      if (file.folderId !== parentId) continue
      if (file.mimeType === 'folder') {
        stack.push(file.id)
        continue
      }
      files.push(file)
    }
  }
  return files
}

function isSystemKnowledgeEntry(file: FileEntry): boolean {
  const folderPath = String(file.metadata?.folderPath || '')
  const kind = String(file.metadata?.kind || '')
  return (
    file.name === 'CLAUDE.md' ||
    folderPath.startsWith('wiki') ||
    folderPath.startsWith('_reports') ||
    folderPath.startsWith('_templates') ||
    kind.startsWith('vault-') ||
    kind === 'wiki-page' ||
    kind === 'vault-template'
  )
}

function safeRawTitle(name: string): string {
  return String(name || '资料')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || '资料'
}

async function ensureRawConvertedFolder(vaultId: string): Promise<FileEntry | null> {
  let folder = await fileStore.findFolderByPath(vaultId, 'raw/转换后的MD')
  if (folder) return folder
  let rawRoot = await fileStore.findVaultRootFolder(vaultId, 'raw')
  if (!rawRoot) {
    rawRoot = await fileStore.addFile({
      category: 'knowledge',
      name: 'raw',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { vaultFolder: 'raw', isFolder: true, folderPath: 'raw' },
    })
  }
  folder = await fileStore.createFolder('转换后的MD', rawRoot.id, vaultId, {
    vaultFolder: 'raw',
    folderPath: 'raw/转换后的MD',
  })
  return folder
}

async function normalizeFilesToRaw(vaultId: string, selected: FileEntry[]): Promise<string[]> {
  const convertedFolder = await ensureRawConvertedFolder(vaultId)
  if (!convertedFolder) return []

  const targetIds: string[] = []
  for (const file of selected) {
    if (
      file.category !== 'knowledge' ||
      file.mimeType === 'folder' ||
      isSystemKnowledgeEntry(file)
    ) continue

    if ((file.kind === 'raw' || !file.kind) && file.indexed === false) {
      targetIds.push(file.id)
      continue
    }

    if (!isMeaningfulExtractedText(file.content || '')) continue
    const content = String(file.content || '').trim()
    const name = /\.md$/i.test(file.name)
      ? safeRawTitle(file.name)
      : normalizeMarkdownFilename(safeRawTitle(file.name))
    await fileStore.updateFile(file.id, {
      name,
      folderId: convertedFolder.id,
      kind: 'raw',
      indexed: false,
      mimeType: 'text/markdown',
      size: new TextEncoder().encode(content).length,
      metadata: {
        ...(file.metadata || {}),
        vaultFolder: 'raw',
        kind: 'converted-markdown',
        folderPath: 'raw/转换后的MD',
        originalName: file.metadata?.originalName || file.name,
        organizedSource: true,
      },
    })
    targetIds.push(file.id)
  }
  return Array.from(new Set(targetIds))
}

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

async function ensureReportFolder(vaultId: string, reportName: string) {
  let reportsRoot = await fileStore.findFolderByPath(vaultId, '_reports')
  if (!reportsRoot) {
    reportsRoot = await fileStore.addFile({
      category: 'knowledge',
      name: '_reports',
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { isFolder: true, vaultFolder: 'reports', folderPath: '_reports' },
    })
  }

  let reportFolder = await fileStore.findFolderByPath(vaultId, `_reports/${reportName}`)
  if (!reportFolder) {
    reportFolder = await fileStore.createFolder(reportName, reportsRoot.id, vaultId, {
      vaultFolder: 'reports',
      folderPath: `_reports/${reportName}`,
    })
  }
  return reportFolder
}

async function runVaultHealthCheckMenu() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  const vaultId = file?.vaultId || vaultStore.activeVaultId
  if (!vaultId) {
    showToast('请先进入一个知识库')
    return
  }

  try {
    showToast('正在健康检查...')
    const allFiles = await fileStore.loadByVault(vaultId)
    const result = inspectVaultHealth(allFiles.filter(item => item.category === 'knowledge' && item.mimeType !== 'folder'))
    const vaultName = vaultStore.vaults.find(vault => vault.id === vaultId)?.name || file?.name || '知识库'
    const report = buildVaultHealthReport(vaultName, result)
    const folder = await ensureReportFolder(vaultId, '健康检查')
    const reportFile = await fileStore.addFile({
      category: 'knowledge',
      name: `健康检查_${timestampForFileName()}.md`,
      content: report,
      mimeType: 'text/markdown',
      size: new TextEncoder().encode(report).length,
      vaultId,
      folderId: folder.id,
      kind: 'summary',
      indexed: true,
      metadata: {
        vaultFolder: 'reports',
        folderPath: '_reports/健康检查',
        kind: 'vault-health-report',
        stats: result.stats,
      },
    })
    lastVaultHealthResult.value = {
      vaultId,
      checkedAt: Date.now(),
      stats: result.stats,
      suggestions: result.suggestions,
      reportName: reportFile.name,
    }
    await loadTab()
    showToast(`健康检查完成：未整理 ${result.stats.unprocessedRaw}，断链 ${result.stats.brokenLinks}，缺引用 ${result.stats.missingSourceRefs}`)
  } catch (err: any) {
    showToast(`健康检查失败：${err?.message || '请稍后重试'}`)
  }
}

async function exportVaultMenu() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  const vaultId = file?.vaultId || vaultStore.activeVaultId
  if (!vaultId) {
    showToast('请先进入一个知识库')
    return
  }

  const vault = vaultStore.vaults.find(item => item.id === vaultId)
  if (!vault) {
    showToast('没有找到这个知识库')
    return
  }

  try {
    showToast('正在导出知识库...')
    const allFiles = await fileStore.loadByVault(vaultId)
    const pkg = buildVaultExportPackage({ vault, documents: allFiles })
    const text = JSON.stringify(pkg)
    const result = await saveGeneratedFile({
      filename: `${vault.name}_${new Date().toLocaleDateString('zh-CN')}.jcvault`,
      mimeType: 'application/json;charset=utf-8',
      data: text,
    })
    if (result.status === 'cancelled') showToast('已取消导出')
    else showToast('知识库已导出')
  } catch (err: any) {
    showToast(`导出失败：${err?.message || '请稍后重试'}`)
  }
}

async function organizeKnowledgeMenu() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  const vaultId = file.vaultId || vaultStore.activeVaultId
  if (!vaultId) {
    showToast('请先进入一个知识库')
    return
  }

  try {
    showToast('正在整理知识库...')
    const allFiles = await fileStore.loadByVault(vaultId)
    const targetFiles = file.metadata?.isVaultRoot
      ? allFiles.filter(item =>
          item.category === 'knowledge' &&
          item.mimeType !== 'folder' &&
          (item.kind === 'raw' || !item.kind) &&
          item.indexed === false
        )
      : file.mimeType === 'folder'
        ? collectDescendantFiles(file, allFiles)
        : [file]
    const targetRawIds = file.metadata?.isVaultRoot
      ? targetFiles.map(item => item.id)
      : await normalizeFilesToRaw(vaultId, targetFiles)
    if (!file.metadata?.isVaultRoot && targetRawIds.length === 0) {
      showToast('没有找到可整理的有效资料')
      return
    }
    const result = await compileRawToWiki(vaultId, targetRawIds?.length ? { targetRawIds } : undefined)
    await loadTab()
    showToast(`整理完成：读取 ${result.rawCount} 条原始资料，新增 ${result.created}，更新 ${result.updated}`)
  } catch (err: any) {
    showToast(`整理失败：${err?.message || '请稍后重试'}`)
  }
}

async function acceptWikiCandidateMenu() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file || !isPendingWikiCandidate(file)) return
  await fileStore.updateFile(file.id, buildCandidateAcceptancePatch(file))
  await loadTab()
  showToast('已接受为 Wiki 知识')
}

async function ignoreWikiCandidateMenu() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file || !isPendingWikiCandidate(file)) return
  await fileStore.updateFile(file.id, buildCandidateIgnorePatch(file))
  await loadTab()
  showToast('已忽略候选')
}

async function evolveAgentMenu() {
  if (!requireMemberAction()) return
  const folder = contextMenu.value.file
  closeAllMenus()
  if (!folder?.metadata?.skillId) {
    showToast('未找到关联搭子')
    return
  }
  const skillId = folder.metadata.skillId as string
  if (agentStore.isBuiltinSkill(skillId)) {
    showToast('内置搭子不支持进化')
    return
  }
  // 通过事件通知 WorkspaceLayout 打开 EvolutionDiff
  emitEvent('open-evolution-diff', skillId)
}


function sendAsReference() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  emitEvent('switch-panel', 'creation')
  // 发送事件给创作面板作为参考图输入
  emitEvent('import-to-creation', { url: file.content, type: file.mimeType.startsWith('video') ? 'video' : 'image', name: file.name })
  showToast('已添加到参考图')
}

function sendToGallery() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  emitEvent('switch-panel', 'creation')
  // 发送事件给创作面板
  emitEvent('send-to-gallery', { url: file.content, type: file.mimeType.startsWith('video') ? 'video' : 'image', name: file.name })
  showToast('已发送到创作画廊')
}

function sendToChat() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  emitEvent('send-to-chat', { url: file.content, type: file.mimeType.startsWith('video') ? 'video' : 'image', name: file.name })
  showToast('已发送到对话区')
}

// ─── 知识库右键：反哺搭子 + 钉到对话 ───

function feedKnowledgeToAgent() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  // 通过事件通知 BrainPanel 用这条知识反哺当前搭子
  emitEvent('reference-file', { name: file.name, content: file.content })
  showToast(`已将「${file.name}」作为参考挂载到对话`)
}

function pinKnowledgeToChat() {
  if (!requireMemberAction()) return
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  const vaultId = file.vaultId || vaultStore.activeVaultId
  if (!vaultId) {
    showToast('请先在对话顶部绑定知识库')
    return
  }
  pinKnowledge(file.name, file.content, vaultId)
  showToast(`已钉选「${file.name}」，仅在当前知识库内生效`)
}


// ─── B1: AI 分析文件内容 ───
const aiAnalysisResult = ref('')
const isAnalyzing = ref(false)

async function aiAnalyzeFile() {
  if (!requireMemberAction()) return
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  if (activeTab.value === 'history' && !props.isMember) {
    showToast('请登录后使用此功能')
    return
  }
  if (!f.content || f.content.length < 10) {
    showToast('文件内容太少，无法分析')
    return
  }
  isAnalyzing.value = true
  showToast('AI 分析中...')
  try {
    const config = await resolveApiConfig()
    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: '你是一个文件分析助手。请简洁分析以下文件内容，给出：1) 内容摘要(2-3句话) 2) 关键信息/要点 3) 可能的用途。用中文回答。' },
          { role: 'user', content: `文件名: ${f.name}\n\n内容:\n${f.content.slice(0, 8000)}` },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const data = await res.json()
    const analysis = data.choices?.[0]?.message?.content || '分析失败'
    // 在编辑区显示分析结果
    emitEvent('open-in-editor', {
      name: `AI分析_${f.name}`,
      content: `# AI 分析: ${f.name}\n\n${analysis}`,
      fileId: undefined,
    })
    emitEvent('switch-panel', 'editor')
  } catch (e: any) {
    showToast(`分析失败: ${e.message}`)
  } finally {
    isAnalyzing.value = false
  }
}

// ─── B2: Office 格式转换 ───
async function convertFileFormat() {
  if (!requireMemberAction()) return
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return

  const ext = f.name.split('.').pop()?.toLowerCase() || ''
  if (['md', 'markdown', 'txt', 'csv', 'json'].includes(ext)) {
    showToast('该文件已经是本地可读文本格式，可直接查看或导出。')
    return
  }

  showToast('线上 Office 转换已关闭。请在工具仓库使用“格式转换”执行本地 ToMD。')
}

// ─── B3: 下载文件 ───
function downloadFile() {
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  const blob = fileEntryToDownloadBlob(f)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  a.click()
  URL.revokeObjectURL(url)
}

// ─── B4: 复制内容到剪贴板 ───
async function copyFileContent() {
  if (!requireMemberAction()) return
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  try {
    await navigator.clipboard.writeText(f.content)
    showToast('已复制到剪贴板')
  } catch {
    showToast('复制失败')
  }
}

// ─── B5: 发送文件内容到对话 ───
function sendFileToChat() {
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  emitEvent('reference-file', { name: f.name, content: f.content })
  showToast(`已将「${f.name}」挂载到对话上下文`)
}

// ─── 搭子辅助函数 ───
function getSkillForFile(f: FileEntry): { skill: SkillConfig | undefined; isBuiltin: boolean } {
  const skillId = f.metadata?.skillId as string | undefined
  if (!skillId) return { skill: undefined, isBuiltin: false }
  const skill = agentStore.getSkillById(skillId)
  return { skill, isBuiltin: skill ? agentStore.isBuiltinSkill(skillId) : false }
}

function editSkillInDialog(skillId: string) {
  const skill = agentStore.getSkillById(skillId)
  if (!skill) return
  if (agentStore.isBuiltinSkill(skillId)) {
    // 内置搭子不允许编辑，只选择使用
    agentStore.selectAgent(skillId)
    return
  }
  emitEvent('open-agent-editor', skillId)
}

function openSkillFolder(f: FileEntry) {
  if (f.mimeType === 'folder' && f.metadata?.skillId) {
    openFolder(f)
  }
}

function handleDoubleClick(f: FileEntry) {
  if (activeTab.value === 'history') {
    // 恢复对话状态
    if (f.metadata?.originalId) {
      // 通过全局事件通知 ChatPanel 切换会话
      sessionStore.switchSession(f.metadata.originalId as string)
    }
  } else if (activeTab.value === 'skill') {
    const { isBuiltin } = getSkillForFile(f)
    if (isBuiltin) {
      // 内置搭子：双击直接选择使用（不可编辑）
      if (f.metadata?.skillId) {
        agentStore.selectAgent(f.metadata.skillId as string)
      }
    } else if (f.metadata?.skillId) {
      // 用户搭子：双击打开深度编辑
      editSkillInDialog(f.metadata.skillId as string)
    } else if (f.mimeType === 'folder') {
      // 文件夹：进入浏览
      openFolder(f)
    } else {
      emitEvent('open-in-editor', { name: f.name, content: f.content, fileId: f.id })
      emitEvent('switch-panel', 'editor')
    }
  } else if (activeTab.value === 'canvas') {
    emitEvent('switch-workspace-mode', 'canvas')
    emitEvent('open-canvas-document', { fileId: f.id, name: f.name, content: f.content })
  } else {
    // 默认行为：在 Editor 中打开
    emitEvent('open-in-editor', { name: f.name, content: f.content, fileId: f.id })
    emitEvent('switch-panel', 'editor')
  }
}

async function scanLocalSkills() {
  closeBlankContextMenu()
  try {
    // 调用 File System Access API
    if (!(window as any).showDirectoryPicker) throw new Error('浏览器不支持此功能')
    const dirHandle = await (window as any).showDirectoryPicker()
    showToast('开始扫描本地技能...')
    // 这里是一个简化逻辑，如果需要可以实现深度遍历
    let count = 0
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        count++
      }
    }
    showToast(`扫描完毕，找到 ${count} 个目录；请上传 SKILL.md 导入搭子`)
  } catch (e: any) {
    showToast(`扫描失败或取消: ${e.message}`)
  }
}

</script>

<template>
  <div class="fp" @click="closeAllMenus" @contextmenu="openBlankContextMenu">
    <div class="fp-tabs">
      <button v-for="t in tabItems" :key="t.key" class="fp-tab" :class="{ active: activeTab === t.key }" @click="switchTab(t.key as Tab)">
        <span class="mso" style="font-size:14px">{{ t.icon }}</span>
        <span>{{ t.label }}</span>
      </button>
      <button class="fp-tab" style="margin-left: auto; padding: 5px 8px" @click="emitEvent('toggle-file-tree')" title="收起文件面板">
        <span class="mso">keyboard_double_arrow_left</span>
      </button>
    </div>

    <!-- 工具栏 -->
    <div class="fp-toolbar">
        <div class="fp-search"><span class="mso" style="font-size:14px">search</span><input v-model="searchQuery" placeholder="搜索..." /></div>
        <button class="fp-tool-btn fp-sort-btn" @click="cycleSortMode" :title="currentSort.title" :aria-label="currentSort.title">
          <span class="mso">{{ currentSort.icon }}</span>
          <span class="fp-sort-label">{{ currentSort.shortLabel }}</span>
        </button>
        <button class="fp-tool-btn" :disabled="isRefreshing" @click="refreshCurrentTab" title="刷新列表">
          <span class="mso" :class="{ spinning: isRefreshing }">refresh</span>
        </button>
        <button v-if="activeTab === 'text'" class="fp-tool-btn new-doc" @click="createNewDoc" title="新建文本">
          <span class="mso">note_add</span>
        </button>
        <button v-if="activeTab === 'canvas'" class="fp-tool-btn new-doc" @click="createNewCanvas" title="新建画布">
          <span class="mso">add_box</span>
        </button>
        <button v-if="!isHistoryOnlyMode" class="fp-tool-btn" :class="{ active: selectAll }" @click="toggleSelectAll" title="全选"><span class="mso">select_all</span></button>
        <button v-if="!isHistoryOnlyMode" class="fp-tool-btn" :disabled="!selectAll || selectedIds.size === 0" @click="deleteSelected" title="删除所选"><span class="mso">delete</span></button>
        <button v-if="activeTab === 'text' || activeTab === 'media'" class="fp-tool-btn" :disabled="!selectAll || selectedIds.size < 2" @click="mergeSelected" title="合并所选"><span class="mso">create_new_folder</span></button>
        <label v-if="activeTab === 'skill'" class="fp-tool-btn" title="上传搭子单文件">
          <span class="mso">upload_file</span>
          <input type="file" accept=".md" @change="handleSkillTextUpload" hidden />
        </label>
        <label v-if="activeTab === 'skill'" class="fp-tool-btn" title="上传搭子文件夹">
          <span class="mso">drive_folder_upload</span>
          <input type="file" multiple webkitdirectory @change="handleSkillUpload" hidden />
        </label>
      <label v-else-if="!isHistoryOnlyMode && (activeTab as string) !== 'skill'" class="fp-tool-btn" title="上传">
          <span class="mso">upload</span>
          <input type="file" multiple @change="handleUpload" hidden />
        </label>
        <input
          ref="vaultImportInput"
          type="file"
          accept=".jcvault,.jcbackup,.json,application/json"
          hidden
          @change="handleVaultImportFile"
        />
    </div>

      <!-- 知识库 tab 面包屑：vault 内部浏览 -->
      <div v-if="activeTab === 'knowledge' && browsingVaultId" class="fp-breadcrumb">
        <button class="fp-bread-btn" @click="currentFolder ? exitFolder() : exitVaultBrowse()">
          <span class="mso">arrow_back</span> {{ currentFolder ? '返回' : '所有知识库' }}
        </button>
        <span class="fp-bread-name">
          {{ currentFolder ? currentFolder.name : (vaultStore.vaults.find(v => v.id === browsingVaultId)?.name || '知识库') }}
        </span>
      </div>

      <!-- 通用文件夹面包屑（非知识库 tab） -->
      <div v-else-if="currentFolder && activeTab !== 'knowledge'" class="fp-breadcrumb">
        <button class="fp-bread-btn" @click="exitFolder"><span class="mso">arrow_back</span> 返回</button>
        <span class="fp-bread-name">{{ currentFolder.name }}</span>
      </div>

      <div v-if="visibleVaultHealthResult" class="fp-health-panel">
        <div class="fp-health-head">
          <span class="mso">health_and_safety</span>
          <span>{{ visibleVaultHealthResult.reportName }}</span>
        </div>
        <div class="fp-health-metrics">
          <span
            v-for="item in healthMetricItems"
            :key="item.label"
            class="fp-health-chip"
            :class="item.tone"
          >
            {{ item.label }} {{ item.value }}
          </span>
        </div>
        <div v-if="visibleVaultHealthResult.suggestions.length" class="fp-health-suggestions">
          <span>建议新增栏目</span>
          <strong>{{ visibleVaultHealthResult.suggestions.slice(0, 3).join(' / ') }}</strong>
        </div>
      </div>

      <!-- 知识库 tab 顶层：vault 文件夹卡片 -->
      <div v-if="activeTab === 'knowledge' && !browsingVaultId" class="fp-list">
        <div v-for="v in vaultStore.vaults.filter(vault => vault.status === 'active')" :key="v.id"
             class="fp-item folder"
             @dblclick="enterVault(v.id)"
             @contextmenu="openContextMenu($event, { id: v.id, name: v.name, category: 'knowledge', mimeType: 'folder', content: '', size: 0, createdAt: v.createdAt, updatedAt: v.updatedAt, vaultId: v.id, metadata: { isVaultRoot: true } } as any)">
          <span class="mso" style="font-size:16px;color:var(--olive)">{{ v.icon || 'folder_special' }}</span>
          <span class="fp-item-name">{{ v.name }}</span>
          <span v-if="v.oneLineDesc" class="fp-kind-chip">{{ v.type }}</span>
          <span class="fp-item-meta">{{ new Date(v.updatedAt).toLocaleDateString('zh-CN') }}</span>
        </div>
        <div v-if="vaultStore.vaults.filter(v => v.status === 'active').length === 0" class="fp-empty">
          还没有知识库，点击左侧「创建知识库」按钮创建
        </div>
      </div>

      <div v-else class="fp-list">
        <!-- 搭子 tab -->
        <!-- 媒体 tab -->
        <template v-if="activeTab === 'media'">
          <div v-for="f in folders" :key="f.id" class="fp-item folder" @dblclick="openFolder(f)" @contextmenu="openContextMenu($event, f)">
            <span class="mso" style="font-size:16px;color:#ff9800">folder</span>
            <span class="fp-item-name">{{ f.name }}</span>
            <span class="fp-item-meta">{{ folderFileCount(f) }} 个文件</span>
          </div>
          <div class="fp-media-grid">
            <div v-for="f in displayFiles" :key="f.id" class="fp-media-item"
                 :class="{ selected: selectedIds.has(f.id) }"
                 @click="selectAll ? toggleItem(f.id) : null"
                 @contextmenu="openContextMenu($event, f)">
              <img v-if="f.category === 'image'" :src="f.content" class="fp-media-thumb" />
              <div v-else class="fp-media-thumb video"><span class="mso">movie</span></div>
              <span class="fp-media-name">{{ f.name }}</span>
            </div>
          </div>
          <div v-if="displayFiles.length === 0 && folders.length === 0" class="fp-empty">暂无媒体文件</div>
        </template>

        <!-- 其他文件 tab -->
        <template v-else>
          <!-- 文件夹 -->
          <div v-for="f in folders" :key="f.id" class="fp-item folder" @dblclick="openFolder(f)" @contextmenu="openContextMenu($event, f)">
            <span class="mso" style="font-size:16px;color:#ff9800">folder</span>
            <span class="fp-item-name">{{ f.name }}</span>
            <span class="fp-item-meta">{{ folderFileCount(f) }} 个文件</span>
          </div>
          <!-- 文件 -->
          <div v-for="f in displayFiles" :key="f.id" class="fp-item"
               :class="{ selected: selectedIds.has(f.id), editing: f.id === activeEditingId, history: activeTab === 'history', active: activeTab === 'history' && f.metadata?.originalId != null && f.metadata.originalId === sessionStore.activeSessionId }"
               @click="selectAll ? toggleItem(f.id) : null"
               @dblclick="!selectAll ? handleDoubleClick(f) : null"
               @contextmenu="openContextMenu($event, f)">
            <input v-if="selectAll" type="checkbox" :checked="selectedIds.has(f.id)" @click.stop="toggleItem(f.id)" />
            <span class="mso" style="font-size:16px;color:var(--ink3)">{{ activeTab === 'history' ? 'chat_bubble' : activeTab === 'knowledge' ? 'auto_stories' : activeTab === 'skill' ? 'smart_toy' : activeTab === 'canvas' ? 'account_tree' : 'description' }}</span>
            <span v-if="activeTab === 'history'" class="fp-item-text">
              <span class="fp-item-name">{{ f.name }}</span>
              <span class="fp-item-preview">{{ historySubtext(f) }}</span>
            </span>
            <span v-else class="fp-item-name">{{ f.name }}</span>
            <span v-if="fileKindLabel(f)" class="fp-kind-chip">{{ fileKindLabel(f) }}</span>
            <span v-if="f.id === activeEditingId" class="fp-editing-dot" title="正在编辑中"></span>
            <span class="fp-item-meta">{{ new Date(f.updatedAt).toLocaleDateString('zh-CN') }}</span>
          </div>
          <div v-if="displayFiles.length === 0 && folders.length === 0" class="fp-empty">{{ emptyText() }}</div>
        </template>
      </div>

      <!-- 底部快捷操作条（仅文本 Tab） -->
      <div v-if="activeTab === 'text'" class="fp-quick-bar">
        <button class="fp-quick-btn" @click="createNewDoc">
          <span class="mso">add</span> 新建文档
        </button>
        <button class="fp-quick-btn" @click="pasteFromClipboard">
          <span class="mso">content_paste</span> 粘贴创建
        </button>
        <button class="fp-quick-btn" @click="exportAllTexts">
          <span class="mso">download</span> 导出全部
        </button>
      </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="contextMenu.show" class="fp-ctx-overlay" @click="closeContextMenu">
        <div class="fp-ctx-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
          <template v-if="contextMenu.file">
            <template v-if="activeTab === 'history'">
              <button v-if="props.isMember" class="fp-ctx-item" @click="openInEditor"><span class="mso">description</span> 以文本打开</button>
              <button v-if="props.isMember" class="fp-ctx-item" @click="distillHistory"><span class="mso">psychology</span> 提炼知识 (Distill)</button>
              <button v-if="props.isMember" class="fp-ctx-item" @click="aiAnalyzeFile"><span class="mso">auto_awesome</span> AI 分析对话</button>
              <div v-if="!props.isMember" class="fp-ctx-note">非会员可双击恢复会话</div>
            </template>
            <template v-else-if="activeTab === 'knowledge'">
              <button v-if="isPendingWikiCandidate(contextMenu.file)" class="fp-ctx-item primary" @click="acceptWikiCandidateMenu"><span class="mso">check_circle</span> 接受候选</button>
              <button v-if="isPendingWikiCandidate(contextMenu.file)" class="fp-ctx-item" @click="ignoreWikiCandidateMenu"><span class="mso">block</span> 忽略候选</button>
              <div v-if="isPendingWikiCandidate(contextMenu.file)" class="fp-ctx-divider"></div>
              <button class="fp-ctx-item primary" @click="organizeKnowledgeMenu"><span class="mso">auto_fix</span> 整理</button>
              <button class="fp-ctx-item" @click="runVaultHealthCheckMenu"><span class="mso">health_and_safety</span> 健康检查</button>
              <button class="fp-ctx-item" @click="exportVaultMenu"><span class="mso">download</span> 导出知识库</button>
              <button v-if="contextMenu.file.mimeType !== 'folder'" class="fp-ctx-item" @click="openInEditor"><span class="mso">edit_note</span> 在编辑区打开</button>
            </template>
            <template v-else-if="activeTab === 'skill'">
              <!-- 用户自建搭子的右键菜单 -->
              <template v-if="contextMenu.file && !getSkillForFile(contextMenu.file).isBuiltin">
                <button v-if="contextMenu.file.mimeType === 'folder' && contextMenu.file.metadata?.skillId" class="fp-ctx-item primary" @click="openSkillFolder(contextMenu.file!)">
                  <span class="mso">folder_open</span> 打开文件夹
                </button>
                <button class="fp-ctx-item primary" @click="contextMenu.file?.metadata?.skillId && editSkillInDialog(contextMenu.file.metadata.skillId as string)">
                  <span class="mso">edit</span> 深度编辑 SKILL.md
                </button>
                <button v-if="contextMenu.file.mimeType === 'folder'" class="fp-ctx-item" @click="evolveAgentMenu">
                  <span class="mso">model_training</span> 用知识反哺搭子
                </button>
              </template>
              <!-- 内置搭子的右键菜单（锁定，仅可选择使用） -->
              <template v-else-if="contextMenu.file">
                <button class="fp-ctx-item primary" @click="contextMenu.file?.metadata?.skillId && agentStore.selectAgent(contextMenu.file.metadata.skillId as string)">
                  <span class="mso">smart_toy</span> 选择使用此搭子
                </button>
                <div class="fp-ctx-divider"></div>
                <div class="fp-ctx-note" style="padding:6px 12px;font-size:11px;color:var(--ink3)">
                  <span class="mso" style="font-size:14px;vertical-align:middle">lock</span>
                  内置搭子 · 内容已锁定，仅可使用
                </div>
              </template>
            </template>
            <template v-else-if="activeTab === 'media'">
              <button class="fp-ctx-item" @click="sendToChat"><span class="mso">chat</span> 发送到对话</button>
              <button class="fp-ctx-item" @click="sendToGallery"><span class="mso">push_pin</span> 挂载到画廊</button>
              <button class="fp-ctx-item" @click="sendAsReference"><span class="mso">image</span> 作为参考图发送</button>
            </template>
            <template v-else-if="activeTab === 'text'">
              <button class="fp-ctx-item" @click="openInEditor"><span class="mso">edit_note</span> 在编辑区打开</button>
              <button class="fp-ctx-item" @click="appendToEditor"><span class="mso">add</span> 追加到编辑区</button>
              <button class="fp-ctx-item" @click="aiAnalyzeFile"><span class="mso">psychology</span> AI 分析</button>
              <button class="fp-ctx-item" @click="sendFileToChat"><span class="mso">chat</span> 发送到对话</button>
              <button class="fp-ctx-item" @click="convertFileFormat"><span class="mso">swap_horiz</span> 转换格式</button>
            </template>

            <template v-if="!isHistoryOnlyMode && !(activeTab === 'skill' && contextMenu.file && getSkillForFile(contextMenu.file).isBuiltin)">
              <div class="fp-ctx-divider"></div>
              <button v-if="activeTab !== 'knowledge'" class="fp-ctx-item" @click="copyFileContent"><span class="mso">content_copy</span> 复制内容</button>
              <button v-if="activeTab !== 'knowledge'" class="fp-ctx-item" @click="downloadFile"><span class="mso">download</span> 下载文件</button>
              <button class="fp-ctx-item" @click="startRename"><span class="mso">edit</span> 重命名</button>
              <button class="fp-ctx-item danger" @click="deleteContextFile"><span class="mso">delete</span> 删除</button>
            </template>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 空白处全局右键菜单 -->
    <Teleport to="body">
      <div v-if="blankContextMenu.show" class="fp-ctx-overlay" @click="closeBlankContextMenu" @contextmenu.prevent="closeBlankContextMenu">
        <div class="fp-ctx-menu" :style="{ top: blankContextMenu.y + 'px', left: blankContextMenu.x + 'px' }">
          <button class="fp-ctx-item" @click="loadTab(); closeBlankContextMenu()"><span class="mso">refresh</span> 刷新列表</button>
          <button v-if="activeTab === 'knowledge' && browsingVaultId" class="fp-ctx-item" @click="createKnowledgeFolderFromBlank"><span class="mso">create_new_folder</span> 新建文件夹</button>
          <button v-if="activeTab === 'knowledge'" class="fp-ctx-item" @click="triggerVaultImport"><span class="mso">drive_folder_upload</span> 导入知识库</button>
          <button v-if="activeTab === 'text'" class="fp-ctx-item" @click="createNewDoc(); closeBlankContextMenu()"><span class="mso">note_add</span> 新建文档</button>
          <button v-if="activeTab === 'canvas'" class="fp-ctx-item" @click="createNewCanvas"><span class="mso">add_box</span> 新建画布</button>
          <button v-if="activeTab === 'text'" class="fp-ctx-item" @click="pasteFromClipboard(); closeBlankContextMenu()"><span class="mso">content_paste</span> 粘贴创建</button>
          <label v-if="activeTab === 'text' || activeTab === 'media'" class="fp-ctx-item" style="cursor: pointer;">
            <span class="mso">upload</span> 上传文件
            <input type="file" multiple @change="handleUpload" hidden />
          </label>
          <button v-if="activeTab === 'text' || activeTab === 'media'" class="fp-ctx-item" @click="createNewFolder"><span class="mso">create_new_folder</span> 新建文件夹</button>
          <label v-if="activeTab === 'skill'" class="fp-ctx-item" style="cursor: pointer;">
            <span class="mso">upload_file</span> 上传 SKILL.md
            <input type="file" accept=".md" @change="handleSkillTextUpload" hidden />
          </label>
          <button v-if="activeTab === 'skill'" class="fp-ctx-item" @click="createNewAgent"><span class="mso">smart_toy</span> 新建空搭子</button>
          <button v-if="activeTab === 'skill'" class="fp-ctx-item" @click="scanLocalSkills"><span class="mso">search</span> 扫描本地技能库</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.fp { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--surface); }
.fp-tabs { display: flex; align-items: flex-end; gap: 2px; padding: 0 6px 0; height: var(--app-header-height); box-sizing: border-box; border-bottom: 1px solid var(--line); overflow-x: auto; }
.fp-tab { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border: none; border-radius: 6px 6px 0 0; background: transparent; color: var(--ink3); cursor: pointer; font-size: 11px; font-weight: 600; font-family: inherit; white-space: nowrap; }
.fp-tab:hover { color: var(--ink1); background: var(--surface); }
.fp-tab.active { color: var(--olive); background: var(--surface); border-bottom: 2px solid var(--olive); }
.fp-toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.fp-search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); }
.fp-search input { flex: 1; min-width: 0; border: none; background: none; outline: none; font-size: 11px; color: var(--ink1); font-family: inherit; }
.fp-tool-btn { width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink3); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.fp-tool-btn:hover { color: var(--olive); border-color: var(--olive); }
.fp-tool-btn.active { color: var(--olive); background: rgba(107,142,35,.1); border-color: var(--olive); }
.fp-tool-btn:disabled { opacity: .3; cursor: not-allowed; }
.fp-tool-btn .mso { font-size: 15px; }
.fp-tool-btn .spinning { animation: fp-spin .8s linear infinite; }
@keyframes fp-spin { to { transform: rotate(360deg); } }
.fp-sort-btn { width: 42px; gap: 2px; flex-shrink: 0; }
.fp-sort-label { font-size: 9px; font-weight: 700; line-height: 1; }
.fp-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.fp-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.fp-item:hover { background: var(--surface); }
.fp-item-name { flex: 1; font-size: 12px; font-weight: 500; color: var(--ink1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-item.history { align-items: flex-start; min-height: 50px; padding-top: 7px; padding-bottom: 7px; }
.fp-item.history .mso { margin-top: 1px; flex-shrink: 0; }
.fp-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fp-item.history .fp-item-name { flex: initial; font-size: 12px; font-weight: 700; line-height: 1.25; }
.fp-item-preview {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.fp-item.history .fp-item-meta { padding-top: 1px; }
.fp-kind-chip {
  flex-shrink: 0;
  max-width: 74px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(107,142,35,.08);
  color: var(--olive-dark);
  border: 1px solid rgba(107,142,35,.18);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
}
.fp-item-meta { font-size: 10px; color: var(--ink3); flex-shrink: 0; }
.fp-empty { text-align: center; padding: 24px; font-size: 12px; color: var(--ink3); }
.fp-media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 6px; padding: 6px; }
.fp-media-item { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; }
.fp-media-thumb { width: 68px; height: 68px; border-radius: 6px; object-fit: cover; border: 1px solid var(--line); }
.fp-media-thumb.video { display: flex; align-items: center; justify-content: center; background: var(--surface); color: var(--ink3); }
.fp-media-name { font-size: 10px; color: var(--ink2); max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-knowledge { display: flex; flex-direction: column; height: 100%; }
.fp-knowledge-info { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 16px; }
.fp-knowledge-count { font-size: 14px; font-weight: 700; color: var(--ink1); }
.fp-knowledge-actions { display: flex; gap: 8px; padding: 0 12px 12px; justify-content: center; }
.fp-kb-btn { display: flex; align-items: center; gap: 4px; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); color: var(--ink1); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.fp-kb-btn:hover { border-color: var(--olive); color: var(--olive); }
.fp-kb-btn.danger:hover { border-color: #e53935; color: #e53935; }
.fp-kb-btn.brain-btn { background: rgba(107,142,35,.1); color: var(--olive); border-color: var(--olive); }
.fp-kb-btn.brain-btn:hover { background: rgba(107,142,35,.2); }
.fp-kb-btn .mso { font-size: 15px; }
.fp-ctx-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.08); }
.fp-ctx-menu { position: fixed; min-width: 160px; padding: 8px; background: var(--paper); border: 1px solid var(--line); color: var(--ink1); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.25); z-index: 10000; }
.fp-ctx-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px; border: none; border-radius: 6px; background: transparent; color: var(--ink1); font-size: 12px; cursor: pointer; font-family: inherit; }
.fp-ctx-item:hover { background: var(--surface); }
.fp-ctx-item.primary { color: var(--olive-dark); font-weight: 700; }
.fp-ctx-item.primary .mso { color: var(--olive); }
.fp-ctx-item.danger:hover { color: #e53935; }
.fp-ctx-item .mso { font-size: 15px; color: var(--ink2); }
.fp-ctx-divider { height: 1px; background: var(--line); margin: 4px 0; }
/* 面包屑 */
.fp-breadcrumb { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line); background: var(--surface); }
.fp-bread-btn { display: flex; align-items: center; gap: 2px; border: none; background: none; color: var(--olive); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.fp-bread-name { font-size: 12px; font-weight: 600; color: var(--ink1); }
.fp-health-panel {
  padding: 8px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-alt);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fp-health-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--ink2);
  font-size: 11px;
  font-weight: 700;
}
.fp-health-head .mso { font-size: 14px; color: var(--olive); }
.fp-health-head span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-health-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fp-health-chip {
  padding: 3px 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink2);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.fp-health-chip.warning {
  border-color: rgba(230, 126, 34, .32);
  background: rgba(230, 126, 34, .08);
  color: #a35612;
}
.fp-health-chip.ok {
  border-color: rgba(107,142,35,.22);
  background: rgba(107,142,35,.08);
  color: var(--olive-dark);
}
.fp-health-suggestions {
  display: flex;
  gap: 6px;
  min-width: 0;
  color: var(--ink3);
  font-size: 10px;
}
.fp-health-suggestions strong {
  flex: 1;
  min-width: 0;
  color: var(--ink1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 文件夹 */
.fp-item.folder { background: rgba(255,152,0,.04); }
.fp-item.folder:hover { background: rgba(255,152,0,.08); }
/* 选中状态 */
.fp-item.selected, .fp-media-item.selected { background: rgba(107,142,35,.08); border-radius: 6px; }
.fp-media-item.selected .fp-media-thumb { border-color: var(--olive); }

/* 正在编辑标记 */
.fp-item.editing { background: rgba(107,142,35,.06); border-left: 2px solid var(--olive); }

/* 当前活跃会话高亮 */
.fp-item.active {
  background: rgba(107,142,35,.10);
  border-left: 3px solid var(--olive);
  font-weight: 600;
}
.fp-item.active .fp-item-name { color: var(--olive-dark); }
.fp-item.active .fp-item-meta { color: var(--olive); }
.fp-editing-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #4caf50; flex-shrink: 0;
  box-shadow: 0 0 4px rgba(76,175,80,.5);
  animation: dot-pulse 2s ease infinite;
}
@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}

/* 新建文档按钮 */
.fp-tool-btn.new-doc { background: var(--olive); color: #fff; border-color: var(--olive); }
.fp-tool-btn.new-doc:hover { background: var(--olive-dark); }

/* 底部快捷操作条 */
.fp-quick-bar {
  display: flex; gap: 4px; padding: 8px 6px;
  border-top: 1px solid var(--line);
  background: var(--surface-alt); flex-shrink: 0;
}
.fp-quick-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 3px;
  padding: 6px 4px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink2);
  font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .12s;
}
.fp-quick-btn:hover { border-color: var(--olive); color: var(--olive); }
.fp-quick-btn .mso { font-size: 14px; }
</style>
