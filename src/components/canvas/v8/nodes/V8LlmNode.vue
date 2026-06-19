<template>
  <!-- LLM Config node wrapper | LLM配置节点包裹层 -->
  <div class="llm-node-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div
      class="llm-node"
      :class="data.selected ? 'llm-node-selected' : ''"
    >
      <!-- Header | 头部 -->
      <div class="llm-node-header">
        <div class="llm-header-left">
          <span class="mso llm-header-icon">chat</span>
          <span v-if="!isEditingLabel" @dblclick="startEditLabel"
            class="llm-header-label" title="双击编辑名称">{{ nodeLabel }}</span>
          <input v-else ref="labelInputRef" v-model="editingLabelValue"
            @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel"
            class="llm-header-input" />
        </div>
        <div class="llm-header-actions">
          <button @click="handleDuplicate" class="llm-action-btn" title="复制节点">
            <span class="mso">content_copy</span>
          </button>
          <button @click="handleDelete" class="llm-action-btn" title="删除节点">
            <span class="mso">delete</span>
          </button>
        </div>
      </div>

      <!-- Config content | 配置内容 -->
      <div class="llm-node-body">
        <!-- System prompt | 系统提示词 -->
        <div class="llm-field">
          <label class="llm-field-label">系统提示词</label>
          <div class="textarea-wrapper" ref="textareaWrapper">
            <div ref="systemPromptRef" class="editor-content" contenteditable="true"
              @input="handleInput" @keydown="handleKeydown" @paste="handlePaste"
              @blur="handleBlur" @wheel.stop @mousedown.stop
              :data-placeholder="placeholder"></div>
          </div>
        </div>

        <!-- Model selection | 模型选择 -->
        <div class="llm-field">
          <label class="llm-field-label">模型</label>
          <select v-model="model" class="llm-select" @change="updateConfig">
            <option v-for="m in textModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
          </select>
        </div>

        <!-- Output format | 输出格式 -->
        <div class="llm-field">
          <label class="llm-field-label">输出格式</label>
          <select v-model="outputFormat" class="llm-select" @change="updateConfig">
            <option v-for="f in formatOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>

        <!-- Generate button | 生成按钮 -->
        <button @click="handleGenerate" :disabled="isGenerating" class="llm-generate-btn">
          <span v-if="isGenerating" class="v8-spinner"></span>
          <span v-else class="mso">auto_awesome</span>
          {{ isGenerating ? '生成中...' : '执行生成' }}
        </button>

        <!-- Output preview | 输出预览 -->
        <div v-if="outputContent" class="llm-output">
          <div class="llm-output-header">
            <label class="llm-field-label">生成结果</label>
            <button @click="handleCopyOutput" class="llm-copy-btn">
              <span class="mso">content_copy</span> 复制
            </button>
          </div>
          <div @wheel.stop @mousedown.stop class="llm-output-content">
            <pre>{{ outputContent }}</pre>
          </div>

          <!-- Split actions | 拆分操作 -->
          <div class="llm-split-actions">
            <button @click="handleSplitToTextOnly" :disabled="isSplitting" class="llm-split-btn">
              <span v-if="isSplitting" class="v8-spinner"></span>
              <span v-else class="mso">list</span>
              {{ isSplitting ? '拆分中...' : '拆分文本' }}
            </button>
            <button @click="handleSplitToTextWithImage" :disabled="isSplitting" class="llm-split-btn">
              <span v-if="isSplitting" class="v8-spinner"></span>
              <span v-else class="mso">image</span>
              {{ isSplitting ? '拆分中...' : '拆分图文' }}
            </button>
          </div>
          <div v-if="splitMessage" class="llm-split-msg">{{ splitMessage }}</div>
        </div>
      </div>

      <!-- Handles | 连接点 -->
      <Handle type="target" :position="Position.Left" id="left" class="llm-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="llm" :visible="showHandleMenu"
        :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * V8LlmNode — 移植自火宝 LLMConfigNode.vue
 * 功能：系统提示词编辑 + 模型选择 + LLM生成 + 输出预览 + 拆分图文
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

const props = defineProps<{
  id: string
  data: Record<string, any>
}>()

const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const { updateNodeInternals } = useVueFlow()

// ── API 配置 ──
const isApiConfigured = computed(() => !!getApiKey())

// ── 模型列表 ──
const textModels = computed(() => agentStore.textModels)

// ── 本地状态 ──
const showHandleMenu = ref(false)
const systemPrompt = ref(props.data?.systemPrompt || '')
const systemPromptRef = ref<HTMLDivElement | null>(null)
const textareaWrapper = ref<HTMLDivElement | null>(null)
const placeholder = '设定 AI 的角色和行为规则...'

const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)
const nodeLabel = computed(() => props.data?.label || 'LLM 文本生成')

const model = ref(props.data?.modelId || agentStore.textModels[0]?.id || 'claude-sonnet-4-6')
const outputFormat = ref(props.data?.outputFormat || 'text')
const outputContent = ref(props.data?.outputContent || '')
const isGenerating = ref(false)
const isSplitting = ref(false)
const splitMessage = ref('')
let isInternalUpdate = false

const formatOptions = [
  { label: '纯文本', value: 'text' },
  { label: 'JSON 结构', value: 'json' },
  { label: 'Markdown', value: 'markdown' },
]

// ── 操作菜单 ──
const operations: NodeHandleOperation[] = [
  { type: 'imageGen', label: '生图', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
  { type: 'text', label: '文本', icon: 'article' },
]

// ── contenteditable 工具 ──
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

// ── 输入处理 ──
const handleInput = () => {
  isInternalUpdate = true
  systemPrompt.value = getEditableText()
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

const handleBlur = () => {
  updateConfig()
}

// ── 配置同步 ──
let updateTimer: ReturnType<typeof setTimeout> | null = null
const updateConfig = () => {
  if (updateTimer) clearTimeout(updateTimer)
  updateTimer = setTimeout(() => {
    canvasStore.updateNodeData(props.id, {
      systemPrompt: systemPrompt.value,
      modelId: model.value,
      outputFormat: outputFormat.value,
      outputContent: outputContent.value,
    })
  }, 150)
}

// ── 获取上游输入 ──
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

// ── 执行生成 ──
const handleGenerate = async () => {
  if (!isApiConfigured.value) {
    console.warn('[V8LlmNode] 请先配置 API Key')
    return
  }

  const input = getInputFromConnections()
  if (!input && !systemPrompt.value) {
    console.warn('[V8LlmNode] 请连接输入节点或设置系统提示词')
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

    const body = JSON.stringify({
      model: model.value,
      messages,
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
    const result = json.choices?.[0]?.message?.content || ''
    if (result) {
      outputContent.value = result
      canvasStore.updateNodeData(props.id, { outputContent: result })
    }
  } catch (err: any) {
    console.error('[V8LlmNode] 生成失败:', err.message)
  } finally {
    isGenerating.value = false
  }
}

// ── 段落解析 ──
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

// ── 拆分文本 ──
const handleSplitToTextOnly = () => {
  if (!outputContent.value) return
  const segments = parseParagraphs(outputContent.value)
  if (segments.length <= 1) {
    console.warn('[V8LlmNode] 内容无法拆分')
    return
  }
  doSplitToTextNodes(segments)
}

// ── 拆分图文 ──
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
        content: segments[i],
        label: `片段 ${i + 1}`,
        createdAt: Date.now(),
      } as any, { x: baseX, y: segY })

      canvasStore.addEdge(props.id, textNode.id, {})

      const imgNode = canvasStore.addNodeWithData('imageGen', {
        label: `图片 ${i + 1}`,
        modelId: 'gpt-image-2',
        createdAt: Date.now(),
      } as any, { x: baseX + 350, y: segY })

      canvasStore.addEdge(textNode.id, imgNode.id, { kind: 'prompt-order' } as any)
    }
    canvasStore.endBatch()
    splitMessage.value = `已拆分 ${segments.length} 个图文节点`
  } catch (err: any) {
    console.error('[V8LlmNode] 拆分失败:', err.message)
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
        content: segments[i],
        label: `拆分片段 ${i + 1}`,
        createdAt: Date.now(),
      } as any, { x: baseX, y: segY })
      canvasStore.addEdge(props.id, textNode.id, {})
    }
    canvasStore.endBatch()
    splitMessage.value = `已拆分为 ${segments.length} 个文本节点`
  } catch (err: any) {
    console.error('[V8LlmNode] 拆分失败:', err.message)
  } finally {
    isSplitting.value = false
  }
}

// ── 复制输出 ──
const handleCopyOutput = async () => {
  if (!outputContent.value) return
  try {
    await navigator.clipboard.writeText(outputContent.value)
  } catch { /* ignore */ }
}

// ── Handle menu select ──
const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0

  const defaultData: Record<string, any> = {
    imageGen: { modelId: 'gpt-image-2', size: '1024x1024', label: '文生图' },
    videoGen: { label: '视频生成' },
    text: { content: '', label: '文本输入' },
  }

  const newNode = canvasStore.addNodeWithData(
    item.type as any,
    defaultData[item.type] || {},
    { x: nodeX + 400, y: nodeY },
  )
  canvasStore.addEdge(props.id, newNode.id, {})
  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

// ── Label 编辑 ──
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
const cancelEditLabel = () => { isEditingLabel.value = false }

// ── 删除/复制 ──
const handleDelete = () => { canvasStore.deleteNode(props.id) }
const handleDuplicate = () => {
  const newNode = canvasStore.duplicateNode(props.id)
  if (newNode) setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

// ── 数据同步 ──
watch(() => props.data, (newData) => {
  if (newData?.systemPrompt !== undefined && newData.systemPrompt !== systemPrompt.value) {
    systemPrompt.value = newData.systemPrompt
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
})

onMounted(() => {
  if (!model.value || !agentStore.textModels.find(m => m.id === model.value)) {
    model.value = agentStore.textModels[0]?.id || 'claude-sonnet-4-6'
  }
  if (systemPromptRef.value) {
    if (props.data?.systemPrompt) systemPrompt.value = props.data.systemPrompt
    setEditableContent(systemPrompt.value)
  }
})
</script>

<style scoped>
.llm-node-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }

.llm-node {
  cursor: default; position: relative;
  background: var(--surface-alt); border-radius: var(--radius);
  border: 1px solid var(--border); min-width: 320px; max-width: 400px;
  transition: all 0.2s ease;
}
.llm-node-selected {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6, 0 4px 16px color-mix(in srgb, #8b5cf6 20%, transparent);
}

/* Header */
.llm-node-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--border);
  background: linear-gradient(90deg, color-mix(in srgb, #8b5cf6 10%, transparent), transparent);
}
.llm-header-left { display: flex; align-items: center; gap: 6px; }
.llm-header-icon { font-size: 16px; color: #8b5cf6; }
.llm-header-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.llm-header-label:hover { background: var(--surface); }
.llm-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #8b5cf6; width: 120px; }
.llm-header-actions { display: flex; align-items: center; gap: 2px; }
.llm-action-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; align-items: center; }
.llm-action-btn:hover { background: var(--surface); color: var(--ink); }
.llm-action-btn .mso { font-size: 14px; }

/* Body */
.llm-node-body { padding: 12px; display: flex; flex-direction: column; gap: 12px; }

/* Field */
.llm-field { position: relative; }
.llm-field-label { font-size: 11px; color: var(--ink2); margin-bottom: 4px; display: block; }

/* Editor */
.editor-content {
  min-height: 60px; max-height: 120px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface); color: var(--ink);
  font-size: 14px; line-height: 1.6; outline: none;
  overflow-y: auto; word-break: break-word; white-space: pre-wrap;
  font-family: var(--jc-font-body);
}
.editor-content:focus { border-color: #8b5cf6; }
.editor-content:empty::before { content: attr(data-placeholder); color: var(--ink3); opacity: 0.5; }

/* Select */
.llm-select {
  width: 100%; padding: 6px 8px; font-size: 13px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--ink);
  outline: none; cursor: pointer; font-family: var(--jc-font-body);
}
.llm-select:focus { border-color: #8b5cf6; }

/* Generate button */
.llm-generate-btn {
  width: 100%; padding: 8px; font-size: 13px; border-radius: 8px;
  background: #8b5cf6; color: #fff; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: background 0.15s; font-family: var(--jc-font-body);
}
.llm-generate-btn:hover:not(:disabled) { background: #7c3aed; }
.llm-generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.llm-generate-btn .mso { font-size: 14px; }

/* Output */
.llm-output { margin-top: 4px; }
.llm-output-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.llm-copy-btn {
  font-size: 11px; color: var(--ink2); background: none; border: none;
  cursor: pointer; display: flex; align-items: center; gap: 2px;
  font-family: var(--jc-font-body);
}
.llm-copy-btn:hover { color: #8b5cf6; }
.llm-copy-btn .mso { font-size: 12px; }
.llm-output-content {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px; max-height: 150px; overflow-y: auto;
}
.llm-output-content pre { font-size: 12px; color: var(--ink); white-space: pre-wrap; margin: 0; font-family: var(--jc-font-body); }

/* Split */
.llm-split-actions { display: flex; gap: 8px; margin-top: 8px; }
.llm-split-btn {
  flex: 1; padding: 6px; font-size: 11px; border-radius: 8px;
  background: transparent; color: #8b5cf6; border: 1px solid #8b5cf6;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
  transition: background 0.15s; font-family: var(--jc-font-body);
}
.llm-split-btn:hover:not(:disabled) { background: color-mix(in srgb, #8b5cf6 10%, transparent); }
.llm-split-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.llm-split-btn .mso { font-size: 12px; }
.llm-split-msg { font-size: 11px; color: var(--olive-dark); margin-top: 4px; }

/* Handle */
.llm-target-handle { background: #8b5cf6 !important; }

/* Spinner */
.v8-spinner {
  width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%;
  animation: v8-spin 0.6s linear infinite; display: inline-block;
}
@keyframes v8-spin { to { transform: rotate(360deg); } }
</style>
