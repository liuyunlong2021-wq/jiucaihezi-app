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
import { useNotebook } from '@/composables/useNotebook'
import { useFileStore } from '@/composables/useFileStore'
import { emitEvent } from '@/utils/eventBus'

const props = defineProps<{
  content: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  agentName?: string
  messageId: string
  toolCalls?: ToolCall[]
  toolName?: string
  images?: string[]  // 图片附件
  files?: Array<{ name: string; content: string }>  // 文本文件附件
}>()

const emit = defineEmits<{
  (e: 'retry', messageId: string): void
  (e: 'delete', messageId: string): void
}>()

const copyLabel = ref('复制')

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

// 复制消息 (V4 copyMsgFloat 行 7411)
function copyMessage() {
  navigator.clipboard.writeText(props.content).then(() => {
    copyLabel.value = '已复制'
    setTimeout(() => { copyLabel.value = '复制' }, 1200)
  })
}

// 导入到编辑区 — 通过事件通知 Tiptap EditorPanel
const { addAgentBlock, blocks: nbBlocks } = useNotebook()
const importLabel = ref('导入编辑区')
const appendLabel = ref('追加编辑区')

function importToEditor() {
  // 同时保留旧 notebook 兼容 + 发送新 Tiptap 事件
  addAgentBlock(
    props.agentName || '助手',
    props.agentName || '助手',
    props.content
  )
  // 通知 Tiptap 编辑器插入内容
  emitEvent('import-to-editor', {
    content: props.content,
    agentName: props.agentName || '助手',
  })
  const fs = useFileStore()
  fs.addFile({
    category: 'text',
    name: (props.agentName || '助手') + '的回复',
    content: props.content,
    mimeType: 'text/markdown',
    size: props.content.length
  })
  emitEvent('switch-panel', 'editor')
  importLabel.value = '✓ 已导入'
  setTimeout(() => { importLabel.value = '导入编辑区' }, 1500)
}

function appendToEditor() {
  addAgentBlock(
    props.agentName || '助手',
    props.agentName || '助手',
    props.content
  )
  emitEvent('import-to-editor', {
    content: props.content,
    agentName: props.agentName || '助手',
  })
  const fs = useFileStore()
  fs.addFile({
    category: 'text',
    name: (props.agentName || '助手') + '的追加回复',
    content: props.content,
    mimeType: 'text/markdown',
    size: props.content.length
  })
  emitEvent('switch-panel', 'editor')
  appendLabel.value = '✓ 已追加'
  setTimeout(() => { appendLabel.value = '追加编辑区' }, 1500)
}
</script>

<template>
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

      <div class="msg-body" @click="onRenderedClick" v-html="renderedHtml"></div>

      <!-- 工具调用卡片 -->
      <ToolCallCard v-if="toolCalls && toolCalls.length" :tool-calls="toolCalls" />

      <!-- 导入/追加编辑区 + 操作按钮（显性一排） -->
      <div v-if="role === 'assistant'" class="msg-action-row">
        <button v-if="showImportBtn" class="msg-action-btn" :class="{ copied: importLabel !== '导入编辑区' }" @click="importToEditor">
          {{ importLabel }}
        </button>
        <button v-if="showImportBtn" class="msg-action-btn append" :class="{ copied: appendLabel !== '追加编辑区' }" @click="appendToEditor">
          {{ appendLabel }}
        </button>
        <button class="msg-action-btn" @click="copyMessage">
          {{ copyLabel }}
        </button>
        <button class="msg-action-btn danger" @click="emit('delete', messageId)" title="删除">
          删除
        </button>
      </div>
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
.msg-action-btn.append { border-color: #2196f3; color: #2196f3; }
.msg-action-btn.append:hover { background: rgba(33,150,243,.06); }
.msg-action-btn.append.copied { background: #4a7; color: #fff; border-color: #4a7; }
.msg-action-btn.danger:hover { border-color: #e53935; color: #e53935; }
.msg-action-btn .mso { font-size: 14px; }
</style>
