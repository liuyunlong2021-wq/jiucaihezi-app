<script setup lang="ts">
/**
 * MessageBubble.vue — 消息气泡（Markdown + 代码复制 + 操作栏）
 *
 * 移植自 V4 code.html:
 *   - renderChat() 行 7931 — markdown 渲染
 *   - copyCodeBlock 行 7420 — 代码块复制
 *   - copyMsgFloat 行 7411 — 消息复制
 *   - shouldCreateAssistantDocumentCard 行 7437 — 长文导入
 */
import { computed, ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import ToolCallCard from './ToolCallCard.vue'
import type { ToolCall } from '@/composables/useChat'
import { emitEvent } from '@/utils/eventBus'
import { extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { canBuildOfficeCreateSpec, createOfficeDownloadFromText, inferOfficeDocType, type OfficeDocType } from '@/utils/officeAutoExport'
import { buildMessageExportFile, getLocalExportFormats, type LocalExportFormat } from '@/utils/messageExport'
import { fetchBlobForExport, normalizeExportFilename, saveGeneratedFile } from '@/utils/exportSave'

const props = defineProps<{
  content: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  agentId?: string
  agentName?: string
  messageId: string
  toolCalls?: ToolCall[]
  toolName?: string
  officeDownloadFiles?: OfficeDownloadFile[]
  images?: string[]  // 图片附件
  files?: Array<{ name: string; content: string }>  // 文本文件附件
  finishReason?: string
}>()

const emit = defineEmits<{
  (e: 'retry', messageId: string): void
  (e: 'delete', messageId: string): void
  (e: 'continue', messageId: string): void
}>()

const copyLabel = ref('复制')
const downloadingUrl = ref('')
const generatedOfficeFiles = ref<OfficeDownloadFile[]>([])
const exportError = ref('')
const exportStatus = ref('')
const showExportMenu = ref(false)

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}

// Markdown 渲染
const renderedHtml = computed(() => {
  if (!props.content) return ''
  if (props.role === 'user') {
    return sanitizeHtml(props.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'))
  }
  try {
    const html = marked.parse(props.content, { breaks: true, gfm: true }) as string
    // 给代码块注入复制按钮
    return sanitizeHtml(html.replace(
      /<pre><code(?: class="language-(\w+)")?>/g,
      (_match, lang) => {
        const langLabel = lang || 'code'
        return `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${langLabel}</span><button class="md-code-copy" type="button" data-code-copy="1">复制</button></div><pre><code class="language-${langLabel}">`
      }
    ).replace(/<\/code><\/pre>/g, '</code></pre></div>'))
  } catch {
    return sanitizeHtml(props.content.replace(/\n/g, '<br>'))
  }
})

const officeDownloadFiles = computed(() => {
  if (props.role !== 'tool' && props.role !== 'assistant') return []
  if (generatedOfficeFiles.value.length) return generatedOfficeFiles.value
  return props.officeDownloadFiles?.length
    ? props.officeDownloadFiles
    : extractOfficeDownloadFiles(props.content)
})

const officeDocType = computed(() => inferOfficeDocType(props.agentId, props.agentName))
const officeFormatLabel = computed(() => {
  const firstFile = officeDownloadFiles.value[0]
  const ext = firstFile?.filename.match(/\.([a-z0-9]+)$/i)?.[1] || officeDocType.value || ''
  return ext ? ext.toUpperCase() : '文件'
})
const exportLabel = computed(() => {
  if (downloadingUrl.value === 'creating') return `生成 ${officeFormatLabel.value} 中`
  if (downloadingUrl.value) return `导出 ${officeFormatLabel.value} 中`
  if (officeDownloadFiles.value.length > 1) return `导出 ${officeDownloadFiles.value.length} 个文件`
  return `导出 ${officeFormatLabel.value}`
})
const showAssistantExport = computed(() => (
  props.role === 'assistant'
  && Boolean(props.content.trim())
  && !props.content.trim().startsWith('⚠️')
))
const localExportFormats = computed(() => getLocalExportFormats(props.content))
const officeExportFormats = computed<OfficeDocType[]>(() => {
  if (!showAssistantExport.value) return []
  const formats: OfficeDocType[] = ['docx', 'pdf', 'pptx']
  if (canBuildOfficeCreateSpec('xlsx', props.content)) formats.push('xlsx')
  return formats
})
const canCreateOfficeDownload = computed(() => (
  props.role === 'assistant'
  && Boolean(officeDocType.value)
  && Boolean(props.content.trim())
  && !props.content.trim().startsWith('⚠️')
  && Boolean(officeDocType.value && canBuildOfficeCreateSpec(officeDocType.value, props.content))
))

const exportBaseName = computed(() => {
  const heading = props.content.match(/^#{1,3}\s+(.+)$/m)?.[1]
  const firstLine = props.content.split(/\n+/).map(line => line.replace(/^#{1,6}\s+/, '').trim()).find(Boolean)
  return heading || firstLine || props.agentName || '韭菜盒子导出'
})

function localFormatLabel(format: LocalExportFormat): string {
  const labels: Record<LocalExportFormat, string> = {
    md: 'Markdown',
    txt: 'TXT',
    html: 'HTML',
    json: 'JSON',
    csv: 'CSV',
    srt: 'SRT 字幕',
  }
  return labels[format]
}

function officeFormatLabelFor(format: OfficeDocType): string {
  const labels: Record<OfficeDocType, string> = {
    docx: 'Word',
    pdf: 'PDF',
    pptx: 'PPT',
    xlsx: 'Excel',
  }
  return labels[format]
}

async function exportOfficeFile(file: OfficeDownloadFile) {
  downloadingUrl.value = file.url
  exportStatus.value = '正在准备文件...'
  try {
    const blob = await fetchBlobForExport(file.url)
    exportStatus.value = '请选择保存位置...'
    const ext = file.filename.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin'
    const result = await saveGeneratedFile({
      filename: normalizeExportFilename(file.filename, ext),
      mimeType: blob.type || 'application/octet-stream',
      data: blob,
    })
    exportStatus.value = result.status === 'cancelled' ? '已取消导出' : '已保存文件'
  } catch (err) {
    exportError.value = (err as Error).message || '导出失败'
  } finally {
    downloadingUrl.value = ''
    setTimeout(() => { exportStatus.value = '' }, 3000)
  }
}

async function exportOfficeFiles() {
  showExportMenu.value = false
  exportError.value = ''
  exportStatus.value = ''
  let files = officeDownloadFiles.value
  if (!files.length && canCreateOfficeDownload.value && officeDocType.value) {
    downloadingUrl.value = 'creating'
    exportStatus.value = '正在生成文件...'
    try {
      files = await createOfficeDownloadFromText(officeDocType.value, props.content)
      generatedOfficeFiles.value = files
    } catch (err) {
      exportError.value = (err as Error).message || '导出失败'
    } finally {
      downloadingUrl.value = ''
    }
  }

  for (const file of files) {
    await exportOfficeFile(file)
    if (exportError.value) break
    await new Promise(resolve => setTimeout(resolve, 120))
  }
}

async function exportLocalFormat(format: LocalExportFormat) {
  showExportMenu.value = false
  exportError.value = ''
  exportStatus.value = '请选择保存位置...'
  downloadingUrl.value = format
  const file = buildMessageExportFile(format, props.content, exportBaseName.value)
  try {
    const result = await saveGeneratedFile({
      filename: file.filename,
      mimeType: file.mimeType,
      data: file.content,
    })
    exportStatus.value = result.status === 'cancelled' ? '已取消导出' : '已保存文件'
  } catch (err) {
    exportError.value = (err as Error).message || '导出失败'
  } finally {
    downloadingUrl.value = ''
    setTimeout(() => { exportStatus.value = '' }, 3000)
  }
}

async function exportOfficeFormat(format: OfficeDocType) {
  showExportMenu.value = false
  exportError.value = ''
  downloadingUrl.value = 'creating'
  exportStatus.value = '正在生成文件...'
  try {
    const files = await createOfficeDownloadFromText(format, props.content)
    generatedOfficeFiles.value = files
    for (const file of files) {
      await exportOfficeFile(file)
      if (exportError.value) break
      await new Promise(resolve => setTimeout(resolve, 120))
    }
  } catch (err) {
    exportError.value = (err as Error).message || '导出失败'
  } finally {
    downloadingUrl.value = ''
  }
}

function onRenderedClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-code-copy="1"]')
  if (!btn) return
  const code = btn.closest('.md-code')?.querySelector('code')?.textContent || ''
  if (!code) return
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制'
    btn.classList.add('copied')
    setTimeout(() => {
      btn.textContent = '复制'
      btn.classList.remove('copied')
    }, 1200)
  })
}

// 长文导入检测 (V4 shouldCreateAssistantDocumentCard 行 7437)
const showImportBtn = computed(() => {
  if (props.role !== 'assistant' || !props.content) return false
  const text = props.content.trim()
  const compact = text.replace(/\s+/g, '').length
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length
  const headings = (text.match(/^#{1,6}\s+/gm) || []).length
  const listItems = (text.match(/^\s*(?:[-*+]|\d+\.)\s+/gm) || []).length
  if (compact >= 900) return true
  return compact >= 420 && (paragraphs >= 4 || headings >= 1 || listItems >= 4)
})

const showContinueBtn = computed(() => {
  if (props.role !== 'assistant' || !props.content.trim()) return false
  if (props.finishReason === 'length' || props.finishReason === 'network_error') return true
  return props.content.includes('网络连接中断')
    || props.content.includes('已达到本次输出上限')
    || props.content.replace(/\s+/g, '').length >= 2000
})

// 复制消息 (V4 copyMsgFloat 行 7411)
function copyMessage() {
  navigator.clipboard.writeText(props.content).then(() => {
    copyLabel.value = '已复制'
    setTimeout(() => { copyLabel.value = '复制' }, 1200)
  })
}

// 放入编辑区 — 只通知 Tiptap EditorPanel，避免重复创建文件
const editorInsertLabel = ref('放入编辑区')

function putIntoEditor() {
  // 通知 Tiptap 编辑器插入内容
  emitEvent('import-to-editor', {
    content: props.content,
    agentName: props.agentName || '助手',
  })
  emitEvent('switch-panel', 'editor')
  editorInsertLabel.value = '✓ 已放入'
  setTimeout(() => { editorInsertLabel.value = '放入编辑区' }, 1500)
}
</script>

<template>
  <!-- 普通消息气泡 -->
  <div class="msg" :class="role">
    <div class="msg-meta">
      <div class="msg-meta-avatar">
        <span class="mso" style="font-size: 14px;">
          {{ role === 'user' ? 'person' : role === 'tool' ? 'build' : 'smart_toy' }}
        </span>
      </div>
      <span class="msg-meta-name">
        {{ role === 'user' ? '你' : role === 'tool' ? `工具: ${toolName || '结果'}` : (agentName || '助手') }}
      </span>
    </div>
    <div class="msg-bubble">
      <!-- 图片附件 -->
      <div v-if="images && images.length" class="msg-images">
        <img v-for="(img, i) in images" :key="i" :src="img" class="msg-image" />
      </div>

      <!-- 文件附件标签 -->
      <div v-if="files && files.length" class="msg-files">
        <div v-for="(f, i) in files" :key="i" class="msg-file-chip">
          <span class="mso" style="font-size:14px">{{ f.name.endsWith('.pdf') ? 'picture_as_pdf' : 'description' }}</span>
          <span class="msg-file-name">{{ f.name }}</span>
        </div>
      </div>

      <div v-if="!(role === 'tool' && officeDownloadFiles.length)" class="msg-body" @click="onRenderedClick" v-html="renderedHtml"></div>

      <!-- 工具调用卡片 -->
      <ToolCallCard v-if="toolCalls && toolCalls.length" :tool-calls="toolCalls" />

      <!-- 编辑区 + 操作按钮（显性一排） -->
      <div v-if="role === 'assistant'" class="msg-action-row">
        <button v-if="showImportBtn" class="msg-action-btn" :class="{ copied: editorInsertLabel !== '放入编辑区' }" @click="putIntoEditor">
          {{ editorInsertLabel }}
        </button>
        <button v-if="showContinueBtn" class="msg-action-btn continue" @click="emit('continue', messageId)">
          继续写
        </button>
        <button class="msg-action-btn" @click="copyMessage">
          {{ copyLabel }}
        </button>
        <div v-if="showAssistantExport" class="msg-export-wrap">
          <button class="msg-action-btn export" :disabled="!!downloadingUrl" @click="showExportMenu = !showExportMenu">
            <span class="mso">download</span>
            {{ downloadingUrl === 'creating' ? '生成中' : '导出' }}
          </button>
          <div v-if="showExportMenu" class="msg-export-menu">
            <button
              v-for="format in localExportFormats"
              :key="format"
              class="msg-export-menu-item"
              @click="exportLocalFormat(format)"
            >
              {{ localFormatLabel(format) }}
            </button>
            <button v-if="officeDownloadFiles.length" class="msg-export-menu-item" @click="exportOfficeFiles">
              已生成文件
            </button>
            <button
              v-for="format in officeExportFormats"
              :key="format"
              class="msg-export-menu-item"
              @click="exportOfficeFormat(format)"
            >
              {{ officeFormatLabelFor(format) }}
            </button>
          </div>
        </div>
        <button class="msg-action-btn danger" @click="emit('delete', messageId)" title="删除">
          删除
        </button>
      </div>
      <div v-if="role === 'tool' && officeDownloadFiles.length" class="msg-action-row">
        <button class="msg-action-btn export" :disabled="!!downloadingUrl" @click="exportOfficeFiles">
          <span class="mso">download</span>
          {{ exportLabel }}
        </button>
        <button class="msg-action-btn" @click="copyMessage">
          {{ copyLabel }}
        </button>
        <button class="msg-action-btn danger" @click="emit('delete', messageId)">
          删除
        </button>
      </div>
      <div v-if="exportError" class="msg-export-error">{{ exportError }}</div>
      <div v-else-if="exportStatus" class="msg-export-status">{{ exportStatus }}</div>
      <div v-else-if="role === 'user'" class="msg-action-row">
        <button class="msg-action-btn" @click="copyMessage">
          {{ copyLabel }}
        </button>
        <button class="msg-action-btn" @click="emit('retry', messageId)" title="重新发送">
          <span class="mso">refresh</span> 重发
        </button>
        <button class="msg-action-btn danger" @click="emit('delete', messageId)">
          删除
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 代码块 */
:deep(.md-code) {
  border-radius: 8px; overflow: hidden;
  border: 1px solid var(--line); margin: 8px 0;
  background: var(--surface);
}
:deep(.md-code-head) {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 10px; background: var(--surface-alt);
  border-bottom: 1px solid var(--line);
}
:deep(.md-code-lang) { font-size: 11px; color: var(--ink3); font-weight: 600; }
:deep(.md-code-copy) {
  padding: 2px 10px; border: none; border-radius: 4px;
  background: var(--paper); color: var(--ink2);
  font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .12s;
}
:deep(.md-code-copy:hover) { background: var(--olive); color: #fff; }
:deep(.md-code-copy.copied) { background: #4a7; color: #fff; }
:deep(.md-code pre) {
  margin: 0; padding: 12px; overflow-x: auto;
  font-size: 12px; line-height: 1.6;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
:deep(.md-code code) { background: none !important; padding: 0 !important; }

/* Markdown 内容 */
:deep(.msg-body h1),
:deep(.msg-body h2),
:deep(.msg-body h3) { margin: 12px 0 6px; font-weight: 700; color: var(--ink1); }
:deep(.msg-body h1) { font-size: 18px; }
:deep(.msg-body h2) { font-size: 16px; }
:deep(.msg-body h3) { font-size: 14px; }
:deep(.msg-body p) { margin: 4px 0; }
:deep(.msg-body ul),
:deep(.msg-body ol) { padding-left: 20px; margin: 4px 0; }
:deep(.msg-body li) { margin: 2px 0; }
:deep(.msg-body code) {
  background: rgba(107,142,35,.08); padding: 1px 5px; border-radius: 4px;
  font-size: 12px; font-family: 'SF Mono', monospace;
}
:deep(.msg-body blockquote) {
  border-left: 3px solid var(--olive); margin: 8px 0;
  padding: 4px 12px; color: var(--ink2); background: rgba(107,142,35,.03);
}
:deep(.msg-body table) {
  border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px;
}
:deep(.msg-body th),
:deep(.msg-body td) {
  border: 1px solid var(--line); padding: 6px 10px; text-align: left;
}
:deep(.msg-body th) { background: var(--surface-alt); font-weight: 600; }
:deep(.msg-body a) { color: var(--olive); text-decoration: underline; }
:deep(.msg-body hr) { border: none; border-top: 1px solid var(--line); margin: 12px 0; }

/* 图片附件 */
.msg-images {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;
}
.msg-image {
  max-width: 240px; max-height: 240px;
  border-radius: 8px; border: 1px solid var(--line);
  object-fit: cover; cursor: pointer;
  transition: transform .15s;
}
.msg-image:hover { transform: scale(1.02); }

/* 文件附件标签 */
.msg-files {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
}
.msg-file-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--line);
  font-size: 12px; color: var(--ink2);
}
.msg-file-chip .mso { color: var(--olive); }
.msg-file-name {
  max-width: 160px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}

/* 操作按钮行（显性） */
.msg-action-row {
  display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;
}
.msg-action-btn {
  display: flex; align-items: center; gap: 3px;
  padding: 4px 10px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink2);
  font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .12s;
}
.msg-action-btn:hover { border-color: var(--olive); color: var(--olive); }
.msg-action-btn.copied { background: #4a7; color: #fff; border-color: #4a7; }
.msg-action-btn.continue { border-color: var(--olive); color: var(--olive-dark); background: rgba(107,142,35,.06); }
.msg-action-btn.continue:hover { background: rgba(107,142,35,.12); }
.msg-action-btn.export { border-color: var(--olive); color: var(--olive); }
.msg-action-btn.export:hover:not(:disabled) { background: rgba(107,142,35,.08); }
.msg-action-btn.export:disabled { opacity: .65; cursor: wait; }
.msg-action-btn.danger:hover { border-color: #e53935; color: #e53935; }
.msg-action-btn .mso { font-size: 14px; }
.msg-export-wrap {
  position: relative;
  display: inline-flex;
}
.msg-export-menu {
  position: absolute;
  z-index: 20;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 128px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  display: grid;
  gap: 2px;
}
.msg-export-menu-item {
  border: none;
  background: transparent;
  color: var(--ink2);
  text-align: left;
  font: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.msg-export-menu-item:hover {
  background: rgba(107,142,35,.08);
  color: var(--olive-dark);
}
.msg-export-error { margin-top: 8px; font-size: 12px; color: #c62828; }
.msg-export-status { margin-top: 8px; font-size: 12px; color: var(--olive-dark); }
</style>
