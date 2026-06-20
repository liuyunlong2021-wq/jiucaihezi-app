<template>
  <!-- LLM Config node wrapper | LLM配置节点包裹层 -->
  <div class="ln-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <!-- LLM Config node | LLM配置节点 -->
    <div
      class="ln-card"
      :class="data.selected ? 'ln-selected' : ''">
      <!-- Header | 头部 -->
      <div class="ln-header">
        <div class="ln-header-left">
          <span class="mso ln-header-icon" style="font-size:16px">chat</span>
          <span v-if="!isEditingLabel"
            @dblclick="startEditLabel"
            class="ln-header-label"
            title="双击编辑名称">{{ nodeLabel }}</span>
          <input v-else ref="labelInputRef" v-model="editingLabelValue"
            @blur="finishEditLabel"
            @keydown.enter="finishEditLabel"
            @keydown.escape="cancelEditLabel"
            class="ln-header-input" />
        </div>
        <div class="ln-header-actions">
          <button @click="handleDuplicate" class="ln-action-btn" title="复制节点">
            <span class="mso" style="font-size:14px">content_copy</span>
          </button>
          <button @click="handleDelete" class="ln-action-btn" title="删除节点">
            <span class="mso" style="font-size:14px">delete</span>
          </button>
        </div>
      </div>

      <!-- Config content | 配置内容 -->
      <div class="ln-body">
        <!-- System prompt | 系统提示词 -->
        <div class="ln-field">
          <label class="ln-field-label">系统提示词</label>
          <div class="ln-textarea-wrap" ref="textareaWrapper">
            <div ref="systemPromptRef" class="ln-editor" contenteditable="true"
              @input="handleInput"
              @keydown="handleKeydown"
              @paste="handlePaste"
              @blur="handleBlur"
              @wheel.stop @mousedown.stop
              :data-placeholder="placeholder"></div>
          </div>
        </div>

        <!-- Model selection | 模型选择 -->
        <div class="ln-field">
          <label class="ln-field-label">模型</label>
          <select v-model="model" class="ln-select" @change="updateConfig">
            <option v-for="m in textModels" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>

        <!-- Output format | 输出格式 -->
        <div class="ln-field">
          <label class="ln-field-label">输出格式</label>
          <select v-model="outputFormat" class="ln-select" @change="updateConfig">
            <option v-for="f in formatOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>

        <!-- Generate button | 生成按钮 -->
        <button @click="handleGenerate" :disabled="isGenerating" class="ln-gen-btn">
          <span v-if="isGenerating" class="ln-spinner"></span>
          <span v-else class="mso" style="font-size:14px">auto_awesome</span>
          {{ isGenerating ? '生成中...' : '执行生成' }}
        </button>

        <!-- Output preview | 输出预览 -->
        <div v-if="outputContent" class="ln-output">
          <div class="ln-output-header">
            <label class="ln-field-label">生成结果</label>
            <button @click="handleCopyOutput" class="ln-copy-btn">
              <span class="mso" style="font-size:12px">content_copy</span> 复制
            </button>
          </div>
          <div @wheel.stop @mousedown.stop class="ln-output-content">
            <pre>{{ outputContent }}</pre>
          </div>

          <!-- Split actions | 拆分操作 -->
          <div class="ln-split-actions">
            <button @click="handleSplitToTextWithImage" :disabled="isSplitting" class="ln-split-btn">
              <span v-if="isSplitting" class="ln-spinner-sm"></span>
              <span v-else class="mso" style="font-size:12px">image</span>
              {{ isSplitting ? '拆分中...' : '拆分图文' }}
            </button>
            <button @click="handleSplitToTextOnly" :disabled="isSplitting" class="ln-split-btn">
              <span v-if="isSplitting" class="ln-spinner-sm"></span>
              <span v-else class="mso" style="font-size:12px">list</span>
              {{ isSplitting ? '拆分中...' : '拆分文本' }}
            </button>
          </div>
          <div v-if="splitMessage" class="ln-split-msg">{{ splitMessage }}</div>
        </div>
      </div>

      <!-- Handles | 连接点 -->
      <Handle type="target" :position="Position.Left" id="left" class="ln-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="llm" :visible="showHandleMenu" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * LLM Config node component | LLM配置节点组件
 * 移植自 huobao-canvas LLMConfigNode.vue — 结构完全一致
 */
import { ref, watch, computed, nextTick, onMounted } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { safeFetch } from '@/utils/httpClient'
import { resolveApiConfig } from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'

const props = defineProps<{ id: string; data: Record<string, any> }>()

const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const { updateNodeInternals } = useVueFlow()

// API config state | API 配置状态
const isApiConfigured = computed(() => !!getApiKey())

// Model options | 模型选项
const textModels = computed(() => agentStore.textModels)

// Local state | 本地状态
const showHandleMenu = ref(false)
const systemPrompt = ref(props.data?.systemPrompt || '')
const systemPromptRef = ref<HTMLDivElement | null>(null)
const textareaWrapper = ref<HTMLDivElement | null>(null)
const placeholder = '设定 AI 的角色和行为规则...'
const lastContent = ref('')

// Label editing state | Label 编辑状态
const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)
const nodeLabel = computed(() => props.data?.label || 'LLM 文本生成')

// 内部更新标志
let isInternalUpdate = false

const outputFormat = ref(props.data?.outputFormat || 'text')
const outputContent = ref(props.data?.outputContent || '')
const isGenerating = ref(false)
const isSplitting = ref(false)
const splitMessage = ref('')

const formatOptions = [
  { label: '纯文本', value: 'text' },
  { label: 'JSON 结构', value: 'json' },
  { label: 'Markdown', value: 'markdown' }
]

const model = ref(props.data?.modelId || agentStore.textModels[0]?.id || 'claude-sonnet-4-6')

// LLMConfig node menu operations | LLM配置节点菜单操作
const operations: NodeHandleOperation[] = [
  { type: 'imageGen', label: '生图', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
  { type: 'text', label: '文本', icon: 'article' }
]

// ============ contenteditable 逻辑 ============

const getEditableText = (): string => {
  const el = systemPromptRef.value
  if (!el) return ''
  return el.textContent || ''
}

const setEditableContent = (text: string) => {
  if (!systemPromptRef.value) return
  systemPromptRef.value.innerHTML = ''
  if (text) systemPromptRef.value.textContent = text
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

const handleInput = () => {
  isInternalUpdate = true
  systemPrompt.value = getEditableText()
  lastContent.value = systemPrompt.value
  nextTick(() => { isInternalUpdate = false })
}

const handleBlur = () => {
  updateConfig()
}

// ============ 配置同步 ============

let updateConfigTimer: ReturnType<typeof setTimeout> | null = null
const updateConfig = () => {
  if (updateConfigTimer) clearTimeout(updateConfigTimer)
  updateConfigTimer = setTimeout(() => {
    canvasStore.updateNodeData(props.id, {
      systemPrompt: systemPrompt.value,
      modelId: model.value,
      outputFormat: outputFormat.value,
      outputContent: outputContent.value
    })
  }, 150)
}

// ============ 获取上游输入 ============

const getInputFromConnections = (): string => {
  const incomingEdges = canvasStore.edges.filter(e => e.target === props.id)
  const inputs: string[] = []
  for (const edge of incomingEdges) {
    const sourceNode = canvasStore.nodes.find(n => n.id === edge.source)
    if (sourceNode) {
      if (sourceNode.type === 'text' && (sourceNode.data as any)?.content) {
        inputs.push((sourceNode.data as any).content)
      } else if (sourceNode.type === 'llm' && (sourceNode.data as any)?.outputContent) {
        inputs.push((sourceNode.data as any).outputContent)
      }
    }
  }
  return inputs.join('\n\n')
}

// ============ 执行生成 ============

const handleGenerate = async () => {
  if (!isApiConfigured.value) {
    console.warn('[LLMNode] 请先配置 API Key')
    return
  }

  const input = getInputFromConnections()
  if (!input && !systemPrompt.value) {
    console.warn('[LLMNode] 请连接输入节点或设置系统提示词')
    return
  }

  isGenerating.value = true
  try {
    const cfg = await resolveApiConfig()
    const messages: any[] = []
    if (systemPrompt.value) {
      messages.push({ role: 'system', content: systemPrompt.value })
    }
    messages.push({ role: 'user', content: input || '请根据以上信息生成内容' })

    const body = JSON.stringify({ model: model.value, messages, stream: false })
    const res = await safeFetch(`${cfg.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body,
    })

    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json()
    const result = json.choices?.[0]?.message?.content || ''
    if (result) {
      outputContent.value = result
      canvasStore.updateNodeData(props.id, { outputContent: result, executed: true })
    }
  } catch (err: any) {
    console.error('[LLMNode] 生成失败:', err.message)
  } finally {
    isGenerating.value = false
  }
}

// ============ 段落解析 ============

const parseParagraphs = (text: string): string[] => {
  const lines = text.split('\n')
  const paragraphs: string[] = []
  let current = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      if (current.trim()) { paragraphs.push(current.trim()); current = '' }
    } else {
      current += (current ? '\n' : '') + line
    }
  }
  if (current.trim()) paragraphs.push(current.trim())
  return paragraphs
}

// ============ 拆分文本 ============

const handleSplitToTextOnly = () => {
  if (!outputContent.value) return
  const segments = parseParagraphs(outputContent.value)
  if (segments.length <= 1) {
    console.warn('[LLMNode] 内容无法拆分')
    return
  }
  doSplitToTextNodes(segments)
}

// ============ 拆分图文 ============

const handleSplitToTextWithImage = () => {
  if (!outputContent.value) return
  const segments = parseParagraphs(outputContent.value)
  if (segments.length === 0) return

  isSplitting.value = true
  splitMessage.value = ''
  try {
    const currentNode = canvasStore.nodes.find(n => n.id === props.id)
    const baseX = (currentNode?.position?.x || 0) + 450
    const baseY = (currentNode?.position?.y || 0)
    const rowSpacing = 200

    canvasStore.startBatch()
    for (let i = 0; i < segments.length; i++) {
      const segY = baseY + i * rowSpacing
      const textNode = canvasStore.addNodeWithData('text', {
        content: segments[i], label: `片段 ${i + 1}`, createdAt: Date.now(),
      } as any, { x: baseX, y: segY })
      canvasStore.addEdge(props.id, textNode.id, {})

      const imgNode = canvasStore.addNodeWithData('imageGen', {
        label: `图片 ${i + 1}`, modelId: 'gpt-image-2', createdAt: Date.now(),
      } as any, { x: baseX + 350, y: segY })
      canvasStore.addEdge(textNode.id, imgNode.id, { kind: 'prompt-order' } as any)
    }
    canvasStore.endBatch()
    splitMessage.value = `已拆分 ${segments.length} 个图文节点`
  } catch (err: any) {
    console.error('[LLMNode] 拆分失败:', err.message)
  } finally {
    isSplitting.value = false
  }
}

const doSplitToTextNodes = (segments: string[]) => {
  isSplitting.value = true
  splitMessage.value = ''
  try {
    const currentNode = canvasStore.nodes.find(n => n.id === props.id)
    const baseX = (currentNode?.position?.x || 0) + 450
    const baseY = (currentNode?.position?.y || 0)
    const rowSpacing = 180

    canvasStore.startBatch()
    for (let i = 0; i < segments.length; i++) {
      const segY = baseY + i * rowSpacing
      const textNode = canvasStore.addNodeWithData('text', {
        content: segments[i], label: `拆分片段 ${i + 1}`, createdAt: Date.now(),
      } as any, { x: baseX, y: segY })
      canvasStore.addEdge(props.id, textNode.id, {})
    }
    canvasStore.endBatch()
    splitMessage.value = `已拆分为 ${segments.length} 个文本节点`
  } catch (err: any) {
    console.error('[LLMNode] 拆分失败:', err.message)
  } finally {
    isSplitting.value = false
  }
}

// ============ 复制输出 ============

const handleCopyOutput = async () => {
  if (!outputContent.value) return
  try { await navigator.clipboard.writeText(outputContent.value) } catch { /* ignore */ }
}

// ============ Handle menu select ============

const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0

  const defaultData: Record<string, any> = {
    imageGen: { modelId: 'gpt-image-2', size: '1024x1024', label: '文生图' },
    videoGen: { label: '视频生成' },
    text: { content: '', label: '文本输入' }
  }

  const newNode = canvasStore.addNodeWithData(
    item.type as any,
    defaultData[item.type] || {},
    { x: nodeX + 400, y: nodeY }
  )
  canvasStore.addEdge(props.id, newNode.id, {})
  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

// ============ Label 编辑 ============

const startEditLabel = () => {
  editingLabelValue.value = nodeLabel.value
  isEditingLabel.value = true
  nextTick(() => {
    labelInputRef.value?.focus()
    labelInputRef.value?.select()
  })
}

const finishEditLabel = () => {
  const newLabel = editingLabelValue.value.trim()
  if (newLabel && newLabel !== nodeLabel.value) {
    canvasStore.updateNodeData(props.id, { label: newLabel })
  }
  isEditingLabel.value = false
}

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

// ============ 数据同步 ============

watch(() => props.data, (newData) => {
  if (newData?.systemPrompt !== undefined && newData.systemPrompt !== systemPrompt.value) {
    systemPrompt.value = newData.systemPrompt
    lastContent.value = systemPrompt.value
    setEditableContent(systemPrompt.value)
  }
  if (newData?.modelId !== undefined) model.value = newData.modelId
  if (newData?.outputFormat !== undefined) outputFormat.value = newData.outputFormat
  if (newData?.outputContent !== undefined) outputContent.value = newData.outputContent
  nextTick(() => updateNodeInternals([props.id]))
}, { deep: true })

watch(systemPrompt, (newVal) => {
  if (isInternalUpdate) return
  setEditableContent(newVal)
  lastContent.value = newVal
})

onMounted(() => {
  if (!model.value || !agentStore.textModels.find(m => m.id === model.value)) {
    model.value = agentStore.textModels[0]?.id || 'claude-sonnet-4-6'
  }
  if (systemPromptRef.value) {
    if (props.data?.systemPrompt) {
      systemPrompt.value = props.data.systemPrompt
    }
    lastContent.value = systemPrompt.value
    setEditableContent(systemPrompt.value)
  }
})
</script>

<style scoped>
/* ─── 与火宝 LLMConfigNode.vue 结构完全一致，Tailwind → scoped CSS ─── */

.ln-wrapper {
  padding-right: 50px;
  padding-top: 20px;
  position: relative;
}

.ln-card {
  cursor: default;
  position: relative;
  background: var(--surface-alt);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  min-width: 320px;
  max-width: 400px;
  transition: all 0.2s ease;
}

.ln-selected {
  border-width: 1px;
  border-color: #8b5cf6;
  box-shadow: 0 4px 16px color-mix(in srgb, #8b5cf6 20%, transparent);
}

/* Header */
.ln-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(90deg, color-mix(in srgb, #8b5cf6 10%, transparent), transparent);
}

.ln-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ln-header-icon {
  color: #8b5cf6;
}

.ln-header-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink2);
  cursor: text;
  padding: 0 4px;
  border-radius: 4px;
  transition: background 0.15s;
}
.ln-header-label:hover {
  background: var(--surface);
}

.ln-header-input {
  font-size: 13px;
  font-weight: 500;
  background: var(--surface);
  color: var(--ink);
  padding: 0 4px;
  border-radius: 4px;
  outline: none;
  border: 1px solid #8b5cf6;
}

.ln-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ln-action-btn {
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink3);
  transition: background 0.15s;
  display: flex;
}
.ln-action-btn:hover {
  background: var(--surface);
  color: var(--ink);
}

/* Body */
.ln-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ln-field {
  position: relative;
}

.ln-field-label {
  font-size: 11px;
  color: var(--ink2);
  margin-bottom: 4px;
  display: block;
}

/* Editor */
.ln-editor {
  min-height: 60px;
  max-height: 120px;
  padding: 8px 10px;
  border: 1px solid var(--border);
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
  transition: border-color 0.2s;
}
.ln-editor:focus {
  border-color: #8b5cf6;
}
.ln-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--ink3);
  opacity: 0.5;
  pointer-events: none;
}

/* Select */
.ln-select {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  outline: none;
  cursor: pointer;
  font-family: var(--jc-font-body);
}
.ln-select:focus {
  border-color: #8b5cf6;
}

/* Generate button */
.ln-gen-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  border-radius: 8px;
  background: #8b5cf6;
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 0.15s;
  font-family: var(--jc-font-body);
}
.ln-gen-btn:hover:not(:disabled) {
  background: #7c3aed;
}
.ln-gen-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Output */
.ln-output {
  margin-top: 4px;
}

.ln-output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.ln-copy-btn {
  font-size: 11px;
  color: var(--ink2);
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--jc-font-body);
}
.ln-copy-btn:hover {
  color: #8b5cf6;
}

.ln-output-content {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  max-height: 150px;
  overflow-y: auto;
}
.ln-output-content pre {
  font-size: 12px;
  color: var(--ink);
  white-space: pre-wrap;
  margin: 0;
  font-family: var(--jc-font-body);
}

/* Split actions */
.ln-split-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.ln-split-btn {
  flex: 1;
  padding: 6px 12px;
  font-size: 11px;
  border-radius: 8px;
  background: transparent;
  color: #8b5cf6;
  border: 1px solid #8b5cf6;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: background 0.15s;
  font-family: var(--jc-font-body);
}
.ln-split-btn:hover:not(:disabled) {
  background: color-mix(in srgb, #8b5cf6 10%, transparent);
}
.ln-split-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ln-split-msg {
  font-size: 11px;
  color: var(--olive-dark);
  margin-top: 4px;
}

/* Target handle */
.ln-target-handle {
  background: #8b5cf6 !important;
}

/* Spinners */
.ln-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ln-spin 0.6s linear infinite;
  display: inline-block;
}

.ln-spinner-sm {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(139,92,246,0.3);
  border-top-color: #8b5cf6;
  border-radius: 50%;
  animation: ln-spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes ln-spin {
  to { transform: rotate(360deg); }
}
</style>
