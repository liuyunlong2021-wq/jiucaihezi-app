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
import { WikiLinkExtension, createWikiLinkSuggestion } from './WikiLinkExtension'
import { EditorTable, EditorTableCell, EditorTableHeader, EditorTableRow } from './editorTableExtensions'
import { useNotebook } from '@/composables/useNotebook'
import { onEvent, emitEvent } from '@/utils/eventBus'
import { useAgentStore } from '@/stores/agentStore'
import { useFileStore } from '@/composables/useFileStore'
import { buildImportedTextDoc, textToTiptapDoc } from '@/utils/editorContent'
import { processFile } from '@/composables/useFileUpload'
import { callLLM } from '@/utils/api'
import {
  buildEditorDocumentMetadata,
  mergeEditorAssets,
  tiptapJsonToMarkdown,
  type EditorAssetRef,
} from '@/utils/editorDocument'
import { normalizeExportFilename, saveGeneratedFile } from '@/utils/exportSave'
import { normalizeEditorLinkUrl } from '@/utils/urlSafety'

const { docTitle, load, blocks } = useNotebook()
const agentStore = useAgentStore()
const fileStore = useFileStore()

// ─── 文件绑定 ───
const currentFileId = ref<string | null>(null)
const currentAssets = ref<EditorAssetRef[]>([])
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function persistDraftSnapshot() {
  if (!editor.value) return
  const markdown = tiptapJsonToMarkdown(editor.value.getJSON())
  localStorage.setItem('jc_tiptap_doc', JSON.stringify({
    title: docTitle.value,
    content: editor.value.getJSON(),
    text: editor.value.getText(),
    html: editor.value.getHTML(),
    markdown,
    assets: currentAssets.value,
    fileId: currentFileId.value,
  }))
}

// ─── 反向链接面板 ───
const showBacklinks = ref(false)
const backlinks = ref<{ id: string; name: string }[]>([])

async function refreshBacklinks() {
  if (!docTitle.value) { backlinks.value = []; return }
  const all = await fileStore.loadByCategory('text')
  const target = `[[${docTitle.value}]]`
  backlinks.value = all.filter(f => f.content.includes(target) && f.id !== currentFileId.value)
    .map(f => ({ id: f.id, name: f.name }))
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
    }),
    Underline,
    Link.configure({ openOnClick: false }),
    Image.configure({ inline: false }),
    Placeholder.configure({
      placeholder: '开始写作... 输入 [[ 插入双向链接，选中文本调用 AI',
    }),
    CharacterCount,
    // ── 新扩展 ──
    Highlight.configure({ multicolor: true }),
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    EditorTable,
    EditorTableRow,
    EditorTableHeader,
    EditorTableCell,
    // ── [[双向链接]] ──
    WikiLinkExtension.configure({
      suggestion: createWikiLinkSuggestion(
        () => wikiFilesCache.value,
        (id, label) => emitEvent('open-in-editor', { fileId: id, name: label }),
      ),
      HTMLAttributes: { class: 'wiki-link' },
    }),
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
      const files = imageFilesFromList(event.dataTransfer?.files)
      if (files.length === 0) return false
      event.preventDefault()
      insertImageFiles(files)
      return true
    },
  },
  onUpdate: () => {
    try {
      persistDraftSnapshot()
    } catch { /* noop */ }
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => saveToFile(), 1500)
    // 刷新 WikiLink 文件缓存
    fileStore.loadByCategory('text').then(all => {
      wikiFilesCache.value = all.map(f => ({ id: f.id, label: f.name }))
    })
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
      }
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
        editor.value?.commands.setContent(textToTiptapDoc(markdown))
      }
    }
  } catch { /* noop */ }
}

// 等编辑器就绪后加载
const checkReady = setInterval(() => {
  if (editor.value) {
    loadFromStorage()
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
// 行为：替换当前编辑器内容（而非追加），实现"新建文档并导入"的体验
const offImport = onEvent('import-to-editor', (payload: any) => {
  if (editor.value && payload?.content) {
    // 清除当前文件引用，视为新文档
    currentFileId.value = null
    docTitle.value = payload.agentName ? `${payload.agentName} 的输出` : '正文'
    currentAssets.value = []

    // 替换编辑器内容
    editor.value.commands.setContent(buildImportedTextDoc({
      agentName: payload.agentName || '助手',
      content: String(payload.content || ''),
    }).content)
  }
})
onBeforeUnmount(() => { offImport() })

// ─── 接收"在编辑区打开"事件 ───
const offOpenInEditor = onEvent('open-in-editor', async (payload: any) => {
  if (editor.value && payload) {
    // 记录文件 ID（如果有）
    currentFileId.value = payload.fileId || null
    docTitle.value = payload.name || '正文'

    // 优先从文件 metadata 恢复 tiptapJson（保留 wikiLink 等结构化节点）
    let doc: any = null
    let assets: EditorAssetRef[] = []
    if (payload.fileId) {
      try {
        const file = await fileStore.getFile(payload.fileId)
        if (file?.metadata?.tiptapJson) {
          doc = file.metadata.tiptapJson
        }
        if (Array.isArray(file?.metadata?.editorAssets)) {
          assets = file.metadata.editorAssets as EditorAssetRef[]
        }
      } catch { /* fallback to plain text */ }
    }
    if (!doc) {
      doc = textToTiptapDoc(payload.content || '')
    }

    currentAssets.value = assets
    editor.value.commands.setContent(doc)
    // 广播当前编辑文件 ID
    emitEvent('editor-file-changed', { fileId: currentFileId.value })
    // 刷新反向链接
    refreshBacklinks()
  }
})
onBeforeUnmount(() => { offOpenInEditor() })

// ─── 自动保存到 IndexedDB ───
async function saveToFile() {
  if (!editor.value) return
  const text = editor.value.getText()
  const json = editor.value.getJSON()
  const html = editor.value.getHTML()
  const markdown = tiptapJsonToMarkdown(json) || text
  const size = new TextEncoder().encode(markdown).length

  if (currentFileId.value) {
    const existing = await fileStore.getFile(currentFileId.value)
    // 更新已有文件
    await fileStore.updateFile(currentFileId.value, {
      content: markdown,
      name: docTitle.value,
      mimeType: 'text/markdown',
      size,
      metadata: buildEditorDocumentMetadata(existing?.metadata, {
        tiptapJson: json,
        html,
        markdown,
        assets: currentAssets.value,
      }),
    })
    await linkAssetsToCurrentFile(currentFileId.value)
    persistDraftSnapshot()
  } else if (text.trim().length > 10 || currentAssets.value.length > 0) {
    // 新文档超过 10 字自动创建文件
    const file = await fileStore.addFile({
      category: 'text',
      name: docTitle.value || `新文档_${new Date().toLocaleTimeString('zh-CN')}`,
      content: markdown,
      mimeType: 'text/markdown',
      size,
      metadata: buildEditorDocumentMetadata(undefined, {
        tiptapJson: json,
        html,
        markdown,
        assets: currentAssets.value,
      }),
    })
    currentFileId.value = file.id
    await linkAssetsToCurrentFile(file.id)
    persistDraftSnapshot()
    emitEvent('editor-file-changed', { fileId: file.id })
    emitEvent('refresh-file-list', {})
  }
}

// ─── Cmd+S 快捷键 ───
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    saveToFile()
  }
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
})

// ─── 字数统计 ───
const wordCount = computed(() => {
  return editor.value?.storage.characterCount.characters() || 0
})

// ─── 工具栏操作 ───
function setHeading(level: 1 | 2 | 3) {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function toggleBold() { editor.value?.chain().focus().toggleBold().run() }
function toggleItalic() { editor.value?.chain().focus().toggleItalic().run() }
function toggleUnderline() { editor.value?.chain().focus().toggleUnderline().run() }
function toggleStrike() { editor.value?.chain().focus().toggleStrike().run() }
function toggleBulletList() { editor.value?.chain().focus().toggleBulletList().run() }
function toggleOrderedList() { editor.value?.chain().focus().toggleOrderedList().run() }
function toggleBlockquote() { editor.value?.chain().focus().toggleBlockquote().run() }
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

function insertLink() {
  const url = window.prompt('输入链接地址', 'https://')
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

async function insertImageFiles(files: File[]) {
  if (!editor.value || files.length === 0) return
  const inserted: EditorAssetRef[] = []

  for (const file of files) {
    const src = await fileToDataUrl(file)
    const asset = await fileStore.addFile({
      category: 'image',
      name: file.name || `图片_${new Date().toLocaleTimeString('zh-CN')}.png`,
      content: src,
      mimeType: file.type || 'image/png',
      size: file.size,
      kind: 'asset',
      metadata: {
        kind: 'editor-asset',
        editorFileId: currentFileId.value || null,
      },
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

async function linkAssetsToCurrentFile(fileId: string) {
  for (const asset of currentAssets.value) {
    const existing = await fileStore.getFile(asset.id)
    if (!existing || existing.category !== 'image') continue
    await fileStore.updateFile(asset.id, {
      metadata: {
        ...(existing.metadata || {}),
        kind: 'editor-asset',
        editorFileId: fileId,
      },
    })
  }
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

function createTableNode(rows = 3, cols = 3) {
  const safeRows = Math.max(2, Math.min(rows, 12))
  const safeCols = Math.max(2, Math.min(cols, 8))
  return {
    type: 'table',
    content: Array.from({ length: safeRows }, (_, rowIndex) => ({
      type: 'tableRow',
      content: Array.from({ length: safeCols }, (_, colIndex) => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [textToTiptapDoc(rowIndex === 0 ? `列${colIndex + 1}` : '').content[0]],
      })),
    })),
  }
}

function insertTable() {
  editor.value?.chain().focus().insertContent([
    createTableNode(),
    { type: 'paragraph' },
  ]).run()
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

// ─── C2: 导出（支持 md / docx / pdf） ───
const showExportMenu = ref(false)
const showMoreMenu = ref(false)
const exportStatus = ref('')
const isExporting = ref(false)

async function exportDoc(format: 'md' | 'docx' | 'pdf' = 'md') {
  if (isExporting.value) return
  showExportMenu.value = false
  showMoreMenu.value = false
  isExporting.value = true
  const text = tiptapJsonToMarkdown(editor.value?.getJSON() || {}) || editor.value?.getText() || ''
  const title = docTitle.value || '文档'

  try {
    if (format !== 'md') {
      exportStatus.value = '线上 Office 导出已关闭，请先保存 Markdown。'
      return
    }

    exportStatus.value = '正在选择保存位置...'
    const result = await saveGeneratedFile({
      filename: normalizeExportFilename(title + '.md', 'md'),
      mimeType: 'text/markdown;charset=utf-8',
      data: text,
    })
    exportStatus.value = result.status === 'cancelled' ? '已取消导出' : '已保存 Markdown'
  } catch (err: any) {
    exportStatus.value = '导出失败：' + (err.message || err)
  } finally {
    isExporting.value = false
    setTimeout(() => { exportStatus.value = '' }, 3500)
  }
}

// ─── 清空 ───
function clearDoc() {
  if (!confirm('确定清空文档？')) return
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
  const text = editor.value.getHTML()
  const count = (text.match(new RegExp(findQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  if (count > 0) {
    const newHtml = text.replaceAll(findQuery.value, replaceQuery.value)
    editor.value.commands.setContent(newHtml)
    alert(`已替换 ${count} 处`)
  } else {
    alert('未找到匹配内容')
  }
}
</script>

<template>
  <div class="ep">
    <!-- 顶部工具栏 -->
    <div class="ep-toolbar">
      <div class="ep-title-strip">
        <input
          v-model="docTitle"
          class="ep-title-input serif"
          placeholder="文档标题..."
        />
        <span v-if="exportStatus" class="ep-export-status">{{ exportStatus }}</span>
        <span class="ep-word-count">{{ wordCount }} 字</span>
      </div>

      <div class="ep-toolbar-main">
        <div class="ep-format-group">
          <button class="ep-fmt-btn" @click="setHeading(1)" :class="{ active: editor?.isActive('heading', { level: 1 }) }" title="标题1">H1</button>
          <button class="ep-fmt-btn" @click="setHeading(2)" :class="{ active: editor?.isActive('heading', { level: 2 }) }" title="标题2">H2</button>
          <button class="ep-fmt-btn" @click="setHeading(3)" :class="{ active: editor?.isActive('heading', { level: 3 }) }" title="标题3">H3</button>
        </div>
        <div class="ep-toolbar-divider"></div>

        <div class="ep-format-group">
          <button class="ep-fmt-btn" @click="toggleBold" :class="{ active: editor?.isActive('bold') }" title="粗体">
            <span class="mso">format_bold</span>
          </button>
          <button class="ep-fmt-btn" @click="toggleItalic" :class="{ active: editor?.isActive('italic') }" title="斜体">
            <span class="mso">format_italic</span>
          </button>
          <button class="ep-fmt-btn" @click="toggleUnderline" :class="{ active: editor?.isActive('underline') }" title="下划线">
            <span class="mso">format_underlined</span>
          </button>
        </div>
        <div class="ep-toolbar-divider"></div>

        <div class="ep-format-group">
          <button class="ep-fmt-btn" @click="toggleBulletList" :class="{ active: editor?.isActive('bulletList') }" title="无序列表">
            <span class="mso">format_list_bulleted</span>
          </button>
          <button class="ep-fmt-btn" @click="toggleOrderedList" :class="{ active: editor?.isActive('orderedList') }" title="有序列表">
            <span class="mso">format_list_numbered</span>
          </button>
          <button class="ep-fmt-btn" @click="toggleBlockquote" :class="{ active: editor?.isActive('blockquote') }" title="引用">
            <span class="mso">format_quote</span>
          </button>
        </div>
        <div class="ep-toolbar-divider"></div>

        <div class="ep-format-group">
          <button class="ep-fmt-btn" @click="insertImage" title="插入图片">
            <span class="mso">image</span>
          </button>
          <button class="ep-fmt-btn" @click="insertTable" title="插入表格">
            <span class="mso">table</span>
          </button>
        </div>
        <div class="ep-toolbar-divider"></div>

        <div class="ep-format-group">
          <button class="ep-fmt-btn" @click="undo" title="撤销">
            <span class="mso">undo</span>
          </button>
          <button class="ep-fmt-btn" @click="redo" title="重做">
            <span class="mso">redo</span>
          </button>
        </div>

        <div class="ep-toolbar-spacer"></div>

        <div class="ep-toolbar-right">
          <button class="ep-fmt-btn" @click="triggerImport" :disabled="isImporting" title="导入文件 (Office/PDF/文本)">
            <span class="mso">upload_file</span>
          </button>
          <div class="ep-export-wrap">
            <button class="ep-fmt-btn" :disabled="isExporting" @click="showExportMenu = !showExportMenu; showMoreMenu = false" title="导出">
              <span class="mso">download</span>
            </button>
            <div v-if="showExportMenu" class="ep-export-menu">
              <button @click="exportDoc('md')"><span class="mso">description</span> Markdown</button>
            </div>
          </div>
          <div class="ep-more-wrap">
            <button class="ep-fmt-btn" @click="showMoreMenu = !showMoreMenu; showExportMenu = false" title="更多">
              <span class="mso">more_horiz</span>
            </button>
            <div v-if="showMoreMenu" class="ep-more-menu">
              <button @click="toggleStrike"><span class="mso">strikethrough_s</span> 删除线</button>
              <button @click="toggleCodeBlock"><span class="mso">code</span> 代码块</button>
              <button @click="toggleTaskList"><span class="mso">checklist</span> 任务列表</button>
              <button @click="toggleHighlight"><span class="mso">draw</span> 高亮标注</button>
              <button @click="insertWikiLink"><span style="font-size:12px;font-weight:700;">[[</span> 双向链接</button>
              <button @click="insertLink"><span class="mso">link</span> 链接</button>
              <button @click="insertHR"><span class="mso">horizontal_rule</span> 分割线</button>
              <button @click="showBacklinks = !showBacklinks; refreshBacklinks()"><span class="mso">hub</span> 反向链接</button>
              <button @click="toggleFindReplace"><span class="mso">search</span> 查找替换</button>
              <button class="danger" @click="clearDoc"><span class="mso">delete_sweep</span> 清空</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 隐藏的导入文件输入 -->
    <input ref="importInput" type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.md,.csv,.json,.html" style="display:none" @change="handleImportFile" />
    <input ref="assetInput" type="file" accept="image/*" multiple style="display:none" @change="handleAssetImageInput" />

    <!-- 导入中 -->
    <div v-if="isImporting" class="ep-ai-loading">
      <span class="mso ep-ai-spin">upload_file</span>
      <span>正在导入文件...</span>
    </div>

    <!-- 查找替换 -->
    <div v-if="showFindReplace" class="ep-find-bar">
      <input v-model="findQuery" placeholder="查找..." class="ep-find-input" />
      <input v-model="replaceQuery" placeholder="替换为..." class="ep-find-input" />
      <button class="ep-find-btn" @click="doFindReplace">全部替换</button>
      <button class="ep-find-close" @click="toggleFindReplace">
        <span class="mso">close</span>
      </button>
    </div>

    <!-- AI 处理中指示器 -->
    <div v-if="aiLoading" class="ep-ai-loading">
      <span class="mso ep-ai-spin">auto_fix</span>
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

    <!-- 编辑器主体 + 反向链接侧边栏 -->
    <div class="ep-body">
      <div class="ep-content">
        <EditorContent v-if="editor" :editor="editor" />
      </div>

      <!-- 反向链接面板 -->
      <transition name="bl-slide">
        <div v-if="showBacklinks" class="ep-backlinks">
          <div class="bl-header">
            <span class="mso" style="font-size:16px;">hub</span>
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
            <span class="mso" style="font-size:14px;color:var(--ink3);">description</span>
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

/* ─── 主体布局（编辑区 + 反向链接侧栏） ─── */
.ep-body {
  flex: 1;
  display: flex;
  overflow: hidden;
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

/* ─── 导出下拉 ─── */
.ep-export-wrap { position: relative; }
.ep-export-menu {
  position: absolute; bottom: calc(100% + 6px); right: 0;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
  padding: 4px; z-index: 100; min-width: 140px;
}
.ep-more-wrap { position: relative; }
.ep-more-menu {
  position: absolute; bottom: calc(100% + 6px); right: 0;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
  padding: 4px; z-index: 100; min-width: 150px;
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
  padding: 0;
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
  min-height: 100%;
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
</style>
