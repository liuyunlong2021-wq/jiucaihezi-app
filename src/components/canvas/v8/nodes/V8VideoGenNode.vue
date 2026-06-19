<template>
  <div class="vg-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="vg-card" :class="data.selected ? 'vg-selected' : ''">
      <div class="vg-header">
        <div class="vg-header-left">
          <span class="mso vg-header-icon">movie</span>
          <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="vg-label" title="双击编辑名称">{{ data.label || '视频生成' }}</span>
          <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="vg-label-input" />
        </div>
        <div class="vg-header-actions">
          <button @click="handleDuplicate" class="vg-btn" title="复制"><span class="mso">content_copy</span></button>
          <button @click="handleDelete" class="vg-btn" title="删除"><span class="mso">delete</span></button>
        </div>
      </div>
      <div class="vg-body">
        <div class="vg-row"><span class="vg-field">模型</span><select v-model="localModelId" class="vg-select" @change="updateConfig"><option v-for="m in videoModels" :key="m.id" :value="m.id">{{ m.label }}</option></select></div>
        <div class="vg-row"><span class="vg-field">比例</span><select v-model="localRatio" class="vg-select" @change="updateConfig"><option v-for="r in ratioOptions" :key="r" :value="r">{{ r }}</option></select></div>
        <div class="vg-row"><span class="vg-field">时长</span><select v-model="localDuration" class="vg-select" @change="updateConfig"><option v-for="d in durationOptions" :key="d" :value="d">{{ d }}s</option></select></div>
        <div class="vg-badges">
          <span class="vg-badge" :class="hasPrompt ? 'vg-badge-on' : 'vg-badge-off'"><span class="vg-badge-dot"></span>提示词 {{ hasPrompt ? '✓' : '○' }}</span>
        </div>
        <button @click="handleGenerate" :disabled="isGenerating" class="vg-gen">
          <span v-if="isGenerating" class="spinner"></span>
          <span v-else class="mso" style="font-size:14px">movie</span>
          {{ isGenerating ? '生成中...' : '生成视频' }}
        </button>
        <div v-if="errorMsg" class="vg-error">{{ errorMsg }}</div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="vg-handle" />
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
const canvasStore = useCanvasStore(); const agentStore = useAgentStore(); const { updateNodeInternals } = useVueFlow()
const isApiConfigured = computed(() => !!getApiKey())
const videoModels = computed(() => agentStore.videoModels)
const showHandleMenu = ref(false); const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const isGenerating = ref(false); const errorMsg = ref('')
const localModelId = ref(props.data?.modelId || agentStore.videoModels[0]?.id || 'veo-3.1')
const localRatio = ref(props.data?.ratio || '16:9'); const localDuration = ref(props.data?.duration || 5)
const ratioOptions = ['16:9', '9:16', '1:1']; const durationOptions = [4, 5, 8, 10]
const hasPrompt = computed(() => canvasStore.edges.some(e => e.target === props.id))
const operations: NodeHandleOperation[] = [{ type: 'videoResult', label: '视频结果', icon: 'movie' }]

const handleGenerate = async () => {
  if (!isApiConfigured.value) { errorMsg.value = '请先配置 API Key'; return }
  isGenerating.value = true; errorMsg.value = ''
  try {
    const cfg = await resolveApiConfig()
    const prompt = getPrompt()
    const body = JSON.stringify({ model: localModelId.value, prompt: prompt || 'a beautiful video', ratio: localRatio.value, duration: localDuration.value })
    const res = await safeFetch(`${cfg.apiBase}/v1/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json(); const url = json.url || json.data?.url
    if (url) {
      canvasStore.updateNodeData(props.id, { resultUrl: url })
      const cn = canvasStore.nodes.find(n => n.id === props.id)
      canvasStore.addNodeWithData('videoResult', { url, label: '视频结果', modelId: localModelId.value } as any, { x: (cn?.position?.x || 0) + 420, y: cn?.position?.y || 0 })
    }
  } catch (err: any) { errorMsg.value = err.message } finally { isGenerating.value = false }
}

const getPrompt = (): string => {
  for (const e of canvasStore.edges.filter(e => e.target === props.id)) {
    const src = canvasStore.nodes.find(n => n.id === e.source)
    if (src?.type === 'text' && (src.data as any)?.content) return (src.data as any).content
    if (src?.type === 'llm' && (src.data as any)?.outputContent) return (src.data as any).outputContent
  }
  return props.data?.prompt || ''
}

let ut: any = null
const updateConfig = () => { if (ut) clearTimeout(ut); ut = setTimeout(() => canvasStore.updateNodeData(props.id, { modelId: localModelId.value, ratio: localRatio.value, duration: localDuration.value }), 150) }
const handleSelect = (item: NodeHandleOperation) => {
  const cn = canvasStore.nodes.find(n => n.id === props.id)
  const n = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, { x: (cn?.position?.x || 0) + 420, y: cn?.position?.y || 0 })
  canvasStore.addEdge(props.id, n.id, {}); setTimeout(() => updateNodeInternals([n.id]), 50)
}
const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.vg-wrapper { padding-right: 50px; padding-top: 20px; position: relative; min-width: 280px; }
.vg-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); transition: all 0.2s; }
.vg-selected { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b, 0 4px 16px color-mix(in srgb, #f59e0b 20%, transparent); }
.vg-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); background: linear-gradient(90deg, color-mix(in srgb, #f59e0b 8%, transparent), transparent); }
.vg-header-left { display: flex; align-items: center; gap: 6px; }
.vg-header-icon { font-size: 16px; color: #f59e0b; }
.vg-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.vg-label:hover { background: var(--surface); }
.vg-label-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #f59e0b; width: 100px; }
.vg-header-actions { display: flex; gap: 2px; }
.vg-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.vg-btn:hover { background: var(--surface); color: var(--ink); }
.vg-btn .mso { font-size: 14px; }
.vg-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.vg-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vg-field { font-size: 12px; color: var(--ink2); white-space: nowrap; }
.vg-select { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; font-family: var(--jc-font-body); max-width: 140px; cursor: pointer; }
.vg-select:focus { border-color: #f59e0b; }
.vg-badges { display: flex; gap: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
.vg-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 8px; border-radius: 999px; }
.vg-badge-on { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.vg-badge-off { background: var(--surface); color: var(--ink3); }
.vg-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
.vg-badge-on .vg-badge-dot { background: #22c55e; }
.vg-badge-off .vg-badge-dot { background: var(--ink3); }
.vg-gen { width: 100%; padding: 8px; font-size: 13px; border-radius: 8px; background: #f59e0b; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--jc-font-body); transition: background 0.15s; }
.vg-gen:hover:not(:disabled) { background: #d97706; }
.vg-gen:disabled { opacity: 0.5; cursor: not-allowed; }
.vg-error { font-size: 11px; color: #ef4444; }
.vg-handle { background: #f59e0b !important; }
.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
