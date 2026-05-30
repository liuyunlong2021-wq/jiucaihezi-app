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
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { highlightCode } from '@/utils/highlight'
import { formatRelativeTime, formatFullTime } from '@/utils/timeFormat'
import { renderMathInText } from '@/utils/mathRenderer'
import { renderMermaidBlocks } from '@/utils/mermaidRenderer'
import { speakText, stopSpeaking, onTtsStateChange } from '@/utils/tts'
import type { TtsState } from '@/utils/tts'
import ToolCallCard from './ToolCallCard.vue'
import type { ToolCall } from '@/composables/useChat'
import { emitEvent } from '@/utils/eventBus'
import { openExternal } from '@/utils/httpClient'
import { extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { buildMessageExportFile, getLocalExportFormats, type LocalExportFormat } from '@/utils/messageExport'
import { fetchBlobForExport, normalizeExportFilename, saveGeneratedFile } from '@/utils/exportSave'
import type { RecallKnowledgeHit } from '@/utils/vaultRecallTrace'
import type { RunTraceSummary } from '@/utils/runTrace'
import { shouldShowKnowledgeReferences } from '@/utils/messageEvidence'

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
  timestamp?: number  // 消息时间戳
  searchResults?: { title: string; url: string; snippet: string }[]  // 搜索引用
  knowledgeHits?: RecallKnowledgeHit[]  // 知识库引用
  traceSummary?: RunTraceSummary  // 本轮上下文摘要
  isEditing?: boolean  // 是否处于内联编辑模式
  editingContent?: string  // 编辑中的内容
}>()

const emit = defineEmits<{
  (e: 'retry', messageId: string): void
  (e: 'delete', messageId: string): void
  (e: 'continue', messageId: string): void
  (e: 'edit', messageId: string): void
  (e: 'regenerate', messageId: string): void
  (e: 'reply', messageId: string): void
  (e: 'editAssistant', messageId: string): void
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

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}

// Markdown 渲染
// 配置 marked：所有链接 target="_blank" + 代码高亮 + Mermaid 保留
marked.use({
  renderer: {
    link(this: any, { href, title, tokens }: any) {
      const text = this.parser.parseInline(tokens)
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    },
    code(this: any, { text, lang }: any) {
      if (lang === 'mermaid') {
        return `<div class="md-code" data-mermaid="1"><div class="md-code-head"><span class="md-code-lang">mermaid</span></div><pre><code class="language-mermaid">${escapeHtml(text)}</code></pre></div>`
      }
      const highlighted = highlightCode(text, lang)
      const langLabel = lang || 'code'
      return `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${langLabel}</span><button class="md-code-copy" type="button" data-code-copy="1">复制</button></div><pre><code class="hljs language-${langLabel}">${highlighted}</code></pre></div>`
    },
  },
})

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const renderedHtml = computed(() => {
  if (!props.content) return ''
  if (props.role === 'user') {
    return sanitizeHtml(props.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'))
  }
  try {
    // 1. 先渲染 KaTeX 数学公式（保护代码块）
    const mathProcessed = renderMathInText(props.content)
    // 2. marked 解析（code renderer 内置 highlight.js + 复制按钮）
    const html = marked.parse(mathProcessed, { breaks: true, gfm: true }) as string
    return sanitizeHtml(html)
  } catch {
    return sanitizeHtml(props.content.replace(/\n/g, '<br>'))
  }
})

const showKnowledgeReferences = computed(() => shouldShowKnowledgeReferences(props.role, props.knowledgeHits))
const displayedKnowledgeHits = computed(() => props.knowledgeHits || [])

// Mermaid 异步渲染后的 HTML（替换原始 renderedHtml）
const mermaidHtml = ref('')

async function doMermaidRender() {
  if (!props.content || props.role !== 'assistant') {
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

const officeDownloadFiles = computed(() => {
  if (props.role !== 'tool' && props.role !== 'assistant') return []
  if (generatedOfficeFiles.value.length) return generatedOfficeFiles.value
  return props.officeDownloadFiles?.length
    ? props.officeDownloadFiles
    : extractOfficeDownloadFiles(props.content)
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
  && Boolean(props.content.trim())
  && !props.content.trim().startsWith('⚠️')
))
const localExportFormats = computed(() => getLocalExportFormats(props.content))

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

function onRenderedClick(e: MouseEvent) {
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
  navigator.clipboard.writeText(code).then(() => {
    const copyDoneText = '已复制'
    const copyText = '复制'
    btn.textContent = copyDoneText
    btn.classList.add('copied')
    setTimeout(() => {
      btn.textContent = copyText
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
      <span v-if="timestamp" class="msg-time" :title="formatFullTime(timestamp)">
        {{ formatRelativeTime(timestamp) }}
      </span>
    </div>
    <div class="msg-bubble">
      <!-- 图片附件 -->
      <div v-if="images && images.length" class="msg-images">
        <img v-for="(img, i) in images" :key="i" :src="img" class="msg-image" @click.stop="openLightbox(img)" />
      </div>

      <!-- 图片灯箱 -->
      <Teleport to="body">
        <div v-if="lightboxImage" class="msg-lightbox" @click="closeLightbox">
          <button class="msg-lightbox-close" @click="closeLightbox">
            <span class="mso">close</span>
          </button>
          <img :src="lightboxImage" class="msg-lightbox-img" @click.stop />
        </div>
      </Teleport>

      <!-- 文件附件标签 -->
      <div v-if="files && files.length" class="msg-files">
        <div v-for="(f, i) in files" :key="i" class="msg-file-chip">
          <span class="mso" style="font-size:14px">{{ f.name.endsWith('.pdf') ? 'picture_as_pdf' : 'description' }}</span>
          <span class="msg-file-name" :title="f.name">{{ f.name }}</span>
        </div>
      </div>

      <!-- 思考链折叠面板（默认收起） -->
      <div v-if="role === 'assistant' && reasoningContent" class="msg-thinking">
        <button class="msg-thinking-toggle" @click="showThinking = !showThinking">
          <span class="mso" style="font-size:14px">{{ showThinking ? 'expand_less' : 'psychology' }}</span>
          <span>{{ showThinking ? '收起思考' : '查看思考过程' }}</span>
        </button>
        <div v-if="showThinking" class="msg-thinking-body">
          {{ reasoningContent }}
        </div>
      </div>

      <div v-if="role === 'assistant' && traceSummary" class="msg-thinking msg-trace">
        <button class="msg-thinking-toggle" @click="showTrace = !showTrace">
          <span class="mso" style="font-size:14px">{{ showTrace ? 'expand_less' : 'fact_check' }}</span>
          <span>{{ showTrace ? '收起本轮上下文' : '本轮上下文' }}</span>
        </button>
        <div v-if="showTrace" class="msg-thinking-body msg-trace-body">
          <div class="msg-trace-grid">
            <span>模型</span><strong>{{ traceSummary.model }}</strong>
            <span>运行</span><strong>{{ traceSummary.runtime }} · {{ traceSummary.mode }}</strong>
            <span>Skill</span><strong>{{ traceSummary.skillLabel }}</strong>
            <span>知识库</span><strong>{{ traceSummary.vaultLabel }}</strong>
            <span>知识状态</span><strong>{{ traceSummary.knowledgeStatus }}</strong>
            <span v-if="traceSummary.skillHash">Hash</span><strong v-if="traceSummary.skillHash">{{ traceSummary.skillHash }}</strong>
          </div>
          <div v-if="traceSummary.sectionLabels.length" class="msg-trace-list">
            <b>上下文段</b>
            <span v-for="section in traceSummary.sectionLabels" :key="section">{{ section }}</span>
          </div>
          <div v-if="traceSummary.knowledgeLabels.length" class="msg-trace-list">
            <b>知识命中</b>
            <span v-for="hit in traceSummary.knowledgeLabels" :key="hit">{{ hit }}</span>
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

      <!-- 搜索引用卡片 -->
      <div v-if="role === 'assistant' && searchResults && searchResults.length" class="msg-search-refs">
        <div class="msg-search-refs-title">🔍 搜索引用（{{ searchResults.length }} 条）</div>
        <div v-for="(ref, i) in searchResults" :key="i" class="msg-search-ref-item">
          <a :href="ref.url" target="_blank" rel="noopener noreferrer" class="msg-search-ref-link">{{ ref.title }}</a>
          <span class="msg-search-ref-snippet">{{ ref.snippet }}</span>
        </div>
      </div>

      <!-- 知识库引用卡片：只有实际召回知识条目时展示 -->
      <div v-if="showKnowledgeReferences" class="msg-search-refs msg-knowledge-refs">
        <div class="msg-search-refs-title">知识库引用（{{ displayedKnowledgeHits.length }} 条）</div>
        <div v-for="hit in displayedKnowledgeHits" :key="hit.id" class="msg-search-ref-item">
          <span class="msg-search-ref-link">{{ hit.title }}</span>
          <span class="msg-search-ref-snippet">{{ hit.path }} · {{ hit.reason }} · {{ hit.snippet }}</span>
        </div>
      </div>

      <div v-if="!(role === 'tool' && officeDownloadFiles.length)" class="msg-body" @click="onRenderedClick" v-html="finalHtml"></div>

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
        <button class="msg-action-btn" :class="{ danger: ttsState === 'speaking' }" @click="handleSpeak" :title="ttsState === 'speaking' ? '停止朗读' : '朗读'">
          <span class="mso">{{ ttsState === 'speaking' ? 'stop' : 'volume_up' }}</span>
        </button>
        <button class="msg-action-btn" @click="emit('reply', messageId)" title="引用回复">
          <span class="mso">reply</span>
        </button>
        <button class="msg-action-btn" @click="emit('regenerate', messageId)" title="重新生成">
          <span class="mso">refresh</span>
        </button>
        <button class="msg-action-btn" @click="emit('editAssistant', messageId)" title="编辑回复">
          <span class="mso">edit</span>
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
        <button class="msg-action-btn" @click="emit('edit', messageId)" title="编辑后重新发送">
          <span class="mso">edit</span> 编辑
        </button>
        <button class="msg-action-btn" @click="emit('retry', messageId)" title="重新发送">
          <span class="mso">refresh</span> 重发
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

/* ─── 搜索引用卡片 ─── */
.msg-search-refs {
  margin-bottom: 8px;
  border: 1px solid rgba(107,142,35,.2);
  border-radius: 8px;
  background: rgba(107,142,35,.03);
  overflow: hidden;
}
.msg-search-refs-title {
  padding: 6px 10px;
  font-size: 11px; font-weight: 600;
  color: var(--olive-dark);
  border-bottom: 1px solid rgba(107,142,35,.1);
}
.msg-search-ref-item {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(107,142,35,.06);
}
.msg-search-ref-item:last-child { border-bottom: none; }
.msg-search-ref-link {
  display: block;
  font-size: 12px; font-weight: 600;
  color: var(--olive); text-decoration: none;
  margin-bottom: 2px;
}
.msg-search-ref-link:hover { text-decoration: underline; }
.msg-search-ref-snippet {
  font-size: 11px; color: var(--ink3);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
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
