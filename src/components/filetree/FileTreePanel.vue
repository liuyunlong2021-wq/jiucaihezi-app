<script setup lang="ts">
/**
 * FileTreePanel — 文件面板（Col 2）
 * 5个tab：会话、文本、媒体、知识库、搭子
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { distillHistoryToWiki, evolveAgent } from '@/utils/brain'
import { useAgentStore } from '@/stores/agentStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useVaultStore } from '@/stores/vaultStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { pinKnowledge } from '@/composables/useBrain'
import { parseSkillMd } from '@/types/skill'
import { processFile } from '@/composables/useFileUpload'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import {
  compareFileEntries,
  DEFAULT_FILE_SORT_MODE,
  FILE_SORT_OPTIONS,
  isFileSortMode,
  type FileSortMode,
} from '@/utils/fileSort'

const OFFICE_API = 'https://api.jiucaihezi.studio/api'

const fileStore = useFileStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const vaultStore = useVaultStore()

type Tab = 'history' | 'text' | 'media' | 'knowledge' | 'skill'
const activeTab = ref<Tab>('text')
const searchQuery = ref('')
const selectAll = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const contextMenu = ref({ show: false, x: 0, y: 0, file: null as FileEntry | null })
const SORT_STORAGE_KEY = 'jc_file_sort_mode'
const savedSortMode = localStorage.getItem(SORT_STORAGE_KEY)
const sortMode = ref<FileSortMode>(isFileSortMode(savedSortMode) ? savedSortMode : DEFAULT_FILE_SORT_MODE)
const currentSort = computed(() =>
  FILE_SORT_OPTIONS.find(option => option.mode === sortMode.value) || FILE_SORT_OPTIONS[0]
)

const tabItems = [
  { key: 'history', icon: 'chat', label: '会话' },
  { key: 'text', icon: 'article', label: '文本' },
  { key: 'media', icon: 'perm_media', label: '媒体' },
  { key: 'knowledge', icon: 'psychology', label: '知识库' },
  { key: 'skill', icon: 'smart_toy', label: '搭子' },
] as const

const knowledgeKindLabels: Record<string, string> = {
  raw: '原始',
  summary: '摘要',
  page: '知识页',
  entity: '实体',
  relation: '关系',
  asset: '素材',
}

const items = ref<FileEntry[]>([])

// ─── 知识库 tab：vault 浏览状态 ───
const browsingVaultId = ref<string | null>(null)

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
  selectAll.value = false
  selectedIds.value.clear()
  if (activeTab.value === 'media') {
    const images = await fileStore.loadByCategory('image')
    const videos = await fileStore.loadByCategory('video')
    items.value = [...images, ...videos]
  } else if (activeTab.value === 'history') {
    await fileStore.syncHistoryFromSessions()
    items.value = await fileStore.loadByCategory('history', vaultStore.activeVaultId)
  } else if (activeTab.value === 'skill') {
    await fileStore.syncSkillsFromStore(agentStore.loadSkills())
    items.value = await fileStore.loadByCategory('skill')
  } else if (activeTab.value === 'knowledge') {
    // 知识库 tab：如果在某个 vault 内部浏览，加载该 vault 的文件
    // 否则不加载（顶层显示 vault 卡片列表）
    if (browsingVaultId.value) {
      items.value = await fileStore.loadByCategory('knowledge', browsingVaultId.value)
    } else {
      items.value = []
    }
  } else {
    items.value = await fileStore.loadByCategory(activeTab.value as any)
  }
  if (currentFolder.value) {
    const latestFolder = items.value.find(f => f.id === currentFolder.value?.id)
    currentFolder.value = latestFolder || null
  }
}

onMounted(async () => {
  await vaultStore.loadAll()
  // 一次性迁移旧知识条目到 vault 文件夹结构
  await migrateOldKnowledgeEntries()
  loadTab()
})

// ─── 编辑状态同步 ───
const activeEditingId = ref<string | null>(null)
const offEditorChanged = onEvent('editor-file-changed', (payload: any) => {
  activeEditingId.value = payload?.fileId || null
})
const offRefreshList = onEvent('refresh-file-list', () => {
  loadTab()
})
onBeforeUnmount(() => {
  offEditorChanged()
  offRefreshList()
})

function switchTab(tab: Tab) {
  activeTab.value = tab
  currentFolder.value = null
  browsingVaultId.value = null
  loadTab()
}

const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase()
  const filtered = q
    ? items.value.filter(f => f.name.toLowerCase().includes(q))
    : items.value
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
  // 只有点击空白处时才触发（排除点击具体 item）
  const target = e.target as HTMLElement
  if (target.closest('.fp-item') || target.closest('.fp-media-item') || target.closest('.fp-toolbar') || target.closest('.fp-tabs')) return
  blankContextMenu.value = { show: true, x: e.clientX, y: e.clientY }
}
function closeBlankContextMenu() { blankContextMenu.value.show = false }

// ─── 文件右键菜单 ───
function openContextMenu(e: MouseEvent, file: FileEntry) {
  e.preventDefault()
  e.stopPropagation()
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
      content: '在此编辑知识内容...',
      topic: vaultStore.activeVault?.name || '项目知识库',
      vaultId,
      kind: 'page',
      indexed: true,
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
  return '暂无文本文件'
}

function fileKindLabel(file: FileEntry): string {
  if (activeTab.value === 'history' && !file.vaultId) return '未绑定'
  if (activeTab.value !== 'knowledge') return ''
  const legacyBucket = String(file.metadata?.migrationBucket || '')
  if (legacyBucket === 'global-legacy') return '全局旧资料'
  if (legacyBucket === 'skill-legacy') return '搭子旧资料'
  if (legacyBucket === 'uncategorized-legacy') return '未分类旧资料'
  if (legacyBucket === 'session-vault') return '已迁移'
  if (file.metadata?.kind === 'vault-hot-cache') return '热记忆'
  if (file.metadata?.kind === 'vault-index') return '索引'
  if (file.metadata?.kind === 'vault-lint-report') return '体检'
  return file.kind ? knowledgeKindLabels[file.kind] || file.kind : ''
}

// ─── 新建文本文档 ───
async function createNewDoc() {
  const name = prompt('文档名称', `新文档_${new Date().toLocaleTimeString('zh-CN')}`)
  if (!name) return
  const file = await fileStore.addText(name, '')
  await loadTab()
  // 自动在编辑区打开
  emitEvent('open-in-editor', { name: file.name, content: '', fileId: file.id })
  emitEvent('switch-panel', 'editor')
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
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) { alert('剪贴板为空'); return }
    const name = `粘贴_${new Date().toLocaleTimeString('zh-CN')}`
    const file = await fileStore.addText(name, text)
    await loadTab()
    emitEvent('open-in-editor', { name: file.name, content: text, fileId: file.id })
    emitEvent('switch-panel', 'editor')
  } catch { alert('无法读取剪贴板') }
}

async function exportAllTexts() {
  const files = await fileStore.loadByCategory('text')
  if (files.length === 0) { alert('没有文本文件'); return }
  const combined = files.map(f => `# ${f.name}\n\n${f.content}`).join('\n\n---\n\n')
  const blob = new Blob([combined], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `全部文本_${new Date().toLocaleDateString('zh-CN')}.md`
  a.click()
  URL.revokeObjectURL(url)
}
// ─── 合并所选（合并为文件夹） ───
async function mergeSelected() {
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

async function detachFromFolder(fileId: string) {
  const all = activeTab.value === 'media' ? [...await fileStore.loadByCategory('image'), ...await fileStore.loadByCategory('video')] : await fileStore.loadByCategory(activeTab.value as any)
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
  const children = (folder.metadata?.children as string[]) || []
  for (const childId of children) {
    await fileStore.deleteFile(childId)
  }
  await fileStore.deleteFile(folder.id)
}

// 过滤：排除已在文件夹中的文件（除非正在查看文件夹）
const displayItems = computed(() => {
  if (currentFolder.value) {
    const children = (currentFolder.value.metadata?.children as string[]) || []
    return filteredItems.value.filter(f => children.includes(f.id))
  }
  return filteredItems.value.filter(f => !f.folderId)
})

// 文件夹列表
const folders = computed(() => {
  if (currentFolder.value) return []
  return filteredItems.value.filter(f => f.mimeType === 'folder')
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
  showToast('长脑子提炼中...')
  try {
    const count = await distillHistoryToWiki(file, vaultStore.activeVaultId || undefined)
    showToast(count > 0 ? `提炼成功！生成了 ${count} 条结构化知识` : '提炼完成，但没有发现可复用知识')
    await loadTab()
  } catch (e: any) {
    showToast(`提炼失败: ${e.message}`)
  }
}

async function evolveAgentMenu() {
  const folder = contextMenu.value.file
  closeAllMenus()
  if (!folder) return
  showToast('达尔文反哺进化中...')
  try {
    const result = await evolveAgent(folder)
    showToast(result.message)
    await loadTab()
  } catch (e: any) {
    showToast(`进化失败: ${e.message}`)
  }
}


function sendAsReference() {
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  emitEvent('switch-panel', 'creation')
  // 发送事件给创作面板作为参考图输入
  emitEvent('import-to-creation', { url: file.content, type: file.mimeType.startsWith('video') ? 'video' : 'image', name: file.name })
  showToast('已添加到参考图')
}

function sendToGallery() {
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  emitEvent('switch-panel', 'creation')
  // 发送事件给创作面板
  emitEvent('send-to-gallery', { url: file.content, type: file.mimeType.startsWith('video') ? 'video' : 'image', name: file.name })
  showToast('已发送到创作画廊')
}

function sendToChat() {
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  emitEvent('send-to-chat', { url: file.content, type: file.mimeType.startsWith('video') ? 'video' : 'image', name: file.name })
  showToast('已发送到对话区')
}

// ─── 知识库右键：反哺搭子 + 钉到对话 ───

function feedKnowledgeToAgent() {
  const file = contextMenu.value.file
  closeAllMenus()
  if (!file) return
  // 通过事件通知 BrainPanel 用这条知识反哺当前搭子
  emitEvent('reference-file', { name: file.name, content: file.content })
  showToast(`已将「${file.name}」作为参考挂载到对话`)
}

function pinKnowledgeToChat() {
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
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
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
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return

  const ext = f.name.split('.').pop()?.toLowerCase() || ''
  let targetFormat = ''
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) targetFormat = 'pdf'
  else if (['xls', 'xlsx'].includes(ext)) targetFormat = 'csv'
  else if (['ppt', 'pptx'].includes(ext)) targetFormat = 'pdf'
  else if (ext === 'md') targetFormat = 'html'
  else {
    showToast('该文件类型暂不支持转换')
    return
  }

  showToast(`转换为 ${targetFormat} 中...`)
  try {
    // 如果有远程URL，直接调用转换API
    const form = new FormData()
    // 从 content 构建 Blob 上传
    if (f.content.startsWith('data:') || f.content.startsWith('http')) {
      // 已有远程 URL 或 data URL
      form.append('url', f.content)
    } else {
      // 纯文本内容，构建 blob
      const blob = new Blob([f.content], { type: 'text/plain' })
      form.append('file', blob, f.name)
    }
    form.append('target_format', targetFormat)

    const res = await fetch(`${OFFICE_API}/office/convert`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error(`转换失败: ${res.status}`)
    const data = await res.json()
    if (data.status === 'ok' && data.url) {
      const link = OFFICE_API.replace('/api', '') + data.url
      window.open(link, '_blank')
      showToast('转换完成，已在新标签页打开')
    } else {
      throw new Error(data.error || '转换失败')
    }
  } catch (e: any) {
    showToast(`转换失败: ${e.message}`)
  }
}

// ─── B3: 下载文件 ───
function downloadFile() {
  const f = contextMenu.value.file
  closeAllMenus()
  if (!f) return
  const blob = new Blob([f.content], { type: f.mimeType || 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = f.content.startsWith('http') ? f.content : url
  a.download = f.name
  a.click()
  URL.revokeObjectURL(url)
}

// ─── B4: 复制内容到剪贴板 ───
async function copyFileContent() {
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

function handleDoubleClick(f: FileEntry) {
  if (activeTab.value === 'history') {
    // 恢复对话状态
    if (f.metadata?.originalId) {
      // 通过全局事件通知 ChatPanel 切换会话
      sessionStore.switchSession(f.metadata.originalId as string)
    }
  } else if (activeTab.value === 'skill') {
    // 切换当前搭子
    if (f.metadata?.skillId) {
      agentStore.selectAgent(f.metadata.skillId as string)
    } else {
      emitEvent('open-in-editor', { name: f.name, content: f.content, fileId: f.id })
      emitEvent('switch-panel', 'editor')
    }
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
        <button v-if="activeTab === 'text'" class="fp-tool-btn new-doc" @click="createNewDoc" title="新建文本">
          <span class="mso">note_add</span>
        </button>
        <button class="fp-tool-btn" :class="{ active: selectAll }" @click="toggleSelectAll" title="全选"><span class="mso">select_all</span></button>
        <button class="fp-tool-btn" :disabled="!selectAll || selectedIds.size === 0" @click="deleteSelected" title="删除所选"><span class="mso">delete</span></button>
        <button v-if="activeTab === 'text' || activeTab === 'media'" class="fp-tool-btn" :disabled="!selectAll || selectedIds.size < 2" @click="mergeSelected" title="合并所选"><span class="mso">create_new_folder</span></button>
        <label v-if="activeTab === 'skill'" class="fp-tool-btn" title="上传搭子单文件">
          <span class="mso">upload_file</span>
          <input type="file" accept=".md" @change="handleSkillTextUpload" hidden />
        </label>
        <label v-if="activeTab === 'skill'" class="fp-tool-btn" title="上传搭子文件夹">
          <span class="mso">drive_folder_upload</span>
          <input type="file" multiple webkitdirectory @change="handleSkillUpload" hidden />
        </label>
        <label v-else-if="(activeTab as string) !== 'skill'" class="fp-tool-btn" title="上传">
          <span class="mso">upload</span>
          <input type="file" multiple @change="handleUpload" hidden />
        </label>
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
            <span class="fp-item-meta">{{ ((f.metadata?.children as string[]) || []).length }} 个文件</span>
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
            <span class="fp-item-meta">{{ ((f.metadata?.children as string[]) || []).length }} 个文件</span>
          </div>
          <!-- 文件 -->
          <div v-for="f in displayFiles" :key="f.id" class="fp-item"
               :class="{ selected: selectedIds.has(f.id), editing: f.id === activeEditingId }"
               @click="selectAll ? toggleItem(f.id) : null"
               @dblclick="!selectAll ? handleDoubleClick(f) : null"
               @contextmenu="openContextMenu($event, f)">
            <input v-if="selectAll" type="checkbox" :checked="selectedIds.has(f.id)" @click.stop="toggleItem(f.id)" />
            <span class="mso" style="font-size:16px;color:var(--ink3)">{{ activeTab === 'history' ? 'chat_bubble' : activeTab === 'knowledge' ? 'auto_stories' : activeTab === 'skill' ? 'smart_toy' : 'description' }}</span>
            <span class="fp-item-name">{{ f.name }}</span>
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
              <button class="fp-ctx-item" @click="openInEditor"><span class="mso">description</span> 以文本打开</button>
              <button class="fp-ctx-item" @click="distillHistory"><span class="mso">psychology</span> 提炼知识 (Distill)</button>
              <button class="fp-ctx-item" @click="aiAnalyzeFile"><span class="mso">auto_awesome</span> AI 分析对话</button>
            </template>
            <template v-else-if="activeTab === 'knowledge'">
              <button class="fp-ctx-item" @click="openInEditor"><span class="mso">edit_note</span> 在编辑区打开</button>
              <button class="fp-ctx-item" @click="feedKnowledgeToAgent"><span class="mso">model_training</span> 挂载到对话上下文</button>
              <button class="fp-ctx-item" @click="pinKnowledgeToChat"><span class="mso">push_pin</span> 钉选 (每轮注入)</button>
              <button class="fp-ctx-item" @click="aiAnalyzeFile"><span class="mso">auto_awesome</span> AI 分析</button>
            </template>
            <template v-else-if="activeTab === 'skill'">
              <button class="fp-ctx-item" @click="openInEditor"><span class="mso">edit</span> 深度编辑 SKILL.md</button>
              <button v-if="contextMenu.file.mimeType === 'folder'" class="fp-ctx-item" @click="evolveAgentMenu"><span class="mso">model_training</span> 用知识反哺搭子</button>
            </template>
            <template v-else-if="activeTab === 'media'">
              <button class="fp-ctx-item" @click="sendToChat"><span class="mso">message</span> 发送到对话</button>
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

            <div class="fp-ctx-divider"></div>
            <button class="fp-ctx-item" @click="copyFileContent"><span class="mso">content_copy</span> 复制内容</button>
            <button class="fp-ctx-item" @click="downloadFile"><span class="mso">download</span> 下载文件</button>
            <button class="fp-ctx-item" @click="startRename"><span class="mso">edit</span> 重命名</button>
            <button class="fp-ctx-item danger" @click="deleteContextFile"><span class="mso">delete</span> 删除</button>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 空白处全局右键菜单 -->
    <Teleport to="body">
      <div v-if="blankContextMenu.show" class="fp-ctx-overlay" @click="closeBlankContextMenu" @contextmenu.prevent="closeBlankContextMenu">
        <div class="fp-ctx-menu" :style="{ top: blankContextMenu.y + 'px', left: blankContextMenu.x + 'px' }">
          <button class="fp-ctx-item" @click="loadTab(); closeBlankContextMenu()"><span class="mso">refresh</span> 刷新列表</button>
          <button v-if="activeTab === 'text'" class="fp-ctx-item" @click="createNewDoc(); closeBlankContextMenu()"><span class="mso">note_add</span> 新建文档</button>
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
.fp-sort-btn { width: 42px; gap: 2px; flex-shrink: 0; }
.fp-sort-label { font-size: 9px; font-weight: 700; line-height: 1; }
.fp-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.fp-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.fp-item:hover { background: var(--surface); }
.fp-item-name { flex: 1; font-size: 12px; font-weight: 500; color: var(--ink1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.fp-ctx-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.1); }
.fp-ctx-menu { position: fixed; min-width: 160px; padding: 8px; background: #fff; border: 2px solid #ddd; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.25); z-index: 10000; }
.fp-ctx-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px; border: none; border-radius: 6px; background: transparent; color: var(--ink1); font-size: 12px; cursor: pointer; font-family: inherit; }
.fp-ctx-item:hover { background: var(--surface); }
.fp-ctx-item.danger:hover { color: #e53935; }
.fp-ctx-item .mso { font-size: 15px; color: var(--ink2); }
.fp-ctx-divider { height: 1px; background: var(--line); margin: 4px 0; }
/* 面包屑 */
.fp-breadcrumb { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line); background: var(--surface); }
.fp-bread-btn { display: flex; align-items: center; gap: 2px; border: none; background: none; color: var(--olive); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.fp-bread-name { font-size: 12px; font-weight: 600; color: var(--ink1); }
/* 文件夹 */
.fp-item.folder { background: rgba(255,152,0,.04); }
.fp-item.folder:hover { background: rgba(255,152,0,.08); }
/* 选中状态 */
.fp-item.selected, .fp-media-item.selected { background: rgba(107,142,35,.08); border-radius: 6px; }
.fp-media-item.selected .fp-media-thumb { border-color: var(--olive); }

/* 正在编辑标记 */
.fp-item.editing { background: rgba(107,142,35,.06); border-left: 2px solid var(--olive); }
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
