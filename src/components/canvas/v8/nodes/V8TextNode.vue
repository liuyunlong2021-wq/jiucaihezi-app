<template>
  <!-- Text node wrapper | 文本节点包裹层 -->
  <div class="text-node-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <!-- Text node | 文本节点 -->
    <div
      class="text-node"
      :class="data.selected ? 'text-node-selected' : ''"
    >
      <!-- Header | 头部 -->
      <div class="text-node-header">
        <span
          v-if="!isEditingLabel"
          @dblclick="startEditLabel"
          class="text-node-label"
          title="双击编辑名称"
        >{{ data.label }}</span>
        <input
          v-else
          ref="labelInputRef"
          v-model="editingLabelValue"
          @blur="finishEditLabel"
          @keydown.enter="finishEditLabel"
          @keydown.escape="cancelEditLabel"
          class="text-node-label-input"
        />
        <div class="text-node-actions">
          <button @click="handleDuplicate" class="text-node-action-btn" title="复制节点">
            <span class="mso">content_copy</span>
          </button>
          <button @click="handleDelete" class="text-node-action-btn" title="删除节点">
            <span class="mso">delete</span>
          </button>
        </div>
      </div>

      <!-- Content | 内容 -->
      <div class="text-node-body">
        <div class="textarea-wrapper" ref="textareaWrapper">
          <div
            ref="editorRef"
            class="editor-content"
            contenteditable="true"
            @input="handleInput"
            @keydown="handleKeydown"
            @paste="handlePaste"
            @blur="updateContent"
            @wheel.stop
            @mousedown.stop
            :data-placeholder="placeholder"
          ></div>
        </div>
        <!-- Polish button | 润色按钮 -->
        <button
          @click="handlePolish"
          :disabled="isPolishing || !plainText.trim()"
          class="polish-btn"
        >
          <span v-if="isPolishing" class="v8-spinner"></span>
          <span v-else>✨</span>
          AI 润色
        </button>
      </div>

      <!-- Handles | 连接点 -->
      <NodeHandleMenu
        :nodeId="id"
        nodeType="text"
        :visible="showHandleMenu"
        :operations="operations"
        @select="handleSelect"
      />
      <Handle type="target" :position="Position.Left" id="left" class="text-node-target-handle" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * V8TextNode — 移植自火宝 TextNode.vue
 * 功能：contenteditable 文本编辑 + AI润色 + 右侧悬浮菜单创建下游节点
 */
import { ref, watch, nextTick, computed, onMounted } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { safeFetch } from '@/utils/httpClient'
import { resolveApiConfig } from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'

const props = defineProps<{
  id: string
  data: Record<string, any>
}>()

const canvasStore = useCanvasStore()
const { updateNodeInternals } = useVueFlow()

// ── API 配置 ──
const isApiConfigured = computed(() => !!getApiKey())

// ── 本地状态 ──
const showHandleMenu = ref(false)
const content = ref(props.data?.content || '')
const placeholder = '请输入文本内容...'

const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)
const isPolishing = ref(false)

const editorRef = ref<HTMLDivElement | null>(null)
const textareaWrapper = ref<HTMLDivElement | null>(null)
let isInternalUpdate = false

// ── 纯文本 ──
const plainText = computed(() => content.value)

// ── 编辑区内容同步 ──
const getEditableText = (): string => {
  const el = editorRef.value
  if (!el) return ''
  return el.textContent || ''
}

const setEditableContent = (text: string) => {
  if (!editorRef.value) return
  editorRef.value.innerHTML = ''
  if (text) {
    editorRef.value.textContent = text
  }
}

// ── 操作菜单 ──
const operations: NodeHandleOperation[] = [
  { type: 'imageGen', label: '生图', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
  { type: 'llm', label: 'LLM', icon: 'chat' },
]

const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0

  const defaultData: Record<string, any> = {
    imageGen: { modelId: 'gpt-image-2', size: '1024x1024', label: '文生图' },
    videoGen: { label: '视频生成' },
    llm: { label: 'LLM文本生成', modelId: 'claude-sonnet-4-6' },
  }

  const newNode = canvasStore.addNodeWithData(
    item.type as any,
    defaultData[item.type] || {},
    { x: nodeX + 400, y: nodeY },
  )

  canvasStore.addEdge(props.id, newNode.id, {})

  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

// ── 输入处理 ──
const handleInput = (e: Event) => {
  isInternalUpdate = true
  content.value = getEditableText()
  nextTick(() => { isInternalUpdate = false })
}

const handlePaste = (e: ClipboardEvent) => {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    document.execCommand('insertLineBreak')
  }
}

const updateContent = () => {
  canvasStore.updateNodeData(props.id, { content: content.value })
}

// ── AI 润色 ──
const handlePolish = async () => {
  const input = content.value.trim()
  if (!input) return

  if (!isApiConfigured.value) {
    console.warn('[V8TextNode] 请先配置 API Key')
    return
  }

  isPolishing.value = true
  const originalContent = content.value

  try {
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body,
    })

    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json()
    const polished = json.choices?.[0]?.message?.content || ''
    if (polished) {
      content.value = polished
      setEditableContent(polished)
      canvasStore.updateNodeData(props.id, { content: polished })
    }
  } catch (err: any) {
    content.value = originalContent
    setEditableContent(originalContent)
    console.error('[V8TextNode] 润色失败:', err.message)
  } finally {
    isPolishing.value = false
  }
}

// ── Label 编辑 ──
const startEditLabel = () => {
  editingLabelValue.value = props.data?.label || ''
  isEditingLabel.value = true
  nextTick(() => {
    labelInputRef.value?.focus()
    labelInputRef.value?.select()
  })
}

const finishEditLabel = () => {
  const newLabel = editingLabelValue.value.trim()
  if (newLabel && newLabel !== props.data?.label) {
    canvasStore.updateNodeData(props.id, { label: newLabel })
  }
  isEditingLabel.value = false
}

const cancelEditLabel = () => {
  isEditingLabel.value = false
}

// ── 删除 / 复制 ──
const handleDelete = () => {
  canvasStore.deleteNode(props.id)
}

const handleDuplicate = () => {
  const newNode = canvasStore.duplicateNode(props.id)
  if (newNode) {
    setTimeout(() => updateNodeInternals([newNode.id]), 50)
  }
}

// ── 外部数据同步 ──
watch(() => props.data?.content, (newVal) => {
  if (newVal !== content.value) {
    content.value = newVal || ''
    setEditableContent(content.value)
  }
})

watch(content, (newVal) => {
  if (isInternalUpdate) return
  setEditableContent(newVal)
})

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
/* ── Wrapper ── */
.text-node-wrapper {
  padding-right: 50px;
  padding-top: 20px;
  position: relative;
}

/* ── Node card ── */
.text-node {
  cursor: default;
  position: relative;
  background: var(--surface-alt);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  min-width: 280px;
  max-width: 350px;
  transition: all 0.2s ease;
}

.text-node-selected {
  border-color: var(--olive);
  box-shadow: 0 0 0 1px var(--olive), 0 4px 16px color-mix(in srgb, var(--olive) 20%, transparent);
}

/* ── Header ── */
.text-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.text-node-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink2);
  cursor: text;
  padding: 0 4px;
  border-radius: 4px;
  transition: background 0.15s;
}

.text-node-label:hover {
  background: var(--surface);
}

.text-node-label-input {
  font-size: 13px;
  font-weight: 500;
  background: var(--surface);
  color: var(--ink);
  padding: 0 4px;
  border-radius: 4px;
  outline: none;
  border: 1px solid var(--olive);
  width: 120px;
}

.text-node-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.text-node-action-btn {
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink3);
  transition: background 0.15s, color 0.15s;
  display: flex;
  align-items: center;
}

.text-node-action-btn:hover {
  background: var(--surface);
  color: var(--ink);
}

.text-node-action-btn .mso {
  font-size: 14px;
}

/* ── Body ── */
.text-node-body {
  padding: 12px;
}

.textarea-wrapper {
  position: relative;
}

/* ── Editor ── */
.editor-content {
  min-height: 60px;
  max-height: 120px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
  outline: none;
  overflow-y: auto;
  word-break: break-word;
  white-space: pre-wrap;
  font-family: var(--jc-font-body);
}

.editor-content:focus {
  background: var(--surface);
}

.editor-content:empty::before {
  content: attr(data-placeholder);
  color: var(--ink3);
  opacity: 0.5;
  pointer-events: none;
}

/* ── Polish button ── */
.polish-btn {
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

.polish-btn:hover:not(:disabled) {
  background: var(--olive);
  color: #fff;
  border-color: var(--olive);
}

.polish-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Target handle ── */
.text-node-target-handle {
  background: var(--olive) !important;
}

/* ── Spinner ── */
.v8-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--olive);
  border-radius: 50%;
  animation: v8-spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes v8-spin {
  to { transform: rotate(360deg); }
}
</style>
