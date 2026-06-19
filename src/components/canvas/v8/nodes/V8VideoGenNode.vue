<template>
  <div class="vgn-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="vgn-card" :class="data.selected ? 'vgn-selected' : ''">
      <div class="vgn-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="vgn-header-label" title="双击编辑名称">{{ data.label || '视频生成' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="vgn-header-input" />
        <div class="vgn-header-actions">
          <button @click="handleDuplicate" class="vgn-action-btn" title="复制"><span class="mso" style="font-size:14px">content_copy</span></button>
          <button @click="handleDelete" class="vgn-action-btn" title="删除"><span class="mso" style="font-size:14px">delete</span></button>
        </div>
      </div>
      <div class="vgn-body">
        <div class="vgn-row"><span class="vgn-row-label">模型</span><select v-model="localModel" class="vgn-select" @change="updateConfig"><option v-for="m in agentStore.videoModels" :key="m.id" :value="m.id">{{ m.label }}</option></select></div>
        <div class="vgn-row"><span class="vgn-row-label">比例</span><select v-model="localRatio" class="vgn-select" @change="updateConfig"><option v-for="r in ratios" :key="r" :value="r">{{ r }}</option></select></div>
        <div class="vgn-row"><span class="vgn-row-label">时长</span><select v-model="localDuration" class="vgn-select" @change="updateConfig"><option v-for="d in durations" :key="d" :value="d">{{ d }}s</option></select></div>
        <div class="vgn-badges">
          <span class="vgn-badge" :class="hasPrompt ? 'vgn-badge-on' : 'vgn-badge-off'"><span class="vgn-badge-dot"></span>提示词 {{ hasPrompt ? '✓' : '○' }}</span>
        </div>
        <button @click="handleGenerate" :disabled="loading || !isConfigured" class="vgn-gen-btn">
          <span v-if="loading" class="vgn-spinner"></span>
          <span v-else class="mso" style="font-size:14px">movie</span>
          {{ loading ? '生成中...' : '生成视频' }}
        </button>
        <div v-if="error" class="vgn-error">{{ error }}</div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="vgn-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="videoGen" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { safeFetch } from '@/utils/httpClient'
import { resolveApiConfig } from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'
import { RH_CREATION_MODELS, getAspectOptions } from '@/data/creationModels'

const props = defineProps<{ id: string; data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const { updateNodeInternals } = useVueFlow()

const isConfigured = computed(() => !!getApiKey())
const showHandleMenu = ref(false)
const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const loading = ref(false); const error = ref('')

const localModel = ref(props.data?.modelId || agentStore.videoModels[0]?.id || 'veo3.1-fast')
const localRatio = ref(props.data?.ratio || '16:9')
const localDuration = ref(props.data?.duration || 5)

// 从创作面板模型注册表动态获取参数选项

// 与创作面板同款参数
const ratios = computed(() => {
  const model = RH_CREATION_MODELS[localModel.value]
  if (!model) return ['16:9', '9:16', '1:1']
  const ar = getAspectOptions(model, 'video')
  return ar.length > 0 ? ar : ['16:9', '9:16', '1:1']
})
const durations = computed(() => {
  const model = RH_CREATION_MODELS[localModel.value]
  if (!model) return [4, 5, 8]
  return (model.dur && model.dur.length > 0) ? model.dur : [4, 5, 8]
})

// 模型切换时重置参数为默认值
watch(localModel, () => {
  const spec = RH_CREATION_MODELS[localModel.value]
  if (spec?.defAr) localRatio.value = spec.defAr
  else if (ratios.value.length > 0) localRatio.value = ratios.value[0]
  if (spec?.defDur && spec.defDur > 0) localDuration.value = spec.defDur
  else if (durations.value.length > 0) localDuration.value = durations.value[0]
  updateConfig()
})

const hasPrompt = computed(() => canvasStore.edges.some(e => e.target === props.id))

const operations: NodeHandleOperation[] = [{ type: 'videoResult', label: '视频结果', icon: 'movie' }]

const handleGenerate = async () => {
  if (!isConfigured.value) { error.value = '请先配置 API Key'; return }
  loading.value = true; error.value = ''
  try {
    const cfg = await resolveApiConfig()
    const prompt = (() => {
      for (const e of canvasStore.edges.filter(e => e.target === props.id)) {
        const s = canvasStore.nodes.find(n => n.id === e.source)
        if (s?.type === 'text' && (s.data as any)?.content) return (s.data as any).content
        if (s?.type === 'llm' && (s.data as any)?.outputContent) return (s.data as any).outputContent
      }
      return props.data?.prompt || 'a beautiful video'
    })()
    const body = JSON.stringify({ model: localModel.value, prompt, ratio: localRatio.value, duration: localDuration.value })
    const res = await safeFetch(`${cfg.apiBase}/v1/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json(); const url = json.url || json.data?.url
    if (url) {
      canvasStore.updateNodeData(props.id, { resultUrl: url })
      const cn = canvasStore.nodes.find(n => n.id === props.id)
      canvasStore.addNodeWithData('videoResult', { url, label: '视频结果', modelId: localModel.value } as any, { x: (cn?.position?.x || 0) + 420, y: cn?.position?.y || 0 })
    }
  } catch (err: any) { error.value = err.message } finally { loading.value = false }
}

let ut: any = null
const updateConfig = () => { if (ut) clearTimeout(ut); ut = setTimeout(() => canvasStore.updateNodeData(props.id, { modelId: localModel.value, ratio: localRatio.value, duration: localDuration.value }), 150) }

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
.vgn-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.vgn-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 300px; transition: all 0.2s; }
.vgn-selected { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b, 0 4px 16px color-mix(in srgb, #f59e0b 20%, transparent); }
.vgn-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.vgn-header-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.vgn-header-label:hover { background: var(--surface); }
.vgn-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #f59e0b; }
.vgn-header-actions { display: flex; gap: 4px; }
.vgn-action-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.vgn-action-btn:hover { background: var(--surface); color: var(--ink); }
.vgn-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.vgn-row { display: flex; align-items: center; justify-content: space-between; }
.vgn-row-label { font-size: 12px; color: var(--ink2); }
.vgn-select { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; cursor: pointer; font-family: var(--jc-font-body); max-width: 140px; }
.vgn-select:focus { border-color: #f59e0b; }
.vgn-badges { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.vgn-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 10px; border-radius: 999px; }
.vgn-badge-on { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.vgn-badge-off { background: var(--surface); color: var(--ink3); }
.vgn-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
.vgn-badge-on .vgn-badge-dot { background: #22c55e; }
.vgn-badge-off .vgn-badge-dot { background: var(--ink3); }
.vgn-gen-btn { width: 100%; padding: 10px; font-size: 13px; border-radius: 8px; background: #f59e0b; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--jc-font-body); transition: background 0.15s; }
.vgn-gen-btn:hover:not(:disabled) { background: #d97706; }
.vgn-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.vgn-error { font-size: 11px; color: #ef4444; }
.vgn-target-handle { background: #f59e0b !important; }
.vgn-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: vgn-spin 0.6s linear infinite; display: inline-block; }
@keyframes vgn-spin { to { transform: rotate(360deg); } }
</style>
