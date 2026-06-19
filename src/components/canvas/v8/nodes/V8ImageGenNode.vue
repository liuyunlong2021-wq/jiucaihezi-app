<template>
  <div class="node-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="node-card" :class="data.selected ? 'node-selected' : ''">
      <!-- Header -->
      <div class="node-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="node-label" title="双击编辑名称">{{ data.label || '文生图' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="node-label-input" />
        <div class="node-actions">
          <button @click="handleDuplicate" class="node-btn" title="复制"><span class="mso">content_copy</span></button>
          <button @click="handleDelete" class="node-btn" title="删除"><span class="mso">delete</span></button>
        </div>
      </div>

      <div class="node-body">
        <!-- Model -->
        <div class="field-row">
          <span class="field-label">模型</span>
          <select v-model="localModelId" class="field-select" @change="updateConfig">
            <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
          </select>
        </div>

        <!-- Size -->
        <div v-if="hasSizeOptions" class="field-row">
          <span class="field-label">尺寸</span>
          <select v-model="localSize" class="field-select" @change="updateConfig">
            <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <!-- Connected inputs -->
        <div class="field-badges">
          <span class="badge" :class="connectedPrompts.length ? 'badge-ok' : 'badge-empty'">提示词 {{ connectedPrompts.length || '○' }}</span>
        </div>

        <!-- Generate -->
        <button @click="handleGenerate" :disabled="isGenerating" class="generate-btn">
          <span v-if="isGenerating" class="v8-spinner"></span>
          <span v-else class="mso">auto_awesome</span>
          {{ isGenerating ? '生成中...' : '生成图片' }}
        </button>

        <!-- Error -->
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
      </div>

      <Handle type="target" :position="Position.Left" id="left" class="target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="imageGen" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
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

const isApiConfigured = computed(() => !!getApiKey())
const imageModels = computed(() => agentStore.imageModels)

const showHandleMenu = ref(false)
const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)
const isGenerating = ref(false)
const errorMsg = ref('')

const localModelId = ref(props.data?.modelId || agentStore.imageModels[0]?.id || 'gpt-image-2')
const localSize = ref(props.data?.size || '1024x1024')
const sizeOptions = ['1024x1024', '1792x1024', '1024x1792', '512x512']
const hasSizeOptions = computed(() => true)

const operations: NodeHandleOperation[] = [
  { type: 'imageResult', label: '图片结果', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
]

const connectedPrompts = computed(() => {
  return canvasStore.edges.filter(e => e.target === props.id && e.sourceHandle !== 'right-ref')
})

const handleGenerate = async () => {
  if (!isApiConfigured.value) { errorMsg.value = '请先配置 API Key'; return }
  isGenerating.value = true; errorMsg.value = ''
  try {
    const cfg = await resolveApiConfig()
    const prompt = getInputPrompt()
    const body = JSON.stringify({
      model: localModelId.value,
      prompt: prompt || 'a beautiful image',
      n: 1,
      size: localSize.value,
    })
    const res = await safeFetch(`${cfg.apiBase}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body,
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json()
    const imgUrl = json.data?.[0]?.url || json.url
    if (imgUrl) {
      canvasStore.updateNodeData(props.id, { resultUrl: imgUrl })
      // Create result node
      const currentNode = canvasStore.nodes.find(n => n.id === props.id)
      const pos = { x: (currentNode?.position?.x || 0) + 380, y: currentNode?.position?.y || 0 }
      canvasStore.addNodeWithData('imageResult', { url: imgUrl, label: '生成结果', modelId: localModelId.value } as any, pos)
    }
  } catch (err: any) { errorMsg.value = err.message } finally { isGenerating.value = false }
}

const getInputPrompt = (): string => {
  const incomingEdges = canvasStore.edges.filter(e => e.target === props.id)
  for (const edge of incomingEdges) {
    const src = canvasStore.nodes.find(n => n.id === edge.source)
    if (src?.type === 'text' && (src.data as any)?.content) return (src.data as any).content
    if (src?.type === 'llm' && (src.data as any)?.outputContent) return (src.data as any).outputContent
  }
  return props.data?.prompt || ''
}

let updateTimer: any = null
const updateConfig = () => {
  if (updateTimer) clearTimeout(updateTimer)
  updateTimer = setTimeout(() => {
    canvasStore.updateNodeData(props.id, { modelId: localModelId.value, size: localSize.value })
  }, 150)
}

const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const newNode = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, {
    x: (currentNode?.position?.x || 0) + 380, y: currentNode?.position?.y || 0,
  })
  canvasStore.addEdge(props.id, newNode.id, {})
  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }

watch(() => props.data?.modelId, (v) => { if (v) localModelId.value = v })
watch(() => props.data?.size, (v) => { if (v) localSize.value = v })
</script>

<style scoped>
.node-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.node-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 280px; transition: all 0.2s; }
.node-selected { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6, 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent); }
.node-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.node-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.node-label:hover { background: var(--surface); }
.node-label-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #3b82f6; width: 100px; }
.node-actions { display: flex; gap: 2px; }
.node-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.node-btn:hover { background: var(--surface); color: var(--ink); }
.node-btn .mso { font-size: 14px; }
.node-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.field-row { display: flex; align-items: center; justify-content: space-between; }
.field-label { font-size: 11px; color: var(--ink2); }
.field-select { padding: 4px 6px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; font-family: var(--jc-font-body); max-width: 160px; }
.field-badges { display: flex; gap: 6px; padding-top: 4px; border-top: 1px solid var(--border); }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.badge-ok { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.badge-empty { background: var(--surface); color: var(--ink3); }
.generate-btn { width: 100%; padding: 8px; font-size: 13px; border-radius: 8px; background: #3b82f6; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--jc-font-body); }
.generate-btn:hover:not(:disabled) { background: #2563eb; }
.generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.generate-btn .mso { font-size: 14px; }
.error-msg { font-size: 11px; color: #ef4444; }
.target-handle { background: #3b82f6 !important; }
.v8-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: v8-spin 0.6s linear infinite; display: inline-block; }
@keyframes v8-spin { to { transform: rotate(360deg); } }
</style>
