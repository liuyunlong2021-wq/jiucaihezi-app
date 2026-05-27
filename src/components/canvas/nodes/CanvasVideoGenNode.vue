<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { getMediaModelsForTask, getMediaField, mediaFieldOptions } from '@/data/mediaModelCapabilities'
import { runCanvasNode } from '../runtime/canvasExecutor'
import type { CanvasVideoGenNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasVideoGenNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()
const videoModels = [...getMediaModelsForTask('video'), ...getMediaModelsForTask('digital-human')]

const connectedTexts = computed(() => canvasStore.edges.filter(e => e.target === props.id).filter(e => { const n = canvasStore.nodes.find(n2 => n2.id === e.source); return n?.type === 'text' || n?.type === 'llm' }).length)
const connectedImages = computed(() => canvasStore.edges.filter(e => e.target === props.id).filter(e => canvasStore.nodes.find(n => n.id === e.source)?.type === 'imageResult').length)
const connectedVideos = computed(() => canvasStore.edges.filter(e => e.target === props.id).filter(e => canvasStore.nodes.find(n => n.id === e.source)?.type === 'videoResult').length)
const connectedAudios = computed(() => canvasStore.edges.filter(e => e.target === props.id).filter(e => canvasStore.nodes.find(n => n.id === e.source)?.type === 'audioResult').length)

function patch(patch: Partial<CanvasVideoGenNodeData>) { canvasStore.updateNodeData(props.id, patch) }

function selectedModel(modelId = props.data.model) {
  return videoModels.find(model => model.model === modelId || model.id === modelId) || videoModels[0]
}

function fieldKind(key: string) { return getMediaField(selectedModel(), key)?.kind || 'text' }

function syncModel(modelId: string) {
  const model = selectedModel(modelId)
  const ratio = mediaFieldOptions(model, 'ratio')[0]?.value
  const resolution = mediaFieldOptions(model, 'resolution')[0]?.value
  const durField = getMediaField(model, 'duration')
  const duration = durField?.kind === 'number' ? (durField.defaultValue ?? 6) : (mediaFieldOptions(model, 'duration')[0]?.value ?? 6)
  patch({
    model: model.model,
    aspectRatio: ratio ? String(ratio) : props.data.aspectRatio,
    resolution: resolution ? String(resolution) : props.data.resolution,
    duration: Number(duration),
  })
}

function defaultOutputWidth() { return props.data.model === 'rh-mimic' ? 480 : 540 }
function defaultOutputHeight() { return props.data.model === 'rh-mimic' ? 832 : 960 }

const generating = computed(() => props.data.status === 'running' || props.data.status === 'queued')
async function handleGenerate() {
  if (generating.value) return
  try { await runCanvasNode(props.id) } catch (e) { /* error shown in node */ }
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 280) + 'px', minHeight: (data.height || 170) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="videoGen" icon="movie" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop @mousedown.stop class="cv-input" :value="data.model" @change="syncModel(($event.target as HTMLSelectElement).value)">
        <option v-for="model in videoModels" :key="model.id" :value="model.model">{{ model.label }}</option>
      </select>
      <div class="cv-row">
        <select v-if="mediaFieldOptions(selectedModel(), 'ratio').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.aspectRatio || '16:9'" @change="patch({ aspectRatio: ($event.target as HTMLSelectElement).value })">
          <option v-for="option in mediaFieldOptions(selectedModel(), 'ratio')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
        </select>
        <!-- number 类型 → 数字输入框；select 类型 → 下拉 -->
        <input v-if="fieldKind('duration') === 'number'" @pointerdown.stop @mousedown.stop class="cv-input" type="number" :min="(getMediaField(selectedModel(),'duration')?.min as number)||4" :max="(getMediaField(selectedModel(),'duration')?.max as number)||30" :step="(getMediaField(selectedModel(),'duration')?.step as number)||1" :value="data.duration ?? 6" @input="patch({ duration: Number(($event.target as HTMLInputElement).value) || 6 })" />
        <select v-else-if="mediaFieldOptions(selectedModel(), 'duration').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.duration || 6" @change="patch({ duration: Number(($event.target as HTMLSelectElement).value) || 6 })">
          <option v-for="option in mediaFieldOptions(selectedModel(), 'duration')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}s</option>
        </select>
      </div>
      <select v-if="mediaFieldOptions(selectedModel(), 'resolution').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.resolution || '720P'" @change="patch({ resolution: ($event.target as HTMLSelectElement).value })">
        <option v-for="option in mediaFieldOptions(selectedModel(), 'resolution')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
      </select>
      <div v-if="data.model === 'rh-mimic' || data.model === 'rh-digital-human'" class="cv-row">
        <input @pointerdown.stop @mousedown.stop class="cv-input" type="number" min="16" step="16" :value="data.outputWidth || defaultOutputWidth()" @input="patch({ outputWidth: Number(($event.target as HTMLInputElement).value) || defaultOutputWidth() })" />
        <input @pointerdown.stop @mousedown.stop class="cv-input" type="number" min="16" step="16" :value="data.outputHeight || defaultOutputHeight()" @input="patch({ outputHeight: Number(($event.target as HTMLInputElement).value) || defaultOutputHeight() })" />
      </div>
      <input v-if="data.model === 'rh-digital-human-fast'" @pointerdown.stop @mousedown.stop class="cv-input" type="number" min="16" step="16" :value="data.value || 832" @input="patch({ value: Number(($event.target as HTMLInputElement).value) || 832 })" />
      <textarea v-if="data.model === 'rh-mimic' || data.model === 'rh-digital-human'" @pointerdown.stop @mousedown.stop class="cv-textarea" :value="data.text || ''" :placeholder="data.model === 'rh-mimic' ? '动作说明' : '台词'" @input="patch({ text: ($event.target as HTMLTextAreaElement).value })" />
      <div class="cv-indicators">
        <span :class="['cv-ind', connectedTexts > 0 ? 'active' : '']">📝 {{ connectedTexts || '○' }}</span>
        <span :class="['cv-ind', connectedImages > 0 ? 'active' : '']">🖼 {{ connectedImages || '○' }}</span>
        <span :class="['cv-ind', connectedVideos > 0 ? 'active' : '']">🎬 {{ connectedVideos || '○' }}</span>
        <span :class="['cv-ind', connectedAudios > 0 ? 'active' : '']">🎵 {{ connectedAudios || '○' }}</span>
      </div>
      <button class="cv-gen-btn" :disabled="generating" @pointerdown.stop @mousedown.stop @click.stop="handleGenerate">
        <span v-if="generating" class="mso" style="animation: spin .8s linear infinite">progress_activity</span>
        <span v-else class="mso">bolt</span>
        {{ generating ? '生成中...' : '立即生成' }}
      </button>
      <div v-if="data.status === 'running' || data.status === 'queued'" class="cv-progress">{{ data.detail || data.status }} · {{ data.progress || 0 }}%</div>
      <div v-if="data.error" class="cv-error">{{ data.error }}</div>
    </div>
    <CanvasResizeHandle :id="id" :default-width="280" :default-height="170" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { position:relative; border:1px solid var(--border); background:var(--paper); border-radius:8px; box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:visible; }
.cv-node.selected { border-color: var(--olive-dark); box-shadow: 0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node-body { padding:8px; display:flex; flex-direction:column; gap:6px; }
.cv-input { height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-row { display:flex; gap:6px; }
.cv-row .cv-input { flex:1; min-width:0; }
.cv-textarea { border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:6px 8px; font:inherit; font-size:12px; resize:vertical; min-height:48px; }
.cv-indicators { display:flex; gap:8px; font-size:11px; padding:2px 0; flex-wrap:wrap; }
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
