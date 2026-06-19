<template>
  <div class="ign-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="ign-card" :class="data.selected ? 'ign-selected' : ''">
      <div class="ign-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="ign-header-label" title="双击编辑名称">{{ data.label || '图片生成' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="ign-header-input" />
        <div class="ign-header-actions">
          <button @click="handleDuplicate" class="ign-action-btn" title="复制"><span class="mso" style="font-size:14px">content_copy</span></button>
          <button @click="handleDelete" class="ign-action-btn" title="删除"><span class="mso" style="font-size:14px">delete</span></button>
        </div>
      </div>
      <div class="ign-body">
        <div class="ign-row">
          <span class="ign-row-label">模型</span>
          <select v-model="localModel" class="ign-select" @change="onModelChange">
            <option v-for="m in imageModelList" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
        <div v-if="sizeOpts.length > 0" class="ign-row">
          <span class="ign-row-label">尺寸</span>
          <select v-model="localSize" class="ign-select" @change="updateConfig">
            <option v-for="s in sizeOpts" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="ign-badges">
          <span class="ign-badge" :class="hasPrompt ? 'ign-badge-on' : 'ign-badge-off'"><span class="ign-badge-dot"></span>提示词 {{ hasPrompt ? '✓' : '○' }}</span>
          <span class="ign-badge ign-badge-off"><span class="ign-badge-dot"></span>参考图 ○</span>
        </div>
        <button @click="handleGenerate" :disabled="loading || !isConfigured" class="ign-gen-btn">
          <span v-if="loading" class="ign-spinner"></span>
          <span v-else class="mso" style="font-size:14px">auto_awesome</span>
          {{ loading ? '生成中...' : '生成图片' }}
        </button>
        <div v-if="error" class="ign-error">{{ error }}</div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="ign-target-handle" />
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
import { safeFetch } from '@/utils/httpClient'
import { resolveApiConfig } from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'
import { getSizeOptions, type CreationModel } from '@/data/creationModels'
import { CREATION_PANEL_MODELS } from '@/composables/useCreation'

const props = defineProps<{ id: string; data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { updateNodeInternals } = useVueFlow()
const isConfigured = computed(() => !!getApiKey())

// 用创作面板同款模型列表 — 只显示 CREATION_PANEL_MODELS 中已有的
const imageModelList = computed(() =>
  Object.entries(CREATION_PANEL_MODELS)
    .filter(([, m]) => (m as CreationModel).tasks?.includes('image'))
    .map(([key, m]) => ({ id: key, label: m.label }))
)

const showHandleMenu = ref(false)
const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const loading = ref(false); const error = ref('')

const localModel = ref(props.data?.modelId || imageModelList.value[0]?.id || '')
const localSize = ref(props.data?.size || '')

const currentModel = computed<CreationModel | undefined>(() => CREATION_PANEL_MODELS[localModel.value])

const sizeOpts = computed(() => {
  if (!currentModel.value) return []
  return getSizeOptions(currentModel.value)
})

const hasPrompt = computed(() => canvasStore.edges.some(e => e.target === props.id))
const operations: NodeHandleOperation[] = [
  { type: 'imageResult', label: '图片结果', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
]

function onModelChange() {
  const m = currentModel.value
  if (m?.defSize) localSize.value = m.defSize
  else if (sizeOpts.value.length > 0) localSize.value = sizeOpts.value[0]
  else localSize.value = ''
  updateConfig()
}

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
      return props.data?.prompt || 'a beautiful image'
    })()
    const body = JSON.stringify({ model: localModel.value, prompt, n: 1, size: localSize.value || undefined })
    const res = await safeFetch(`${cfg.apiBase}/v1/images/generations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body,
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json(); const url = json.data?.[0]?.url || json.url
    if (url) {
      canvasStore.updateNodeData(props.id, { resultUrl: url })
      const cn = canvasStore.nodes.find(n => n.id === props.id)
      canvasStore.addNodeWithData('imageResult', { url, label: '生成结果', modelId: localModel.value } as any, { x: (cn?.position?.x || 0) + 380, y: cn?.position?.y || 0 })
    }
  } catch (err: any) { error.value = err.message } finally { loading.value = false }
}

let ut: any = null
const updateConfig = () => { if (ut) clearTimeout(ut); ut = setTimeout(() => canvasStore.updateNodeData(props.id, { modelId: localModel.value, size: localSize.value }), 150) }

const handleSelect = (item: NodeHandleOperation) => {
  const cn = canvasStore.nodes.find(n => n.id === props.id)
  const n = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, { x: (cn?.position?.x || 0) + 380, y: cn?.position?.y || 0 })
  canvasStore.addEdge(props.id, n.id, {}); setTimeout(() => updateNodeInternals([n.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.ign-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.ign-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 300px; transition: all 0.2s; }
.ign-selected { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6, 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent); }
.ign-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.ign-header-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.ign-header-label:hover { background: var(--surface); }
.ign-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #3b82f6; }
.ign-header-actions { display: flex; gap: 4px; }
.ign-action-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.ign-action-btn:hover { background: var(--surface); color: var(--ink); }
.ign-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.ign-row { display: flex; align-items: center; justify-content: space-between; }
.ign-row-label { font-size: 12px; color: var(--ink2); }
.ign-select { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; cursor: pointer; font-family: var(--jc-font-body); max-width: 180px; }
.ign-select:focus { border-color: #3b82f6; }
.ign-badges { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.ign-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 10px; border-radius: 999px; }
.ign-badge-on { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.ign-badge-off { background: var(--surface); color: var(--ink3); }
.ign-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
.ign-badge-on .ign-badge-dot { background: #22c55e; }
.ign-badge-off .ign-badge-dot { background: var(--ink3); }
.ign-gen-btn { width: 100%; padding: 10px; font-size: 13px; border-radius: 8px; background: #3b82f6; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--jc-font-body); transition: background 0.15s; }
.ign-gen-btn:hover:not(:disabled) { background: #2563eb; }
.ign-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ign-error { font-size: 11px; color: #ef4444; }
.ign-target-handle { background: #3b82f6 !important; }
.ign-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: ign-spin 0.6s linear infinite; display: inline-block; }
@keyframes ign-spin { to { transform: rotate(360deg); } }
</style>
