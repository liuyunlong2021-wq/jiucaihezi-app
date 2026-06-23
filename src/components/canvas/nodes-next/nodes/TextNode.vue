<template>
  <div class="tn-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div
      class="tn-card"
      :class="data.selected ? 'tn-selected' : ''"
      :style="{ width: nodeWidth + 'px', minHeight: nodeHeight + 'px' }">
      <!-- Header -->
      <div class="tn-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="tn-header-label" title="双击编辑名称">{{ data.label || '文本' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="tn-header-input" />
        <div class="tn-header-actions">
          <button @click="handleDuplicate" class="tn-action-btn" title="复制节点"><JcIcon name="content_copy" /></button>
          <button @click="handleDelete" class="tn-action-btn" title="删除节点"><JcIcon name="delete" /></button>
        </div>
      </div>

      <!-- Editor -->
      <textarea
        ref="editorRef"
        v-model="content"
        class="tn-editor"
        :placeholder="placeholder"
        @input="updateContent"
      ></textarea>

      <!-- Footer: 字符统计 + RH NodeID -->
      <div class="tn-footer">
        <span class="tn-char-count" title="字符数">{{ content.length }} 字符</span>
        <label class="tn-rh-label" title="可选：填 RH 应用 nodeInfoList 里的节点序号，下游 RH 节点会按此自动绑定文本参数">
          <span class="tn-rh-hash">#</span>
          <input
            :value="rhNodeId"
            @input="handleRhNodeId"
            placeholder="RH#"
            inputmode="numeric"
            class="tn-rh-input"
          />
        </label>
      </div>

      <!-- 自由缩放拖拽手柄 (T8 ResizableCorners 对齐) -->
      <div
        v-if="data.selected"
        class="tn-resize-handle"
        @pointerdown.prevent="startResize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 10L10 0v10H0z" fill="currentColor" opacity="0.4"/></svg>
      </div>

      <!-- Handles -->
      <NodeHandleMenu :nodeId="id" nodeType="text" :visible="showHandleMenu" :operations="operations" @select="handleSelect" />
      <Handle type="target" :position="Position.Left" id="left" class="tn-target-handle" />
    </div>
  </div>
  <MentionsPicker v-model:visible="showMentionsPicker" :position="mentionsPosition" context="text" @select="handleMentionSelect" />
</template>

<script setup lang="ts">
/**
 * Text node component | 文本节点组件
 * 移植自 huobao-canvas TextNode.vue — 结构完全一致
 */
import { ref, watch, nextTick, computed, onMounted } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { safeFetch } from '@/utils/httpClient'
import { resolveApiConfig } from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'
import MentionsPicker from '../shared/MentionsPicker.vue'
import { parseMentions } from '../composables/useNodeRef'

const props = defineProps<{ id: string; data: Record<string, any> }>()

const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const { updateNodeInternals } = useVueFlow()

// ─── 自由缩放 (T8 ResizableCorners 对齐) ───
const nodeWidth = ref(props.data?.nodeWidth || 280)
const nodeHeight = ref(props.data?.nodeHeight || 140)
const resizeState = ref<{ startX: number; startY: number; startW: number; startH: number } | null>(null)

function startResize(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  resizeState.value = { startX: e.clientX, startY: e.clientY, startW: nodeWidth.value, startH: nodeHeight.value }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  if (!resizeState.value) return
  const dx = e.clientX - resizeState.value.startX
  const dy = e.clientY - resizeState.value.startY
  nodeWidth.value = Math.max(220, resizeState.value.startW + dx)
  nodeHeight.value = Math.max(100, resizeState.value.startH + dy)
}

function onResizeEnd() {
  resizeState.value = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  canvasStore.updateNodeData(props.id, { nodeWidth: nodeWidth.value, nodeHeight: nodeHeight.value })
  setTimeout(() => updateNodeInternals([props.id]), 50)
}

// ─── RH NodeID 绑定 (T8 rhNodeId 对齐) ───
const rhNodeId = ref(props.data?.rhNodeId || '')
function handleRhNodeId(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const digits = raw.replace(/\D+/g, '')
  rhNodeId.value = digits
  canvasStore.updateNodeData(props.id, { rhNodeId: digits })
}

// API config state | API 配置状态
const isApiConfigured = computed(() => !!getApiKey())

// Chat hook for polish | 润色用的 API 调用
async function callPolishApi(input: string): Promise<string> {
  const cfg = await resolveApiConfig()
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: '你是一个专业的AI绘画提示词专家。将用户输入的内容美化成高质量的生图提示词，包含风格、光线、构图、细节等要素。直接返回提示词，不要其他解释。' },
      { role: 'user', content: input },
    ],
    stream: false,
  })
  const res = await safeFetch(`${cfg.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body,
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = await res.json()
  return json.choices?.[0]?.message?.content || ''
}

// Local content state | 本地内容状态
const showHandleMenu = ref(false)
const content = ref(props.data?.content || '')
const placeholder = '请输入文本内容...'

// Collapse / preview mode | 折叠/预览模式
const isCollapsed = ref(false)
const isEditing = ref(false)
const isActiveEditor = ref(false)
const enterEditMode = () => {
  isCollapsed.value = false
  isEditing.value = true
  isActiveEditor.value = true
  nextTick(() => {
    editorRef.value?.focus()
  })
}

// Label editing state | Label 编辑状态
const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)

// Polish loading state | 润色加载状态
const isPolishing = ref(false)

const editorRef = ref<HTMLDivElement | null>(null)
const textareaWrapper = ref<HTMLDivElement | null>(null)

// @提及选择器
const showMentionsPicker = ref(false)
const mentionsPosition = ref({ x: 0, y: 0 })

// 内部更新标志
let isInternalUpdate = false

// 从 contenteditable 中提取纯文本
const getEditableText = (): string => {
  const el = editorRef.value
  if (!el) return ''
  return el.textContent || ''
}

// 设置 contenteditable 内容（纯文本）
const setEditableContent = (text: string) => {
  if (!editorRef.value) return
  editorRef.value.innerHTML = ''
  if (text) editorRef.value.textContent = text
}

// Handle paste - 纯文本粘贴
const handlePaste = (e: ClipboardEvent) => {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
}

// 获取纯文本（用于 AI 润色）
const plainText = computed(() => content.value)

// Text node menu operations | 文本节点菜单操作
const operations: NodeHandleOperation[] = [
  { type: 'imageGen', label: '生图', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
  { type: 'llm', label: 'LLM', icon: 'chat' }
]

// Handle menu select | 处理菜单选择
const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0

  const defaultData: Record<string, any> = {
    imageGen: { modelId: 'gpt-image-2', size: '1024x1024', label: '文生图' },
    videoGen: { label: '视频生成' },
    llm: { label: 'LLM文本生成', modelId: agentStore.textModels[0]?.id || 'claude-sonnet-4-6' }
  }

  const newNode = canvasStore.addNodeWithData(
    item.type as any,
    defaultData[item.type] || {},
    { x: nodeX + 400, y: nodeY }
  )

  canvasStore.addEdge(props.id, newNode.id, {})

  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

// Handle input | 处理输入
const handleInput = (e: Event) => {
  isInternalUpdate = true
  content.value = getEditableText()
  nextTick(() => { isInternalUpdate = false })

  // @ 提及检测
  const selection = window.getSelection()
  if (!selection?.rangeCount) { showMentionsPicker.value = false; return }
  const range = selection.getRangeAt(0)
  const textBeforeCursor = content.value.slice(0, range.startOffset)
  const lastAt = textBeforeCursor.lastIndexOf('@')
  if (lastAt !== -1 && !textBeforeCursor.slice(lastAt + 1).includes(' ') && !/@\[[^\]]*\]$/.test(textBeforeCursor.slice(lastAt))) {
    const rect = range.getBoundingClientRect()
    showMentionsPicker.value = true
    mentionsPosition.value = { x: rect.left, y: rect.bottom + 4 }
  } else {
    showMentionsPicker.value = false
  }
}

// Handle keydown | 处理键盘
const handleKeydown = (e: KeyboardEvent) => {
  // Shift+Enter 换行
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    document.execCommand('insertLineBreak')
  }
}

// Update content in store | 更新存储中的内容
function handleMentionSelect({ nodeId }: { nodeId: string }) {
  const el = editorRef.value
  if (!el) return
  const text = content.value
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  const cursorPos = range.startOffset
  const beforeCursor = text.slice(0, cursorPos)
  const lastAt = beforeCursor.lastIndexOf('@')
  if (lastAt === -1) return
  const searchText = beforeCursor.slice(lastAt)
  content.value = text.slice(0, lastAt) + `@[${nodeId}]` + text.slice(cursorPos)
  nextTick(() => {
    setEditableContent(content.value)
    el.focus()
    const sel = window.getSelection()
    sel?.collapse(el.childNodes[0] || el, lastAt + nodeId.length + 3)
  })
  showMentionsPicker.value = false
}

const updateContent = () => {
  canvasStore.updateNodeData(props.id, { content: content.value })
}

// Handle AI polish | 处理 AI 润色
const handlePolish = async () => {
  const input = content.value.trim()
  if (!input) return

  if (!isApiConfigured.value) {
    console.warn('[TextNode] 请先配置 API Key')
    return
  }

  isPolishing.value = true
  const originalContent = content.value

  try {
    const result = await callPolishApi(input)
    if (result) {
      content.value = result
      canvasStore.updateNodeData(props.id, { content: result })
    }
  } catch (err: any) {
    content.value = originalContent
    console.error('[TextNode] 润色失败:', err.message)
  } finally {
    isPolishing.value = false
  }
}

// Start editing label | 开始编辑 label
const startEditLabel = () => {
  editingLabelValue.value = props.data?.label || ''
  isEditingLabel.value = true
  nextTick(() => {
    labelInputRef.value?.focus()
    labelInputRef.value?.select()
  })
}

// Finish editing label | 完成编辑 label
const finishEditLabel = () => {
  const newLabel = editingLabelValue.value.trim()
  if (newLabel && newLabel !== props.data?.label) {
    canvasStore.updateNodeData(props.id, { label: newLabel })
  }
  isEditingLabel.value = false
}

// Cancel editing label | 取消编辑 label
const cancelEditLabel = () => {
  isEditingLabel.value = false
}

// Handle delete | 处理删除
const handleDelete = () => {
  canvasStore.deleteNode(props.id)
}

// Handle duplicate | 处理复制
const handleDuplicate = () => {
  const newNode = canvasStore.duplicateNode(props.id)
  if (newNode) {
    setTimeout(() => updateNodeInternals([newNode.id]), 50)
  }
}

// Watch for external data changes | 监听外部数据变化
watch(() => props.data?.content, (newVal) => {
  if (newVal !== content.value) {
    content.value = newVal || ''
    setEditableContent(content.value)
  }
})

// Watch content changes and sync to editor | 监听内容变化并同步到编辑器
watch(content, (newVal) => {
  if (isInternalUpdate) return
  setEditableContent(newVal)
})

// Initialize editor content | 初始化 editor 内容
// 暴露给 MentionsPicker 查找节点
;(window as any).__canvasStore__ = canvasStore

onMounted(() => {
  if (editorRef.value) {
    if (props.data?.content) {
      content.value = props.data.content
    }
    setEditableContent(content.value)
  }
})
</script>

<style scoped>
/* ─── 与火宝 TextNode.vue 结构完全一致，Tailwind → scoped CSS ─── */

.tn-wrapper {
  padding-right: 50px;
  padding-top: 20px;
  position: relative;
}

.tn-card {
  cursor: default;
  position: relative;
  background: var(--surface-alt);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  min-width: 220px;
  max-width: 600px;
  transition: all 0.2s ease;
}

.tn-selected {
  border-width: 1px;
  border-color: #3b82f6;
  box-shadow: 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent);
}

/* Header */
.tn-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.tn-header-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink2);
  cursor: text;
  padding: 0 4px;
  border-radius: 4px;
  transition: background 0.15s;
}
.tn-header-label:hover {
  background: var(--surface);
}

.tn-header-input {
  font-size: 13px;
  font-weight: 500;
  background: var(--surface);
  color: var(--ink);
  padding: 0 4px;
  border-radius: 4px;
  outline: none;
  border: 1px solid #3b82f6;
}

.tn-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tn-action-btn {
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink3);
  transition: background 0.15s;
  display: flex;
}
.tn-action-btn:hover {
  background: var(--surface);
  color: var(--ink);
}

/* Body */
.tn-body {
  padding: 12px;
}

.tn-textarea-wrap {
  position: relative;
}

.tn-content-wrap {
  /* simple */
}

/* Editor - textarea */
.tn-editor {
  width: 100%;
  min-height: 100px;
  max-height: 300px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
  word-break: break-word;
  font-family: var(--jc-font-body);
  box-sizing: border-box;
}
.tn-editor:focus {
  box-shadow: 0 0 0 2px #3b82f630;
}
.tn-editor::placeholder {
  color: var(--ink3);
  opacity: 0.5;
}

/* Footer: 字符统计 + RH NodeID */
.tn-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  font-size: 10px;
  color: var(--ink3);
  flex-shrink: 0;
}
.tn-char-count { opacity: 0.6; }
.tn-rh-label { display: flex; align-items: center; gap: 2px; cursor: text; }
.tn-rh-hash { font-size: 9px; opacity: 0.5; }
.tn-rh-input {
  width: 48px; height: 18px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--surface); color: var(--ink);
  font-size: 10px; padding: 0 4px; outline: none;
  font-family: var(--jc-font-body);
}
.tn-rh-input:focus { border-color: #3b82f6; }

/* 自由缩放拖拽手柄 (T8 ResizableCorners 对齐) */
.tn-resize-handle {
  position: absolute; bottom: 0; right: 0;
  width: 14px; height: 14px;
  cursor: nwse-resize;
  display: flex; align-items: flex-end; justify-content: flex-end;
  padding: 2px; color: var(--ink3); z-index: 10;
}
.tn-resize-handle:hover { color: #3b82f6; }

/* Polish button */
.tn-polish-btn {
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink2);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--jc-font-body);
}
.tn-polish-btn:hover:not(:disabled) {
  background: var(--olive);
  color: #fff;
  border-color: var(--olive);
}
.tn-polish-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Target handle */
.tn-target-handle {
  background: var(--olive) !important;
}

/* Preview text | 非编辑状态文本预览 */
.tn-preview {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 20px;
  cursor: text;
}

/* Edit affordance button | 编辑按钮 */
.v8-text-edit-btn {
  margin: 0 12px 8px;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink2);
  border: 1px solid var(--border);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--jc-font-body);
  transition: all 0.15s;
}
.v8-text-edit-btn:hover {
  background: var(--olive);
  color: #fff;
  border-color: var(--olive);
}

/* Spinner */
.tn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--olive);
  border-radius: 50%;
  animation: tn-spin 0.6s linear infinite;
  display: inline-block;
}
@keyframes tn-spin {
  to { transform: rotate(360deg); }
}
</style>
