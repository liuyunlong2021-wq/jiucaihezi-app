<script setup lang="ts">
/**
 * EditorPanel — Tiptap 富文本编辑区（AI 工作台）
 *
 * 功能:
 *   1. 完整富文本编辑（标题/粗体/列表/引用/代码块/图片/链接）
 *   2. [[双向链接]] — 输入 [[ 弹出文件选择浮窗，Ctrl+Click 跳转
 *   3. 任务列表 / 高亮标注 / 智能排版
 *   4. 选中文本后的悬浮 AI 工具条（润色/扩写/缩写/提炼）
 *   5. 反向链接面板 — 显示哪些文件引用了当前文档
 *   6. 撤销/重做/字数统计/导出
 */
import { ref, computed, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'
import { NodeRange } from '@tiptap/extension-node-range'
import { TextAlign } from '@tiptap/extension-text-align'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { TableOfContents } from '@tiptap/extension-table-of-contents'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { UniqueID } from '@tiptap/extension-unique-id'
import { createLowlight, common } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { WikiLinkExtension, createWikiLinkSuggestion } from './WikiLinkExtension'
import SlashCommandsExtension from './SlashCommands'
import EditorTabs, { type EditorTab } from './EditorTabs.vue'
// ── Phase 1: 官方 TableKit 替换自定义表格 ──
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
// ── Phase 1: 新增扩展 ──
import { FontFamily } from '@tiptap/extension-font-family'
import { Superscript } from '@tiptap/extension-superscript'
import { Subscript } from '@tiptap/extension-subscript'
import { Mathematics } from '@tiptap/extension-mathematics'
// ── Phase 2: 额外扩展 ──
import { Youtube } from '@tiptap/extension-youtube'
import { Audio } from '@tiptap/extension-audio'
import { TrailingNode } from '@tiptap/extensions'
import { useNotebook } from '@/composables/useNotebook'
import { onEvent, emitEvent, consumeLastEvent } from '@/utils/eventBus'
import { useAgentStore } from '@/stores/agentStore'
import { useFileStore } from '@/composables/useFileStore'
import { buildImportedTextDoc, textToTiptapDoc } from '@/components/editor/editorContent'
import { processFile } from '@/composables/useFileUpload'
import { callLLM } from '@/utils/api'
import {
  mergeEditorAssets,
  tiptapJsonToMarkdown,
  type EditorAssetRef,
} from '@/components/editor/editorDocument'
import { normalizeEditorLinkUrl } from '@/utils/urlSafety'
import { confirmAction } from '@/utils/confirmAction'
import { closeEditorTabSafely } from '@/utils/openCodeP3UiPolicy'
import { readRealFileContent, jumpEditorToLine } from '@/components/editor/editorDiffBridge'
import { projectTextEditorMode, type ProjectResource, type ProjectResourceRevision, type ProjectTextEditorMode } from '@/utils/projectResource'
import { createRuntimeProjectFileService, onProjectResourceChange } from '@/services/projectFileService'
import { createProjectFileActions } from '@/services/projectFileActions'
import { openProjectResource } from '@/services/projectExplorerService'
import { useProjectStore } from '@/stores/projectStore'
import { createSessionSaveQueue, projectEditorSessionEpoch, projectEditorSessionStore } from '@/components/editor/editorSessionStore'

const { docTitle, load, blocks } = useNotebook()
const agentStore = useAgentStore()
const fileStore = useFileStore()
const projectStore = useProjectStore()

// ─── 文件绑定 ───
const currentFileId = ref<string | null>(null)
const currentFilePath = ref<string | null>(null) // ★ 磁盘文件路径（非 SQLite）
const currentProjectDir = ref<string | null>(null) // ★ 从 ProjectFileTree 传来的 projectDir，用于 Rust dev_xxx 命令
const lastSavedMarkdown = ref('') // ★ 上次保存时的 markdown，对齐 VS Code isDirty 语义
const currentAssets = ref<EditorAssetRef[]>([])
const currentResource = ref<ProjectResource | null>(null)
const currentResourceDeleted = ref(false)
const projectTextMode = ref<ProjectTextEditorMode>('rich')
const plainProjectText = ref('')
const plainTextRef = ref<HTMLTextAreaElement | null>(null)
const editorContextMenu = ref({ show: false, x: 0, y: 0 })
// ─── Phase 1: 多文件 Tab ───
const openTabs = ref<EditorTab[]>([])
const activeTabId = ref<string | null>(null)
const projectFileService = createRuntimeProjectFileService()
const projectFileActions = createProjectFileActions(projectFileService)
const projectSessions = projectEditorSessionStore
const projectSaveQueue = createSessionSaveQueue()
const projectSessionEpoch = ref(0)
const activeProjectSession = computed(() => {
  projectSessionEpoch.value
  return activeTabId.value ? projectSessions.get(activeTabId.value) : undefined
})
const isPlainProjectText = computed(() => Boolean(activeProjectSession.value && projectTextMode.value === 'plain'))
const hasRichTextSelection = computed(() => {
  const selection = editor.value?.state.selection
  return Boolean(selection && !selection.empty)
})
const canSaveActiveProjectSession = computed(() => {
  projectSessionEpoch.value
  const session = activeProjectSession.value
  return Boolean(session?.dirty && session.resource && projectSessions.canSaveToOriginal(session.tabId))
})

function touchProjectSessions() {
  projectSessionEpoch.value += 1
  projectEditorSessionEpoch.value += 1
  const nonProjectTabs = openTabs.value.filter(tab => !tab.resource)
  openTabs.value = [
    ...nonProjectTabs,
    ...projectSessions.all().map(session => ({
      id: session.tabId,
      title: session.title,
      filePath: session.resource?.runtime === 'desktop' ? `${session.resource.owner}/${session.resource.path}` : undefined,
      fileId: session.resource?.runtime === 'web' ? session.resource.id : undefined,
      resource: session.resource || undefined,
      dirty: session.dirty,
    })),
  ]
}

function captureActiveProjectSession() {
  const session = activeTabId.value ? projectSessions.get(activeTabId.value) : undefined
  if (!session || !editor.value) return
  if (isPlainProjectText.value) {
    projectSessions.updateDocument(session.tabId, textToTiptapDoc(plainProjectText.value), plainProjectText.value, [])
    touchProjectSessions()
    return
  }
  projectSessions.updateDocument(session.tabId, editor.value.getJSON(), getEditorMarkdown(), [...currentAssets.value])
  touchProjectSessions()
}

function renderProjectSession(tabId: string) {
  const session = projectSessions.select(tabId)
  if (!session || !editor.value) return
  activeTabId.value = session.tabId
  currentResource.value = session.resource
  currentResourceDeleted.value = session.state === 'deleted'
  currentFilePath.value = session.resource?.runtime === 'desktop' ? `${session.resource.owner}/${session.resource.path}` : null
  currentProjectDir.value = session.resource?.runtime === 'desktop' ? session.resource.owner : null
  currentFileId.value = session.resource?.runtime === 'web' ? session.resource.id || null : null
  docTitle.value = session.title
  currentAssets.value = session.assets as EditorAssetRef[]
  projectTextMode.value = session.resource ? projectTextEditorMode(session.resource) : 'rich'
  plainProjectText.value = projectTextMode.value === 'plain' ? session.markdown : ''
  editor.value.commands.setContent(session.document as any, { emitUpdate: false })
  lastSavedMarkdown.value = session.markdown
  updateDocCharCount()
  touchProjectSessions()
  emitEvent('editor-file-changed', { fileId: currentFileId.value, filePath: currentFilePath.value })
}

function openOrSwitchTab(tab: EditorTab) {
  // 去重: 已有同 ID tab → 只切换
  const existing = openTabs.value.find(t => t.id === tab.id)
  if (!existing) {
    openTabs.value.push(tab)
  }
  activeTabId.value = tab.id
}

async function closeTab(tabId: string) {
  const idx = openTabs.value.findIndex(t => t.id === tabId)
  if (idx === -1) return
  const tab = openTabs.value[idx]
  const projectSession = projectSessions.get(tabId)
  if (projectSession) {
    if (activeTabId.value === tabId) captureActiveProjectSession()
    if (projectSession.dirty) {
      if (await confirmAction(`保存「${projectSession.title}」后关闭？`)) {
        const saved = await saveProjectSession(tabId)
        if (!saved) return
      } else if (!await confirmAction(`放弃「${projectSession.title}」的未保存修改？`)) {
        return
      }
    }
    projectSessions.remove(tabId)
    touchProjectSessions()
    const next = projectSessions.active() || openTabs.value[0]
    if (next && 'tabId' in next) renderProjectSession(next.tabId)
    else if (next && 'id' in next) selectTab(next.id)
    else if (openTabs.value.length === 0) clearEditorAfterLastTab()
    return
  }
  // 检查未保存: 磁盘文件始终视为可能有编辑，SQLite 文件检查 autoSave
  if (tab.dirty) {
    const confirmed = await confirmAction(`「${tab.title}」有未保存的更改，确定关闭？`)
    if (!confirmed) return
  }
  // 关闭前自动保存当前文件
  if (activeTabId.value === tabId) {
    saveToFile()
  }
  if (activeTabId.value === tabId) {
    const next = openTabs.value[idx + 1] || openTabs.value[idx - 1]
    if (next) {
      selectTab(next.id)
    }
  }
  openTabs.value.splice(idx, 1)
  // 所有 tab 关闭 → 清空编辑器
  if (openTabs.value.length === 0) {
    clearEditorAfterLastTab()
  }
}

function clearEditorAfterLastTab() {
  currentFileId.value = null
  currentFilePath.value = null
  currentProjectDir.value = null
  currentResource.value = null
  currentResourceDeleted.value = false
  projectTextMode.value = 'rich'
  plainProjectText.value = ''
  lastSavedMarkdown.value = ''
  docTitle.value = '正文'
  currentAssets.value = []
  editor.value?.commands.clearContent(false)
  updateDocCharCount()
  activeTabId.value = null
  emitEvent('editor-file-changed', { fileId: null, filePath: null })
}

function selectTab(tabId: string) {
  const tab = openTabs.value.find(t => t.id === tabId)
  if (!tab || tabId === activeTabId.value) return
  if (projectSessions.get(tabId)) {
    captureActiveProjectSession()
    renderProjectSession(tabId)
    return
  }
  // 切换前保存当前文件
  saveToFile()
  activeTabId.value = tabId
  currentFileId.value = tab.fileId || null
  currentFilePath.value = tab.filePath || null
  docTitle.value = tab.title
  // 触发重新加载
  if (tab.filePath) {
    emitEvent('open-in-editor', { filePath: tab.filePath, name: tab.title })
  } else if (tab.fileId) {
    emitEvent('open-in-editor', { fileId: tab.fileId, name: tab.title })
  }
}
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let backlinksRefreshTimer: ReturnType<typeof setTimeout> | null = null
// Module-scoped (non-window) buffer for temporary legacy version snapshots.
let pendingVersions: any[] = []

function getEditorMarkdown(): string {
  if (!editor.value) return ''
  const storage = editor.value.storage as any
  return storage?.markdown?.getMarkdown?.() || tiptapJsonToMarkdown(editor.value.getJSON()) || editor.value.getText()
}

function setEditorMarkdown(markdown: string): void {
  if (!editor.value) return
  const commands = editor.value.commands as any
  if (typeof commands.setMarkdown === 'function') {
    commands.setMarkdown(markdown)
  } else {
    editor.value.commands.setContent(textToTiptapDoc(markdown))
  }
}

function toggleDetailsBlock(): void {
  const chain = editor.value?.chain().focus() as any
  chain?.toggleDetails?.().run?.()
}

function insertTableOfContentsBlock(): void {
  const chain = editor.value?.chain().focus() as any
  chain?.insertTableOfContents?.().run?.()
}

function persistDraftSnapshot() {
  if (!editor.value) return
  const json = editor.value.getJSON()
  // For large docs, avoid expensive getHTML + full markdown in localStorage draft (space + perf)
  // Only keep essential for reload: json + text + basic info
  updateDocCharCount() // ensure fresh
  const isLarge = isLargeDoc.value
  let markdown = ''
  let html = ''
  let text = ''
  if (!isLarge) {
    markdown = getEditorMarkdown()
    html = editor.value.getHTML()
    text = editor.value.getText()
  } else {
    text = editor.value.getText().slice(0, 500) + '...' // lightweight preview
  }
  localStorage.setItem('jc_tiptap_doc', JSON.stringify({
    title: docTitle.value,
    content: json,
    text,
    html,
    markdown,
    assets: currentAssets.value,
    fileId: currentFileId.value,
    isLargeDoc: isLarge,
  }))
}

// ─── 反向链接面板 ───
const showBacklinks = ref(false)
const backlinks = ref<{ id: string; name: string }[]>([])

async function refreshBacklinks() {
  if (!docTitle.value) { backlinks.value = []; return }
  // 优化：先过滤可能包含 [[ 的文件（减少字符串扫描），目标精确匹配仍 O(n) 但实际开销小；加简单节流避免频繁 toggle 触发
  if (backlinksRefreshTimer) clearTimeout(backlinksRefreshTimer)
  backlinksRefreshTimer = setTimeout(async () => {
    const all = await fileStore.loadByCategory('text')
    const target = `[[${docTitle.value}]]`
    const candidates = all.filter(f => typeof f.content === 'string' && f.content.includes('[['))
    backlinks.value = candidates
      .filter(f => f.content.includes(target) && f.id !== currentFileId.value)
      .map(f => ({ id: f.id, name: f.name }))
  }, 60)
}

// ─── WikiLink 文件列表（给建议浮窗使用） ───
const wikiFilesCache = ref<{ id: string; label: string }[]>([])
// 预热缓存
fileStore.loadByCategory('text').then(all => {
  wikiFilesCache.value = all.map(f => ({ id: f.id, label: f.name }))
})

// ─── Tiptap 编辑器 ───
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
      codeBlock: false, // replaced by CodeBlockLowlight
    }),
    Underline,
    Link.configure({ openOnClick: false }),
    Image.configure({
      inline: false,
      // Enable built-in resize (P0 from TipTap demos) - produces width/height attrs used by DOCX exporter
      resize: {
        enabled: true,
        alwaysPreserveAspectRatio: true,
      },
    }),
    Placeholder.configure({
      placeholder: '开始写作... 输入 [[ 插入双向链接，行首输入 / 打开命令菜单，选中文本调用 AI',
    }),
    CharacterCount,
    // ── 新扩展 ──
    Highlight.configure({ multicolor: true }),
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    NodeRange,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    // Details for collapsible blocks (like <details>)
    Details,
    DetailsSummary,
    DetailsContent,
    // TableOfContents (auto-generated, useful for long docs and exports)
    TableOfContents.configure({
      // default looks for headings
    }),
    // CodeBlock with syntax highlight using lowlight
    CodeBlockLowlight.configure({
      lowlight: createLowlight(common),
    }),
    // Unique ID for stable node references (helps versions, wiki links, export fidelity)
    UniqueID.configure({
      types: ['heading', 'paragraph', 'image', 'table', 'codeBlock'],
      // Better ID: timestamp + random for lower collision in large docs
      generateID: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    }),
    // ── Phase 1: 官方 TableKit (替换自定义 EditorTable) ──
    Table.configure({
      resizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    // ── Phase 1: 新增扩展 ──
    FontFamily.configure({
      types: ['textStyle'],
    }),
    Superscript,
    Subscript,
    Mathematics.configure({
      katexOptions: {
        throwOnError: false,
        displayMode: false,
      },
    }),
    // ── Phase 2: 额外扩展 ──
    Youtube.configure({
      controls: true,
      nocookie: true,
    }),
    Audio,
    TrailingNode,
    // ── [[双向链接]] ──
    WikiLinkExtension.configure({
      suggestion: createWikiLinkSuggestion(
        () => wikiFilesCache.value,
        (id, label) => emitEvent('open-in-editor', { fileId: id, name: label }),
      ),
      HTMLAttributes: { class: 'wiki-link' },
    }),
    // Slash Commands / 命令菜单 ( / 触发，参考 WikiLink suggestion 模式)
    SlashCommandsExtension,
    // Official Markdown for bidirectional support (replaces custom tiptapJsonToMarkdown)
    Markdown.configure({
      // Enable full roundtrip using nodes' renderHTML/parseHTML for custom (wiki, tables, details, etc.)
      html: true,
      // transformPastedText etc can be added if needed
    } as any),
  ],
  content: '',
  editorProps: {
    attributes: {
      class: 'tiptap-editor',
    },
    handleClick(view, pos, event) {
      // Ctrl+Click / Cmd+Click 跳转 [[双向链接]]
      if (!(event.ctrlKey || event.metaKey)) return false
      const target = (event.target as HTMLElement).closest?.('[data-wiki-link]')
      if (!target) return false
      const id = target.getAttribute('data-id')
      const label = target.getAttribute('data-label')
      if (id) {
        emitEvent('open-in-editor', { fileId: id, name: label || '' })
      }
      return true
    },
    handlePaste(_view, event) {
      const files = imageFilesFromList(event.clipboardData?.files)
      if (files.length === 0) return false
      event.preventDefault()
      insertImageFiles(files)
      return true
    },
    handleDrop(_view, event) {
      // Desktop Finder drops are handled by the project-resource dispatcher.
      return false
    },
  },
  onCreate: () => {
    updateDocCharCount()
  },
  onUpdate: () => {
    updateDocCharCount()
    captureActiveProjectSession()
    try {
      // For large docs, debounce persist to reduce stringify cost on every keystroke
      if (isLargeDoc.value) {
        if (persistTimer) clearTimeout(persistTimer)
        persistTimer = setTimeout(() => persistDraftSnapshot(), 800)
      } else {
        persistDraftSnapshot()
      }
    } catch { /* noop */ }
    if (activeTabId.value && projectSessions.get(activeTabId.value)) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer)
      const saveDelay = isLargeDoc.value ? 3000 : 1500
      autoSaveTimer = setTimeout(() => saveToFile(), saveDelay)
    }
  },
  onSelectionUpdate: () => updateBubblePosition(),
})

// 初始加载
function loadFromStorage() {
  try {
    const raw = localStorage.getItem('jc_tiptap_doc')
    if (raw) {
      const data = JSON.parse(raw)
      if (data.title) docTitle.value = data.title
      currentFileId.value = data.fileId || null
      currentAssets.value = Array.isArray(data.assets) ? data.assets : []
      if (data.content && editor.value) {
        editor.value.commands.setContent(data.content)
        updateDocCharCount()
      }
      pendingVersions = []
      emitEvent('editor-file-changed', { fileId: currentFileId.value })
    } else {
      // 迁移旧数据：把旧 blocks 合并成一个文档
      load()
      if (blocks.value.length > 0) {
        const markdown = blocks.value.map(b => {
          if (b.type === 'agent') {
            return `> **${b.agentName || 'Skill'}** · ${new Date(b.ts).toLocaleTimeString()}\n\n${b.content}`
          }
          return b.content
        }).join('\n\n---\n\n')
        // Use official markdown if available for better bidirectional fidelity
        setEditorMarkdown(markdown)
        updateDocCharCount()
      }
    }
  } catch { /* noop */ }
}

// 等编辑器就绪后加载
const checkReady = setInterval(() => {
  if (editor.value) {
    loadFromStorage()
    updateDocCharCount()
    clearInterval(checkReady)
  }
}, 50)
setTimeout(() => clearInterval(checkReady), 5000) // 安全退出

// ─── 文件重命名同步 ───
const offFileRenamed = onEvent('file-renamed', (payload: any) => {
  if (docTitle.value === payload.oldName) {
    docTitle.value = payload.newName
  }
})
onBeforeUnmount(() => {
  offFileRenamed()
})

// ─── 接收"导入编辑区"事件 ───
// 支持 mode: 'replace'（替换当前内容）或 'append'（追加到文档末尾）
const offImport = onEvent('import-to-editor', (payload: any) => {
  if (editor.value && payload?.content) {
    const mode = payload.mode || 'replace'
    const importedDoc = buildImportedTextDoc({
      agentName: payload.agentName || '助手',
      content: String(payload.content || ''),
    })

    if (mode === 'append') {
      // 追加模式：在当前文档末尾插入内容
      const docSize = editor.value.state.doc.content.size
      editor.value.commands.insertContentAt(docSize, importedDoc.content)
      updateDocCharCount()
    } else {
      // 替换模式：清除当前文件引用，视为新文档
      if (activeTabId.value && projectSessions.get(activeTabId.value)) {
        projectSessions.remove(activeTabId.value)
        touchProjectSessions()
        activeTabId.value = null
        currentResource.value = null
        currentResourceDeleted.value = false
      }
      currentFileId.value = null
      currentFilePath.value = null
      currentProjectDir.value = null
      docTitle.value = payload.agentName ? `${payload.agentName} 的输出` : '正文'
      currentAssets.value = []
      editor.value.commands.setContent(importedDoc.content)
      updateDocCharCount()
    }
  }
})
onBeforeUnmount(() => { offImport() })

// ─── 接收"在编辑区打开"事件 ───
const offOpenInEditor = onEvent('open-in-editor', async (payload: any) => {
  if (!editor.value || !payload) return

  if (payload.resource && typeof payload.content === 'string') {
    const resource = payload.resource as ProjectResource
    captureActiveProjectSession()
    const revision = payload.revision as ProjectResourceRevision | undefined
      || (await projectFileService.readText(resource)).revision
    const mode = (payload.editorMode as ProjectTextEditorMode | undefined) || projectTextEditorMode(resource)
    const session = projectSessions.openProject(resource, textToTiptapDoc(payload.content), payload.content, revision)
    projectTextMode.value = mode
    plainProjectText.value = mode === 'plain' ? payload.content : ''
    touchProjectSessions()
    renderProjectSession(session.tabId)
    return
  }

  // ★ Task A: 磁盘文件路径分支
  if (payload.filePath && !payload.fileId && !payload.projectDir) {
    // 仅保留非项目的只读临时预览。项目资源必须携带 resource 走上方服务路径。
    const raw = await readRealFileContent(payload.filePath, payload.projectDir)
    if (raw !== null) {
      // 构造显示用的路径标识：有 projectDir 时拼完整路径，否则直接用传入路径
      const displayPath = payload.projectDir
        ? payload.projectDir.replace(/\/+$/, '') + '/' + payload.filePath.replace(/^\/+/, '')
        : payload.filePath
      const tabId = `disk:${displayPath}`
      openOrSwitchTab({
        id: tabId,
        title: payload.name || payload.filePath.split('/').pop() || '磁盘文件',
        filePath: displayPath,
      })
      currentFilePath.value = displayPath
      currentProjectDir.value = payload.projectDir || null
      currentFileId.value = null
      docTitle.value = payload.name || payload.filePath.split('/').pop() || '磁盘文件'
      currentAssets.value = []
      editor.value.commands.setContent(textToTiptapDoc(raw))
      // ponytail: 记录初始内容，对齐 VS Code 的 isDirty 语义 — 刚打开的文件不触发保存
      lastSavedMarkdown.value = getEditorMarkdown()
      updateDocCharCount()
      pendingVersions = []
      emitEvent('editor-file-changed', { fileId: null, filePath: displayPath })
      if (payload.lineNumber) {
        setTimeout(() => jumpEditorToLine(editor.value!, payload.lineNumber), 150)
      }
      return
    }
    // 磁盘文件不存在或无权读取 → 静默降级
    return
  }

  // 现有 SQLite 分支（保持不变）
  if (payload.fileId) {
    currentFileId.value = payload.fileId
    currentFilePath.value = null
    currentProjectDir.value = null
    docTitle.value = payload.name || '正文'

    // 优先从文件 metadata 恢复 tiptapJson（保留 wikiLink 等结构化节点）
    let doc: any = null
    let assets: EditorAssetRef[] = []
    try {
      const file = await fileStore.getFile(payload.fileId)
      if (file?.metadata?.tiptapJson) {
        doc = file.metadata.tiptapJson
      }
      if (Array.isArray(file?.metadata?.editorAssets)) {
        assets = file.metadata.editorAssets as EditorAssetRef[]
      }
    } catch { /* fallback to plain text */ }
    if (!doc) {
      doc = textToTiptapDoc(payload.content || '')
    }

    // ★ 在 Tab 栏注册
    openOrSwitchTab({
      id: `sqlite:${payload.fileId}`,
      title: payload.name || 'SQLite 文档',
      fileId: payload.fileId,
    })

    currentAssets.value = assets
    editor.value.commands.setContent(doc)
    updateDocCharCount()
    pendingVersions = [] // 切换文件时清空待持久化版本缓冲
    // 广播当前编辑文件 ID
    emitEvent('editor-file-changed', { fileId: currentFileId.value })
    // 刷新反向链接
    refreshBacklinks()
  }
})
onBeforeUnmount(() => { offOpenInEditor() })

// ─── 接收"从变更审查打开 diff 文件"事件 ───
const offOpenDiffInEditor = onEvent('open-diff-in-editor', async (payload: any) => {
  if (!editor.value || !payload) return

  const { filePath, fileName, patch, diff } = payload
  const displayName = fileName || filePath || '变更文件'

  // 尝试读取真实文件内容 (桌面端 Tauri FS)
  let realContent: string | null = null
  if (filePath) {
    realContent = await readRealFileContent(filePath)
  }

  if (realContent !== null) {
    // 成功读取真实文件 → 加载到编辑区
    docTitle.value = displayName
    currentFilePath.value = filePath        // ★ 记录磁盘来源，保存时写回
    currentFileId.value = null
    currentAssets.value = []
    editor.value.commands.setContent(textToTiptapDoc(realContent))
    updateDocCharCount()
    pendingVersions = []

    // 如果有 patch，附加 diff 注释到文档末尾
    if (patch) {
      const diffNote = `\n\n---\n## 变更审查 (AI 修改)\n\`\`\`diff\n${patch}\n\`\`\``
      const docSize = editor.value.state.doc.content.size
      editor.value.commands.insertContentAt(docSize, textToTiptapDoc(diffNote).content)
    }

    emitEvent('editor-file-changed', { fileId: null, filePath })
    emitEvent('switch-panel', 'editor')
  } else {
    // 降级: 把 diff 当作文档导入
    const content = `## 文件变更: ${displayName}\n\n\`\`\`diff\n${patch || ''}\n\`\`\``
    emitEvent('import-to-editor', {
      content,
      agentName: '变更审查',
      mode: 'replace',
    })
    emitEvent('switch-panel', 'editor')
  }
})
onBeforeUnmount(() => { offOpenDiffInEditor() })

const offCloseCurrentEditorTab = onEvent('editor-close-current-tab', async (payload: any) => {
  const payloadFileId = payload?.fileId ? String(payload.fileId) : null
  await closeEditorTabSafely({
    getCurrentFileId: () => currentFileId.value,
    payloadFileId,
    saveCurrentFile: async () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
        autoSaveTimer = null
      }
    },
    clearEditor: () => {
      pendingVersions = []
      currentFileId.value = null
      currentFilePath.value = null
      currentProjectDir.value = null
      lastSavedMarkdown.value = ''
      docTitle.value = '正文'
      currentAssets.value = []
      editor.value?.commands.clearContent()
      updateDocCharCount()
      emitEvent('editor-file-changed', { fileId: null, filePath: null })
    },
  })
})
onBeforeUnmount(() => { offCloseCurrentEditorTab() })

// 项目资源导出只允许导出当前资源的原文件，不再转换为 Word/PDF/HTML。
const offExportCurrentEditor = onEvent('export-current-editor', async (payload: any) => {
  const session = activeProjectSession.value
  if (!session?.resource || !projectSessions.canSaveToOriginal(session.tabId)) {
    const errorResult = { status: 'error', message: '编辑器未就绪' }
    payload?.callback?.(errorResult)
    emitEvent('editor-export-result', errorResult)
    return
  }
  try {
    if (session.dirty && !await saveProjectSession(session.tabId)) throw new Error('当前文件保存失败，未导出旧版本')
    const result = await exportProjectResourceThroughFileTree(session.resource)
    const exportResult = { status: result.status, path: result.path, format: 'original' }
    payload?.callback?.(exportResult)
    emitEvent('editor-export-result', exportResult)
  } catch (err: any) {
    const errorResult = { status: 'error', message: err.message || String(err) }
    payload?.callback?.(errorResult)
    emitEvent('editor-export-result', errorResult)
  }
})
onBeforeUnmount(() => { offExportCurrentEditor() })

async function saveProjectSession(tabId = activeTabId.value): Promise<boolean> {
  if (!tabId) return false
  return await projectSaveQueue.run(tabId, () => saveProjectSessionNow(tabId))
}

function saveActiveProjectSession() {
  if (activeTabId.value) void saveProjectSession(activeTabId.value)
}

async function exportCurrentProjectResource() {
  const session = activeProjectSession.value
  if (!session?.resource || !projectSessions.canSaveToOriginal(session.tabId)) {
    exportStatus.value = '当前没有可导出的项目文件'
    return
  }
  if (session.dirty && !await saveProjectSession(session.tabId)) return
  try {
    const result = await exportProjectResourceThroughFileTree(session.resource)
    exportStatus.value = result.status === 'cancelled' ? '已取消导出' : `已导出 ${session.resource.name}`
  } catch (error) {
    exportStatus.value = `导出失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function exportProjectResourceThroughFileTree(resource: ProjectResource): Promise<{ status: string; path?: string; message?: string }> {
  return new Promise(resolve => {
    emitEvent('project:export-resources', { resources: [resource], callback: resolve })
  })
}

function onPlainProjectTextInput() {
  captureActiveProjectSession()
  updateDocCharCount()
}

function openEditorContextMenu(event: MouseEvent) {
  editorContextMenu.value = { show: true, x: event.clientX, y: event.clientY }
}

function closeEditorContextMenu() {
  editorContextMenu.value.show = false
}

function runEditorContextCommand(command: string) {
  if (['cut', 'copy', 'paste', 'selectAll'].includes(command)) {
    if (isPlainProjectText.value) plainTextRef.value?.focus()
    else editor.value?.commands.focus()
    document.execCommand(command === 'selectAll' ? 'selectAll' : command)
  } else if (command === 'undo') undo()
  else if (command === 'redo') redo()
  else if (command === 'bold') toggleBold()
  else if (command === 'italic') toggleItalic()
  else if (command === 'underline') toggleUnderline()
  else if (command === 'strike') toggleStrike()
  else if (command === 'heading') setHeading(1)
  else if (command === 'bulletList') toggleBulletList()
  else if (command === 'orderedList') toggleOrderedList()
  else if (command === 'image') insertImage()
  else if (command === 'table') insertTable()
  else if (command === 'findReplace') toggleFindReplace()
  else if (command.startsWith('ai:')) void aiToolAction(command.slice(3))
  closeEditorContextMenu()
}

function locateActiveProjectResource() {
  const resource = activeProjectSession.value?.resource
  if (resource) emitEvent('project-filetree:locate', { path: resource.path })
  closeEditorContextMenu()
}

function requestNewProjectDocument() {
  emitEvent('project:new-document')
}

async function saveProjectSessionNow(tabId: string): Promise<boolean> {
  if (tabId === activeTabId.value) captureActiveProjectSession()
  const session = projectSessions.get(tabId)
  if (!session?.resource || !projectSessions.canSaveToOriginal(tabId)) {
    exportStatus.value = session?.state === 'deleted'
      ? '文件已删除，请另存为新项目文件或放弃更改'
      : '当前文件不能保存，请重新加载或另存为'
    return false
  }
  if (!session.dirty) return true
  const savingVersion = projectSessions.markSaving(tabId)
  if (savingVersion === undefined || !session.baseRevision) return false
  touchProjectSessions()
  try {
    const result = await projectFileService.writeText(session.resource, session.markdown, session.baseRevision)
    if (result.status === 'saved') {
      projectSessions.markSaved(tabId, result.revision, savingVersion)
      touchProjectSessions()
      exportStatus.value = '已保存到项目'
      setTimeout(() => { if (exportStatus.value === '已保存到项目') exportStatus.value = '' }, 2000)
      return true
    }
    if (result.status === 'missing') {
      const operationId = crypto.randomUUID()
      projectSessions.applyResourceChange({ type: 'deleted', resource: session.resource, transactionId: operationId, operationId, source: 'external' })
      exportStatus.value = '文件已删除，请另存为新项目文件或放弃更改'
    } else {
      projectSessions.markConflict(tabId)
      exportStatus.value = '文件已被外部修改，请重新加载或另存为'
    }
    touchProjectSessions()
    return false
  } catch (error) {
    projectSessions.markSaveError(tabId, error instanceof Error ? error.message : String(error))
    touchProjectSessions()
    exportStatus.value = '项目文件保存失败'
    return false
  }
}

function suggestedProjectCopyPath(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot > 0 ? `${path.slice(0, dot)}-副本${path.slice(dot)}` : `${path}-副本`
}

async function saveProjectSessionAs() {
  const session = activeProjectSession.value
  if (!session?.resource || (session.state !== 'deleted' && session.state !== 'conflict')) return
  const path = window.prompt('另存为项目内文件', suggestedProjectCopyPath(session.resource.path))
  if (!path?.trim()) return
  try {
    const resource = await projectFileService.createText(session.resource.owner, path.trim(), session.markdown)
    const read = await projectFileService.readText(resource)
    projectSessions.rebindToCreatedResource(session.tabId, resource, read.revision)
    touchProjectSessions()
    renderProjectSession(session.tabId)
    exportStatus.value = '已另存为新项目文件'
  } catch (error) {
    exportStatus.value = `另存为失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

function discardDeletedProjectSession() {
  const session = activeProjectSession.value
  if (!session || session.state !== 'deleted') return
  projectSessions.remove(session.tabId)
  touchProjectSessions()
  const next = projectSessions.active()
  if (next) renderProjectSession(next.tabId)
  else if (openTabs.value.length) selectTab(openTabs.value[0].id)
  else clearEditorAfterLastTab()
}

function reloadActiveProjectSession() {
  const session = activeProjectSession.value
  if (session?.resource) void reloadProjectSession(session.tabId, session.resource)
}

async function saveToFile() {
  if (activeTabId.value && projectSessions.get(activeTabId.value)) {
    await saveProjectSession(activeTabId.value)
    return
  }
  exportStatus.value = '当前内容未绑定项目文件，请新建项目文档后保存'
}

async function reloadProjectSession(tabId: string, resource: ProjectResource) {
  const session = projectSessions.get(tabId)
  if (!session || session.resource !== resource || !['ready', 'conflict', 'error'].includes(session.state)) return
  try {
    const text = await projectFileService.readText(resource)
    const current = projectSessions.get(tabId)
    if (!current || current.resource !== resource || !['ready', 'conflict', 'error'].includes(current.state)) return
    if (text.truncated || text.content.includes('\0')) {
      projectSessions.markSaveError(tabId, '文件不能在编辑区安全读取')
    } else {
      projectSessions.replaceLoaded(tabId, textToTiptapDoc(text.content), text.content, text.revision)
      if (activeTabId.value === tabId) renderProjectSession(tabId)
    }
  } catch (error) {
    projectSessions.markSaveError(tabId, error instanceof Error ? error.message : String(error))
  } finally {
    touchProjectSessions()
  }
}

const offProjectResourceChanged = onProjectResourceChange(change => {
  const effects = projectSessions.applyResourceChange(change)
  touchProjectSessions()
  for (const effect of effects) {
    if (effect.type === 'reload') void reloadProjectSession(effect.tabId, effect.resource)
  }
  const active = activeProjectSession.value
  if (active?.state === 'deleted') {
    currentResourceDeleted.value = true
    exportStatus.value = '文件已从项目删除，请另存为新项目文件或放弃更改'
  } else if (active) {
    renderProjectSession(active.tabId)
  } else if (effects.some(effect => effect.type === 'close')) {
    const next = projectSessions.active()
    if (next) renderProjectSession(next.tabId)
    else if (openTabs.value.length) selectTab(openTabs.value[0].id)
    else clearEditorAfterLastTab()
  }
})
onBeforeUnmount(() => { offProjectResourceChanged() })

async function openDroppedEditorResource(resource: ProjectResource) {
  const result = await openProjectResource(projectFileService, resource)
  if (result.type === 'editor') {
    emitEvent('open-in-editor', { resource: result.resource, content: result.text.content, revision: result.text.revision, editorMode: result.editorMode })
    return
  }
  const existing = new Set((await projectFileService.list(resource.owner)).map(item => item.path))
  const base = resource.name.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_') || '导入文件'
  let path = `jc-imports/${base}-引用.md`
  for (let index = 2; existing.has(path); index++) path = `jc-imports/${base}-引用-${index}.md`
  const note = await projectFileService.createText(resource.owner, path, `[${resource.name}](./${resource.name})\n`)
  const text = await projectFileService.readText(note)
  emitEvent('open-in-editor', { resource: note, content: text.content, revision: text.revision, editorMode: 'rich' })
}

async function importDesktopEditorPaths(paths: string[]) {
  const owner = projectStore.projectDir.value
  if (!owner) return
  try {
    const resources = await projectFileActions.importDesktopPaths({ owner, paths, targetPath: 'jc-imports' })
    for (const resource of resources) await openDroppedEditorResource(resource)
  } catch (error) {
    showOpToast(`导入失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const offDesktopProjectDrop = onEvent('project:desktop-drop', (payload: unknown) => {
  const drop = payload as { target?: string; paths?: string[] }
  if (drop.target === 'editor' && Array.isArray(drop.paths)) void importDesktopEditorPaths(drop.paths)
})
onBeforeUnmount(offDesktopProjectDrop)

// ─── Cmd+S 快捷键 ───
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && editorContextMenu.value.show) {
    closeEditorContextMenu()
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    saveToFile()
  }
}

function handleDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (editorContextMenu.value.show && !t.closest('.ep-context-menu')) closeEditorContextMenu()
  // Close the more menu when clicking outside it.
  if (showMoreMenu.value && !t.closest('.ep-more-wrap')) {
    showMoreMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', handleDocClick, true)
  // 监听文件列表刷新，只在必要时更新 WikiLink 缓存（避免大文档时 onUpdate 每 keystroke 都 load）
  const offRefresh = onEvent('refresh-file-list', () => {
    fileStore.loadByCategory('text').then(all => {
      wikiFilesCache.value = all.map(f => ({ id: f.id, label: f.name }))
    })
  })
  // 存储清理
  ;(window as any).__jc_off_refresh_wiki = offRefresh
  // ★ Bug fix: 消费 EditorPanel 挂载前 ProjectFileTree 发出的 open-in-editor
  // 场景：用户在别的面板 → 点击文件树中的文件 → switch-panel 切到 editor → EditorPanel 刚挂载，handler 还没注册
  const pending = consumeLastEvent('open-in-editor')
  if (pending) emitEvent('open-in-editor', ...pending)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', handleDocClick, true)
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  if (persistTimer) clearTimeout(persistTimer)
  if (backlinksRefreshTimer) clearTimeout(backlinksRefreshTimer)
  const off = (window as any).__jc_off_refresh_wiki
  if (off) { off(); delete (window as any).__jc_off_refresh_wiki }
})

// ─── Phase 3: 版本历史（轻量快照） ───
function createVersionSnapshot(label?: string) {
  if (!editor.value) return

  const snapshot = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    label: label || '手动保存',
    tiptapJson: editor.value.getJSON(),
    title: docTitle.value,
  }

  // 限制最多保留 15 个版本
  if (currentFileId.value) {
    // 实际持久化在下次 saveToFile 时通过 metadata
    // 这里先临时存到 module 作用域，saveToFile 会合并 (不再用 window 全局)
    pendingVersions.unshift(snapshot)
    if (pendingVersions.length > 15) pendingVersions.pop()
  }
}

async function loadVersionHistory() {
  versionHistory.value = []
  if (!currentFileId.value) return

  try {
    const file = await fileStore.getFile(currentFileId.value)
    const versions = Array.isArray((file?.metadata as any)?.versions) ? (file?.metadata as any).versions : []
    versionHistory.value = versions
  } catch (e) {
    console.error('加载版本历史失败', e)
  }
}

async function restoreVersion(version: any) {
  if (!editor.value || !currentFileId.value) return

  // 先创建一个当前状态的快照
  createVersionSnapshot('恢复前自动快照')

  // 恢复
  editor.value.commands.setContent(version.tiptapJson)
  updateDocCharCount()
  if (version.title) docTitle.value = version.title

  // 保存（这会把新版本历史写入 metadata）
  await saveToFile()

  showVersionHistory.value = false
  exportStatus.value = `已恢复版本：${new Date(version.timestamp).toLocaleString()}`
  setTimeout(() => (exportStatus.value = ''), 2000)
}

function closeVersionHistory() {
  showVersionHistory.value = false
}

// ─── 字数统计 & 大文档检测（响应式） ───
const docCharCount = ref(0)
const wordCount = computed(() => docCharCount.value)
const isLargeDoc = computed(() => docCharCount.value > 150000)

// ─── 工具栏操作 ───
function setHeading(level: 1 | 2 | 3) {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function toggleBold() { editor.value?.chain().focus().toggleBold().run() }
function toggleItalic() { editor.value?.chain().focus().toggleItalic().run() }
function toggleUnderline() { editor.value?.chain().focus().toggleUnderline().run() }
function toggleStrike() { editor.value?.chain().focus().toggleStrike().run() }
function toggleSuperscript() { editor.value?.chain().focus().toggleSuperscript().run() }
function toggleSubscript() { editor.value?.chain().focus().toggleSubscript().run() }
function toggleBulletList() { editor.value?.chain().focus().toggleBulletList().run() }
function toggleOrderedList() { editor.value?.chain().focus().toggleOrderedList().run() }
function toggleBlockquote() { editor.value?.chain().focus().toggleBlockquote().run() }

// 更新文档字符计数（用于响应式 isLargeDoc 和 wordCount）
function updateDocCharCount() {
  if (isPlainProjectText.value) {
    docCharCount.value = plainProjectText.value.length
    return
  }
  if (editor.value) {
    docCharCount.value = editor.value.storage.characterCount.characters() || 0
  }
}
function toggleCodeBlock() { editor.value?.chain().focus().toggleCodeBlock().run() }
function toggleTaskList() { editor.value?.chain().focus().toggleTaskList().run() }
function toggleHighlight() { editor.value?.chain().focus().toggleHighlight().run() }
function insertHR() { editor.value?.chain().focus().setHorizontalRule().run() }
function undo() { editor.value?.chain().focus().undo().run() }
function redo() { editor.value?.chain().focus().redo().run() }

// 双向链接：输入 [[ 触发浮窗；工具栏按钮也可直接插入
function insertWikiLink() {
  editor.value?.chain().focus().insertContent('[[').run()
}

async function insertLink() {
  const { safePrompt } = await import('@/utils/safePrompt')
  const url = await safePrompt('输入链接地址', 'https://')
  if (!url) return
  const safeUrl = normalizeEditorLinkUrl(url)
  if (!safeUrl) {
    alert('只支持 http、https 或 mailto 链接。')
    return
  }
  editor.value?.chain().focus().setLink({ href: safeUrl }).run()
}

function imageFilesFromList(files?: FileList | null): File[] {
  return Array.from(files || []).filter(file => file.type.startsWith('image/'))
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function projectImagePath(file: File): string {
  const name = (file.name || '图片.png').replace(/[\\/]/g, '_')
  return `jc-media/images/${crypto.randomUUID()}-${name}`
}

async function insertImageFiles(files: File[]) {
  if (!editor.value || files.length === 0) return
  const inserted: EditorAssetRef[] = []

  for (const file of files) {
    const projectSession = activeProjectSession.value
    const src = await fileToDataUrl(file)
    if (projectSession?.resource) {
      const resource = await projectFileService.importBinary({
        owner: projectSession.resource.owner,
        path: projectImagePath(file),
        data: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type || 'image/png',
      })
      const assetRef: EditorAssetRef = {
        id: resource.id || `${resource.owner}:${resource.path}`,
        name: resource.name,
        mimeType: resource.mimeType || file.type || 'image/png',
        size: file.size,
        src,
        createdAt: Date.now(),
      }
      inserted.push(assetRef)
      editor.value.chain().focus().setImage({ src, alt: resource.name, title: resource.name }).run()
      continue
    }

    const asset = await fileStore.addFile({
      category: 'image', name: file.name || `图片_${new Date().toLocaleTimeString('zh-CN')}.png`, content: src,
      mimeType: file.type || 'image/png', size: file.size, kind: 'asset', metadata: { kind: 'editor-asset', editorFileId: currentFileId.value || null },
    })
    const assetRef: EditorAssetRef = {
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
      src,
      createdAt: asset.createdAt,
    }
    inserted.push(assetRef)
    editor.value.chain().focus().setImage({ src, alt: asset.name, title: asset.name }).run()
  }

  currentAssets.value = mergeEditorAssets(currentAssets.value, inserted)
  await saveToFile()
}

const assetInput = ref<HTMLInputElement | null>(null)

function insertImage() {
  assetInput.value?.click()
}

async function handleAssetImageInput(e: Event) {
  const input = e.target as HTMLInputElement
  const files = imageFilesFromList(input.files)
  try {
    await insertImageFiles(files)
  } finally {
    input.value = ''
  }
}

// ── Phase 1: 使用官方 TableKit insertTable 命令 ──
function insertTable() {
  editor.value?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}

// ─── C1: 导入 Office 文件到编辑区 ───
const importInput = ref<HTMLInputElement | null>(null)
const isImporting = ref(false)

function triggerImport() {
  importInput.value?.click()
}

async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.[0]) return
  const file = input.files[0]
  isImporting.value = true
  try {
    const result = await processFile(file, { maxTextLength: 1024 * 1024 })
    if (result.textContent) {
      docTitle.value = file.name.replace(/\.[^.]+$/, '')
      editor.value?.commands.setContent(textToTiptapDoc(result.textContent))
      updateDocCharCount()
      currentFileId.value = null
      currentAssets.value = []
      emitEvent('editor-file-changed', { fileId: null })
    } else {
      alert('无法提取文件内容')
    }
  } catch (err: any) {
    alert(`导入失败: ${err.message}`)
  } finally {
    isImporting.value = false
    input.value = ''
  }
}

const showMoreMenu = ref(false)
const exportStatus = ref('')

// 通用操作反馈（toast 风格，替代部分 alert，与项目其他组件一致）
const opToast = ref('')
function showOpToast(msg: string, timeout = 2200) {
  opToast.value = msg
  setTimeout(() => { if (opToast.value === msg) opToast.value = '' }, timeout)
}

// Phase 3: 版本历史
const showVersionHistory = ref(false)
const versionHistory = ref<any[]>([])

// Phase 3: 快捷键说明
const showShortcuts = ref(false)

// ─── 清空 ───
async function clearDoc() {
  if (!await confirmAction('确定清空文档？')) return
  editor.value?.commands.clearContent()
  docTitle.value = '正文'
  currentFileId.value = null
  currentAssets.value = []
  localStorage.removeItem('jc_tiptap_doc')
  emitEvent('editor-file-changed', { fileId: null })
}

// ─── 悬浮 AI 工具 ───
const aiLoading = ref(false)
const aiAction = ref('')
const showBubble = ref(false)
const bubbleStyle = ref({ top: '0px', left: '0px' })

function updateBubblePosition() {
  if (!editor.value) return
  const { from, to } = editor.value.state.selection
  if (from === to) {
    showBubble.value = false
    return
  }
  // 获取选区 DOM 位置
  const view = editor.value.view
  const start = view.coordsAtPos(from)
  const editorEl = view.dom.closest('.ep-content')
  if (!editorEl) return
  const rect = editorEl.getBoundingClientRect()
  bubbleStyle.value = {
    top: (start.top - rect.top - 44) + 'px',
    left: Math.max(0, (start.left - rect.left)) + 'px',
  }
  showBubble.value = true
}

async function aiToolAction(action: string) {
  if (!editor.value || aiLoading.value) return
  const { from, to } = editor.value.state.selection
  const selectedText = editor.value.state.doc.textBetween(from, to, '\n')
  if (!selectedText.trim()) return

  const prompts: Record<string, string> = {
    '润色': `请润色以下文本，使其更流畅优美，保持原意，直接输出润色后的结果，不要加任何解释：\n\n${selectedText}`,
    '扩写': `请将以下文本扩写为更详细、更丰富的版本，保持原意，直接输出扩写结果：\n\n${selectedText}`,
    '缩写': `请将以下文本精简缩写为更简洁的版本，保留核心信息，直接输出缩写结果：\n\n${selectedText}`,
    '提炼': `请提炼以下文本的核心要点，以简洁的列表形式输出：\n\n${selectedText}`,
    '翻译': `请将以下文本翻译为英文（如果已是英文则翻译为中文），直接输出翻译结果：\n\n${selectedText}`,
    '续写': `请续写以下文本，保持风格和语气一致，直接输出续写内容：\n\n${selectedText}`,
  }

  const prompt = prompts[action]
  if (!prompt) return

  aiLoading.value = true
  aiAction.value = action

  try {
    const result = await callLLM({
      systemPrompt: '你是一个专业的文本编辑助手。请直接输出处理后的结果，不要加任何前缀说明。',
      userMessage: prompt,
      temperature: 0.3,
      maxTokens: action === '扩写' || action === '续写' ? 4096 : 2048,
    })
    const content = textToTiptapDoc(result).content
    if (action === '续写') {
      editor.value.commands.insertContentAt(to, content)
    } else {
      editor.value.commands.insertContentAt({ from, to }, content)
    }
    showBubble.value = false
    await saveToFile()
  } finally {
    aiLoading.value = false
    aiAction.value = ''
  }
}

// ─── 查找替换 ───
const showFindReplace = ref(false)
const findQuery = ref('')
const replaceQuery = ref('')

function toggleFindReplace() {
  showFindReplace.value = !showFindReplace.value
}

function doFindReplace() {
  if (!findQuery.value || !editor.value) return
  // 重要：find/replace 始终走 JSON 递归（仅改 .text 节点），绝不使用 getHTML + replaceAll（避免破坏标签/attrs/UniqueID/自定义节点结构）
  // 小文档路径也安全（无 HTML 风险）；大文档直接提示不执行
  if (isLargeDoc.value) {
    showOpToast('大文档下 find/replace 可能性能差，建议先分片导出后处理。')
    return
  }
  const json = editor.value.getJSON()
  let count = 0
  const query = findQuery.value
  const repl = replaceQuery.value
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'g')

  function walk(node: any): any {
    if (!node) return node
    if (node.type === 'text' && typeof node.text === 'string') {
      const matches = node.text.match(re)
      if (matches) count += matches.length
      return { ...node, text: node.text.replace(re, repl) }
    }
    if (node.content && Array.isArray(node.content)) {
      return { ...node, content: node.content.map(walk) }
    }
    return node
  }

  const newJson = walk(json)
  if (count > 0) {
    editor.value.commands.setContent(newJson)
    updateDocCharCount()
    showOpToast(`已替换 ${count} 处`)
  } else {
    showOpToast('未找到匹配内容')
  }
}
</script>

<template>
  <div class="ep" data-project-drop-target="editor">
    <!-- 顶部工具栏：一行文件名 + 一行功能按钮 -->
    <div class="ep-toolbar">
      <div class="ep-toolbar-row ep-toolbar-title-row">
        <input
          v-model="docTitle"
          class="ep-title-input serif"
          placeholder="未命名文档"
        />
        <span class="ep-word-count">{{ wordCount }} 字</span>
      </div>

      <div class="ep-toolbar-main">
        <button class="ep-fmt-btn" title="新建项目文档" @click="requestNewProjectDocument"><JcIcon name="note-add" /></button>
        <button class="ep-fmt-btn" :disabled="!canSaveActiveProjectSession" title="保存" @click="saveActiveProjectSession"><JcIcon name="save" /></button>
        <button class="ep-fmt-btn" @click="setHeading(1)" :class="{ active: editor?.isActive('heading', { level: 1 }) }" title="标题1">H1</button>
        <button class="ep-fmt-btn" @click="toggleBold" :class="{ active: editor?.isActive('bold') }" title="粗体"><JcIcon name="format_bold" /></button>
        <button class="ep-fmt-btn" @click="editor?.chain().focus().setTextAlign('left').run()" :class="{ active: editor?.isActive({ textAlign: 'left' }) }" title="左对齐"><JcIcon name="format_align_left" /></button>
        <button class="ep-fmt-btn" @click="editor?.chain().focus().setTextAlign('center').run()" :class="{ active: editor?.isActive({ textAlign: 'center' }) }" title="居中"><JcIcon name="format_align_center" /></button>
        <button class="ep-fmt-btn" @click="editor?.chain().focus().setTextAlign('right').run()" :class="{ active: editor?.isActive({ textAlign: 'right' }) }" title="右对齐"><JcIcon name="format_align_right" /></button>
        <div class="ep-toolbar-divider"></div>
        <button class="ep-fmt-btn" @click="toggleOrderedList" :class="{ active: editor?.isActive('orderedList') }" title="有序列表"><JcIcon name="format_list_numbered" /></button>
        <button class="ep-fmt-btn" @click="insertImage" title="插入图片"><JcIcon name="image" /></button>
        <button class="ep-fmt-btn" @click="insertTable" title="插入表格"><JcIcon name="table" /></button>
        <div class="ep-toolbar-divider"></div>
        <button class="ep-fmt-btn" @click="undo" title="撤销"><JcIcon name="undo" /></button>
        <button class="ep-fmt-btn" @click="redo" title="重做"><JcIcon name="redo" /></button>
        <div class="ep-toolbar-spacer"></div>

        <div class="ep-more-wrap">
          <button class="ep-fmt-btn" @click="showMoreMenu = !showMoreMenu" title="更多">
            <JcIcon name="more_horiz" />
          </button>
          <div v-if="showMoreMenu" class="ep-more-menu">
            <button @click="setHeading(2)" :class="{ active: editor?.isActive('heading', { level: 2 }) }">H2 标题2</button>
            <button @click="setHeading(3)" :class="{ active: editor?.isActive('heading', { level: 3 }) }">H3 标题3</button>
            <button @click="toggleItalic" :class="{ active: editor?.isActive('italic') }"><JcIcon name="format_italic" /> 斜体</button>
            <button @click="toggleUnderline" :class="{ active: editor?.isActive('underline') }"><JcIcon name="format_underlined" /> 下划线</button>
            <button @click="toggleStrike"><JcIcon name="strikethrough_s" /> 删除线</button>
            <button @click="toggleSuperscript"><span style="font-weight:700;">x²</span> 上标</button>
            <button @click="toggleSubscript"><span style="font-weight:700;">x₂</span> 下标</button>
            <button @click="toggleBulletList" :class="{ active: editor?.isActive('bulletList') }"><JcIcon name="format_list_bulleted" /> 无序列表</button>
            <button @click="toggleBlockquote" :class="{ active: editor?.isActive('blockquote') }"><JcIcon name="format_quote" /> 引用</button>
            <button @click="toggleCodeBlock"><JcIcon name="code" /> 代码块</button>
            <button @click="toggleTaskList"><JcIcon name="checklist" /> 任务列表</button>
            <button @click="toggleHighlight"><JcIcon name="draw" /> 高亮标注</button>
            <button @click="insertWikiLink"><span style="font-size:12px;font-weight:700;">[[</span> 双向链接</button>
            <button @click="insertLink"><JcIcon name="link" /> 链接</button>
            <button @click="insertHR"><JcIcon name="horizontal_rule" /> 分割线</button>
            <button @click="toggleDetailsBlock" :class="{ active: editor?.isActive('details') }"><JcIcon name="expand_more" /> 可折叠块</button>
            <button @click="insertTableOfContentsBlock" :class="{ active: editor?.isActive('tableOfContents') }"><JcIcon name="toc" /> 目录 (TOC)</button>
            <button @click="showBacklinks = !showBacklinks; refreshBacklinks()"><JcIcon name="hub" /> 反向链接</button>
            <button @click="toggleFindReplace"><JcIcon name="search" /> 查找替换</button>
            <div style="border-top:1px solid var(--line); margin:4px 0; padding-top:4px;"></div>
            <button @click="triggerImport" :disabled="isImporting"><JcIcon name="upload_file" /> 导入文件</button>
            <button @click="exportCurrentProjectResource"><JcIcon name="download" /> 导出当前文件</button>
            <button @click="showShortcuts = true"><JcIcon name="keyboard" /> 快捷键</button>
            <button @click="showVersionHistory = true; loadVersionHistory()"><JcIcon name="history" /> 版本历史</button>
            <button class="danger" @click="clearDoc"><JcIcon name="delete_sweep" /> 清空文档</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 隐藏的导入文件输入 -->
    <input ref="importInput" type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.md,.csv,.json,.html" style="display:none" @change="handleImportFile" />
    <input ref="assetInput" type="file" accept="image/*" multiple style="display:none" @change="handleAssetImageInput" />

    <!-- 导入中 -->
    <div v-if="isImporting" class="ep-ai-loading">
      <JcIcon name="upload_file" class="ep-ai-spin" />
      <span>正在导入文件...</span>
    </div>

    <!-- 查找替换 -->
    <div v-if="showFindReplace" class="ep-find-bar">
      <input v-model="findQuery" placeholder="查找..." class="ep-find-input" />
      <input v-model="replaceQuery" placeholder="替换为..." class="ep-find-input" />
      <button class="ep-find-btn" @click="doFindReplace">全部替换</button>
      <button class="ep-find-close" @click="toggleFindReplace">
        <JcIcon name="close" />
      </button>
    </div>
    <!-- 操作反馈（一致的简短 toast，非 alert；用于 find/replace 等） -->
    <div v-if="opToast" class="ep-op-toast">{{ opToast }}</div>

    <!-- Phase 3: 版本历史 Modal -->
    <div v-if="showVersionHistory" class="ep-preview-modal" @click.self="closeVersionHistory">
      <div class="ep-preview-content" style="max-width: 520px;">
        <div class="ep-preview-header">
          <span>版本历史（最近 {{ versionHistory.length }} 个快照）</span>
          <button @click="closeVersionHistory" class="ep-preview-close">
            <JcIcon name="close" />
          </button>
        </div>
        <div class="ep-preview-body" style="max-height: 420px; overflow-y: auto;">
          <div v-if="versionHistory.length === 0" style="color: #666; padding: 20px 0;">
            暂无版本历史。每次保存或导出时会自动创建轻量快照。
          </div>
          <div v-for="v in versionHistory" :key="v.id" 
               style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600;">{{ v.label || '快照' }}</div>
              <div style="font-size: 12px; color: #888;">{{ new Date(v.timestamp).toLocaleString() }}</div>
            </div>
            <button @click="restoreVersion(v)" style="padding: 4px 12px; font-size: 12px;">
              恢复此版本
            </button>
          </div>
        </div>
        <div class="ep-preview-footer">
          <button @click="closeVersionHistory">关闭</button>
        </div>
      </div>
    </div>

    <!-- 快捷键说明 Modal -->
    <div v-if="showShortcuts" class="ep-preview-modal" @click.self="showShortcuts = false">
      <div class="ep-preview-content" style="max-width: 480px;">
        <div class="ep-preview-header">
          <span>编辑区快捷键</span>
          <button @click="showShortcuts = false" class="ep-preview-close">
            <JcIcon name="close" />
          </button>
        </div>
        <div class="ep-preview-body" style="font-size: 13px; line-height: 1.6;">
          <div style="margin-bottom: 12px; color: #666;">大部分快捷键来自 TipTap，少数为本编辑区定制。大文档时自动启用性能优化（减少实时计算、跳过部分 getHTML）。</div>

          <div style="display: grid; gap: 6px;">
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>S</kbd></span>
              <span style="color:#555;">保存文档</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Z</kbd></span>
              <span style="color:#555;">撤销</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd></span>
              <span style="color:#555;">重做</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>B</kbd></span>
              <span style="color:#555;">加粗</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>I</kbd></span>
              <span style="color:#555;">斜体</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>U</kbd></span>
              <span style="color:#555;">下划线</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></span>
              <span style="color:#555;">删除线</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>8</kbd></span>
              <span style="color:#555;">无序列表</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>7</kbd></span>
              <span style="color:#555;">有序列表</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>9</kbd></span>
              <span style="color:#555;">任务列表</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>1/2/3</kbd></span>
              <span style="color:#555;">标题 1 / 2 / 3</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd></span>
              <span style="color:#555;">引用块</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>⌘/Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>C</kbd></span>
              <span style="color:#555;">代码块</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><kbd>Shift</kbd> + <kbd>Enter</kbd></span>
              <span style="color:#555;">硬换行（不分段）</span>
            </div>
            <div style="display: flex; justify-content: space-between; border-top: 1px solid #eee; padding-top: 8px; margin-top: 4px;">
              <span><kbd>Ctrl/⌘</kbd> + <kbd>点击</kbd></span>
              <span style="color:#555;">跳转 [[双向链接]]</span>
            </div>
            <div style="display: flex; justify-content: space-between; border-top: 1px solid #eee; padding-top: 8px; margin-top: 4px;">
              <span><kbd>/</kbd> （行首）</span>
              <span style="color:#555;">打开命令菜单（标题/列表/表格等）</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>拖拽手柄 ⋮⋮</span>
              <span style="color:#555;">鼠标拖动块重排（左侧出现）</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>图片拖拽边角</span>
              <span style="color:#555;">调整图片尺寸（支持等比）</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>▽ 按钮</span>
              <span style="color:#555;">插入/切换可折叠块 (Details)</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>TOC 按钮</span>
              <span style="color:#555;">插入目录 (TableOfContents)</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>L / C / R 按钮</span>
              <span style="color:#555;">段落/标题对齐 (TextAlign, 导出 DOCX 支持)</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>拖拽 ⋮⋮ + 唯一ID</span>
              <span style="color:#555;">块重排 + 稳定节点ID (UniqueID)</span>
            </div>
          </div>
        </div>
        <div class="ep-preview-footer">
          <button @click="showShortcuts = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- AI 处理中指示器 -->
    <div v-if="aiLoading" class="ep-ai-loading">
      <JcIcon name="auto_fix" class="ep-ai-spin" />
      <span>AI {{ aiAction }}中...</span>
    </div>

    <!-- 悬浮 AI 工具条（选中文本后出现） -->
    <div v-if="showBubble && !aiLoading" class="ep-bubble-menu" :style="bubbleStyle">
      <button @click="aiToolAction('润色')" :disabled="aiLoading">✨ 润色</button>
      <button @click="aiToolAction('扩写')" :disabled="aiLoading">📝 扩写</button>
      <button @click="aiToolAction('缩写')" :disabled="aiLoading">✂️ 缩写</button>
      <button @click="aiToolAction('提炼')" :disabled="aiLoading">💡 提炼</button>
      <button @click="aiToolAction('续写')" :disabled="aiLoading">➡️ 续写</button>
      <button @click="aiToolAction('翻译')" :disabled="aiLoading">🌐 翻译</button>
    </div>

    <!-- ★ Phase 1: 多文件 Tab 栏 -->
    <EditorTabs
      :tabs="openTabs"
      :active-tab-id="activeTabId"
      @select-tab="selectTab"
      @close-tab="closeTab"
    />

    <div v-if="activeProjectSession?.state === 'deleted'" class="ep-resource-notice">
      <span>原文件已删除，当前修改不会写回旧路径。</span>
      <button @click="saveProjectSessionAs">另存为</button>
      <button @click="discardDeletedProjectSession">放弃修改</button>
    </div>
    <div v-else-if="activeProjectSession?.state === 'conflict'" class="ep-resource-notice">
      <span>文件已被外部修改，当前内容不能直接覆盖。</span>
      <button @click="reloadActiveProjectSession">重新加载</button>
      <button @click="saveProjectSessionAs">另存为</button>
    </div>

    <!-- 编辑器主体 + 反向链接侧边栏 -->
    <div class="ep-body">
      <div class="ep-content">
        <!-- DragHandle for reordering blocks, lists, images, tables etc. (P0 UX from TipTap) -->
        <DragHandle
          v-if="editor && !isPlainProjectText"
          :editor="editor"
          :nested="true"
          class="drag-handle"
        />
        <textarea
          ref="plainTextRef"
          v-if="isPlainProjectText"
          v-model="plainProjectText"
          class="ep-plain-text"
          spellcheck="false"
          aria-label="原样文本编辑器"
          @input="onPlainProjectTextInput"
          @contextmenu.prevent="openEditorContextMenu"
        />
        <EditorContent v-else-if="editor" :editor="editor" @contextmenu.prevent="openEditorContextMenu" />
      </div>

      <div
        v-if="editorContextMenu.show"
        class="ep-context-menu"
        :style="{ left: `${editorContextMenu.x}px`, top: `${editorContextMenu.y}px` }"
      >
        <template v-if="isPlainProjectText">
          <button @click="runEditorContextCommand('undo')">撤销</button>
          <button @click="runEditorContextCommand('redo')">重做</button>
          <button @click="runEditorContextCommand('cut')">剪切</button>
          <button @click="runEditorContextCommand('copy')">复制</button>
          <button @click="runEditorContextCommand('paste')">粘贴</button>
          <button @click="runEditorContextCommand('selectAll')">全选</button>
          <button @click="runEditorContextCommand('findReplace')">查找替换</button>
        </template>
        <template v-else-if="hasRichTextSelection">
          <button @click="runEditorContextCommand('cut')">剪切</button>
          <button @click="runEditorContextCommand('copy')">复制</button>
          <button @click="runEditorContextCommand('paste')">粘贴</button>
          <div class="ep-context-menu-divider"></div>
          <button @click="runEditorContextCommand('bold')">加粗</button>
          <button @click="runEditorContextCommand('italic')">斜体</button>
          <button @click="runEditorContextCommand('underline')">下划线</button>
          <button @click="runEditorContextCommand('strike')">删除线</button>
          <div class="ep-context-menu-divider"></div>
          <button @click="runEditorContextCommand('ai:润色')">AI 润色</button>
          <button @click="runEditorContextCommand('ai:扩写')">AI 扩写</button>
          <button @click="runEditorContextCommand('ai:缩写')">AI 缩写</button>
          <button @click="runEditorContextCommand('ai:提炼')">AI 提炼</button>
        </template>
        <template v-else>
          <button @click="runEditorContextCommand('undo')">撤销</button>
          <button @click="runEditorContextCommand('redo')">重做</button>
          <button @click="runEditorContextCommand('paste')">粘贴</button>
          <div class="ep-context-menu-divider"></div>
          <button @click="runEditorContextCommand('heading')">标题</button>
          <button @click="runEditorContextCommand('bulletList')">无序列表</button>
          <button @click="runEditorContextCommand('orderedList')">有序列表</button>
          <button @click="runEditorContextCommand('image')">插入图片</button>
          <button @click="runEditorContextCommand('table')">插入表格</button>
          <button @click="runEditorContextCommand('findReplace')">查找替换</button>
        </template>
        <template v-if="activeProjectSession?.resource">
          <div class="ep-context-menu-divider"></div>
          <button :disabled="!canSaveActiveProjectSession" @click="saveActiveProjectSession(); closeEditorContextMenu()">保存</button>
          <button @click="exportCurrentProjectResource(); closeEditorContextMenu()">导出当前文件</button>
          <button @click="locateActiveProjectResource">在文件树中定位</button>
        </template>
      </div>

      <!-- 反向链接面板 -->
      <transition name="bl-slide">
        <div v-if="showBacklinks" class="ep-backlinks">
          <div class="bl-header">
            <JcIcon name="hub" style="font-size:16px;" />
            <span>反向链接</span>
            <span class="bl-count">{{ backlinks.length }}</span>
          </div>
          <div v-if="backlinks.length === 0" class="bl-empty">
            暂无其他文件引用「{{ docTitle }}」
          </div>
          <button
            v-for="bl in backlinks"
            :key="bl.id"
            class="bl-item"
            @click="emitEvent('open-in-editor', { fileId: bl.id, name: bl.name })"
          >
            <JcIcon name="description" style="font-size:14px;color:var(--ink3);" />
            <span>{{ bl.name }}</span>
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.ep {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}

.ep-resource-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--line);
  background: #fff5e6;
  color: var(--ink2);
  font-size: 12px;
}
.ep-resource-notice button {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink1);
  padding: 3px 7px;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}

/* ─── 主体布局（编辑区 + 反向链接侧栏） ─── */
.ep-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.ep-plain-text {
  width: 100%;
  height: 100%;
  resize: none;
  border: 0;
  outline: 0;
  padding: 16px 20px;
  background: var(--surface);
  color: var(--ink1);
  font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  tab-size: 2;
  box-sizing: border-box;
}

/* ─── 反向链接面板 ─── */
.ep-backlinks {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--line);
  background: var(--surface-alt);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 12px 0 24px;
}
.bl-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink2);
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}
.bl-count {
  margin-left: auto;
  background: var(--olive-pale);
  color: var(--olive-dark);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 11px;
}
.bl-empty {
  font-size: 12px;
  color: var(--ink3);
  padding: 12px 14px;
  line-height: 1.6;
}
.bl-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: none;
  border: none;
  font-size: 12px;
  color: var(--ink2);
  cursor: pointer;
  text-align: left;
  transition: background .12s;
  font-family: inherit;
  width: 100%;
}
.bl-item:hover {
  background: rgba(107,142,35,.07);
  color: var(--olive-dark);
}

/* 滑入动画 */
.bl-slide-enter-active,
.bl-slide-leave-active { transition: width .2s ease, opacity .2s; }
.bl-slide-enter-from,
.bl-slide-leave-to { width: 0; opacity: 0; }

/* ─── 工具栏 ─── */
.ep-toolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 12px;
  min-height: var(--app-header-height); box-sizing: border-box;
  border-bottom: 1px solid var(--line);
  background: var(--surface-alt);
  overflow: visible;
  flex-shrink: 0;
}

.ep-title-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  position: relative; /* for .diag-report absolute child to anchor without shifting layout on expand */
}

.ep-toolbar-main {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.ep-title-input {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink1);
  background: none;
  border: none;
  outline: none;
  flex: 1;
  min-width: 120px;
  font-family: inherit;
}
.ep-title-input::placeholder { color: var(--ink3); }

.ep-toolbar-spacer {
  flex: 1 1 20px;
  min-width: 8px;
}

.ep-toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--line);
  margin: 0 2px;
  flex-shrink: 0;
}

.ep-format-group {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}

.ep-fmt-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink3);
  font-family: inherit;
  transition: all 0.12s;
}
.ep-fmt-btn:hover { background: var(--olive-pale); color: var(--olive-dark); }
.ep-fmt-btn.active { background: rgba(107,142,35,.15); color: var(--olive-dark); }
.ep-fmt-btn:disabled { opacity: .5; cursor: wait; }
.ep-fmt-btn .mso { font-size: 16px; }
.ep-fmt-btn.danger:hover { color: #e53935; background: rgba(229,57,53,.06); }

.ep-toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ep-word-count {
  font-size: 11px;
  color: var(--ink3);
  padding-right: 4px;
  white-space: nowrap;
}

.ep-export-status {
  font-size: 12px;
  color: var(--olive-dark);
  background: rgba(107,142,35,.08);
  border: 1px solid rgba(107,142,35,.16);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
}

.ep-chunk-progress {
  font-size: 11px;
  color: var(--olive);
  background: var(--olive-pale);
  padding: 1px 6px;
  border-radius: 999px;
  margin-left: 4px;
  font-family: monospace;
}

.ep-export-open-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--olive);
  cursor: pointer;
  border-radius: 4px;
}
.ep-export-open-btn:hover {
  background: var(--olive-pale);
}

/* ─── 诊断报告（无内联样式，class 驱动；absolute 展开不影响主布局流） ─── */
.ep-diagnostic-pill-wrap {
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  position: relative; /* local anchor if needed */
}
.ep-diag-pill-btn {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  color: #166534;
  border-color: #bbf7d0;
}
.ep-diagnostic-pill-wrap.failed .ep-diag-pill-btn,
.ep-diag-pill-btn.failed {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fef2f2;
}
.ep-diag-status-badge {
  font-weight: 600;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 999px;
  background: #bbf7d0;
}
.ep-diagnostic-pill-wrap.failed .ep-diag-status-badge {
  background: #fecaca;
}
.ep-diag-clear {
  font-size: 10px;
  color: #999;
  background: none;
  border: none;
  cursor: pointer;
}

.diag-report {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 80;
  margin: 4px 0 0;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  min-width: 280px;
  max-width: 520px;
}
.diag-report.failed {
  border-color: #fecaca;
}
.diag-report-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.diag-report-header strong {
  color: #166534;
}
.diag-report.failed .diag-report-header strong {
  color: #b91c1c;
}
.diag-timestamp {
  color: #666;
  font-size: 11px;
}
.diag-dl {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 2px 8px;
  margin: 0 0 6px;
  font-size: 11px;
}
.diag-dl dt {
  color: #666;
}
.diag-dl dd {
  margin: 0;
  font-weight: 500;
}
.diag-dl .diag-path {
  word-break: break-all;
  font-family: monospace;
  font-size: 10px;
}
.diag-errors {
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 4px 6px;
  border-radius: 4px;
  color: #b91c1c;
  font-size: 11px;
  margin-bottom: 4px;
}
.diag-raw {
  font-size: 10px;
  color: #555;
}
.diag-raw summary {
  cursor: pointer;
}
.diag-raw pre {
  margin: 4px 0 0;
  max-height: 180px;
  overflow: auto;
  background: #f8fafc;
  padding: 4px;
  border-radius: 3px;
  white-space: pre-wrap;
}

/* Phase 2: Export Preview Modal */
.ep-preview-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.ep-preview-content {
  background: white;
  width: 100%;
  max-width: 860px;
  max-height: 90vh;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
}
.ep-preview-header {
  padding: 12px 20px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  background: #f8f8f8;
}
.ep-preview-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
}
.ep-preview-body {
  flex: 1;
  overflow: auto;
  padding: 20px 40px;
  background: #fff;
  color: #222;
}
.ep-preview-footer {
  padding: 12px 20px;
  border-top: 1px solid #eee;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  background: #fafafa;
}
.ep-preview-footer button {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: white;
  cursor: pointer;
}
.ep-preview-footer button:last-child {
  background: var(--olive);
  color: white;
  border-color: var(--olive);
}

/* 快捷键 Modal 样式增强 */
.ep-preview-body kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  padding: 1px 5px;
  background: #f1f1f1;
  border: 1px solid #ccc;
  border-radius: 3px;
  color: #333;
}

/* Phase 3: 主题化导出样式（打印时可通过 class 切换，未来支持 UI 选择） */
@media print {
  .print-theme-academic {
    font-family: "Times New Roman", Georgia, serif;
    font-size: 12pt;
    line-height: 1.8;
    max-width: 100%;
  }
  .print-theme-business {
    font-family: "Microsoft YaHei", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
  }
  .print-theme-minimal {
    font-family: system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.4;
  }

  /* TDD / SDD 要求的 page-break 控制 */
  table, pre, img, blockquote, .ep-bubble-menu {
    page-break-inside: avoid;
  }
  h1, h2, h3 {
    page-break-after: avoid;
  }
  img {
    max-width: 100%;
    height: auto;
    page-break-inside: avoid;
  }
}

/* ─── 导出下拉 ─── */
.ep-export-wrap { position: relative; }
.ep-export-menu {
  position: absolute; top: calc(100% + 6px); right: 0;
  background: var(--paper, #fffdf6); border: 1px solid var(--line);
  color: var(--ink1);
  border-radius: 8px; box-shadow: 0 14px 34px rgba(24,36,22,.22);
  padding: 4px; z-index: 10020; min-width: 180px;
}
.ep-more-wrap { position: relative; }
.ep-more-menu {
  position: absolute; top: calc(100% + 6px); right: 0;
  background: var(--paper, #fffdf6); border: 1px solid var(--line);
  color: var(--ink1);
  border-radius: 8px; box-shadow: 0 14px 34px rgba(24,36,22,.22);
  padding: 4px; z-index: 10020; min-width: 170px;
  display: grid; gap: 2px;
}
.ep-export-menu button,
.ep-more-menu button {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 7px 10px; border: none; background: none; border-radius: 6px;
  font-size: 12px; color: var(--ink1); cursor: pointer; font-family: inherit;
  text-align: left; white-space: nowrap;
}
.ep-export-menu button:hover,
.ep-more-menu button:hover { background: var(--olive-pale); color: var(--olive-dark); }
.ep-more-menu button.danger:hover { color: #e53935; background: rgba(229,57,53,.06); }
.ep-export-menu .mso,
.ep-more-menu .mso { font-size: 15px; color: var(--ink3); }
.ep-context-menu {
  position: fixed;
  z-index: 90;
  min-width: 156px;
  padding: 4px;
  background: var(--paper, #fffdf6);
  border: 1px solid var(--line);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .16);
}
.ep-context-menu button {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
  font: inherit;
}
.ep-context-menu button:hover:not(:disabled) { background: var(--olive-pale); }
.ep-context-menu button:disabled { color: var(--ink3); cursor: default; }
.ep-context-menu-divider { height: 1px; margin: 4px 2px; background: var(--line); }
.ep-more-submenu {
  display: grid;
  gap: 2px;
  margin: 2px 0;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
}

/* ─── 查找替换 ─── */
.ep-find-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 16px; border-bottom: 1px solid var(--line);
  background: var(--surface-alt); flex-shrink: 0;
}
.ep-find-input {
  flex: 1; padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px;
  font-size: 12px; outline: none; background: var(--surface); color: var(--ink);
  font-family: inherit;
}
.ep-find-btn {
  padding: 4px 10px; background: var(--olive); color: #fff; border: none;
  border-radius: 4px; cursor: pointer; font-size: 11px; font-family: inherit;
}
.ep-find-close { background: none; border: none; cursor: pointer; }
.ep-find-close .mso { font-size: 16px; color: var(--ink3); }

/* 简短操作 toast（与 canvas/FileTree 等组件本地 toast 风格一致；用于 find/replace 反馈等） */
.ep-op-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--ink);
  color: #fff;
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  z-index: 200;
  white-space: nowrap;
  pointer-events: none;
}

/* ─── AI 处理中 ─── */
.ep-ai-loading {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(107,142,35,.06), rgba(213,199,135,.08));
  border-bottom: 1px solid rgba(107,142,35,.2);
  font-size: 13px; color: var(--olive-dark); font-weight: 600;
  animation: ai-pulse 1.5s ease infinite;
}
@keyframes ai-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .6; } }
.ep-ai-spin { animation: spin 2s linear infinite; font-size: 16px; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ─── 编辑器主体 ─── */
.ep-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 0 32px; /* left gutter reserves space for DragHandle; prevents absolute left clip on narrow screens, horizontal scroll, or when backlinks sidebar shown */
  position: relative; /* ensure drag-handle absolute is contained and not clipped by ancestors */
}

/* Tiptap 编辑区样式 */
:deep(.tiptap-editor) {
  padding: 32px 40px 120px;
  max-width: 780px;
  margin: 0 auto;
  outline: none;
  font-size: 15px;
  line-height: 1.8;
  color: var(--ink);
  /* ponytail: Intel Mac 修复 — min-height: 100% 依赖 flex 父容器已计算高度，
     慢盘/慢字体加载时父容器可能为 0，导致 ProseMirror 渲染零高度不可见。
     加像素级兜底，天花板：编辑器内容超过 400px 时 100% 仍生效。 */
  min-height: 100%;
  min-height: max(100%, 400px);
}

:deep(.tiptap-editor p) {
  margin: 4px 0;
}

:deep(.tiptap-editor h1) {
  font-size: 26px; font-weight: 800; margin: 24px 0 12px;
  color: var(--ink1); border-bottom: 2px solid var(--line); padding-bottom: 8px;
}
:deep(.tiptap-editor h2) {
  font-size: 20px; font-weight: 700; margin: 20px 0 8px; color: var(--ink1);
}
:deep(.tiptap-editor h3) {
  font-size: 16px; font-weight: 700; margin: 16px 0 6px; color: var(--ink1);
}

:deep(.tiptap-editor ul),
:deep(.tiptap-editor ol) {
  padding-left: 24px; margin: 8px 0;
}
:deep(.tiptap-editor li) { margin: 2px 0; }

:deep(.tiptap-editor blockquote) {
  border-left: 3px solid var(--olive);
  margin: 12px 0; padding: 8px 16px;
  color: var(--ink2); background: rgba(107,142,35,.03);
  border-radius: 0 8px 8px 0;
}

:deep(.tiptap-editor code) {
  background: rgba(107,142,35,.08); padding: 2px 6px; border-radius: 4px;
  font-size: 13px; font-family: 'SF Mono', 'Fira Code', monospace;
}

:deep(.tiptap-editor pre) {
  background: var(--surface-alt); border: 1px solid var(--line);
  border-radius: 8px; padding: 14px 18px; overflow-x: auto;
  margin: 12px 0;
}
:deep(.tiptap-editor pre code) {
  background: none !important; padding: 0 !important;
  font-size: 13px; line-height: 1.6;
}

:deep(.tiptap-editor hr) {
  border: none; border-top: 1px solid var(--line); margin: 20px 0;
}

:deep(.tiptap-editor img) {
  max-width: 100%; border-radius: 8px; margin: 12px 0;
  border: 1px solid var(--line);
}

:deep(.tiptap-editor table.editor-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  table-layout: fixed;
  font-size: 14px;
}
:deep(.tiptap-editor table.editor-table th),
:deep(.tiptap-editor table.editor-table td) {
  border: 1px solid var(--line);
  padding: 8px 10px;
  vertical-align: top;
  min-width: 80px;
}
:deep(.tiptap-editor table.editor-table th) {
  background: var(--surface-alt);
  color: var(--ink1);
  font-weight: 700;
}
:deep(.tiptap-editor table.editor-table p) {
  margin: 0;
}

:deep(.tiptap-editor a) {
  color: var(--olive); text-decoration: underline;
}

/* Placeholder */
:deep(.tiptap-editor p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--ink3);
  opacity: 0.5;
  pointer-events: none;
  height: 0;
  font-style: italic;
}

/* ─── 悬浮 AI 工具条 ─── */
.ep-bubble-menu {
  position: absolute;
  z-index: 50;
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  animation: bubble-in .15s ease;
}
@keyframes bubble-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.ep-bubble-menu button {
  padding: 4px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink2);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: all .12s;
}
.ep-bubble-menu button:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.ep-bubble-menu button:disabled {
  opacity: .4;
  cursor: wait;
}

/* ─── Drag Handle (from @tiptap/extension-drag-handle-vue-3) ─── */
.drag-handle {
  position: absolute;
  left: 4px; /* positive offset inside the .ep-content left padding gutter; avoids negative positioning clip on narrow/scroll/overflow */
  top: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink3);
  cursor: grab;
  opacity: 0.5;
  transition: opacity 0.1s;
  user-select: none;
  z-index: 20;
  font-size: 14px;
}
.drag-handle:hover {
  opacity: 1;
  color: var(--olive);
}
.drag-handle:active {
  cursor: grabbing;
}
.drag-handle::before {
  content: '⋮⋮';
  font-size: 13px;
  line-height: 1;
  letter-spacing: -1px;
  font-weight: 700;
}
/* Editor needs relative for absolute handles; blocks get relative for per-node handle */
:deep(.tiptap-editor) {
  position: relative;
  /* padding-left handled by .ep-content gutter (32px) + internal breathing room; avoids reliance on negative left that clips on narrow/scroll */
}
:deep(.tiptap-editor > *) {
  position: relative;
}

/* Image resize handles (from TipTap Image resize) */
:deep(.tiptap-editor img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}
:deep(.tiptap-editor [data-resize-handle]) {
  position: absolute;
  background: var(--olive);
  border: 1px solid #fff;
  border-radius: 2px;
  z-index: 30;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
:deep(.tiptap-editor [data-resize-handle='top-left']),
:deep(.tiptap-editor [data-resize-handle='top-right']),
:deep(.tiptap-editor [data-resize-handle='bottom-left']),
:deep(.tiptap-editor [data-resize-handle='bottom-right']) {
  width: 10px;
  height: 10px;
}
:deep(.tiptap-editor [data-resize-handle='left']),
:deep(.tiptap-editor [data-resize-handle='right']) {
  width: 6px;
  height: 30px;
  top: 50%;
  transform: translateY(-50%);
}
:deep(.tiptap-editor [data-resize-handle='top']),
:deep(.tiptap-editor [data-resize-handle='bottom']) {
  width: 30px;
  height: 6px;
  left: 50%;
  transform: translateX(-50%);
}

/* ─── Slash Command Menu (pure DOM, triggered by / ) ─── */
.slash-command-menu {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.1);
  min-width: 220px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px 0;
  font-size: 13px;
}
.sc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink2);
}
.sc-item:hover,
.sc-item.sc-selected {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.sc-icon {
  width: 20px;
  font-size: 14px;
  opacity: 0.8;
}
.sc-text {
  display: flex;
  flex-direction: column;
}
.sc-title {
  font-weight: 500;
}
.sc-desc {
  font-size: 11px;
  color: var(--ink3);
  margin-top: 1px;
}
.sc-empty {
  padding: 8px 12px;
  color: var(--ink3);
  font-size: 12px;
}
</style>
