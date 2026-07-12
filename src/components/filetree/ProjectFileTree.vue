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
import { useProjectStore } from '@/stores/projectStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { searchItems } from '@/utils/generalSearch'
import { confirmAction } from '@/utils/confirmAction'
import { safePrompt } from '@/utils/safePrompt'
import { copyCanvasFile, createCanvasFile, deleteCanvasFile, renameCanvasFile } from '@/components/canvas/canvasPersistence'

interface FlatEntry { path: string; isDir: boolean; size: number | null }
interface TreeNode { name: string; path: string; isDir: boolean; size?: number; children: TreeNode[]; expanded: boolean; depth: number }
interface VisibleNode { node: TreeNode; indent: number; hasChildren: boolean; isExpanded: boolean }
interface CtxMenu { show: boolean; x: number; y: number; node: TreeNode | null }

const projectStore = useProjectStore()
const isDesktop = isTauriRuntime()
const filterQuery = ref('')
const treeRoot = ref<TreeNode | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const selectedPath = ref<string | null>(null)
const focusedPath = ref<string | null>(null)
const ctxMenu = ref<CtxMenu>({ show: false, x: 0, y: 0, node: null })
const ctxMenuRef = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const projectDir = computed(() => projectStore.projectDir.value)
const hasProject = computed(() => !!projectDir.value)
let pollTimer: ReturnType<typeof setInterval> | null = null

/* ─── 构建树 ─── */
function buildTree(entries: FlatEntry[], rootPath: string): TreeNode {
  const root: TreeNode = { name: rootPath.split('/').filter(Boolean).pop() || rootPath, path: '', isDir: true, children: [], expanded: true, depth: 0 }
  const sorted = [...entries].sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.path.localeCompare(b.path) })
  const nodeMap = new Map<string, TreeNode>(); nodeMap.set('', root)
  for (const e of sorted) {
    const parts = e.path.split('/')
    const n: TreeNode = { name: parts[parts.length - 1], path: e.path, isDir: e.isDir, size: e.size ?? undefined, children: [], expanded: false, depth: parts.length }
    const p = nodeMap.get(parts.slice(0, -1).join('/'))
    if (p) p.children.push(n)
    if (e.isDir) nodeMap.set(e.path, n)
  }
  return root
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
      result.push({ node, indent: node.depth, hasChildren: node.isDir && node.children.length > 0, isExpanded: node.expanded })
      if (node.expanded && node.isDir) for (const child of node.children) walk(child)
    }
  }
  for (const child of root.children) walk(child)
  return result
}
const visibleNodes = computed(() => treeRoot.value ? flattenVisible(treeRoot.value, filterQuery.value) : [])

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
  if (!projectDir.value) { treeRoot.value = null; return }
  // 保存当前展开状态，刷新后恢复（防止轮询刷新导致全部折叠）
  const expandedPaths = saveExpandState(treeRoot.value)
  loading.value = true; errorMsg.value = ''
  try {
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core')
      treeRoot.value = buildTree(await invoke<FlatEntry[]>('dev_list_files', { input: { root: projectDir.value, maxEntries: 1000 } }), projectDir.value)
      restoreExpandState(treeRoot.value, expandedPaths)
    } else { errorMsg.value = '文件树仅桌面端可用'; treeRoot.value = null }
  } catch (e) { errorMsg.value = `加载失败: ${e instanceof Error ? e.message : String(e)}`; treeRoot.value = null }
  finally { loading.value = false }
}
function startPolling() { stopPolling(); if (isDesktop) pollTimer = setInterval(loadFileTree, 5000) }
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
const offCanvasLocate = onEvent('project-filetree:locate', (payload: any) => {
  const path = payload?.path
  if (!path || !treeRoot.value) return
  let node = treeRoot.value
  for (const part of path.split('/')) {
    node.expanded = true
    const child = node.children.find(item => item.name === part)
    if (!child) return
    node = child
  }
  selectedPath.value = path
  focusedPath.value = path
})

/* ─── 工具函数 ─── */
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','svg','webp','ico','bmp'])
const VIDEO_EXTS = new Set(['mp4','mov','avi','webm','mkv'])
const CANVAS_EXT = 'jccanvas'
function isCanvasFile(node: TreeNode | null | undefined): node is TreeNode {
  return Boolean(node && !node.isDir && node.name.toLowerCase().endsWith(`.${CANVAS_EXT}`))
}
const EXTERNAL_EXTS = new Set([
  ...IMAGE_EXTS,
  'mp4','mov','avi','webm','mkv',
  'mp3','wav','ogg','m4a','flac',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'zip','tar','gz','tgz','rar','7z','dmg','pkg',
  'exe','dll','so','dylib','bin',
])
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
function toggleNode(node: TreeNode) { if (node.isDir) node.expanded = !node.expanded }

/* ─── 左键打开 ─── */
async function openFile(node: TreeNode) {
  if (node.isDir) { toggleNode(node); return }
  selectedPath.value = node.path
  const ext = node.name.split('.').pop()?.toLowerCase() || ''
  if (ext === CANVAS_EXT) {
    emitEvent('canvas:open', { path: node.path })
    emitEvent('switch-panel', 'creation')
    return
  }
  // 图片和视频都加入画布作为可选参考素材。
  if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
    emitEvent('canvas:add-media', { url: projectDir.value + '/' + node.path, kind: VIDEO_EXTS.has(ext) ? 'video' : 'image', label: node.name })
    emitEvent('switch-panel', 'creation')
    return
  }
  // VS Code 式兜底：只有明确的媒体/二进制交给系统；其余未知格式默认按文本进编辑区。
  if (!EXTERNAL_EXTS.has(ext)) {
    emitEvent('open-in-editor', { filePath: node.path, name: node.name, projectDir: projectDir.value })
    emitEvent('switch-panel', 'editor')
  } else {
    if (isDesktop) try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_in_shell', { path: projectDir.value + '/' + node.path })
    } catch { /* */ }
  }
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
function onContextMenu(e: MouseEvent, node: TreeNode) { e.preventDefault(); e.stopPropagation(); selectedPath.value = node.path; focusedPath.value = node.path; const { x, y } = clampCtxMenu(e.clientX, e.clientY); ctxMenu.value = { show: true, x, y, node } }
/** 右键空白区域 */
function onEmptyContextMenu(e: MouseEvent) { e.preventDefault(); const { x, y } = clampCtxMenu(e.clientX, e.clientY); ctxMenu.value = { show: true, x, y, node: null } }
function closeCtxMenu() { ctxMenu.value.show = false }
function onCtxMenuClick(e: MouseEvent) { if (ctxMenuRef.value && !ctxMenuRef.value.contains(e.target as Node)) closeCtxMenu() }
async function ctxCopyPath() { const n = ctxMenu.value.node; if (n) try { await navigator.clipboard.writeText(projectDir.value + '/' + n.path) } catch { /* */ }; closeCtxMenu() }
async function ctxCopyRelativePath() { const n = ctxMenu.value.node; if (n) try { await navigator.clipboard.writeText(n.path) } catch { /* */ }; closeCtxMenu() }
/** 复制项目根路径到剪贴板 */
async function ctxCopyProjectPath() { try { await navigator.clipboard.writeText(projectDir.value || '') } catch { /* */ }; closeCtxMenu() }
async function ctxReveal() { const n = ctxMenu.value.node; if (n && isDesktop) try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('dev_reveal_in_finder', { path: projectDir.value + '/' + n.path }) } catch { /* */ }; closeCtxMenu() }
function isCanvasMediaFile(node: TreeNode | null | undefined): boolean {
  if (!node || node.isDir) return false
  const ext = (node.name || '').split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)
}
function ctxOpenInCanvas() {
  const n = ctxMenu.value.node
  closeCtxMenu()
  if (!n || n.isDir) return
  const fullPath = projectDir.value + '/' + n.path
  emitEvent('switch-panel', 'creation')
  const ext = n.name.split('.').pop()?.toLowerCase() || ''
  emitEvent('canvas:add-media', { url: fullPath, kind: VIDEO_EXTS.has(ext) ? 'video' : 'image', label: n.name })
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
  try {
    const file = await renameCanvasFile(n.path, name)
    await loadFileTree()
    emitEvent('canvas:renamed', { oldPath: n.path, newPath: file.path })
  } catch (e) { errorMsg.value = `重命名画布失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxDeleteCanvas() {
  const n = ctxMenu.value.node; if (!isCanvasFile(n)) return; closeCtxMenu()
  if (!await confirmAction(`确定删除画布「${n.name}」？图片素材不会删除。`)) return
  try { await deleteCanvasFile(n.path); await loadFileTree(); emitEvent('canvas:deleted', { path: n.path }) }
  catch (e) { errorMsg.value = `删除画布失败: ${e instanceof Error ? e.message : String(e)}` }
}
function ctxOpen() { const n = ctxMenu.value.node; closeCtxMenu(); if (n && !n.isDir) openFile(n) }
/** 右键空白 → 切换项目文件夹（当前单根架构，后续可升级为 VS Code 多根 workspace） */
async function ctxAddProjectFolder() {
  console.log('[pft pickProject] 1. ctxAddProjectFolder 触发')
  closeCtxMenu()
  if (!isDesktop) { console.log('[pft pickProject] 非桌面，跳过'); return }
  console.log('[pft pickProject] 2. invoke pick_project_folder...')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const dir = await invoke<string | null>('pick_project_folder')
    console.log('[pft pickProject] 3. 返回:', dir)
    if (dir) projectStore.selectProject(dir)
  } catch (e) { console.error('[pft pickProject] 异常:', e); errorMsg.value = `选择文件夹失败: ${e instanceof Error ? e.message : String(e)}` }
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
  try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('dev_create_dir', { input: { root: projectDir.value, relativePath: relPath } }); await loadFileTree() }
  catch (e) { errorMsg.value = `创建文件夹失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function createFileAt(relPath: string) {
  try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('dev_write_file', { input: { root: projectDir.value, relativePath: relPath, content: '' } }); await loadFileTree() }
  catch (e) { errorMsg.value = `创建失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxRename() {
  const n = ctxMenu.value.node; if (!n) return; closeCtxMenu()
  const newName = await safePrompt('重命名', n.name)
  if (!newName?.trim() || newName.trim() === n.name) return
  const parentRel = n.path.split('/').slice(0, -1).join('/')
  const newRel = (parentRel ? parentRel + '/' : '') + newName.trim().replace(/^\/+/, '')
  try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('dev_rename_file', { input: { root: projectDir.value, oldRelativePath: n.path, newRelativePath: newRel } }); await loadFileTree() }
  catch (e) { errorMsg.value = `重命名失败: ${e instanceof Error ? e.message : String(e)}` }
}
async function ctxDelete() {
  const n = ctxMenu.value.node; if (!n) return; closeCtxMenu()
  const label = n.isDir ? `文件夹「${n.name}」` : `文件「${n.name}」`
  if (!await confirmAction(`确定删除 ${label}？此操作不可撤销。`)) return
  try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('dev_delete_file', { input: { root: projectDir.value, relativePath: n.path } }); await loadFileTree() }
  catch (e) { errorMsg.value = `删除失败: ${e instanceof Error ? e.message : String(e)}` }
}

/* ─── 顶部按钮 ─── */
function ctxNewFileRoot() { selectRoot(); ctxNewFile() }
function ctxNewFolderRoot() { selectRoot(); ctxNewFolder() }
function selectRoot() { ctxMenu.value = { show: false, x: 0, y: 0, node: treeRoot.value } }
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
watch(projectDir, () => { filterQuery.value = ''; loadFileTree(); startPolling() })
watch(filterQuery, (q) => { if (q.trim()) expandAll(treeRoot.value) })
onMounted(() => { document.addEventListener('click', onCtxMenuClick); if (projectDir.value) { loadFileTree(); startPolling() } })
onBeforeUnmount(() => { document.removeEventListener('click', onCtxMenuClick); stopPolling(); offEditorChanged(); offCanvasLocate() })
</script>

<template>
  <div class="pft" @keydown="onTreeKeydown" tabindex="0">
    <div v-if="!hasProject" class="pft-empty">
      <JcIcon name="folder" style="font-size:32px;opacity:0.3" />
      <p>还没有打开项目</p>
      <button class="pft-empty-btn" @click="ctxAddProjectFolder">
        <JcIcon name="create_new_folder" style="font-size:14px" />
        选择项目文件夹
      </button>
    </div>

    <template v-else>
      <!-- ═══ 顶部工具栏 ═══ -->
      <header class="pft-head">
        <div class="pft-title-row">
          <strong class="pft-title">{{ projectStore.projectName.value }}</strong>
        </div>
        <div class="pft-actions">
          <button class="pft-icon-btn" title="新建文件" @click="ctxNewFileRoot"><JcIcon name="note-add" /></button>
          <button class="pft-icon-btn" title="新建文件夹" @click="ctxNewFolderRoot"><JcIcon name="create-new-folder" /></button>
          <button class="pft-icon-btn" title="切换项目文件夹" @click="ctxAddProjectFolder"><JcIcon name="call-split" /></button>
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
      <div v-show="!errorMsg" ref="listEl" class="pft-list" @contextmenu="onEmptyContextMenu">
        <div v-if="visibleNodes.length === 0 && filterQuery" class="pft-status">没有匹配的文件</div>
        <div
          v-for="item in visibleNodes" :key="item.node.path"
          class="pft-node"
          :class="{ selected: selectedPath === item.node.path, focused: focusedPath === item.node.path }"
          :style="{ paddingLeft: (item.indent * 16 + 8) + 'px' }"
          @click="openFile(item.node)"
          @contextmenu="onContextMenu($event, item.node)"
        >
          <span v-if="item.node.isDir && item.hasChildren" class="pft-arrow" @click.stop="toggleNode(item.node)">
            <JcIcon :name="item.isExpanded ? 'expand-more' : 'chevron-right'" style="font-size:16px" />
          </span>
          <span v-else-if="item.node.isDir" class="pft-arrow pft-arrow-empty"></span>
          <JcIcon :name="iconForNode(item.node)" class="pft-icon" />
          <span class="pft-name">{{ item.node.name }}</span>
        </div>
      </div>
    </template>

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
          <button class="pft-ctx-item" @click="ctxAddProjectFolder"><JcIcon name="create-new-folder" /><span>切换项目文件夹...</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxCopyProjectPath"><JcIcon name="content-copy" /><span>复制项目路径</span></button>
        </template>
        <template v-else-if="ctxMenu.node?.isDir">
          <!-- ── 目录右键菜单 ── -->
          <button class="pft-ctx-item" @click="ctxNewFile"><JcIcon name="note-add" /><span>新建文件</span></button>
          <button v-if="ctxMenu.node?.path === 'jc-canvas'" class="pft-ctx-item" @click="ctxNewCanvas"><JcIcon name="add" /><span>新建画布</span></button>
          <button class="pft-ctx-item" @click="ctxNewFolder"><JcIcon name="create-new-folder" /><span>新建文件夹</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxRename"><JcIcon name="edit" /><span>重命名</span></button>
          <button class="pft-ctx-item" @click="ctxDelete"><JcIcon name="delete" /><span>删除</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxReveal"><JcIcon name="folder-open" /><span>电脑中打开</span></button>
          <button class="pft-ctx-item" @click="ctxCopyPath"><JcIcon name="content-copy" /><span>复制路径</span></button>
          <button class="pft-ctx-item" @click="ctxCopyRelativePath"><JcIcon name="content-copy" /><span>复制相对路径</span></button>
        </template>
        <template v-else>
          <!-- ── 文件右键菜单 ── -->
          <button class="pft-ctx-item" v-if="isCanvasMediaFile(ctxMenu.node)" @click="ctxOpenInCanvas"><JcIcon name="palette" /><span>加入画布</span></button>
          <button class="pft-ctx-item" v-if="ctxMenu.node && VIDEO_EXTS.has(ctxMenu.node.name.split('.').pop()?.toLowerCase() || '')" @click="ctxOpenInSystem"><JcIcon name="play_arrow" /><span>用系统播放器打开</span></button>
          <button v-if="isCanvasFile(ctxMenu.node)" class="pft-ctx-item" @click="ctxOpen"><JcIcon name="dashboard" /><span>打开画布</span></button>
          <button v-else class="pft-ctx-item" @click="ctxOpen"><JcIcon name="edit" /><span>编辑区打开</span></button>
          <div class="pft-ctx-divider"></div>
          <button v-if="isCanvasFile(ctxMenu.node)" class="pft-ctx-item" @click="ctxCopyCanvas"><JcIcon name="content-copy" /><span>复制画布</span></button>
          <button class="pft-ctx-item" @click="isCanvasFile(ctxMenu.node) ? ctxRenameCanvas() : ctxRename()"><JcIcon name="edit" /><span>重命名</span></button>
          <button class="pft-ctx-item" @click="isCanvasFile(ctxMenu.node) ? ctxDeleteCanvas() : ctxDelete()"><JcIcon name="delete" /><span>删除</span></button>
          <div class="pft-ctx-divider"></div>
          <button class="pft-ctx-item" @click="ctxReveal"><JcIcon name="folder-open" /><span>电脑中打开</span></button>
          <button class="pft-ctx-item" @click="ctxCopyPath"><JcIcon name="content-copy" /><span>复制路径</span></button>
          <button class="pft-ctx-item" @click="ctxCopyRelativePath"><JcIcon name="content-copy" /><span>复制相对路径</span></button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pft { display: flex; flex-direction: column; height: 100%; overflow: hidden; user-select: none; outline: none; }
.pft:focus-visible { outline: 2px solid var(--olive); outline-offset: -2px; }
.pft-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; color: var(--ink3); font-size: 13px; text-align: center; padding: 24px; }
.pft-empty-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--paper); color: var(--ink); font-size: 13px; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.pft-empty-btn:hover { background: var(--olive-pale); border-color: var(--olive); }

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
.pft-node { display: flex; align-items: center; gap: 4px; height: 26px; padding-right: 8px; cursor: pointer; font-size: 12px; white-space: nowrap; transition: background 0.08s; }
.pft-node:hover { background: var(--olive-pale); }
.pft-node.selected { background: rgba(213, 199, 135, 0.16); }
.pft-node.focused { background: rgba(213, 199, 135, 0.22); outline: 1px solid var(--olive); outline-offset: -1px; }
.pft-arrow { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
.pft-arrow-empty { visibility: hidden; }
.pft-icon { font-size: 16px; flex-shrink: 0; color: var(--ink3); }
.pft-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }

/* ─── 右键菜单 ─── */
.pft-ctx-menu { position: fixed; z-index: 1000; min-width: 180px; background: var(--paper); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,0.16); padding: 4px; }
.pft-ctx-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: none; border-radius: 6px; background: transparent; font-size: 12px; color: var(--ink); cursor: pointer; text-align: left; transition: background 0.06s, color 0.06s; }
.pft-ctx-item:hover { background: var(--olive-pale); color: var(--olive-dark); }
.pft-ctx-item:disabled { opacity: 0.35; cursor: default; }
.pft-ctx-item .mso { color: var(--ink3); font-size: 16px; }
.pft-ctx-item:hover .mso { color: var(--olive-dark); }
.pft-ctx-divider { height: 1px; margin: 4px 8px; background: var(--border); }
</style>
