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
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { formatRelativeTime, formatFullTime } from '@/utils/timeFormat'
import { renderMermaidBlocks } from '@/utils/mermaidRenderer'
import { speakText, stopSpeaking, onTtsStateChange } from '@/utils/tts'
import type { TtsState } from '@/utils/tts'
import type { ToolCall } from '@/composables/useChat'
import { emitEvent } from '@/utils/eventBus'
import { openExternal } from '@/utils/httpClient'
import { extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { buildMessageExportFile, getLocalExportFormats, type LocalExportFormat } from '@/utils/messageExport'
import { fetchBlobForExport, normalizeExportFilename, saveGeneratedFile } from '@/utils/exportSave'
import type { RunTraceSummary } from '@/utils/runTrace'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { renderMessageMarkdown } from './display/markdownDisplayPolicy'
import { renderStreamingText } from './display/streamingTextRenderer'
import MessageReferences from './MessageReferences.vue'
import MessageTextWarning from './MessageTextWarning.vue'
import MessageToolSummary from './MessageToolSummary.vue'
import OpenCodePartList from './OpenCodePartList.vue'
import { buildMessageDisplayModel } from './display/messageDisplayModel'
import type { ContinuationPart } from './display/continuationDisplayModel'
import { summarizeOpenCodePart, type OpenCodeRenderablePart } from '@/opencodeClient/timelineRows'

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
  reasoningContent?: string  // 思考链内容（可折叠）
  timestamp?: number | string  // 消息时间戳（存储层可能序列化为字符串）
  searchResults?: { title: string; url: string; snippet: string }[]  // 搜索引用
  traceSummary?: RunTraceSummary  // 本轮上下文摘要
  isEditing?: boolean  // 是否处于内联编辑模式
  editingContent?: string  // 编辑中的内容
  continuationParts?: ContinuationPart[]
  toolResult?: string
  isStreamingMessage?: boolean
  openCodeParts?: OpenCodeRenderablePart[]
}>()

const emit = defineEmits<{
  (e: 'retry', messageId: string): void
  (e: 'delete', messageId: string): void
  (e: 'continue', messageId: string): void
  (e: 'edit', messageId: string): void
  (e: 'regenerate', messageId: string): void
  (e: 'reply', messageId: string): void
  (e: 'editAssistant', messageId: string): void
  (e: 'openSubtask', sessionId: string): void
  (e: 'revert', messageId: string): void
  (e: 'fork', messageId: string): void
  (e: 'previewImage', payload: { url: string; mime: string; title: string }): void
  (e: 'downloadImage', url: string): void
  (e: 'update:editingContent', content: string): void
  (e: 'confirmEdit'): void
  (e: 'cancelEdit'): void
}>()

const copyLabel = ref('复制')
const downloadingUrl = ref('')
const generatedOfficeFiles = ref<OfficeDownloadFile[]>([])
const exportError = ref('')
const exportStatus = ref('')
const showExportMenu = ref(false)
const showThinking = ref(false)  // 思考链默认折叠
const showTrace = ref(false)
const lightboxImage = ref<string | null>(null)  // 图片灯箱
const ttsState = ref<TtsState>('idle')  // TTS 朗读状态

// ── P1: jc-media:// 引用懒解析为 convertFileSrc URL（零内存开销）──
const displayImages = ref<string[]>([])
let imageResolveId = 0
watch(() => props.images, async (imgs) => {
  const rid = ++imageResolveId
  if (!imgs?.length) { displayImages.value = []; return }
  const resolved: string[] = []
  for (const img of imgs) {
    if (!img) continue
    if (img.startsWith('jc-media://')) {
      try {
        const { resolveForDisplay } = await import('@/utils/mediaFileReader')
        const url = await resolveForDisplay(img.slice('jc-media://'.length))
        if (rid !== imageResolveId) return // 过期请求
        resolved.push(url || img)
      } catch { resolved.push(img) }
    } else {
      resolved.push(img)
    }
  }
  displayImages.value = resolved
}, { immediate: true })

const normalizedContent = computed(() => String(props.content || ''))
const visibleOpenCodeTextByPartId = ref<Record<string, string>>({})

function updateVisibleOpenCodeText(partId: string, text: string) {
  if (visibleOpenCodeTextByPartId.value[partId] === text) return
  visibleOpenCodeTextByPartId.value = {
    ...visibleOpenCodeTextByPartId.value,
    [partId]: text,
  }
}

// 对齐官方 OpenCode：流式文本直接渲染，不做逐帧渐进式揭示
// ProgressiveStreamReveal 在长文本时会导致帧丢失 → 文字成块弹出
const displayContent = computed(() => (
  props.isStreamingMessage ? normalizedContent.value : normalizedContent.value
))

const renderedHtml = computed(() => {
  return props.isStreamingMessage ? renderStreamingText(displayContent.value) : renderMessageMarkdown(displayContent.value, props.role)
})

const displayModel = computed(() => buildMessageDisplayModel({
  id: props.messageId,
  role: props.role,
  content: normalizedContent.value,
  agentName: props.agentName,
  toolName: props.toolName,
  searchResults: props.searchResults,
}))
const showMeta = computed(() => displayModel.value.showMeta)
const metaIcon = computed(() => displayModel.value.metaIcon)
const metaName = computed(() => displayModel.value.metaLabel)
const messageClass = computed(() => [
  props.role,
  `layout-${displayModel.value.layout}`,
  `content-${displayModel.value.contentKind}`,
])
const showTextWarning = computed(() => displayModel.value.hasTextWarning && Boolean(displayModel.value.textWarning))
const textWarningMessage = computed(() => displayModel.value.textWarning || '')
const showTimestamp = computed(() => displayModel.value.showTimestampByDefault && Boolean(props.timestamp))
const timestampValue = computed(() => {
  const t = props.timestamp
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const parsed = Date.parse(t)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
})
const isToolRunning = computed(() => (
  props.role === 'assistant'
  && Boolean(props.toolCalls?.length)
  && !props.toolResult
  && !props.officeDownloadFiles?.length
  && props.finishReason !== 'tool_complete'
))
const latestToolResult = computed(() => props.toolResult)
const openCodeTextParts = computed(() => (props.openCodeParts || []).filter(part => part.type === 'text' && part.text?.trim()))
const openCodeReasoningContent = computed(() => {
  const text = (props.openCodeParts || [])
    .filter(part => part.type === 'reasoning' && part.text?.trim())
    .map(part => part.text)
    .join('\n\n')
  return text || props.reasoningContent || ''
})
const hasOpenCodeNonTextParts = computed(() => (props.openCodeParts || []).some(part => part.type !== 'text' && part.type !== 'reasoning'))
const hasMarkdownBody = computed(() => Boolean(normalizedContent.value.trim()) && !(props.role === 'tool' && officeDownloadFiles.value.length))

// Mermaid 异步渲染后的 HTML（替换原始 renderedHtml）
const mermaidHtml = ref('')

async function doMermaidRender() {
  if (props.isStreamingMessage || !normalizedContent.value || props.role !== 'assistant') {
    mermaidHtml.value = ''
    return
  }
  const baseHtml = renderedHtml.value
  if (!baseHtml.includes('language-mermaid')) {
    mermaidHtml.value = ''
    return
  }
  try {
    mermaidHtml.value = await renderMermaidBlocks(baseHtml, props.messageId)
  } catch {
    mermaidHtml.value = ''
  }
}

// 当 renderedHtml 变化时触发 Mermaid 渲染
watch(renderedHtml, () => {
  mermaidHtml.value = ''
  nextTick(() => doMermaidRender())
}, { immediate: true })

// 实际使用的 HTML：优先使用带 Mermaid SVG 的版本
const finalHtml = computed(() => mermaidHtml.value || renderedHtml.value)

function renderAssistantHtml(content: string): string {
  return renderMessageMarkdown(content, 'assistant')
}

function renderOpenCodeTextPart(part: OpenCodeRenderablePart): string {
  const text = props.isStreamingMessage
    ? visibleOpenCodeTextByPartId.value[part.id] || ''
    : part.text || ''
  return props.isStreamingMessage ? renderStreamingText(text) : renderMessageMarkdown(text, 'assistant')
}

const officeDownloadFiles = computed(() => {
  if (props.role !== 'tool' && props.role !== 'assistant') return []
  if (generatedOfficeFiles.value.length) return generatedOfficeFiles.value
  return props.officeDownloadFiles?.length
    ? props.officeDownloadFiles
    : extractOfficeDownloadFiles(normalizedContent.value)
})

const officeFormatLabel = computed(() => {
  const firstFile = officeDownloadFiles.value[0]
  const ext = firstFile?.filename.match(/\.([a-z0-9]+)$/i)?.[1] || ''
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
  && Boolean(normalizedContent.value.trim())
  && !normalizedContent.value.trim().startsWith('⚠️')
))
const localExportFormats = computed(() => getLocalExportFormats(normalizedContent.value))

const exportBaseName = computed(() => {
  const heading = normalizedContent.value.match(/^#{1,3}\s+(.+)$/m)?.[1]
  const firstLine = normalizedContent.value.split(/\n+/).map(line => line.replace(/^#{1,6}\s+/, '').trim()).find(Boolean)
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
  if (!files.length) {
    exportError.value = '没有可导出的本地文件。请使用 Markdown/TXT/HTML/CSV 本地导出。'
    return
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
  const file = buildMessageExportFile(format, normalizedContent.value, exportBaseName.value)
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

async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_clipboard_text', { text })
      return true
    } catch {
      // Continue to WebView fallbacks for browser previews or unexpected desktop errors.
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Some desktop WebView focus states reject navigator.clipboard; fall back below.
  }

  const textarea = document.createElement('textarea')
  const selection = document.getSelection()
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    if (selection && selectedRange) {
      selection.removeAllRanges()
      selection.addRange(selectedRange)
    }
  }
}

function setCodeCopyLabel(btn: HTMLButtonElement, label: string, copied: boolean) {
  const labelEl = btn.querySelector<HTMLSpanElement>('span:not(.mso)')
  if (labelEl) {
    labelEl.textContent = label
  } else {
    btn.textContent = label
  }
  btn.classList.toggle('copied', copied)
}

function copyableMessageText(): string {
  const direct = normalizedContent.value.trim()
  if (direct) return normalizedContent.value

  const partText = (props.openCodeParts || [])
    .map((part) => {
      if ((part.type === 'text' || part.type === 'reasoning') && part.text?.trim()) return part.text
      if (part.result) {
        return [
          part.title || part.toolName || part.type || 'OpenCode',
          part.result,
        ].filter(Boolean).join('\n')
      }
      return summarizeOpenCodePart(part.raw || part)
    })
    .map(text => String(text || '').trim())
    .filter(Boolean)
    .join('\n\n')
  if (partText) return partText

  if (props.reasoningContent?.trim()) return props.reasoningContent
  if (props.toolResult?.trim()) return props.toolResult
  return normalizedContent.value
}

async function onRenderedClick(e: MouseEvent) {
  // 拦截 <a> 链接点击：桌面端用系统浏览器打开
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a')
  if (link && link.href && !link.href.startsWith('#')) {
    e.preventDefault()
    openExternal(link.href).catch(() => {
      // 降级：尝试 window.open
      window.open(link.href, '_blank')
    })
    return
  }

  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-code-copy="1"]')
  if (!btn) return
  const code = btn.closest('.md-code')?.querySelector('code')?.textContent || ''
  if (!code) return
  const copied = await writeClipboardText(code)
  setCodeCopyLabel(btn, copied ? '已复制' : '复制失败', copied)
  setTimeout(() => {
    setCodeCopyLabel(btn, '复制', false)
  }, copied ? 1200 : 1800)
}

// 长文导入检测 — 降低阈值，包含代码块/表格/列表等结构内容时 300 字符以上即可
const showImportBtn = computed(() => {
  if (props.role !== 'assistant' || !normalizedContent.value) return false
  const text = normalizedContent.value.trim()
  const compact = text.replace(/\s+/g, '').length
  if (compact >= 900) return true
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length
  const headings = (text.match(/^#{1,6}\s+/gm) || []).length
  const listItems = (text.match(/^\s*(?:[-*+]|\d+\.)\s+/gm) || []).length
  const codeBlocks = (text.match(/```/g) || []).length
  const tables = (text.match(/^\|.+\|$/gm) || []).length
  if (compact >= 300 && (codeBlocks >= 2 || tables >= 2 || paragraphs >= 2 || headings >= 1 || listItems >= 2)) return true
  return compact >= 420 && (paragraphs >= 4 || headings >= 1 || listItems >= 4)
})

const showContinueBtn = computed(() => {
  if (props.role !== 'assistant' || !normalizedContent.value.trim()) return false
  if (props.finishReason === 'length' || props.finishReason === 'network_error') return true
  return normalizedContent.value.includes('网络连接中断')
    || normalizedContent.value.includes('已达到本次输出上限')
    || normalizedContent.value.replace(/\s+/g, '').length >= 2000
})

// 复制消息 (V4 copyMsgFloat 行 7411)
async function copyMessage() {
  const text = copyableMessageText()
  const copied = await writeClipboardText(text)
  if (copied) {
    copyLabel.value = '已复制'
  } else {
    copyLabel.value = '复制失败'
  }
  setTimeout(() => { copyLabel.value = '复制' }, copied ? 1200 : 1800)
}

// 放入编辑区 — 支持替换/追加两种模式
const editorInsertLabel = ref('放入编辑区')

function putIntoEditor(mode: 'replace' | 'append' = 'append') {
  emitEvent('import-to-editor', {
    content: normalizedContent.value,
    agentName: props.agentName || '助手',
    mode,
  })
  emitEvent('switch-panel', 'editor')
  editorInsertLabel.value = mode === 'replace' ? '✓ 已替换' : '✓ 已追加'
  setTimeout(() => { editorInsertLabel.value = '放入编辑区' }, 1500)
}

// 导出菜单：点击外部关闭
function onDocumentClick(e: MouseEvent) {
  if (!showExportMenu.value) return
  const target = e.target as HTMLElement
  if (!target.closest('.msg-export-wrap')) {
    showExportMenu.value = false
  }
}

// 图片灯箱
function openLightbox(src: string) {
  lightboxImage.value = src
}
function closeLightbox() {
  lightboxImage.value = null
}

// ─── TTS 朗读 ───
function handleSpeak() {
  if (ttsState.value === 'speaking' || ttsState.value === 'paused') {
    stopSpeaking()
    ttsState.value = 'idle'
    return
  }
  // 停止其他可能正在播放的朗读
  stopSpeaking()
  const html = finalHtml.value || renderedHtml.value
  if (html && speakText(html)) {
    ttsState.value = 'speaking'
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  onTtsStateChange((s) => { ttsState.value = s })
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  if (ttsState.value === 'speaking') stopSpeaking()
})

</script>

<template>
  <!-- 普通消息气泡 -->
  <div class="msg" :class="messageClass">
    <div v-if="showMeta" class="msg-meta">
      <div class="msg-meta-avatar">
        <JcIcon :name="metaIcon" style="font-size: 13px;" />
      </div>
      <span class="msg-meta-name">{{ metaName }}</span>
      <span v-if="showTimestamp" class="msg-time" :title="formatFullTime(timestampValue)">
        {{ formatRelativeTime(timestampValue) }}
      </span>
    </div>
    <div class="msg-bubble">
      <!-- 图片附件（P1：jc-media:// 懒解析为本地路径） -->
      <div v-if="displayImages.length" class="msg-images">
        <img v-for="(img, i) in displayImages" :key="i" :src="img" class="msg-image" @click.stop="openLightbox(img)" />
      </div>

      <!-- 图片灯箱 -->
      <Teleport to="body">
        <div v-if="lightboxImage" class="msg-lightbox" @click="closeLightbox">
          <button class="msg-lightbox-close" @click="closeLightbox">
            <JcIcon name="close" />
          </button>
          <img :src="lightboxImage" class="msg-lightbox-img" @click.stop />
        </div>
      </Teleport>

      <!-- 文件附件标签 -->
      <div v-if="files && files.length" class="msg-files">
        <div v-for="(f, i) in files" :key="i" class="msg-file-chip">
          <JcIcon :name="f.name.endsWith('.pdf') ? 'picture_as_pdf' : 'description'" style="font-size:14px" />
          <span class="msg-file-name" :title="f.name">{{ f.name }}</span>
        </div>
      </div>

      <!-- 思考链折叠面板（默认收起） -->
      <div v-if="role === 'assistant' && openCodeReasoningContent" class="msg-thinking">
        <button class="msg-thinking-toggle" @click="showThinking = !showThinking">
          <JcIcon :name="showThinking ? 'expand_less' : 'psychology'" style="font-size:14px" />
          <span>{{ showThinking ? '收起思考' : '查看思考过程' }}</span>
        </button>
        <div v-if="showThinking" class="msg-thinking-body">
          {{ openCodeReasoningContent }}
        </div>
      </div>

      <div v-if="role === 'assistant' && traceSummary" class="msg-thinking msg-trace">
        <button class="msg-thinking-toggle" @click="showTrace = !showTrace">
          <JcIcon :name="showTrace ? 'expand_less' : 'fact_check'" style="font-size:14px" />
          <span>{{ showTrace ? '收起本轮上下文' : '本轮上下文' }}</span>
        </button>
        <div v-if="showTrace" class="msg-thinking-body msg-trace-body">
          <div class="msg-trace-grid">
            <span>模型</span><strong>{{ traceSummary.model }}</strong>
            <span>运行</span><strong>{{ traceSummary.runtime }} · {{ traceSummary.mode }}</strong>
            <span>Skill</span><strong>{{ traceSummary.skillLabel }}</strong>
            <span v-if="traceSummary.skillHash">Hash</span><strong v-if="traceSummary.skillHash">{{ traceSummary.skillHash }}</strong>
          </div>
          <div v-if="traceSummary.sectionLabels.length" class="msg-trace-list">
            <b>上下文段</b>
            <span v-for="section in traceSummary.sectionLabels" :key="section">{{ section }}</span>
          </div>
        </div>
      </div>

      <!-- 内联编辑模式 -->
      <template v-if="isEditing">
        <textarea
          class="msg-edit-textarea"
          :value="editingContent"
          @input="emit('update:editingContent', ($event.target as HTMLTextAreaElement).value)"
          rows="5"
        ></textarea>
        <div class="msg-action-row">
          <button class="msg-action-btn" @click="emit('confirmEdit')">确认</button>
          <button class="msg-action-btn danger" @click="emit('cancelEdit')">取消</button>
        </div>
      </template>

      <!-- 普通模式 -->
      <template v-else>

      <MessageTextWarning v-if="showTextWarning" :message="textWarningMessage" />

      <div v-if="openCodeTextParts.length" class="msg-open-code-text-parts">
        <div
          v-for="part in openCodeTextParts"
          :key="part.id"
          class="msg-body msg-open-code-text-part"
          @click="onRenderedClick"
          v-html="renderOpenCodeTextPart(part)"
        ></div>
      </div>
      <div v-else-if="hasMarkdownBody" class="msg-body" @click="onRenderedClick" v-html="finalHtml"></div>

      <OpenCodePartList v-if="hasOpenCodeNonTextParts" :parts="openCodeParts" @open-subtask="emit('openSubtask', $event)" @preview-image="emit('previewImage', $event)" @download-image="emit('downloadImage', $event)" />

      <!-- 工具调用卡片 -->
      <MessageToolSummary
        v-if="!hasOpenCodeNonTextParts && ((toolCalls && toolCalls.length) || officeDownloadFiles.length || latestToolResult)"
        :tool-calls="toolCalls"
        :files="officeDownloadFiles"
        :is-running="isToolRunning"
        :tool-result="latestToolResult"
      />

      <MessageReferences
        :role="role"
        :search-results="searchResults"
      />

      <div v-if="continuationParts && continuationParts.length" class="msg-continuation-group">
        <div v-for="part in continuationParts" :key="part.id" class="msg-continuation-part" :finish-reason="part.finishReason">
          <div class="msg-continuation-rule">
            <span></span>
            <b>继续</b>
            <span></span>
          </div>
          <div v-if="part.reasoningContent" class="msg-thinking">
            <div class="msg-thinking-body">{{ part.reasoningContent }}</div>
          </div>
          <div class="msg-body" @click="onRenderedClick" v-html="renderAssistantHtml(part.content)"></div>
          <MessageToolSummary
            v-if="(part.toolCalls && part.toolCalls.length) || (part.officeDownloadFiles && part.officeDownloadFiles.length)"
            :tool-calls="part.toolCalls"
            :files="part.officeDownloadFiles"
            :is-running="false"
            :tool-result="part.latestToolResult"
          />
          <MessageReferences
            role="assistant"
            :search-results="part.searchResults"
          />
        </div>
      </div>

      <!-- 编辑区 + 操作按钮（显性一排） -->
      <div v-if="role === 'assistant'" class="msg-action-row">
        <button v-if="showImportBtn" class="msg-action-btn" :class="{ copied: editorInsertLabel !== '放入编辑区' }" @click="putIntoEditor('append')" title="追加到编辑区末尾">
          <JcIcon name="note_add" />
        </button>
        <button v-if="showImportBtn" class="msg-action-btn" :class="{ copied: editorInsertLabel !== '放入编辑区' }" @click="putIntoEditor('replace')" title="替换编辑区内容">
          {{ editorInsertLabel }}
        </button>
        <button v-if="showContinueBtn" class="msg-action-btn continue" @click="emit('continue', messageId)">
          继续写
        </button>
        <button class="msg-action-btn" :class="{ danger: ttsState === 'speaking' }" @click="handleSpeak" :title="ttsState === 'speaking' ? '停止朗读' : '朗读'">
          <JcIcon :name="ttsState === 'speaking' ? 'stop' : 'volume_up'" />
        </button>
        <button class="msg-action-btn" @click="emit('reply', messageId)" title="引用回复">
          <JcIcon name="reply" />
        </button>
        <button class="msg-action-btn" @click="emit('regenerate', messageId)" title="重新生成">
          <JcIcon name="refresh" />
        </button>
        <button class="msg-action-btn" @click="emit('editAssistant', messageId)" title="编辑回复">
          <JcIcon name="edit" />
        </button>
        <button class="msg-action-btn" @click="emit('revert', messageId)" title="撤销本轮">
          <JcIcon name="undo" />
        </button>
        <button class="msg-action-btn" @click="emit('fork', messageId)" title="分叉新会话">
          <JcIcon name="call_split" />
        </button>
        <button class="msg-action-btn" @click="copyMessage">
          {{ copyLabel }}
        </button>
        <div v-if="showAssistantExport" class="msg-export-wrap">
          <button class="msg-action-btn export" :disabled="!!downloadingUrl" @click="showExportMenu = !showExportMenu">
            <JcIcon name="download" />
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
          </div>
        </div>
        <button class="msg-action-btn danger" @click="emit('delete', messageId)" title="删除">
          删除
        </button>
      </div>
      <div v-if="role === 'tool' && officeDownloadFiles.length" class="msg-action-row">
        <button class="msg-action-btn export" :disabled="!!downloadingUrl" @click="exportOfficeFiles">
          <JcIcon name="download" />
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
        <button class="msg-action-btn" @click="emit('edit', messageId)" title="编辑后重新发送">
          <JcIcon name="edit" /> 编辑
        </button>
        <button class="msg-action-btn" @click="emit('retry', messageId)" title="重新发送">
          <JcIcon name="refresh" /> 重发
        </button>
        <button class="msg-action-btn danger" @click="emit('delete', messageId)">
          删除
        </button>
      </div>
    </template>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  margin-bottom: 16px;
  flex-direction: column;
}
.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }
.msg-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.7;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
/* OpenCode 对齐：去掉气泡块，纯文本自然流（通过父级 .cp-opencode-clean 控制） */
:deep(.cp-opencode-clean .msg-bubble) {
  max-width: 100%;
  padding: 2px 0;
  border-radius: 0;
  background: transparent;
  border: none;
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
.msg-body { white-space: pre-wrap; }

/* 代码块 */
:deep(.md-code) {
  max-width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  margin: 10px 0;
  background: var(--surface);
}
:deep(.md-code-head) {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px;
  padding: 6px 10px; background: var(--surface-alt);
  border-bottom: 1px solid var(--line);
}
:deep(.md-code-lang) {
  min-width: 0;
  color: var(--ink3);
  font-size: 11px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.md-code-copy) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 3px 8px;
  border: none;
  border-radius: 5px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all .12s;
}
:deep(.md-code-copy .mso) { font-size: 13px; }
:deep(.md-code-copy:hover) { background: var(--olive); color: #fff; }
:deep(.md-code-copy:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--olive) 70%, transparent);
  outline-offset: 2px;
}
:deep(.md-code-copy.copied) { background: #4a7; color: #fff; }
:deep(.md-code pre) {
  max-width: 100%;
  margin: 0;
  padding: 13px 14px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.62;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  tab-size: 2;
}
:deep(.md-code code) {
  display: block;
  width: max-content;
  min-width: 100%;
  background: none !important;
  padding: 0 !important;
}

/* 助手长文正文流：让长输出像文档，而不是重卡片 */
.msg.layout-assistant-prose .msg-bubble {
  max-width: 820px;
  width: min(100%, 820px);
  padding: 2px 4px 6px;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  line-height: 1.76;
  font-size: 14px;
}
.msg.layout-assistant-prose .msg-meta {
  margin-bottom: 6px;
}

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
:deep(.md-table-wrap) {
  max-width: 100%;
  margin: 10px 0;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}
:deep(.md-table-wrap table) {
  min-width: 520px;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
:deep(.md-table-wrap th),
:deep(.md-table-wrap td) {
  border-bottom: 1px solid var(--line);
  border-right: 1px solid var(--line);
  padding: 7px 10px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
:deep(.md-table-wrap th:last-child),
:deep(.md-table-wrap td:last-child) {
  border-right: none;
}
:deep(.md-table-wrap tr:last-child td) {
  border-bottom: none;
}
:deep(.md-table-wrap th) {
  background: var(--surface-alt);
  color: var(--ink2);
  font-weight: 650;
}
:deep(.md-table-wrap td) {
  max-width: 320px;
}
:deep(.msg-body a) { color: var(--olive); text-decoration: underline; }
:deep(.msg-body hr) { border: none; border-top: 1px solid var(--line); margin: 12px 0; }

.msg.layout-assistant-prose :deep(.msg-body p) {
  margin: 0 0 .78em;
}
.msg.layout-assistant-prose :deep(.msg-body h1) {
  margin: 1.45em 0 .7em;
  font-size: 20px;
  line-height: 1.35;
}
.msg.layout-assistant-prose :deep(.msg-body h2) {
  margin-top: 1.35em;
  margin-bottom: .62em;
  font-size: 17px;
  line-height: 1.4;
}
.msg.layout-assistant-prose :deep(.msg-body h3) {
  margin: 1.1em 0 .5em;
  font-size: 15px;
  line-height: 1.45;
}
.msg.layout-assistant-prose :deep(.msg-body ul),
.msg.layout-assistant-prose :deep(.msg-body ol) {
  margin: .55em 0 .9em;
  padding-left: 1.55em;
}
.msg.layout-assistant-prose :deep(.msg-body li) {
  margin: .28em 0;
}
.msg.layout-assistant-prose :deep(.msg-body blockquote) {
  margin: .9em 0;
  padding: .42em .9em;
}

.msg-continuation-group {
  display: grid;
  gap: 4px;
  margin-top: 10px;
}
.msg-continuation-part {
  min-width: 0;
}
.msg-continuation-rule {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  color: var(--ink3);
  font-size: 11px;
}
.msg-continuation-rule span {
  height: 1px;
  background: var(--line);
}
.msg-continuation-rule b {
  font-weight: 600;
}

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

/* 消息时间戳 */
.msg-time {
  font-size: 11px; color: var(--ink3);
  white-space: nowrap; cursor: default;
  opacity: 0.7; transition: opacity .15s;
}
.msg-time:hover { opacity: 1; }

/* 内联编辑 */
.msg-edit-textarea {
  width: 100%; min-height: 80px;
  padding: 8px 10px;
  border: 1px solid var(--olive);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink1);
  font-family: inherit; font-size: 13px; line-height: 1.6;
  resize: vertical;
  outline: none;
}
.msg-edit-textarea:focus { border-color: var(--olive-dark); }

/* 操作按钮行（显性） */
.msg-action-row {
  display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;
  opacity: .72;
  transform: translateY(0);
  transition: opacity .14s ease, border-color .14s ease, color .14s ease;
}
.msg:hover .msg-action-row,
.msg:focus-within .msg-action-row {
  opacity: 1;
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

/* ─── 思考链折叠面板 ─── */
.msg-thinking {
  margin-bottom: 10px;
  border: 1px solid rgba(107,142,35,.15);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(107,142,35,.03);
}
.msg-thinking-toggle {
  display: flex; align-items: center; gap: 4px;
  width: 100%; padding: 6px 10px;
  border: none; background: transparent;
  color: var(--olive-dark); font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit; text-align: left;
  transition: background .15s;
}
.msg-thinking-toggle:hover { background: rgba(107,142,35,.06); }
.msg-thinking-body {
  padding: 8px 12px 10px;
  font-size: 11px; line-height: 1.6; color: var(--ink3);
  white-space: pre-wrap; word-break: break-word;
  border-top: 1px solid rgba(107,142,35,.1);
  max-height: 240px; overflow-y: auto;
}
.msg-trace-body {
  white-space: normal;
  display: grid;
  gap: 8px;
}
.msg-trace-grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 10px;
}
.msg-trace-grid span {
  color: var(--ink3);
}
.msg-trace-grid strong {
  color: var(--ink2);
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
.msg-trace-list {
  display: grid;
  gap: 4px;
}
.msg-trace-list b {
  color: var(--olive-dark);
  font-size: 11px;
}
.msg-trace-list span {
  color: var(--ink3);
  overflow-wrap: anywhere;
}

/* ─── 图片灯箱 ─── */
.msg-lightbox {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,.85);
  display: flex; align-items: center; justify-content: center;
  cursor: zoom-out;
  animation: lb-fade-in .2s ease;
}
@keyframes lb-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.msg-lightbox-close {
  position: absolute; top: 16px; right: 16px;
  width: 40px; height: 40px; border: none;
  background: rgba(255,255,255,.15); color: #fff;
  border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; transition: background .15s;
}
.msg-lightbox-close:hover { background: rgba(255,255,255,.3); }
.msg-lightbox-img {
  max-width: 90vw; max-height: 90vh;
  border-radius: 8px; cursor: default;
  object-fit: contain;
}

/* ─── Mermaid 图表 ─── */
:deep(.mermaid-diagram) {
  display: flex; justify-content: center;
  margin: 12px 0; padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  overflow-x: auto;
}
:deep(.mermaid-diagram svg) {
  max-width: 100%; height: auto;
}
:deep(.mermaid-error) {
  opacity: 0.6;
}

/* ─── KaTeX 公式样式增强 ─── */
:deep(.katex-display) {
  margin: 8px 0;
  overflow-x: auto;
  overflow-y: hidden;
}
:deep(.katex) {
  font-size: 1.05em;
}

</style>
