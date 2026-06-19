<template>
  <div class="node-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="node-card" :class="data.selected ? 'node-selected' : ''">
      <div class="node-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="node-label" title="双击编辑名称">{{ data.label || '视频生成' }}</span>
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
            <option v-for="m in videoModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
          </select>
        </div>
        <!-- Ratio -->
        <div class="field-row">
          <span class="field-label">比例</span>
          <select v-model="localRatio" class="field-select" @change="updateConfig">
            <option v-for="r in ratioOptions" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <!-- Duration -->
        <div class="field-row">
          <span class="field-label">时长</span>
          <select v-model="localDuration" class="field-select" @change="updateConfig">
            <option v-for="d in durationOptions" :key="d" :value="d">{{ d }}s</option>
          </select>
        </div>
        <!-- Badges -->
        <div class="field-badges">
          <span class="badge" :class="connectedPrompt ? 'badge-ok' : 'badge-empty'">提示词 {{ connectedPrompt ? '✓' : '○' }}</span>
        </div>
        <!-- Generate -->
        <button @click="handleGenerate" :disabled="isGenerating" class="generate-btn">
          <span v-if="isGenerating" class="v8-spinner"></span>
          <span v-else class="mso">movie</span>
          {{ isGenerating ? '生成中...' : '生成视频' }}
        </button>
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="videoGen" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
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
const videoModels = computed(() => agentStore.videoModels)

const showHandleMenu = ref(false)
const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const isGenerating = ref(false); const errorMsg = ref('')

const localModelId = ref(props.data?.modelId || agentStore.videoModels[0]?.id || 'veo-3.1')
const localRatio = ref(props.data?.ratio || '16:9')
const localDuration = ref(props.data?.duration || 5)
const ratioOptions = ['16:9', '9:16', '1:1']
const durationOptions = [4, 5, 8, 10]

const connectedPrompt = computed(() => canvasStore.edges.some(e => e.target === props.id))

const operations: NodeHandleOperation[] = [
  { type: 'videoResult', label: '视频结果', icon: 'movie' },
]

const handleGenerate = async () => {
  if (!isApiConfigured.value) { errorMsg.value = '请先配置 API Key'; return }
  isGenerating.value = true; errorMsg.value = ''
  try {
    const cfg = await resolveApiConfig()
    const prompt = getInputPrompt()
    const body = JSON.stringify({
      model: localModelId.value, prompt: prompt || 'a beautiful video',
      ratio: localRatio.value, duration: localDuration.value,
    })
    const res = await safeFetch(`${cfg.apiBase}/v1/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body,
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json()
    const videoUrl = json.url || json.data?.url
    if (videoUrl) {
      canvasStore.updateNodeData(props.id, { resultUrl: videoUrl })
      const currentNode = canvasStore.nodes.find(n => n.id === props.id)
      canvasStore.addNodeWithData('videoResult', { url: videoUrl, label: '视频结果', modelId: localModelId.value } as any, {
        x: (currentNode?.position?.x || 0) + 420, y: currentNode?.position?.y || 0,
      })
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
    canvasStore.updateNodeData(props.id, { modelId: localModelId.value, ratio: localRatio.value, duration: localDuration.value })
  }, 150)
}

const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const newNode = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, {
    x: (currentNode?.position?.x || 0) + 420, y: currentNode?.position?.y || 0,
  })
  canvasStore.addEdge(props.id, newNode.id, {})
  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.node-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.node-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 280px; transition: all 0.2s; }
.node-selected { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b, 0 4px 16px color-mix(in srgb, #f59e0b 20%, transparent); }
.node-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.node-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.node-label:hover { background: var(--surface); }
.node-label-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #f59e0b; width: 100px; }
.node-actions { display: flex; gap: 2px; }
.node-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.node-btn:hover { background: var(--surface); color: var(--ink); }
.node-btn .mso { font-size: 14px; }
.node-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.field-row { display: flex; align-items: center; justify-content: space-between; }
.field-label { font-size: 11px; color: var(--ink2); }
.field-select { padding: 4px 6px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; font-family: var(--jc-font-body); max-width: 140px; }
.field-badges { display: flex; gap: 6px; padding-top: 4px; border-top: 1px solid var(--border); }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.badge-ok { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.badge-empty { background: var(--surface); color: var(--ink3); }
.generate-btn { width: 100%; padding: 8px; font-size: 13px; border-radius: 8px; background: #f59e0b; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--jc-font-body); }
.generate-btn:hover:not(:disabled) { background: #d97706; }
.generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.error-msg { font-size: 11px; color: #ef4444; }
.target-handle { background: #f59e0b !important; }
.v8-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: v8-spin 0.6s linear infinite; display: inline-block; }
@keyframes v8-spin { to { transform: rotate(360deg); } }
</style>
