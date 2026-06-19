<template>
  <div class="ig-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="ig-card" :class="data.selected ? 'ig-selected' : ''">
      <!-- Header with gradient -->
      <div class="ig-header">
        <div class="ig-header-left">
          <span class="mso ig-header-icon">image</span>
          <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="ig-label" title="双击编辑名称">{{ data.label || '图片生成' }}</span>
          <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="ig-label-input" />
        </div>
        <div class="ig-header-actions">
          <button @click="handleDuplicate" class="ig-btn" title="复制"><span class="mso">content_copy</span></button>
          <button @click="handleDelete" class="ig-btn" title="删除"><span class="mso">delete</span></button>
        </div>
      </div>

      <div class="ig-body">
        <!-- Model -->
        <div class="ig-row">
          <span class="ig-field">模型</span>
          <select v-model="localModelId" class="ig-select" @change="updateConfig">
            <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>

        <!-- Size -->
        <div class="ig-row">
          <span class="ig-field">尺寸</span>
          <select v-model="localSize" class="ig-select" @change="updateConfig">
            <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <!-- Connection badges -->
        <div class="ig-badges">
          <span class="ig-badge" :class="hasPrompt ? 'ig-badge-on' : 'ig-badge-off'">
            <span class="ig-badge-dot"></span>提示词 {{ hasPrompt ? '✓' : '○' }}
          </span>
          <span class="ig-badge ig-badge-off">
            <span class="ig-badge-dot"></span>参考图 ○
          </span>
        </div>

        <!-- Generate -->
        <button @click="handleGenerate" :disabled="isGenerating" class="ig-gen">
          <span v-if="isGenerating" class="spinner"></span>
          <span v-else class="mso" style="font-size:14px">auto_awesome</span>
          {{ isGenerating ? '生成中...' : '生成图片' }}
        </button>

        <div v-if="errorMsg" class="ig-error">{{ errorMsg }}</div>
      </div>

      <Handle type="target" :position="Position.Left" id="left" class="ig-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="imageGen" :operations="operations" @select="handleSelect" />
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

const props = defineProps<{ id: string; data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const { updateNodeInternals } = useVueFlow()

const isApiConfigured = computed(() => !!getApiKey())
const imageModels = computed(() => agentStore.imageModels)

const showHandleMenu = ref(false)
const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const isGenerating = ref(false); const errorMsg = ref('')

const localModelId = ref(props.data?.modelId || agentStore.imageModels[0]?.id || 'gpt-image-2')
const localSize = ref(props.data?.size || '1024x1024')
const sizeOptions = ['1024x1024', '1792x1024', '1024x1792', '512x512']

const hasPrompt = computed(() => canvasStore.edges.some(e => e.target === props.id))

const operations: NodeHandleOperation[] = [
  { type: 'imageResult', label: '图片结果', icon: 'image' },
  { type: 'videoGen', label: '生视频', icon: 'movie' },
]

const handleGenerate = async () => {
  if (!isApiConfigured.value) { errorMsg.value = '请先配置 API Key'; return }
  isGenerating.value = true; errorMsg.value = ''
  try {
    const cfg = await resolveApiConfig()
    const prompt = getPrompt()
    const body = JSON.stringify({ model: localModelId.value, prompt: prompt || 'a beautiful image', n: 1, size: localSize.value })
    const res = await safeFetch(`${cfg.apiBase}/v1/images/generations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body,
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = await res.json()
    const imgUrl = json.data?.[0]?.url || json.url
    if (imgUrl) {
      canvasStore.updateNodeData(props.id, { resultUrl: imgUrl })
      const cn = canvasStore.nodes.find(n => n.id === props.id)
      canvasStore.addNodeWithData('imageResult', { url: imgUrl, label: '生成结果', modelId: localModelId.value } as any, { x: (cn?.position?.x || 0) + 380, y: cn?.position?.y || 0 })
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
const updateConfig = () => { if (ut) clearTimeout(ut); ut = setTimeout(() => canvasStore.updateNodeData(props.id, { modelId: localModelId.value, size: localSize.value }), 150) }

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

watch(() => props.data?.modelId, v => { if (v) localModelId.value = v })
watch(() => props.data?.size, v => { if (v) localSize.value = v })
</script>

<style scoped>
.ig-wrapper { padding-right: 50px; padding-top: 20px; position: relative; min-width: 280px; }
.ig-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); transition: all 0.2s; }
.ig-selected { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6, 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent); }

.ig-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); background: linear-gradient(90deg, color-mix(in srgb, #3b82f6 8%, transparent), transparent); }
.ig-header-left { display: flex; align-items: center; gap: 6px; }
.ig-header-icon { font-size: 16px; color: #3b82f6; }
.ig-label { font-size: 13px; font-weight: 500; color: var(--ink2); cursor: text; padding: 0 4px; border-radius: 4px; }
.ig-label:hover { background: var(--surface); }
.ig-label-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #3b82f6; width: 100px; }
.ig-header-actions { display: flex; gap: 2px; }
.ig-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.ig-btn:hover { background: var(--surface); color: var(--ink); }
.ig-btn .mso { font-size: 14px; }

.ig-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.ig-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ig-field { font-size: 12px; color: var(--ink2); white-space: nowrap; }
.ig-select { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); outline: none; font-family: var(--jc-font-body); max-width: 160px; cursor: pointer; }
.ig-select:focus { border-color: #3b82f6; }

.ig-badges { display: flex; gap: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
.ig-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 8px; border-radius: 999px; }
.ig-badge-on { background: color-mix(in srgb, #22c55e 15%, transparent); color: #16a34a; }
.ig-badge-off { background: var(--surface); color: var(--ink3); }
.ig-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
.ig-badge-on .ig-badge-dot { background: #22c55e; }
.ig-badge-off .ig-badge-dot { background: var(--ink3); }

.ig-gen { width: 100%; padding: 8px; font-size: 13px; border-radius: 8px; background: #3b82f6; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--jc-font-body); transition: background 0.15s; }
.ig-gen:hover:not(:disabled) { background: #2563eb; }
.ig-gen:disabled { opacity: 0.5; cursor: not-allowed; }
.ig-error { font-size: 11px; color: #ef4444; }
.ig-handle { background: #3b82f6 !important; }

.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
