<script setup lang="ts">
/**
 * ProjectFileTree.vue — 项目文件树（VS Code Explorer 1:1 复刻）
 *
 * 顶部：新建文件 / 新建文件夹 / 折叠全部 / 刷新 / 隐藏
 * 左键文件 → 编辑区 | 左键目录 → 展开/折叠
 * 右键文件 → 复制路径/复制相对路径/重命名/删除/电脑打开/编辑区打开
 * 右键目录 → 新建文件/新建文件夹/重命名/删除/电脑打开/复制路径/复制相对路径
 * 键盘：Enter=打开 F2=重命名 Delete=删除
 * 自动刷新：5s 轮询
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useProjectStore } from '@/stores/projectStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { emitEvent, emitEventAsync, onEvent } from '@/utils/eventBus'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { searchItems } from '@/utils/generalSearch'
import { confirmAction } from '@/utils/confirmAction'
import { safePrompt } from '@/utils/safePrompt'
import { copyCanvasFile, createCanvasFile, deleteCanvasFile, renameCanvasFile } from '@/components/canvas/canvasPersistence'
import { resolveProjectVideoThumbnail } from '@/utils/mediaThumbnail'
import { WEB_PROJECT_FILES_CHANNEL, webProjectFiles } from '@/utils/webProjectFiles'
import { buildSaveDialogFilters, saveGeneratedFile } from '@/utils/exportSave'
import { isTextFile } from '@/utils/fileProcessor'
import { classifyProjectResource, type ProjectResource } from '@/utils/projectResource'
import { createRuntimeProjectFileService, emitProjectResourceChange, flattenProjectResourceChange, onProjectResourceChange } from '@/services/projectFileService'
import { openProjectResource } from '@/services/projectExplorerService'
import { createProjectResourceWatcher } from '@/services/projectResourceWatcher'
import {
  exportWebProject,
  importWebProject,
  writeWebProjectEntries,
  type WebProjectCollisionDecision,
  type WebProjectTransferEntry,
} from '@/utils/webProjectTransfer'
import MediaViewer from '@/components/media/MediaViewer.vue'

interface FlatEntry { id?: string; path: string; isDir: boolean; size: number | null; updatedAt?: number; mimeType?: string; content?: string }
interface TreeNode { id?: string; name: string; path: string; isDir: boolean; size?: number; updatedAt?: number; mimeType?: string; content?: string; children: TreeNode[]; expanded: boolean; loaded: boolean; depth: number }
interface VisibleNode { node: TreeNode; indent: number; hasChildren: boolean; isExpanded: boolean }
interface CtxMenu { show: boolean; x: number; y: number; node: TreeNode | null }
interface FilePreview { node: TreeNode; type: 'image' | 'video' | 'audio'; url: string }
interface PendingCollision { path: string; resolve: (decision: WebProjectCollisionDecision) => void }
interface ThumbnailRequest { node: TreeNode; owner: string }
interface DirectoryExportWriter { write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
interface DirectoryExportFileHandle { createWritable(): Promise<DirectoryExportWriter> }
interface DirectoryExportHandle {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryExportHandle>
  getFileHandle(name: string, options: { create: boolean }): Promise<DirectoryExportFileHandle>
}
interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { mode: 'read' | 'readwrite' }) => Promise<DirectoryExportHandle>
}
interface ProjectResourceClipboard { owner: string; runtime: ProjectResource['runtime']; mode: 'copy' | 'cut'; roots: ProjectResource[] }

const projectStore = useProjectStore()
const mediaTaskStore = useMediaTaskStore()
const projectFiles = createRuntimeProjectFileService()
const resourceWatcher = createProjectResourceWatcher()
const isDesktop = isTauriRuntime()
const filterQuery = ref('')
const searchTree = ref<TreeNode | null>(null)
let searchRequestId = 0
const treeRoot = ref<TreeNode | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const selectedPath = ref<string | null>(null)
const selectedPaths = ref<Set<string>>(new Set())
let selectionAnchorPath: string | null = null
const focusedPath = ref<string | null>(null)
const ctxMenu = ref<CtxMenu>({ show: false, x: 0, y: 0, node: null })
const ctxMenuRef = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const directoryInput = ref<HTMLInputElement | null>(null)
const projectDir = computed(() => projectStore.projectDir.value)
const webProjectId = computed(() => projectStore.webProjectId.value)
const projectKey = computed(() => isDesktop ? projectDir.value : webProjectId.value)
const hasProject = computed(() => projectStore.hasProject.value)
const webProjects = ref<Array<{ id: string; name: string }>>([])
const showProjectMenu = ref(false)
const treeDropActive = ref(false)
const filePreview = ref<FilePreview | null>(null)
const pendingCollision = ref<PendingCollision | null>(null)
const pendingDelete = ref<ProjectResource[]>([])
const deletingDelete = ref(false)
const deletingResourceKeys = new Set<string>()
let directoryPickerAction: { kind: 'upload' | 'import'; targetPath: string } = { kind: 'upload', targetPath: '' }
let filePreviewObjectUrl = ''
let filePreviewRequestId = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
const mediaThumbnails = ref<Record<string, string>>({})
const failedMediaThumbnails = ref<Record<string, true>>({})
const loadingMediaThumbnails = new Set<string>()
const queuedMediaThumbnails = new Set<string>()
const mediaThumbnailQueue: ThumbnailRequest[] = []
const MAX_CONCURRENT_THUMBNAILS = 1
let activeMediaThumbnailLoads = 0
let thumbnailPumpScheduled = false
let webProjectChannel: BroadcastChannel | null = null
let stopDesktopProjectFsHints: UnlistenFn | null = null
let loadFileTreeRequestId = 0
const resourceClipboard = ref<ProjectResourceClipboard | null>(null)

/* ─── 构建树 ─── */
function buildTree(entries: FlatEntry[], rootPath: string): TreeNode {
  const root: TreeNode = { name: rootPath.split('/').filter(Boolean).pop() || rootPath, path: '', isDir: true, children: [], expanded: true, loaded: true, depth: 0 }
  const sorted = [...entries].sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.path.localeCompare(b.path) })
  const nodeMap = new Map<string, TreeNode>(); nodeMap.set('', root)
  for (const e of sorted) {
    const parts = e.path.split('/')
    const n: TreeNode = { id: e.id, name: parts[parts.length - 1], path: e.path, isDir: e.isDir, size: e.size ?? undefined, updatedAt: e.updatedAt, mimeType: e.mimeType, content: e.content, children: [], expanded: false, loaded: !e.isDir, depth: parts.length }
    const p = nodeMap.get(parts.slice(0, -1).join('/'))
    if (p) p.children.push(n)
    if (e.isDir) nodeMap.set(e.path, n)
  }
  return root
}
function buildSearchTree(resources: ProjectResource[], rootPath: string): TreeNode {
  const entries = new Map<string, FlatEntry>()
  for (const resource of resources) {
    const parts = resource.path.split('/')
    for (let index = 1; index < parts.length; index++) {
      const path = parts.slice(0, index).join('/')
      entries.set(path, { path, isDir: true, size: null })
    }
    entries.set(resource.path, { id: resource.id, path: resource.path, isDir: resource.isDirectory, size: resource.size ?? null, updatedAt: resource.updatedAt, mimeType: resource.mimeType })
  }
  return buildTree([...entries.values()], rootPath)
}

/* ─── 模糊筛选（fuzzysort + 拼音） ─── */
function fuzzyMatch(name: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  // ponytail: searchItems 带拼音增强，打 "juese" 匹配「角色设计」
  return searchItems(q, [{ name }]).length > 0
}
function nodeMatchesFilter(node: TreeNode, q: string): boolean {
  return fuzzyMatch(node.name, q) || (node.isDir && node.children.some(c => nodeMatchesFilter(c, q)))
}
function flattenVisible(root: TreeNode | null, filter: string): VisibleNode[] {
  if (!root) return []
  const result: VisibleNode[] = []; const q = filter.trim()
  function walk(node: TreeNode) {
    if (!q || fuzzyMatch(node.name, q) || node.children.some(c => nodeMatchesFilter(c, q))) {
      result.push({ node, indent: node.depth, hasChildren: node.isDir, isExpanded: node.expanded })
      if (node.expanded && node.isDir) for (const child of node.children) walk(child)
    }
  }
  for (const child of root.children) walk(child)
  return result
}
const visibleNodes = computed(() => {
  const root = filterQuery.value.trim() ? searchTree.value : treeRoot.value
  return root ? flattenVisible(root, filterQuery.value) : []
})
const fileTreeVirtualizer = useVirtualizer(computed(() => ({
  count: visibleNodes.value.length,
  getScrollElement: () => listEl.value,
  estimateSize: () => 30,
  overscan: 8,
})))
const virtualVisibleNodes = computed(() => fileTreeVirtualizer.value.getVirtualItems()
  .map(row => ({ row, item: visibleNodes.value[row.index] }))
  .filter((entry): entry is { row: ReturnType<typeof fileTreeVirtualizer.value.getVirtualItems>[number]; item: VisibleNode } => Boolean(entry.item)))

/* ─── 保存/恢复展开状态（防止轮询刷新丢失展开） ─── */
function saveExpandState(root: TreeNode | null): Set<string> {
  const set = new Set<string>()
  if (!root) return set
  function walk(n: TreeNode) { if (n.expanded && n.isDir) { set.add(n.path); for (const c of n.children) walk(c) } }
  for (const c of root.children) walk(c)
  return set
}
function restoreExpandState(root: TreeNode | null, expanded: Set<string>) {
  if (!root) return
  for (const c of root.children) { if (c.isDir && expanded.has(c.path)) { c.expanded = true; restoreExpandState(c, expanded) } }
}

/* ─── 加载 ─── */
async function loadFileTree() {
  const requestId = ++loadFileTreeRequestId
  const requestedProjectKey = projectKey.value
  const requestedProjectDir = projectDir.value
  const requestedWebProjectId = webProjectId.value
  const requestedProjectName = projectStore.projectName.value
  if (!requestedProjectKey) { treeRoot.value = null; loading.value = false; return }
  // 保存当前展开状态，刷新后恢复（防止轮询刷新导致全部折叠）
  const expandedPaths = saveExpandState(treeRoot.value)
  loading.value = true; errorMsg.value = ''
  try {
    const resources = await projectFiles.listDirectory(requestedProjectKey, '')
    const nextTree = buildTree(resources.map(resource => ({ id: resource.id, path: resource.path, isDir: resource.isDirectory, size: resource.size ?? null, updatedAt: resource.updatedAt, mimeType: resource.mimeType })), isDesktop ? requestedProjectDir : requestedProjectName)
    if (requestId !== loadFileTreeRequestId || projectKey.value !== requestedProjectKey) return
    restoreExpandState(nextTree, expandedPaths)
    treeRoot.value = nextTree
    const available = new Set(resources.map(resource => resource.path))
    selectedPaths.value = new Set([...selectedPaths.value].filter(path => available.has(path)))
    if (selectedPath.value && !available.has(selectedPath.value)) selectedPath.value = null
    if (focusedPath.value && !available.has(focusedPath.value)) focusedPath.value = null
    if (selectionAnchorPath && !available.has(selectionAnchorPath)) selectionAnchorPath = null
  } catch (e) {
    if (requestId !== loadFileTreeRequestId) return
    errorMsg.value = `加载失败: ${e instanceof Error ? e.message : String(e)}`
    treeRoot.value = null
  } finally {
    if (requestId === loadFileTreeRequestId) loading.value = false
  }
}
function resourceForNode(node: TreeNode): ProjectResource {
  const owner = projectKey.value
  if (!owner) throw new Error('请先选择项目')
  return { runtime: isDesktop ? 'desktop' : 'web', owner, path: node.path, id: node.id, name: node.name, isDirectory: node.isDir, mimeType: node.mimeType, size: node.size, updatedAt: node.updatedAt, kind: node.isDir ? 'binary' : classifyProjectResource({ path: node.path, mimeType: node.mimeType }) }
}
function findLoadedDirectory(path: string): TreeNode | null {
  let node = treeRoot.value
  if (!node) return null
  if (!path) return node
  for (const part of path.split('/')) {
    node = node.children.find(child => child.isDir && child.name === part) || null
    if (!node) return null
  }
  return node
}
async function refreshAffectedDirectory(changedPath: string) {
  const directoryPath = changedPath.split('/').slice(0, -1).join('/')
  const directory = findLoadedDirectory(directoryPath)
  const owner = projectKey.value
  if (!directory || !directory.loaded || !owner) return
  const children = await projectFiles.listDirectory(owner, directoryPath)
  if (owner !== projectKey.value) return
  const previous = new Map(directory.children.map(child => [child.path, child]))
  directory.children = children.map(resource => {
    const old = previous.get(resource.path)
    return {
      id: resource.id, name: resource.name, path: resource.path, isDir: resource.isDirectory,
      size: resource.size, updatedAt: resource.updatedAt, mimeType: resource.mimeType,
      children: old?.children || [], expanded: old?.expanded || false,
      loaded: old?.loaded ?? !resource.isDirectory, depth: resource.path.split('/').length,
    }
  })
}
function resourceKey(resource: ProjectResource): string { return `${resource.runtime}:${resource.owner}:${resource.path}` }
function startPolling() {
  stopPolling()
  if (!isDesktop || !projectKey.value) return
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('dev_watch_project', { root: projectKey.value })).catch(error => {
    errorMsg.value = `实时刷新不可用: ${error instanceof Error ? error.message : String(error)}`
  })
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (!isDesktop || !projectKey.value) return
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('dev_stop_project_watch', { root: projectKey.value })).catch(() => undefined)
}
const offCanvasLocate = onEvent('project-filetree:locate', (payload: any) => {
  const path = payload?.path
  if (path) void locateProjectResource(path)
})
const offWebProjectFilesChanged = onEvent('web-project-files-changed', (payload: unknown) => {
  const changedProjectId = String((payload as { projectId?: string })?.projectId || '')
  if (!isDesktop && changedProjectId && changedProjectId === webProjectId.value) void loadFileTree()
})
const offProjectResourceChanged = onProjectResourceChange(change => {
  let affectsCurrentProject = false
  for (const entry of flattenProjectResourceChange(change)) {
    if (entry.source === 'local') {
      if (entry.type === 'renamed') resourceWatcher.acknowledgeLocal(entry.oldResource.path, entry.oldResource.owner, entry.oldResource.runtime)
      resourceWatcher.acknowledgeLocal(entry.resource.path, entry.resource.owner, entry.resource.runtime)
    }
    if (entry.resource.owner === projectKey.value) {
      const next = new Set(selectedPaths.value)
      if (entry.type === 'renamed' && next.delete(entry.oldResource.path)) next.add(entry.resource.path)
      if (entry.type === 'deleted') next.delete(entry.resource.path)
      selectedPaths.value = next
      if (entry.type === 'renamed' && selectedPath.value === entry.oldResource.path) selectedPath.value = entry.resource.path
      if (entry.type === 'renamed' && focusedPath.value === entry.oldResource.path) focusedPath.value = entry.resource.path
      if (entry.type === 'deleted' && selectedPath.value === entry.resource.path) selectedPath.value = null
      if (entry.type === 'deleted' && focusedPath.value === entry.resource.path) focusedPath.value = null
      const clipboard = resourceClipboard.value
      if (clipboard && clipboard.owner === entry.resource.owner) {
        if (entry.type === 'deleted' && clipboard.roots.some(resource => resource.path === entry.resource.path || resource.path.startsWith(`${entry.resource.path}/`))) resourceClipboard.value = null
        if (entry.type === 'renamed') resourceClipboard.value = { ...clipboard, roots: clipboard.roots.map(resource => resource.path === entry.oldResource.path || resource.path.startsWith(`${entry.oldResource.path}/`) ? { ...resource, path: `${entry.resource.path}${resource.path.slice(entry.oldResource.path.length)}`, name: `${entry.resource.path}${resource.path.slice(entry.oldResource.path.length)}`.split('/').pop()! } : resource) }
      }
    }
    if (entry.resource.owner === projectKey.value) affectsCurrentProject = true
  }
  if (affectsCurrentProject) void loadFileTree()
})

/* ─── 工具函数 ─── */
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','svg','webp','ico','bmp'])
const VIDEO_EXTS = new Set(['mp4','mov','avi','webm','mkv'])
const AUDIO_EXTS = new Set(['mp3','wav','ogg','m4a','flac'])
const CANVAS_EXT = 'jccanvas'
function isCanvasFile(node: TreeNode | null | undefined): node is TreeNode {
  return Boolean(node && !node.isDir && node.name.toLowerCase().endsWith(`.${CANVAS_EXT}`))
}
function iconForNode(node: TreeNode): string {
  if (node.isDir) return node.expanded ? 'folder-open' : 'folder'
  switch (node.name.split('.').pop()?.toLowerCase()) {
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'vue': case 'svelte': return 'code'
    case 'json': case 'yaml': case 'yml': case 'toml': return 'data-object'
    case CANVAS_EXT: return 'dashboard'
    case 'md': case 'txt': case 'csv': return 'article'
    case 'html': case 'css': case 'scss': return 'code'
    case 'py': case 'rs': case 'go': case 'java': case 'c': case 'cpp': case 'h': return 'terminal'
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'image'
    case 'mp4': case 'mov': case 'avi': case 'webm': return 'movie'
    case 'mp3': case 'wav': case 'ogg': return 'music-note'
    case 'pdf': return 'picture-as-pdf'
    case 'zip': case 'tar': case 'gz': return 'folder-managed'
    default: return 'description'
  }
}
function expandAll(root: TreeNode | null) { if (!root) return; root.expanded = true; for (const c of root.children) if (c.isDir) expandAll(c) }
function collapseAll(root: TreeNode | null) { if (!root) return; for (const c of root.children) { c.expanded = false; if (c.isDir) collapseAll(c) } }
async function ensureDirectoryLoaded(node: TreeNode): Promise<boolean> {
  if (!node.isDir || node.loaded) return node.isDir
  try {
    const owner = projectKey.value
    if (!owner) return false
    const children = await projectFiles.listDirectory(owner, node.path)
    if (owner !== projectKey.value) return false
    node.children = children.map(resource => ({
      id: resource.id, name: resource.name, path: resource.path, isDir: resource.isDirectory,
      size: resource.size, updatedAt: resource.updatedAt, mimeType: resource.mimeType,
      children: [], expanded: false, loaded: !resource.isDirectory, depth: resource.path.split('/').length,
    }))
    node.loaded = true
    return true
  } catch (error) {
    errorMsg.value = `读取目录失败: ${error instanceof Error ? error.message : String(error)}`
    return false
  }
}
async function toggleNode(node: TreeNode) {
  if (!node.isDir) return
  if (!node.expanded && !await ensureDirectoryLoaded(node)) return
  node.expanded = !node.expanded
}
async function locateProjectResource(path: string) {
  let node = treeRoot.value
  if (!node) return
  for (const part of path.split('/')) {
    if (!await ensureDirectoryLoaded(node)) return
    node.expanded = true
    const child = node.children.find(item => item.name === part)
    if (!child) return
    node = child
  }
  selectedPaths.value = new Set([path])
  selectedPath.value = path
  focusedPath.value = path
}

/* ─── 左键打开 ─── */
function selectTreeNode(node: TreeNode, event?: MouseEvent) {
  const next = new Set(selectedPaths.value)
  if (event?.shiftKey && selectionAnchorPath) {
    const start = visibleNodes.value.findIndex(item => item.node.path === selectionAnchorPath)
    const end = visibleNodes.value.findIndex(item => item.node.path === node.path)
    if (start >= 0 && end >= 0) {
      next.clear()
      for (const item of visibleNodes.value.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(item.node.path)
    }
  } else if (event && (event.metaKey || event.ctrlKey)) {
    if (next.has(node.path)) next.delete(node.path)
    else next.add(node.path)
  } else {
    next.clear()
    next.add(node.path)
  }
  if (!event?.shiftKey) selectionAnchorPath = node.path
  selectedPaths.value = next
  selectedPath.value = node.path
  focusedPath.value = node.path
}
function clearProjectSelection() {
  selectedPaths.value = new Set()
  selectedPath.value = null
  focusedPath.value = null
  selectionAnchorPath = null
}
function selectedResources(): ProjectResource[] {
  return visibleNodes.value.filter(item => selectedPaths.value.has(item.node.path)).map(item => resourceForNode(item.node))
}
async function openFile(node: TreeNode, event?: MouseEvent) {
  selectTreeNode(node, event)
  if (node.isDir) {
    selectedPath.value = node.path
    focusedPath.value = node.path
    await toggleNode(node)
    return
  }
  const resource = resourceForNode(node)
  const result = await openProjectResource(projectFiles, resource)
  if (result.type === 'canvas') {
    emitEvent('canvas:open', { path: result.resource.path })
    emitEvent('switch-panel', 'creation')
    return
  }
  if (result.type === 'media') {
    emitEvent('canvas:add-media', { projectId: projectKey.value, path: result.resource.path, kind: result.mediaKind, label: result.resource.name })
    emitEvent('switch-panel', 'creation')
    return
  }
  if (result.type === 'unsafe-text') {
    errorMsg.value = '文件过大或包含二进制内容，不能在编辑区安全编辑'
    return
  }
  if (result.type === 'editor') {
    emitEvent('open-in-editor', { resource: result.resource, content: result.text.content, revision: result.text.revision, filePath: isDesktop ? node.path : undefined, fileId: isDesktop ? undefined : node.id, name: node.name, projectDir: projectDir.value })
    emitEvent('switch-panel', 'editor')
    return
  }
  if (isDesktop) try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_in_shell', { path: projectDir.value + '/' + node.path })
  } catch { /* */ }
}

/* ─── 右键菜单 ─── */
// ponytail: 菜单边缘检测，靠近底部向上翻，靠近右侧向左翻
const CTX_MENU_EST_HEIGHT = 320
const CTX_MENU_EST_WIDTH = 220
function clampCtxMenu(clientX: number, clientY: number) {
  let x = clientX
  let y = clientY
  if (y + CTX_MENU_EST_HEIGHT > window.innerHeight) y = Math.max(0, window.innerHeight - CTX_MENU_EST_HEIGHT - 8)
  if (x + CTX_MENU_EST_WIDTH > window.innerWidth) x = Math.max(0, window.innerWidth - CTX_MENU_EST_WIDTH - 8)
  return { x, y }
}
function onContextMenu(e: MouseEvent, node: TreeNode) { e.preventDefault(); e.stopPropagation(); if (!selectedPaths.value.has(node.path)) selectTreeNode(node); const { x, y } = clampCtxMenu(e.clientX, e.clientY); ctxMenu.value = { show: true, x, y, node } }
/** 右键空白区域 */
function onEmptyContextMenu(e: MouseEvent) { clearProjectSelection(); e.preventDefault(); const { x, y } = clampCtxMenu(e.clientX, e.clientY); ctxMenu.value = { show: true, x, y, node: null } }
function closeCtxMenu() { ctxMenu.value.show = false }
function onCtxMenuClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (ctxMenuRef.value && !ctxMenuRef.value.contains(target)) closeCtxMenu()
  if (showProjectMenu.value && !target.closest('.pft-project-menu') && !target.closest('.pft-project-trigger')) showProjectMenu.value = false
}
async function ctxCopyPath() { const n = ctxMenu.value.node; if (n) try { await navigator.clipboard.writeText(isDesktop ? projectDir.value + '/' + n.path : `${projectStore.projectName.value}/${n.path}`) } catch { /* */ }; closeCtxMenu() }
async function ctxCopyRelativePath() { const n = ctxMenu.value.node; if (n) try { await navigator.clipboard.writeText(n.path) } catch { /* */ }; closeCtxMenu() }
function ctxCopyResources() {
  const roots = selectedResources()
  if (roots.length) resourceClipboard.value = { owner: roots[0].owner, runtime: roots[0].runtime, mode: 'copy', roots }
  closeCtxMenu()
}
function ctxCutResources() {
  const roots = selectedResources()
  if (roots.length) resourceClipboard.value = { owner: roots[0].owner, runtime: roots[0].runtime, mode: 'cut', roots }
  closeCtxMenu()
}
function isCutResource(path: string): boolean {
  const clipboard = resourceClipboard.value
  return Boolean(clipboard?.mode === 'cut' && clipboard.roots.some(root => path === root.path || (root.isDirectory && path.startsWith(`${root.path}/`))))
}
async function prepareBatchCanvasLifecycle(plan: Awaited<ReturnType<typeof projectFiles.planBatch>>, policy?: 'keep-both' | 'overwrite') {
  const resources = await projectFiles.list(plan.owner)
  const affects = (resource: ProjectResource, root: ProjectResource) => resource.path === root.path || (root.isDirectory && resource.path.startsWith(`${root.path}/`))
  const sources = plan.kind === 'copy' ? [] : resources.filter(resource => resource.kind === 'canvas' && plan.roots.some(root => affects(resource, root)))
  const overwritten = policy === 'overwrite'
    ? resources.filter(resource => resource.kind === 'canvas' && plan.conflicts.some(conflict => resource.path === conflict.targetPath || (conflict.target?.isDirectory && resource.path.startsWith(`${conflict.targetPath}/`))))
    : []
  const gates: Array<{ path: string; owner: string; lifecycleId: string; release?: () => void; event: 'canvas:before-rename' | 'canvas:before-delete' }> = []
  try {
    for (const resource of [...sources, ...overwritten]) {
      const event = overwritten.includes(resource) ? 'canvas:before-delete' : plan.kind === 'move' ? 'canvas:before-rename' : 'canvas:before-delete'
      const gate = { path: resource.path, owner: plan.owner, lifecycleId: crypto.randomUUID(), event }
      gates.push(gate)
      await emitEventAsync(event, gate)
      if (projectKey.value !== plan.owner) throw new Error('项目已切换，请重试')
      if (mediaTaskStore.hasPendingCanvasWrite(plan.owner, resource.path)) throw new Error('画布有待写入的生成结果，请稍候')
    }
    return gates
  } catch (error) {
    gates.forEach(gate => emitEvent('canvas:lifecycle-failed', gate))
    throw error
  }
}
function completeBatchCanvasLifecycle(result: Awaited<ReturnType<typeof projectFiles.executeBatch>>, gates: Awaited<ReturnType<typeof prepareBatchCanvasLifecycle>>) {
  const changes = result.change ? flattenProjectResourceChange(result.change) : []
  for (const gate of gates) {
    const renamed = changes.find(change => change.type === 'renamed' && change.oldResource.path === gate.path)
    if (renamed?.type === 'renamed') emitEvent('canvas:renamed', { oldPath: gate.path, newPath: renamed.resource.path, owner: gate.owner, lifecycleId: gate.lifecycleId, release: gate.release })
    else emitEvent('canvas:deleted', { path: gate.path, owner: gate.owner, lifecycleId: gate.lifecycleId, release: gate.release })
  }
}
async function ctxPasteResources(target?: TreeNode | null) {
  const clipboard = resourceClipboard.value
  const owner = projectKey.value
  if (!clipboard || !owner || clipboard.owner !== owner || clipboard.runtime !== (isDesktop ? 'desktop' : 'web')) return
  try {
    const targetResource = target?.isDir
      ? resourceForNode(target)
      : { runtime: clipboard.runtime, owner, path: '', name: '', isDirectory: true, kind: 'binary' as const }
    const plan = await projectFiles.planBatch({ kind: clipboard.mode === 'cut' ? 'move' : 'copy', resources: clipboard.roots, targetDirectory: targetResource })
    const policy = plan.conflicts.length ? await requestCollision(plan.conflicts[0].targetPath) : undefined
    if (policy === 'cancel') return
    const gates = await prepareBatchCanvasLifecycle(plan, policy)
    try { completeBatchCanvasLifecycle(await projectFiles.executeBatch(plan, policy), gates) }
    catch (error) { gates.forEach(gate => emitEvent('canvas:lifecycle-failed', gate)); throw error }
    if (clipboard.mode === 'cut') resourceClipboard.value = null
    await loadFileTree()
  } catch (error) { errorMsg.value = `粘贴失败: ${error instanceof Error ? error.message : String(error)}` }
  finally { closeCtxMenu() }
}
/** 复制项目根路径到剪贴板 */
async function ctxCopyProjectPath() { try { await navigator.clipboard.writeText(isDesktop ? projectDir.value : projectStore.projectName.value) } catch { /* */ }; closeCtxMenu() }
async function ctxReveal() { const n = ctxMenu.value.node; if (n && isDesktop) try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('dev_reveal_in_finder', { path: projectDir.value + '/' + n.path }) } catch { /* */ }; closeCtxMenu() }
function isCanvasMediaFile(node: TreeNode | null | undefined): boolean {
  if (!node || node.isDir) return false
  const ext = (node.name || '').split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)
}
function isCanvasAddableMediaResource(node: TreeNode | null | undefined): boolean {
  if (!node || node.isDir) return false
  return resourceForNode(node).kind === 'media'
}
function previewType(node: TreeNode | null | undefined): FilePreview['type'] | null {
  if (!node || node.isDir) return null
  if (node.mimeType?.startsWith('image/')) return 'image'
  if (node.mimeType?.startsWith('video/')) return 'video'
  if (node.mimeType?.startsWith('audio/')) return 'audio'
  const ext = node.name.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  return null
}
function mediaThumbnailUrl(node: TreeNode) {
  return mediaThumbnails.value[node.path] || ''
}
function mediaThumbnailKey(owner: string, path: string) {
  return `${owner}:${path}`
}
async function loadMediaThumbnail(node: TreeNode, owner: string) {
  const key = mediaThumbnailKey(owner, node.path)
  if (!isDesktop || !owner || !isCanvasMediaFile(node) || mediaThumbnails.value[node.path] || failedMediaThumbnails.value[node.path] || loadingMediaThumbnails.has(key)) return
  loadingMediaThumbnails.add(key)
  try {
    const ext = node.name.split('.').pop()?.toLowerCase() || ''
    const thumbnail = VIDEO_EXTS.has(ext)
      ? await resolveProjectVideoThumbnail(owner, node.path)
      : (await import('@tauri-apps/api/core')).convertFileSrc(`${owner}/${node.path}`)
    if (!thumbnail) throw new Error('媒体缩略图为空')
    if (owner !== projectKey.value) return
    mediaThumbnails.value = { ...mediaThumbnails.value, [node.path]: thumbnail }
  } catch {
    if (owner === projectKey.value) failedMediaThumbnails.value = { ...failedMediaThumbnails.value, [node.path]: true }
  } finally {
    loadingMediaThumbnails.delete(key)
  }
}
function pumpMediaThumbnailQueue() {
  thumbnailPumpScheduled = false
  while (activeMediaThumbnailLoads < MAX_CONCURRENT_THUMBNAILS && mediaThumbnailQueue.length) {
    const { node, owner } = mediaThumbnailQueue.shift()!
    const key = mediaThumbnailKey(owner, node.path)
    if (owner !== projectKey.value || mediaThumbnails.value[node.path] || failedMediaThumbnails.value[node.path]) {
      queuedMediaThumbnails.delete(key)
      continue
    }
    activeMediaThumbnailLoads++
    void loadMediaThumbnail(node, owner).finally(() => {
      activeMediaThumbnailLoads--
      queuedMediaThumbnails.delete(key)
      scheduleMediaThumbnailPump()
    })
  }
}
function scheduleMediaThumbnailPump() {
  if (thumbnailPumpScheduled) return
  thumbnailPumpScheduled = true
  if ('requestIdleCallback' in window) window.requestIdleCallback(pumpMediaThumbnailQueue, { timeout: 500 })
  else setTimeout(pumpMediaThumbnailQueue, 200)
}
function enqueueMediaThumbnail(node: TreeNode) {
  const owner = projectKey.value
  const key = mediaThumbnailKey(owner, node.path)
  if (!isDesktop || !owner || !isCanvasMediaFile(node) || mediaThumbnails.value[node.path] || failedMediaThumbnails.value[node.path] || queuedMediaThumbnails.has(key)) return
  queuedMediaThumbnails.add(key)
  mediaThumbnailQueue.push({ node, owner })
  scheduleMediaThumbnailPump()
}
function queueRenderedMediaThumbnail(el: Element | null, node: TreeNode) {
  if (!el) return
  enqueueMediaThumbnail(node)
}
function ctxOpenInCanvas() {
  const n = ctxMenu.value.node
  closeCtxMenu()
  if (n && !n.isDir) void openFile(n)
}
async function ctxOpenInSystem() {
  const n = ctxMenu.value.node
  closeCtxMenu()
  if (!n || n.isDir || !isDesktop) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_in_shell', { path: projectDir.value + '/' + n.path })
  } catch { /* */ }
}
async function ctxNewCanvas() {
  closeCtxMenu()
  try {
    const { file } = await createCanvasFile()
    await loadFileTree()
    emitEvent('canvas:open', { path: file.path })
    emitEvent('switch-panel', 'creation')
  } catch (e) { errorMsg.value = `新建画布失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxCopyCanvas() {
  const n = ctxMenu.value.node; if (!isCanvasFile(n)) return; closeCtxMenu()
  try { await copyCanvasFile(n.path); await loadFileTree() }
  catch (e) { errorMsg.value = `复制画布失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxRenameCanvas() {
  const n = ctxMenu.value.node; if (!isCanvasFile(n)) return; closeCtxMenu()
  const name = await safePrompt('画布名称', n.name.replace(/\.jccanvas$/i, ''))
  if (!name?.trim()) return
  const owner = projectKey.value
  if (!owner) return
  const lifecycle: { path: string; owner: string; lifecycleId: string; release?: () => void } = { path: n.path, owner, lifecycleId: crypto.randomUUID() }
  let completed = false
  try {
    await emitEventAsync('canvas:before-rename', lifecycle)
    if (owner !== projectKey.value) throw new Error('项目已切换，请重试')
    if (mediaTaskStore.hasPendingCanvasWrite(owner, n.path)) throw new Error('画布有待写入的生成结果，请稍候')
    const file = await renameCanvasFile(n.path, name, owner)
    completed = true
    emitProjectResourceChange({ type: 'renamed', oldResource: resourceForNode(n), resource: { ...resourceForNode(n), path: file.path, name: file.name, kind: 'canvas' }, transactionId: lifecycle.lifecycleId, operationId: lifecycle.lifecycleId, source: 'local' })
    emitEvent('canvas:renamed', { oldPath: n.path, newPath: file.path, owner, lifecycleId: lifecycle.lifecycleId, release: lifecycle.release })
    await loadFileTree()
  } catch (e) {
    if (!completed) emitEvent('canvas:lifecycle-failed', lifecycle)
    errorMsg.value = `重命名画布失败: ${e instanceof Error ? e.message : String(e)}`
  }
}
async function ctxDeleteCanvas() {
  const n = ctxMenu.value.node; if (!isCanvasFile(n)) return; closeCtxMenu()
  if (!await confirmAction(`确定删除画布「${n.name}」？图片素材不会删除。`)) return
  const owner = projectKey.value
  if (!owner) return
  const lifecycle: { path: string; owner: string; lifecycleId: string; release?: () => void } = { path: n.path, owner, lifecycleId: crypto.randomUUID() }
  let completed = false
  try {
    await emitEventAsync('canvas:before-delete', lifecycle)
    if (owner !== projectKey.value) throw new Error('项目已切换，请重试')
    if (mediaTaskStore.hasPendingCanvasWrite(owner, n.path)) throw new Error('画布有待写入的生成结果，请稍候')
    await deleteCanvasFile(n.path, owner)
    completed = true
    emitProjectResourceChange({ type: 'deleted', resource: resourceForNode(n), transactionId: lifecycle.lifecycleId, operationId: lifecycle.lifecycleId, source: 'local' })
    emitEvent('canvas:deleted', { path: n.path, owner, lifecycleId: lifecycle.lifecycleId, release: lifecycle.release })
    await loadFileTree()
  }
  catch (e) {
    if (!completed) emitEvent('canvas:lifecycle-failed', lifecycle)
    errorMsg.value = `删除画布失败: ${e instanceof Error ? e.message : String(e)}`
  }
}
function ctxOpen() { const n = ctxMenu.value.node; closeCtxMenu(); if (n && !n.isDir) openFile(n) }
/** 右键空白 → 切换项目文件夹（当前单根架构，后续可升级为 VS Code 多根 workspace） */
async function ctxAddProjectFolder() {
  closeCtxMenu()
  if (!isDesktop) {
    await refreshWebProjects()
    showProjectMenu.value = true
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const dir = await invoke<string | null>('pick_project_folder')
    if (dir) projectStore.selectProject(dir)
  } catch (e) { errorMsg.value = `选择文件夹失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function refreshWebProjects() {
  const projects = await webProjectFiles.listProjects()
  webProjects.value = projects.map(project => ({ id: project.id, name: project.name }))
  if (webProjectId.value && !projects.some(project => project.id === webProjectId.value)) {
    projectStore.clearWebProject()
  }
}
function selectWebProject(project: { id: string; name: string }) {
  projectStore.selectWebProject(project)
  showProjectMenu.value = false
}
async function createWebProject() {
  const name = await safePrompt('新建项目名称', '未命名项目')
  if (!name?.trim()) return
  const project = await webProjectFiles.createProject(name.trim())
  webProjects.value.push({ id: project.id, name: project.name })
  selectWebProject(project)
}
async function ctxNewFile() {
  const parentNode = ctxMenu.value.node
  const dirRel = parentNode?.isDir ? parentNode.path : ''
  closeCtxMenu()
  const name = await safePrompt('新建文件名（含扩展名）', 'untitled.txt')
  if (!name?.trim()) return
  const relPath = dirRel ? dirRel + '/' + name.trim().replace(/^\/+/, '') : name.trim().replace(/^\/+/, '')
  createFileAt(relPath)
}
async function ctxNewFolder() {
  const parentNode = ctxMenu.value.node
  const dirRel = parentNode?.isDir ? parentNode.path : ''
  closeCtxMenu()
  const name = await safePrompt('新建文件夹名', 'new-folder')
  if (!name?.trim()) return
  const relPath = (dirRel ? dirRel + '/' : '') + name.trim().replace(/^\/+/, '')
  try {
    await projectFiles.createFolder(projectKey.value, relPath)
    await loadFileTree()
  }
  catch (e) { errorMsg.value = `创建文件夹失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function createFileAt(relPath: string) {
  try {
    await projectFiles.createText(projectKey.value, relPath, '')
    await loadFileTree()
  }
  catch (e) { errorMsg.value = `创建失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxRename() {
  const n = ctxMenu.value.node; if (!n) return; closeCtxMenu()
  const newName = await safePrompt('重命名', n.name)
  if (!newName?.trim() || newName.trim() === n.name) return
  try {
    await projectFiles.rename(resourceForNode(n), newName.trim())
    await loadFileTree()
  }
  catch (e) { errorMsg.value = `重命名失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxDelete() {
  const n = ctxMenu.value.node; if (!n) return; closeCtxMenu()
  const resources = selectedResources()
  if (!resources.length || resources.some(resource => deletingResourceKeys.has(resourceKey(resource)))) return
  errorMsg.value = ''
  pendingDelete.value = resources
}
function cancelDelete() {
  if (!deletingDelete.value) pendingDelete.value = []
}
function isMissingProjectResourceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('项目内路径不可访问') && /no such file or directory|not found/i.test(message)
}
async function confirmDelete() {
  const resources = pendingDelete.value
  if (!resources.length || resources.some(resource => deletingResourceKeys.has(resourceKey(resource)))) return
  if (resources.some(resource => resource.owner !== projectKey.value)) {
    pendingDelete.value = []
    errorMsg.value = '项目已切换，已取消删除'
    return
  }
  deletingDelete.value = true
  resources.forEach(resource => deletingResourceKeys.add(resourceKey(resource)))
  try {
    const plan = await projectFiles.planBatch({ kind: 'delete', resources })
    const gates = await prepareBatchCanvasLifecycle(plan)
    try { completeBatchCanvasLifecycle(await projectFiles.executeBatch(plan), gates) }
    catch (error) { gates.forEach(gate => emitEvent('canvas:lifecycle-failed', gate)); throw error }
    await loadFileTree()
    pendingDelete.value = []
  }
  catch (error) {
    if (isMissingProjectResourceError(error)) {
      await loadFileTree()
      pendingDelete.value = []
      return
    }
    errorMsg.value = `移入废纸篓失败: ${error instanceof Error ? error.message : String(error)}`
  }
  finally {
    deletingDelete.value = false
    resources.forEach(resource => deletingResourceKeys.delete(resourceKey(resource)))
  }
}

function relativePathForFile(file: File): string {
  return String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
}
function uploadPathForFile(file: File, targetPath: string): string {
  const path = relativePathForFile(file).replace(/^[\\/]+/, '')
  return targetPath ? `${targetPath.replace(/\/+$/, '')}/${path}` : path
}
function transferEntryForFile(file: File, path: string): WebProjectTransferEntry {
  const text = isTextFile(file)
  const mimeType = file.type || (text ? 'text/plain' : 'application/octet-stream')
  return {
    path,
    kind: text ? 'text' : 'binary',
    category: text ? 'text' : mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'binary',
    mimeType,
    blob: file,
  }
}
function requestCollision(path: string): Promise<WebProjectCollisionDecision> {
  return new Promise(resolve => { pendingCollision.value = { path, resolve } })
}
function chooseCollision(decision: WebProjectCollisionDecision) {
  const pending = pendingCollision.value
  if (!pending) return
  pendingCollision.value = null
  pending.resolve(decision)
}
async function uploadWebFiles(files: File[], targetPath = '') {
  const projectId = webProjectId.value
  if (isDesktop || !projectId || !files.length) return
  try {
    await writeWebProjectEntries(
      webProjectFiles,
      projectId,
      files.map(file => transferEntryForFile(file, uploadPathForFile(file, targetPath))),
      { resolveCollision: ({ path }) => requestCollision(path) },
    )
    if (projectId === webProjectId.value) await loadFileTree()
  } catch (error) {
    errorMsg.value = `上传失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
async function importDesktopFiles(targetPath = '') {
  const owner = projectDir.value
  if (!owner) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const imported = await invoke<string[] | null>('dev_import_project_files', {
      input: { root: owner, targetRelativePath: targetPath },
    })
    if (imported && owner === projectDir.value) await loadFileTree()
  } catch (error) {
    errorMsg.value = `上传失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
async function importDesktopDirectory(targetPath = '') {
  const owner = projectDir.value
  if (!owner) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const imported = await invoke<string | null>('dev_import_project_folder', {
      input: { root: owner, targetRelativePath: targetPath },
    })
    if (imported && owner === projectDir.value) await loadFileTree()
  } catch (error) {
    errorMsg.value = `上传文件夹失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
function openFileUpload(targetPath = '') {
  if (isDesktop) {
    void importDesktopFiles(targetPath)
    return
  }
  directoryPickerAction = { kind: 'upload', targetPath }
  uploadInput.value?.click()
}
function openDirectoryUpload(targetPath = '') {
  if (isDesktop) {
    void importDesktopDirectory(targetPath)
    return
  }
  directoryPickerAction = { kind: 'upload', targetPath }
  directoryInput.value?.click()
}
async function onUploadInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await uploadWebFiles(files, directoryPickerAction.targetPath)
}
async function importWebDirectory(files: File[]) {
  if (!files.length) return
  const folderName = relativePathForFile(files[0]).split('/').filter(Boolean)[0]
  if (!folderName) throw new Error('请选择项目文件夹')
  const result = await importWebProject(
    webProjectFiles,
    folderName,
    files.map(file => transferEntryForFile(file, relativePathForFile(file))),
    { resolveCollision: ({ path }) => requestCollision(path) },
  )
  await refreshWebProjects()
  selectWebProject(result.project)
}
async function onDirectoryInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  const action = directoryPickerAction
  input.value = ''
  try {
    if (action.kind === 'import') await importWebDirectory(files)
    else await uploadWebFiles(files, action.targetPath)
  } catch (error) {
    errorMsg.value = `导入失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
function ctxUploadFiles() {
  const targetPath = ctxMenu.value.node?.isDir ? ctxMenu.value.node.path : ''
  closeCtxMenu()
  openFileUpload(targetPath)
}
function ctxUploadDirectory() {
  const targetPath = ctxMenu.value.node?.isDir ? ctxMenu.value.node.path : ''
  closeCtxMenu()
  openDirectoryUpload(targetPath)
}
async function ctxImportProject() {
  closeCtxMenu()
  if (isDesktop) {
    await ctxAddProjectFolder()
    return
  }
  directoryPickerAction = { kind: 'import', targetPath: '' }
  directoryInput.value?.click()
}
async function existingExportFile(directory: DirectoryExportHandle, filename: string): Promise<DirectoryExportFileHandle | undefined> {
  try {
    return await directory.getFileHandle(filename, { create: false })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
    throw error
  }
}
async function writeProjectExportEntry(root: DirectoryExportHandle, entry: WebProjectTransferEntry) {
  const parts = entry.path.split('/')
  const filename = parts.pop()
  if (!filename) return
  let directory = root
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true })
  let targetName = filename
  let file = await existingExportFile(directory, filename)
  if (file) {
    const collision = await requestCollision(entry.path)
    if (collision === 'cancel') return
    if (collision === 'keep-both') {
      const dotIndex = filename.lastIndexOf('.')
      const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
      const extension = dotIndex > 0 ? filename.slice(dotIndex) : ''
      for (let index = 1; ; index += 1) {
        const candidateName = `${base} (${index})${extension}`
        if (!await existingExportFile(directory, candidateName)) {
          targetName = candidateName
          file = undefined
          break
        }
      }
    }
  }
  const target = file || await directory.getFileHandle(targetName, { create: true })
  const writer = await target.createWritable()
  try {
    await writer.write(entry.blob)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}
async function ctxExportProject() {
  closeCtxMenu()
  if (isDesktop) {
    await exportDesktopProject()
    return
  }
  const projectId = webProjectId.value
  const pickerWindow = typeof window === 'undefined' ? undefined : window as Window & DirectoryPickerWindow
  if (!projectId || !pickerWindow?.showDirectoryPicker) {
    errorMsg.value = '当前浏览器不支持选择导出文件夹'
    return
  }
  try {
    const directory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' })
    for (const entry of await exportWebProject(webProjectFiles, projectId)) {
      await writeProjectExportEntry(directory, entry)
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    errorMsg.value = `导出失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
async function ctxExportSelected() {
  closeCtxMenu()
  const roots = selectedResources()
  if (!roots.length) return
  if (isDesktop) {
    const owner = projectDir.value
    if (!owner) return
    try {
      const [{ open }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core'),
      ])
      const destination = await open({ directory: true, multiple: false, title: '选择导出位置' })
      if (!destination || Array.isArray(destination)) return
      try {
        await invoke('dev_export_project_paths', { input: { root: owner, relativePaths: roots.map(root => root.path), destinationDirectory: destination } })
      } catch (error) {
        if (!String(error).includes('导出目标已存在')) throw error
        const policy = await requestCollision('导出目标已存在')
        if (policy === 'cancel') return
        await invoke('dev_export_project_paths', { input: { root: owner, relativePaths: roots.map(root => root.path), destinationDirectory: destination, policy } })
      }
    } catch (error) { errorMsg.value = `导出所选资源失败: ${error instanceof Error ? error.message : String(error)}` }
    return
  }
  const projectId = webProjectId.value
  const pickerWindow = typeof window === 'undefined' ? undefined : window as Window & DirectoryPickerWindow
  if (!projectId || !pickerWindow?.showDirectoryPicker) { errorMsg.value = '当前浏览器不支持选择导出文件夹'; return }
  try {
    const directory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' })
    const includes = (path: string) => roots.some(root => path === root.path || (root.isDirectory && path.startsWith(`${root.path}/`)))
    for (const entry of await exportWebProject(webProjectFiles, projectId)) if (includes(entry.path)) await writeProjectExportEntry(directory, entry)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    errorMsg.value = `导出所选资源失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
async function exportDesktopProject() {
  const owner = projectDir.value
  if (!owner) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<string | null>('dev_export_project', { input: { root: owner } })
  } catch (error) {
    errorMsg.value = `导出失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
function releaseFilePreviewUrl() {
  if (filePreviewObjectUrl) URL.revokeObjectURL(filePreviewObjectUrl)
  filePreviewObjectUrl = ''
}
function closeFilePreview() {
  filePreviewRequestId++
  releaseFilePreviewUrl()
  filePreview.value = null
}
async function openFilePreview(node: TreeNode) {
  const type = previewType(node)
  if (!type) return
  const requestId = ++filePreviewRequestId
  releaseFilePreviewUrl()
  filePreview.value = null
  let objectUrl = ''
  try {
    let url: string
    if (isDesktop) {
      url = (await import('@tauri-apps/api/core')).convertFileSrc(`${projectDir.value}/${node.path}`)
      if (requestId !== filePreviewRequestId) return
    } else {
      const entry = await webProjectFiles.read(webProjectId.value, node.path)
      if (requestId !== filePreviewRequestId) return
      if (entry.metadata?.binaryStorage === 'opfs') {
        objectUrl = URL.createObjectURL(await webProjectFiles.readBinary(webProjectId.value, node.path))
        if (requestId !== filePreviewRequestId) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        url = objectUrl
      } else {
        url = entry.content
      }
    }
    if (requestId !== filePreviewRequestId) return
    if (!url) throw new Error('媒体文件为空')
    filePreviewObjectUrl = objectUrl
    filePreview.value = { node, type, url }
  } catch (error) {
    if (requestId !== filePreviewRequestId) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      return
    }
    releaseFilePreviewUrl()
    errorMsg.value = `预览失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
function ctxPreview() {
  const node = ctxMenu.value.node
  closeCtxMenu()
  if (node && !node.isDir) void openFilePreview(node)
}
async function saveNodeAs(node: TreeNode) {
  const owner = projectKey.value
  if (!owner) return
  if (isDesktop) {
    const [{ save }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ])
    const destinationPath = await save({
      defaultPath: node.name,
      filters: buildSaveDialogFilters(node.name),
    })
    if (!destinationPath) return
    if (owner !== projectKey.value) return
    await invoke('dev_save_project_file_as', {
      input: { root: owner, relativePath: node.path, destinationPath },
    })
    return
  }
  const entry = await webProjectFiles.read(owner, node.path)
  if (owner !== projectKey.value) return
  const data = entry.metadata?.binaryStorage === 'opfs'
    ? await webProjectFiles.readBinary(owner, node.path)
    : entry.content
  if (owner !== projectKey.value) return
  await saveGeneratedFile({ filename: entry.name, mimeType: entry.mimeType, data })
}
async function ctxSaveAs() {
  const node = ctxMenu.value.node
  closeCtxMenu()
  if (!node || node.isDir) return
  try {
    await saveNodeAs(node)
  } catch (error) {
    errorMsg.value = `另存为失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
async function downloadFilePreview() {
  const preview = filePreview.value
  if (!preview) return
  try {
    await saveNodeAs(preview.node)
  } catch (error) {
    errorMsg.value = `另存为失败: ${error instanceof Error ? error.message : String(error)}`
  }
}
function onTreeDragOver(event: DragEvent) {
  if (isDesktop || !event.dataTransfer?.types.includes('Files')) return
  event.dataTransfer.dropEffect = 'copy'
  treeDropActive.value = true
}
function onTreeDragLeave() {
  treeDropActive.value = false
}
function onTreeDrop(event: DragEvent, targetPath = '') {
  treeDropActive.value = false
  if (isDesktop) return
  void uploadWebFiles(Array.from(event.dataTransfer?.files || []), targetPath)
}
function onNodeDrop(event: DragEvent, node: TreeNode) {
  const internal = event.dataTransfer?.getData('application/x-jc-project-resources')
  if (internal) {
    void ctxPasteResources(node)
    return
  }
  const targetPath = node.isDir ? node.path : node.path.split('/').slice(0, -1).join('/')
  onTreeDrop(event, targetPath)
}
function onNodeDragStart(event: DragEvent, node: TreeNode) {
  selectTreeNode(node)
  const roots = selectedResources()
  if (roots.length) resourceClipboard.value = { owner: roots[0].owner, runtime: roots[0].runtime, mode: 'cut', roots }
  event.dataTransfer?.setData('application/x-jc-project-resources', node.path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

/* ─── 顶部按钮 ─── */
function selectedDirectoryNode(): TreeNode | null {
  const path = selectedPath.value
  if (!path || !treeRoot.value) return null
  const stack = [...treeRoot.value.children]
  while (stack.length) {
    const node = stack.pop()!
    if (node.path === path) return node.isDir ? node : null
    if (node.isDir) stack.push(...node.children)
  }
  return null
}
function useSelectedDirectoryAsCreationTarget() {
  ctxMenu.value = { show: false, x: 0, y: 0, node: selectedDirectoryNode() || treeRoot.value }
}
function ctxNewFileFromSelection() { useSelectedDirectoryAsCreationTarget(); void ctxNewFile() }
function ctxNewFolderFromSelection() { useSelectedDirectoryAsCreationTarget(); void ctxNewFolder() }
function doCollapseAll() {
  /* ponytail: clone → collapse → assign. Mutating the reactive proxy then cloning
     can race with Vue's async scheduling, causing the computed to re-eval against
     a half-mutated tree. Clone first, collapse the plain object, then replace. */
  const clone = treeRoot.value ? JSON.parse(JSON.stringify(treeRoot.value)) : null
  collapseAll(clone)
  treeRoot.value = clone
}
function toggleFileTree() { emitEvent('toggle-file-tree') }

/* ─── 键盘导航 ─── */
function onTreeKeydown(e: KeyboardEvent) {
  if (!focusedPath.value || !visibleNodes.value.length) return
  const idx = visibleNodes.value.findIndex(v => v.node.path === focusedPath.value)
  if (idx === -1) return
  const node = visibleNodes.value[idx].node
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'c') { e.preventDefault(); ctxCopyResources(); return }
    if (e.key.toLowerCase() === 'x') { e.preventDefault(); ctxCutResources(); return }
    if (e.key.toLowerCase() === 'v') { e.preventDefault(); void ctxPasteResources(selectedDirectoryNode()); return }
  }
  switch (e.key) {
    case 'Enter': e.preventDefault(); openFile(node); break
    case 'F2': e.preventDefault(); ctxMenu.value = { show: false, x: 0, y: 0, node }; ctxRename(); break
    case 'Backspace': case 'Delete': e.preventDefault(); ctxMenu.value = { show: false, x: 0, y: 0, node }; ctxDelete(); break
    case 'ArrowDown': e.preventDefault(); if (idx + 1 < visibleNodes.value.length) focusedPath.value = visibleNodes.value[idx + 1].node.path; break
    case 'ArrowUp': e.preventDefault(); if (idx > 0) focusedPath.value = visibleNodes.value[idx - 1].node.path; break
    case 'ArrowLeft': e.preventDefault(); if (node.isDir && node.expanded) toggleNode(node); break
    case 'ArrowRight': e.preventDefault(); if (node.isDir && !node.expanded) toggleNode(node); else openFile(node); break
  }
}

/* ─── 自动定位：编辑器打开文件时，文件树选中对应节点 ─── */
const offEditorChanged = onEvent('editor-file-changed', (payload: unknown) => {
  const p = payload as { filePath?: string | null }
  if (p?.filePath) {
    // 从完整路径提取相对路径
    const rel = projectDir.value ? p.filePath.replace(projectDir.value.replace(/\/+$/, '') + '/', '') : ''
    selectedPath.value = rel || null
    focusedPath.value = rel || null
    // 确保父目录展开
    if (rel && treeRoot.value) expandParents(treeRoot.value, rel)
  }
})
function expandParents(root: TreeNode, targetRel: string) {
  const parts = targetRel.split('/')
  let current: TreeNode | undefined = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current) break
    current.expanded = true
    current = current.children.find(c => c.name === parts[i])
  }
}

/* ─── 生命周期 ─── */
watch(projectKey, () => {
  treeRoot.value = null
  selectedPath.value = null
  focusedPath.value = null
  ctxMenu.value = { show: false, x: 0, y: 0, node: null }
  treeDropActive.value = false
  closeFilePreview()
  chooseCollision('cancel')
  filterQuery.value = ''
  mediaThumbnails.value = {}
  failedMediaThumbnails.value = {}
  queuedMediaThumbnails.clear()
  mediaThumbnailQueue.length = 0
  loadFileTree()
  startPolling()
}, { flush: 'sync' })
watch(filterQuery, async query => {
  const owner = projectKey.value
  const requestId = ++searchRequestId
  if (!query.trim() || !owner) { searchTree.value = null; return }
  const matches = await projectFiles.searchPaths(owner, query, 2000)
  if (requestId !== searchRequestId || owner !== projectKey.value) return
  searchTree.value = buildSearchTree(matches, isDesktop ? projectDir.value : projectStore.projectName.value)
  expandAll(searchTree.value)
})
onMounted(async () => {
  document.addEventListener('click', onCtxMenuClick)
  if (!isDesktop) {
    if (typeof BroadcastChannel !== 'undefined') {
      webProjectChannel = new BroadcastChannel(WEB_PROJECT_FILES_CHANNEL)
      webProjectChannel.onmessage = event => {
        const changedProjectId = String((event.data as { projectId?: string })?.projectId || '')
        if (changedProjectId && changedProjectId === webProjectId.value) void loadFileTree()
      }
    }
    try { await refreshWebProjects() }
    catch (error) { errorMsg.value = `加载项目失败: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (isDesktop) {
    stopDesktopProjectFsHints = await listen<{ owner: string; path: string }>('project-fs-hint', event => {
      if (event.payload.owner === projectKey.value) void refreshAffectedDirectory(event.payload.path)
    })
  }
  if (projectKey.value) { loadFileTree(); startPolling() }
})
onBeforeUnmount(() => { chooseCollision('cancel'); closeFilePreview(); document.removeEventListener('click', onCtxMenuClick); webProjectChannel?.close(); stopDesktopProjectFsHints?.(); stopPolling(); offEditorChanged(); offCanvasLocate(); offWebProjectFilesChanged(); offProjectResourceChanged() })
</script>

<template>
  <div class="pft" @keydown="onTreeKeydown" tabindex="0">
    <input ref="uploadInput" class="pft-native-input" type="file" multiple @change="onUploadInputChange" />
    <input ref="directoryInput" class="pft-native-input" type="file" multiple webkitdirectory @change="onDirectoryInputChange" />
    <div v-if="!hasProject" class="pft-empty">
      <JcIcon name="folder" style="font-size:32px;opacity:0.3" />
      <p>还没有打开项目</p>
      <button class="pft-empty-btn" @click="ctxAddProjectFolder">
        <JcIcon name="create_new_folder" style="font-size:14px" />
        {{ isDesktop ? '选择项目文件夹' : '新建或切换项目' }}
      </button>
    </div>

    <template v-else>
      <!-- ═══ 顶部工具栏 ═══ -->
      <header class="pft-head">
        <div class="pft-title-row">
          <strong class="pft-title">{{ projectStore.projectName.value }}</strong>
        </div>
        <div class="pft-actions">
          <button class="pft-icon-btn" title="新建文件" @click="ctxNewFileFromSelection"><JcIcon name="note-add" /></button>
          <button class="pft-icon-btn" title="新建文件夹" @click="ctxNewFolderFromSelection"><JcIcon name="create-new-folder" /></button>
          <button class="pft-icon-btn" title="上传文件" @click="openFileUpload()"><JcIcon name="upload" /></button>
          <button class="pft-icon-btn" title="上传文件夹" @click="openDirectoryUpload()"><JcIcon name="folder-open" /></button>
          <button class="pft-icon-btn" title="导入项目" @click="ctxImportProject"><JcIcon name="upload" /></button>
          <button class="pft-icon-btn" title="导出项目" @click="ctxExportProject"><JcIcon name="download" /></button>
          <button class="pft-icon-btn pft-project-trigger" :title="isDesktop ? '切换项目文件夹' : '切换项目'" @click="ctxAddProjectFolder"><JcIcon name="call-split" /></button>
          <button class="pft-icon-btn" title="刷新" @click="loadFileTree"><JcIcon name="refresh" /></button>
          <button class="pft-icon-btn" title="隐藏文件树" @click="toggleFileTree"><JcIcon name="chevron-left" /></button>
        </div>
      </header>

      <!-- 文件筛选 -->
      <div class="pft-search">
        <JcIcon name="search" />
        <input v-model="filterQuery" type="search" placeholder="筛选文件（支持模糊匹配）..." />
        <button v-if="filterQuery" class="pft-search-clear" @click="filterQuery=''"><JcIcon name="close" /></button>
      </div>

      <!-- 加载提示（不销毁列表 DOM，防止滚动位置丢失） -->
      <div v-if="loading" class="pft-status pft-loading-overlay">加载中...</div>

      <!-- 错误 -->
      <div v-if="!loading && errorMsg" class="pft-status pft-error">{{ errorMsg }}</div>

      <!-- ═══ 文件树列表 ═══ -->
      <div
        v-show="!errorMsg" ref="listEl" class="pft-list" :class="{ 'drop-active': treeDropActive }"
        @click.self="clearProjectSelection" @contextmenu="onEmptyContextMenu" @dragover.prevent="onTreeDragOver" @dragleave.prevent="onTreeDragLeave" @drop.prevent.stop="onTreeDrop($event)"
      >
        <div v-if="visibleNodes.length === 0 && filterQuery" class="pft-status">没有匹配的文件</div>
        <div v-if="visibleNodes.length" class="pft-virtual-list" :style="{ height: `${fileTreeVirtualizer.getTotalSize()}px` }" @click.self="clearProjectSelection">
          <div
            v-for="{ row, item } in virtualVisibleNodes" :key="item.node.path"
            class="pft-node pft-node-guides"
            :class="{ selected: selectedPaths.has(item.node.path), focused: focusedPath === item.node.path, cutting: isCutResource(item.node.path) }"
            :style="{ '--tree-depth': item.indent, paddingLeft: (item.indent * 16 + 8) + 'px', position: 'absolute', top: '0', left: '0', width: '100%', transform: `translateY(${row.start}px)` }"
            :ref="el => queueRenderedMediaThumbnail(el as Element | null, item.node)"
            draggable="true"
            @click="openFile(item.node, $event)"
            @contextmenu="onContextMenu($event, item.node)"
            @dragstart="onNodeDragStart($event, item.node)"
            @dragover.prevent.stop="onTreeDragOver"
            @dragleave.prevent.stop="onTreeDragLeave"
            @drop.prevent.stop="onNodeDrop($event, item.node)"
          >
          <span v-if="item.node.isDir && item.hasChildren" class="pft-arrow" @click.stop="toggleNode(item.node)">
            <JcIcon :name="item.isExpanded ? 'expand-more' : 'chevron-right'" style="font-size:16px" />
          </span>
          <span v-else-if="item.node.isDir" class="pft-arrow pft-arrow-empty"></span>
          <span v-if="isCanvasMediaFile(item.node)" class="pft-media-thumb">
            <img v-if="mediaThumbnailUrl(item.node)" :src="mediaThumbnailUrl(item.node)" @error="failedMediaThumbnails[item.node.path] = true" />
            <JcIcon v-else :name="iconForNode(item.node)" />
            <i v-if="VIDEO_EXTS.has(item.node.name.split('.').pop()?.toLowerCase() || '')">▶</i>
          </span>
          <JcIcon v-else :name="iconForNode(item.node)" class="pft-icon" />
          <span class="pft-name">{{ item.node.name }}</span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="showProjectMenu && !isDesktop" class="pft-project-menu">
      <button
        v-for="project in webProjects"
        :key="project.id"
        :class="{ active: project.id === webProjectId }"
        @click="selectWebProject(project)"
      >
        <JcIcon name="folder" />
        <span>{{ project.name }}</span>
      </button>
      <div v-if="webProjects.length" class="pft-ctx-divider"></div>
      <button @click="createWebProject"><JcIcon name="create-new-folder" /><span>新建项目</span></button>
    </div>

    <!-- ═══ 右键菜单 ═══ -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show" ref="ctxMenuRef"
        class="pft-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <template v-if="ctxMenu.node === null">
          <!-- ── 空白区域 / 根节点右键菜单（对齐 VS Code Explorer 空白区域）── -->
          <button class="pft-ctx-item" @click="ctxNewFile"><JcIcon name="note-add" /><span>新建文件</span></button>
          <button class="pft-ctx-item" @click="ctxNewFolder"><JcIcon name="create-new-folder" /><span>新建文件夹</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxAddProjectFolder"><JcIcon name="create-new-folder" /><span>切换项目文件夹...</span></button>
          <button class="pft-ctx-item" @click="ctxUploadFiles"><JcIcon name="upload" /><span>上传文件</span></button>
          <button class="pft-ctx-item" @click="ctxUploadDirectory"><JcIcon name="folder-open" /><span>上传文件夹</span></button>
          <button class="pft-ctx-item" @click="ctxImportProject"><JcIcon name="upload" /><span>导入项目</span></button>
          <button class="pft-ctx-item" @click="ctxExportProject"><JcIcon name="download" /><span>导出项目</span></button>
          <button v-if="resourceClipboard" class="pft-ctx-item" @click="ctxPasteResources()"><JcIcon name="content-paste" /><span>粘贴</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxCopyProjectPath"><JcIcon name="content-copy" /><span>复制项目路径</span></button>
        </template>
        <template v-else-if="ctxMenu.node?.isDir">
          <!-- ── 目录右键菜单 ── -->
          <button class="pft-ctx-item" @click="ctxNewFile"><JcIcon name="note-add" /><span>新建文件</span></button>
          <button v-if="ctxMenu.node?.path === 'jc-canvas'" class="pft-ctx-item" @click="ctxNewCanvas"><JcIcon name="add" /><span>新建画布</span></button>
          <button class="pft-ctx-item" @click="ctxNewFolder"><JcIcon name="create-new-folder" /><span>新建文件夹</span></button>
          <button class="pft-ctx-item" @click="ctxUploadFiles"><JcIcon name="upload" /><span>上传文件</span></button>
          <button class="pft-ctx-item" @click="ctxUploadDirectory"><JcIcon name="folder-open" /><span>上传文件夹</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxCopyResources"><JcIcon name="content-copy" /><span>复制</span></button>
          <button class="pft-ctx-item" @click="ctxCutResources"><JcIcon name="content-cut" /><span>剪切</span></button>
          <button class="pft-ctx-item" @click="ctxExportSelected"><JcIcon name="download" /><span>导出所选资源</span></button>
          <button v-if="resourceClipboard" class="pft-ctx-item" @click="ctxPasteResources(ctxMenu.node)"><JcIcon name="content-paste" /><span>粘贴</span></button>
          <button class="pft-ctx-item" @click="ctxRename"><JcIcon name="edit" /><span>重命名</span></button>
          <button class="pft-ctx-item" @click="ctxDelete"><JcIcon name="delete" /><span>删除</span></button>
          <div class="pft-ctx-divider"></div>
          <button v-if="isDesktop" class="pft-ctx-item" @click="ctxReveal"><JcIcon name="folder-open" /><span>电脑中打开</span></button>
          <button class="pft-ctx-item" @click="ctxCopyPath"><JcIcon name="content-copy" /><span>复制路径</span></button>
          <button class="pft-ctx-item" @click="ctxCopyRelativePath"><JcIcon name="content-copy" /><span>复制相对路径</span></button>
        </template>
        <template v-else>
          <!-- ── 文件右键菜单 ── -->
          <button v-if="previewType(ctxMenu.node)" class="pft-ctx-item" @click="ctxPreview"><JcIcon name="visibility" /><span>预览</span></button>
          <button class="pft-ctx-item" v-if="isCanvasAddableMediaResource(ctxMenu.node)" @click="ctxOpenInCanvas"><JcIcon name="palette" /><span>加入画布</span></button>
          <button class="pft-ctx-item" v-if="ctxMenu.node && (ctxMenu.node.mimeType?.startsWith('video/') || VIDEO_EXTS.has(ctxMenu.node.name.split('.').pop()?.toLowerCase() || ''))" @click="ctxOpenInSystem"><JcIcon name="play_arrow" /><span>用系统播放器打开</span></button>
          <button v-if="isCanvasFile(ctxMenu.node)" class="pft-ctx-item" @click="ctxOpen"><JcIcon name="dashboard" /><span>打开画布</span></button>
          <button v-else class="pft-ctx-item" @click="ctxOpen"><JcIcon name="edit" /><span>编辑区打开</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxCopyResources"><JcIcon name="content-copy" /><span>复制</span></button>
          <button class="pft-ctx-item" @click="ctxCutResources"><JcIcon name="content-cut" /><span>剪切</span></button>
          <button class="pft-ctx-item" @click="ctxExportSelected"><JcIcon name="download" /><span>导出所选资源</span></button>
          <button v-if="isCanvasFile(ctxMenu.node)" class="pft-ctx-item" @click="ctxCopyCanvas"><JcIcon name="content-copy" /><span>复制画布</span></button>
          <button class="pft-ctx-item" @click="isCanvasFile(ctxMenu.node) ? ctxRenameCanvas() : ctxRename()"><JcIcon name="edit" /><span>重命名</span></button>
          <button class="pft-ctx-item" @click="isCanvasFile(ctxMenu.node) ? ctxDeleteCanvas() : ctxDelete()"><JcIcon name="delete" /><span>删除</span></button>
          <button class="pft-ctx-item" @click="ctxSaveAs"><JcIcon name="download" /><span>另存为</span></button>
          <div class="pft-ctx-divider"></div>
          <button v-if="isDesktop" class="pft-ctx-item" @click="ctxReveal"><JcIcon name="folder-open" /><span>电脑中打开</span></button>
          <button class="pft-ctx-item" @click="ctxCopyPath"><JcIcon name="content-copy" /><span>复制路径</span></button>
          <button class="pft-ctx-item" @click="ctxCopyRelativePath"><JcIcon name="content-copy" /><span>复制相对路径</span></button>
        </template>
      </div>
    </Teleport>

    <MediaViewer
      v-if="filePreview"
      :show="true"
      mode="file"
      :url="filePreview.url"
      :type="filePreview.type"
      :model="filePreview.node.name"
      @close="closeFilePreview"
      @download="downloadFilePreview"
    />

    <Teleport to="body">
      <div v-if="pendingCollision" class="pft-collision-overlay" @click.self="chooseCollision('cancel')">
        <div class="pft-collision-dialog" role="dialog" aria-modal="true" aria-label="同名文件处理">
          <strong>同名文件</strong>
          <p>{{ pendingCollision.path }}</p>
          <div>
            <button class="pft-collision-overwrite" @click="chooseCollision('overwrite')">覆盖</button>
            <button @click="chooseCollision('keep-both')">保留两份</button>
            <button @click="chooseCollision('cancel')">取消</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="pendingDelete.length" class="pft-delete-overlay" @click.self="cancelDelete">
        <div class="pft-delete-dialog" role="dialog" aria-modal="true" aria-label="移入废纸篓确认">
          <strong>移入废纸篓？</strong>
          <p v-if="isDesktop">{{ pendingDelete.length }} 个项目会移入系统废纸篓，可在废纸篓中恢复。</p>
          <p v-else>{{ pendingDelete.length }} 个项目会被永久删除。</p>
          <div>
            <button :disabled="deletingDelete" @click="cancelDelete">取消</button>
            <button class="pft-delete-confirm" :disabled="deletingDelete" @click="confirmDelete">{{ deletingDelete ? '正在移入...' : isDesktop ? '移入废纸篓' : '删除' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pft { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; user-select: none; outline: none; }
.pft:focus-visible { outline: 2px solid var(--olive); outline-offset: -2px; }
.pft-native-input { display: none; }
.pft-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; color: var(--ink3); font-size: 13px; text-align: center; padding: 24px; }
.pft-empty-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--paper); color: var(--ink); font-size: 13px; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.pft-empty-btn:hover { background: var(--olive-pale); border-color: var(--olive); }
.pft-project-menu { position: absolute; top: 48px; left: 8px; right: 8px; z-index: 20; display: flex; flex-direction: column; gap: 2px; max-height: 280px; overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--paper); box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
.pft-project-menu button { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.pft-project-menu button:hover, .pft-project-menu button.active { background: var(--olive-pale); }
.pft-project-menu button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ─── 头部 ─── */
.pft-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.pft-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pft-title { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pft-actions { display: flex; align-items: center; gap: 2px; }
.pft-icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 4px; background: transparent; color: var(--ink); cursor: pointer; font-size: 16px; transition: background 0.1s; }
.pft-icon-btn:hover { background: var(--olive-pale); }

/* ─── 搜索 ─── */
.pft-search { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--border); font-size: 14px; color: var(--ink3); }
.pft-search input { flex: 1; border: none; outline: none; background: transparent; font-size: 12px; color: var(--ink); }
.pft-search input::placeholder { color: var(--ink3); }
.pft-search-clear { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: 50%; background: transparent; color: var(--ink3); cursor: pointer; font-size: 14px; }
.pft-search-clear:hover { background: var(--olive-pale); }

/* ─── 状态 ─── */
.pft-status { padding: 16px; text-align: center; font-size: 12px; color: var(--ink3); }
.pft-loading-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2; background: var(--paper); border-radius: 6px; padding: 8px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.pft-error { color: var(--color-error, #d32f2f); }

/* ─── 列表 ─── */
.pft-list { flex: 1; overflow-y: auto; overflow-x: hidden; }
.pft-list.drop-active { background: var(--olive-pale); outline: 1px dashed var(--olive); outline-offset: -3px; }
.pft-virtual-list { position: relative; width: 100%; }
.pft-node { display: flex; align-items: center; gap: 4px; height: 30px; padding-right: 8px; cursor: pointer; font-size: 12px; white-space: nowrap; transition: background 0.08s; }
.pft-node-guides { background-image: repeating-linear-gradient(to right, transparent 0, transparent 15px, var(--border) 15px, var(--border) 16px); background-position: 8px 0; background-repeat: no-repeat; background-size: calc(var(--tree-depth) * 16px) 100%; }
.pft-node:hover { background: var(--olive-pale); }
.pft-node.selected { background: rgba(213, 199, 135, 0.16); }
.pft-node.focused { background: rgba(213, 199, 135, 0.22); outline: 1px solid var(--olive); outline-offset: -1px; }
.pft-node.cutting { opacity: 0.48; }
.pft-arrow { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
.pft-arrow-empty { visibility: hidden; }
.pft-icon { font-size: 16px; flex-shrink: 0; color: var(--ink3); }
.pft-media-thumb { position: relative; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink3); }
.pft-media-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pft-media-thumb .mso { font-size: 14px; }
.pft-media-thumb i { position: absolute; right: 1px; bottom: 0; padding: 0 1px; border-radius: 2px; background: rgba(0,0,0,.6); color: #fff; font-size: 8px; font-style: normal; line-height: 10px; }
.pft-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }

/* ─── 右键菜单 ─── */
.pft-ctx-menu { position: fixed; z-index: 1000; min-width: 180px; background: var(--paper); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,0.16); padding: 4px; }
.pft-ctx-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: none; border-radius: 6px; background: transparent; font-size: 12px; color: var(--ink); cursor: pointer; text-align: left; transition: background 0.06s, color 0.06s; }
.pft-ctx-item:hover { background: var(--olive-pale); color: var(--olive-dark); }
.pft-ctx-item:disabled { opacity: 0.35; cursor: default; }
.pft-ctx-item .mso { color: var(--ink3); font-size: 16px; }
.pft-ctx-item:hover .mso { color: var(--olive-dark); }
.pft-ctx-divider { height: 1px; margin: 4px 8px; background: var(--border); }
.pft-collision-overlay { position: fixed; inset: 0; z-index: 10001; display: grid; place-items: center; background: rgba(0,0,0,.34); }
.pft-collision-dialog { width: min(360px, calc(100vw - 32px)); padding: 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--paper); box-shadow: 0 12px 28px rgba(0,0,0,.18); }
.pft-collision-dialog strong { display: block; color: var(--ink); font-size: 14px; }
.pft-collision-dialog p { margin: 6px 0 14px; overflow-wrap: anywhere; color: var(--ink3); font-size: 12px; }
.pft-collision-dialog > div { display: flex; justify-content: flex-end; gap: 6px; }
.pft-collision-dialog button { min-height: 28px; padding: 4px 9px; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--ink); font-size: 12px; cursor: pointer; }
.pft-collision-dialog .pft-collision-overwrite { border-color: var(--olive); background: var(--olive); color: #fff; }
.pft-delete-overlay { position: fixed; inset: 0; z-index: 10001; display: grid; place-items: center; background: rgba(0,0,0,.34); }
.pft-delete-dialog { width: min(360px, calc(100vw - 32px)); padding: 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--paper); box-shadow: 0 12px 28px rgba(0,0,0,.18); }
.pft-delete-dialog strong { display: block; color: var(--ink); font-size: 14px; }
.pft-delete-dialog p { margin: 6px 0 14px; overflow-wrap: anywhere; color: var(--ink3); font-size: 12px; }
.pft-delete-dialog > div { display: flex; justify-content: flex-end; gap: 6px; }
.pft-delete-dialog button { min-height: 28px; padding: 4px 9px; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--ink); font-size: 12px; cursor: pointer; }
.pft-delete-dialog button:disabled { opacity: .55; cursor: default; }
.pft-delete-dialog .pft-delete-confirm { border-color: var(--olive); background: var(--olive); color: #fff; }
</style>
