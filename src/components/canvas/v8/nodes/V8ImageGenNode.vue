<template>
  <!-- Image config node wrapper | 文生图配置节点包裹层 -->
  <div class="ign-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <!-- Image config node | 文生图配置节点 -->
    <div
      class="ign-card"
      :class="data.selected ? 'ign-selected' : ''">
      <!-- Header | 头部 -->
      <div class="ign-header">
        <span
          v-if="!isEditingLabel"
          @dblclick="startEditLabel"
          class="ign-header-label"
          title="双击编辑名称"
        >{{ data.label || '图片生成' }}</span>
        <input
          v-else
          ref="labelInputRef"
          v-model="editingLabelValue"
          @blur="finishEditLabel"
          @keydown.enter="finishEditLabel"
          @keydown.escape="cancelEditLabel"
          class="ign-header-input"
        />
        <div class="ign-header-actions">
          <button @click="handleDuplicate" class="ign-action-btn" title="复制节点">
            <span class="mso" style="font-size:14px">content_copy</span>
          </button>
          <button @click="handleDelete" class="ign-action-btn" title="删除节点">
            <span class="mso" style="font-size:14px">delete</span>
          </button>
        </div>
      </div>

      <!-- Config options | 配置选项 -->
      <div class="ign-body">
        <!-- Model selector | 模型选择 -->
        <div class="ign-row">
          <span class="ign-row-label">模型</span>
          <select v-model="localModel" class="ign-select" @change="updateConfig">
            <option v-for="m in agentStore.imageModels" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>

        <!-- Size selector | 尺寸选择 -->
        <div class="ign-row">
          <span class="ign-row-label">尺寸</span>
          <select v-model="localSize" class="ign-select" @change="updateConfig">
            <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <!-- Connected inputs indicator | 连接输入指示 -->
        <div class="ign-badges">
          <span class="ign-badge" :class="connectedPrompts.length ? 'ign-badge-on' : 'ign-badge-off'">
            <span class="ign-badge-dot"></span>
            提示词 {{ connectedPrompts.length ? '✓' : '○' }}
          </span>
          <span class="ign-badge ign-badge-off">
            <span class="ign-badge-dot"></span>
            参考图 ○
          </span>
        </div>

        <!-- Generate button | 生成按钮 -->
        <button @click="handleGenerate" :disabled="loading || !isConfigured" class="ign-gen-btn">
          <span v-if="loading" class="ign-spinner"></span>
          <span v-else class="mso" style="font-size:14px">auto_awesome</span>
          {{ loading ? '生成中...' : '生成图片' }}
        </button>

        <!-- Error message | 错误信息 -->
        <div v-if="error" class="ign-error">
          {{ error }}
        </div>
      </div>

      <!-- Handles | 连接点 -->
      <Handle type="target" :position="Position.Left" id="left" class="ign-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="imageGen" :visible="showHandleMenu" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Image config node component | 文生图配置节点组件
 * 移植自 huobao-canvas ImageConfigNode.vue — 结构一致
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { safeFetch } from '@/utils/httpClient'
import { resolveApiConfig } from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'
import { RH_CREATION_MODELS, getSizeOptions } from '@/data/creationModels'

const props = defineProps<{ id: string; data: Record<string, any> }>()

const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const { updateNodeInternals } = useVueFlow()

// API config state | API 配置状态
const isConfigured = computed(() => !!getApiKey())

// Local state | 本地状态
const showHandleMenu = ref(false)
const localModel = ref(props.data?.modelId || agentStore.imageModels[0]?.id || 'gpt-image-2')
const localSize = ref(props.data?.size || '1024x1024')

// 从创作面板模型注册表动态获取参数选项

// 与创作面板同款参数 — 通过 getSizeOptions() 获取模型专属尺寸
const sizeOptions = computed(() => {
  const model = RH_CREATION_MODELS[localModel.value]
  if (!model) return ['1024x1024', '1792x1024', '1024x1792', '512x512']
  const sizes = getSizeOptions(model)
  return sizes.length > 0 ? sizes : ['1024x1024']
})

const loading = ref(false)
const error = ref('')

// 模型切换时重置尺寸为默认值
watch(localModel, () => {
  const spec = RH_CREATION_MODELS[localModel.value]
  if (spec?.defSize) localSize.value = spec.defSize
  else if (sizeOptions.value.length > 0) localSize.value = sizeOptions.value[0]
  updateConfig()
})

// Label editing state | Label 编辑状态
const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)

// Operations
const operations: NodeHandleOperation[] = [
  { type: 'imageResult', label: '图片结果', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
]

// Connected inputs
const connectedPrompts = computed(() => {
  return canvasStore.edges.filter(e => e.target === props.id)
})

// Handle menu select | 处理菜单选择
const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0

  const newNode = canvasStore.addNodeWithData(
    item.type as any,
    { label: item.label } as any,
    { x: nodeX + 400, y: nodeY }
  )
  canvasStore.addEdge(props.id, newNode.id, {})
  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

// Get input from connections
const getInputPrompt = (): string => {
  const incomingEdges = canvasStore.edges.filter(e => e.target === props.id)
  for (const edge of incomingEdges) {
    const sourceNode = canvasStore.nodes.find(n => n.id === edge.source)
    if (sourceNode) {
      if (sourceNode.type === 'text' && (sourceNode.data as any)?.content) {
        return (sourceNode.data as any).content
      }
      if (sourceNode.type === 'llm' && (sourceNode.data as any)?.outputContent) {
        return (sourceNode.data as any).outputContent
      }
    }
  }
  return props.data?.prompt || ''
}

// Handle generate | 处理生成
const handleGenerate = async () => {
  if (!isConfigured.value) {
    error.value = '请先配置 API Key'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const cfg = await resolveApiConfig()
    const prompt = getInputPrompt()
    const body = JSON.stringify({
      model: localModel.value,
      prompt: prompt || 'a beautiful image',
      n: 1,
      size: localSize.value,
    })

    const res = await safeFetch(`${cfg.apiBase}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body,
    })

    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json()
    const imgUrl = json.data?.[0]?.url || json.url

    if (imgUrl) {
      canvasStore.updateNodeData(props.id, { resultUrl: imgUrl })

      // Auto-create result node
      const currentNode = canvasStore.nodes.find(n => n.id === props.id)
      canvasStore.addNodeWithData('imageResult', {
        url: imgUrl,
        label: '生成结果',
        modelId: localModel.value,
        createdAt: Date.now(),
      } as any, {
        x: (currentNode?.position?.x || 0) + 380,
        y: currentNode?.position?.y || 0,
      })
    }
  } catch (err: any) {
    error.value = err.message || '生成失败'
  } finally {
    loading.value = false
  }
}

// Update config | 更新配置
let updateTimer: ReturnType<typeof setTimeout> | null = null
const updateConfig = () => {
  if (updateTimer) clearTimeout(updateTimer)
  updateTimer = setTimeout(() => {
    canvasStore.updateNodeData(props.id, {
      modelId: localModel.value,
      size: localSize.value,
    })
  }, 150)
}

// Initialize on mount | 挂载时初始化
onMounted(() => {
  if (!localModel.value || !agentStore.imageModels.find(m => m.id === localModel.value)) {
    localModel.value = agentStore.imageModels[0]?.id || 'gpt-image-2'
    updateConfig()
  }
})

// Label editing
const startEditLabel = () => {
  editingLabelValue.value = props.data?.label || ''
  isEditingLabel.value = true
  nextTick(() => {
    labelInputRef.value?.focus()
    labelInputRef.value?.select()
  })
}
const finishEditLabel = () => {
  const v = editingLabelValue.value.trim()
  if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v })
  isEditingLabel.value = false
}
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => {
  const n = canvasStore.duplicateNode(props.id)
  if (n) setTimeout(() => updateNodeInternals([n.id]), 50)
}

watch(() => props.data?.modelId, v => { if (v) localModel.value = v })
watch(() => props.data?.size, v => { if (v) localSize.value = v })
</script>

<style scoped>
/* ─── 与火宝 ImageConfigNode.vue 结构一致 ─── */

.ign-wrapper {
  padding-right: 50px;
  padding-top: 20px;
  position: relative;
}

.ign-card {
  cursor: default;
  position: relative;
  background: var(--surface-alt);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  min-width: 300px;
  transition: all 0.2s ease;
}

.ign-selected {
  border-width: 1px;
  border-color: #3b82f6;
  box-shadow: 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent);
}

/* Header */
.ign-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.ign-header-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink2);
  cursor: text;
  padding: 0 4px;
  border-radius: 4px;
  transition: background 0.15s;
}
.ign-header-label:hover { background: var(--surface); }

.ign-header-input {
  font-size: 13px;
  font-weight: 500;
  background: var(--surface);
  color: var(--ink);
  padding: 0 4px;
  border-radius: 4px;
  outline: none;
  border: 1px solid #3b82f6;
}

.ign-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ign-action-btn {
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink3);
  transition: background 0.15s;
  display: flex;
}
.ign-action-btn:hover { background: var(--surface); color: var(--ink); }

/* Body */
.ign-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Row */
.ign-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ign-row-label {
  font-size: 12px;
  color: var(--ink2);
}

.ign-select {
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  outline: none;
  cursor: pointer;
  font-family: var(--jc-font-body);
  max-width: 180px;
}
.ign-select:focus { border-color: #3b82f6; }

/* Badges */
.ign-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.ign-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
}

.ign-badge-on {
  background: color-mix(in srgb, #22c55e 15%, transparent);
  color: #16a34a;
}

.ign-badge-off {
  background: var(--surface);
  color: var(--ink3);
}

.ign-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.ign-badge-on .ign-badge-dot { background: #22c55e; }
.ign-badge-off .ign-badge-dot { background: var(--ink3); }

/* Generate button */
.ign-gen-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  border-radius: 8px;
  background: #3b82f6;
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
.ign-gen-btn:hover:not(:disabled) { background: #2563eb; }
.ign-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Error */
.ign-error {
  font-size: 11px;
  color: #ef4444;
}

/* Target handle */
.ign-target-handle {
  background: #3b82f6 !important;
}

/* Spinner */
.ign-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ign-spin 0.6s linear infinite;
  display: inline-block;
}
@keyframes ign-spin { to { transform: rotate(360deg); } }
</style>
