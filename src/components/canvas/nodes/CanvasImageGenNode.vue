<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { getMediaModelsForTask, mediaFieldOptions } from '@/data/mediaModelCapabilities'
import { runCanvasNode } from '../runtime/canvasExecutor'
import type { CanvasImageGenNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasImageGenNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()
const imageModels = getMediaModelsForTask('image')

const connectedTexts = computed(() =>
  canvasStore.edges
    .filter(e => e.target === props.id)
    .filter(e => canvasStore.nodes.find(n => n.id === e.source)?.type === 'text' || canvasStore.nodes.find(n => n.id === e.source)?.type === 'llm')
    .length
)
const connectedImages = computed(() =>
  canvasStore.edges
    .filter(e => e.target === props.id)
    .filter(e => canvasStore.nodes.find(n => n.id === e.source)?.type === 'imageResult')
    .length
)

function patch(patch: Partial<CanvasImageGenNodeData>) {
  canvasStore.updateNodeData(props.id, patch)
}

function selectedModel(modelId = props.data.model) {
  return imageModels.find(model => model.model === modelId || model.id === modelId) || imageModels[0]
}

function syncModel(modelId: string) {
  const model = selectedModel(modelId)
  const aspect = mediaFieldOptions(model, 'aspect_ratio')[0]?.value
  const size = mediaFieldOptions(model, 'size')[0]?.value
  patch({
    model: model.model,
    aspectRatio: aspect ? String(aspect) : props.data.aspectRatio,
    size: size ? String(size) : props.data.size,
  })
}

const generating = computed(() => props.data.status === 'running' || props.data.status === 'queued')

async function handleGenerate() {
  if (generating.value) return
  try { await runCanvasNode(props.id) } catch (e) { /* error shown in node */ }
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 270) + 'px', minHeight: (data.height || 132) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="imageGen" icon="image" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop @mousedown.stop class="cv-input" :value="data.model" @change="syncModel(($event.target as HTMLSelectElement).value)">
        <option v-for="model in imageModels" :key="model.id" :value="model.model">{{ model.label }}</option>
      </select>
      <select v-if="mediaFieldOptions(selectedModel(), 'size').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.size || 'auto'" @change="patch({ size: ($event.target as HTMLSelectElement).value })">
        <option v-for="option in mediaFieldOptions(selectedModel(), 'size')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
      </select>
      <select v-if="mediaFieldOptions(selectedModel(), 'aspect_ratio').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.aspectRatio || '1:1'" @change="patch({ aspectRatio: ($event.target as HTMLSelectElement).value })">
        <option v-for="option in mediaFieldOptions(selectedModel(), 'aspect_ratio')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
      </select>
      <div class="cv-indicators">
        <span :class="['cv-ind', connectedTexts > 0 ? 'active' : '']">📝 提示词 {{ connectedTexts || '○' }}</span>
        <span :class="['cv-ind', connectedImages > 0 ? 'active' : '']">🖼 参考图 {{ connectedImages || '○' }}</span>
      </div>
      <button class="cv-gen-btn" :disabled="generating" @pointerdown.stop @mousedown.stop @click.stop="handleGenerate">
        <span v-if="generating" class="mso" style="animation: spin .8s linear infinite">progress_activity</span>
        <span v-else class="mso">bolt</span>
        {{ generating ? '生成中...' : '立即生成' }}
      </button>
      <div v-if="data.status === 'running' || data.status === 'queued'" class="cv-progress">
        {{ data.detail || data.status }} · {{ data.progress || 0 }}%
      </div>
      <div v-if="data.error" class="cv-error">{{ data.error }}</div>
    </div>
    <CanvasResizeHandle :id="id" :default-width="270" :default-height="132" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { position:relative; border: 1px solid var(--border); background: var(--paper); border-radius: 8px; box-shadow: var(--jc-shadow-sm); color: var(--ink1); overflow: visible; }
.cv-node.selected { border-color: var(--olive-dark); box-shadow: 0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node-body { padding:8px; display:flex; flex-direction:column; gap:6px; }
.cv-input { height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-indicators { display:flex; gap:8px; font-size:11px; padding:2px 0; }
.cv-ind { color: var(--ink3); }
.cv-ind.active { color: var(--olive-dark); font-weight:600; }
.cv-gen-btn { width:100%; height:32px; display:flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:8px; background:var(--olive-dark); color:#fff; font:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:opacity .15s; }
.cv-gen-btn:hover:not(:disabled) { opacity:.88; }
.cv-gen-btn:disabled { opacity:.55; cursor:not-allowed; }
.cv-gen-btn .mso { font-size:16px; }
.cv-progress { font-size:11px; color:var(--ink3); }
.cv-error { color: var(--jc-error); font-size: 12px; }
@keyframes spin { to { transform:rotate(360deg) } }
</style>
