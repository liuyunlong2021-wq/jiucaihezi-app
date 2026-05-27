<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { getMediaField, getMediaModelsForTask, mediaFieldOptions } from '@/data/mediaModelCapabilities'
import { runCanvasNode } from '../runtime/canvasExecutor'
import type { CanvasAudioGenNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasAudioGenNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()
const audioModels = getMediaModelsForTask('audio')

const connectedTexts = computed(() => canvasStore.edges.filter(e => e.target === props.id).filter(e => { const n = canvasStore.nodes.find(n2 => n2.id === e.source); return n?.type === 'text' || n?.type === 'llm' }).length)
const connectedAudios = computed(() => canvasStore.edges.filter(e => e.target === props.id).filter(e => canvasStore.nodes.find(n => n.id === e.source)?.type === 'audioResult').length)

function patch(patch: Partial<CanvasAudioGenNodeData>) { canvasStore.updateNodeData(props.id, patch) }
function selectedModel(modelId = props.data.model) { return audioModels.find(model => model.model === modelId || model.id === modelId) || audioModels[0] }
function hasField(key: string) { return Boolean(getMediaField(selectedModel(), key)) }

function syncModel(modelId: string) {
  const model = selectedModel(modelId)
  const mv = mediaFieldOptions(model, 'mv')[0]?.value
  const language = mediaFieldOptions(model, 'language')[0]?.value
  const startTime = getMediaField(model, 'start_time')?.defaultValue
  const endTime = getMediaField(model, 'end_time')?.defaultValue
  patch({ model: model.model, mv: mv ? String(mv) : props.data.mv, language: language ? String(language) : props.data.language, startTime: startTime !== undefined ? String(startTime) : props.data.startTime, endTime: endTime !== undefined ? String(endTime) : props.data.endTime })
}

const generating = computed(() => props.data.status === 'running' || props.data.status === 'queued')
async function handleGenerate() {
  if (generating.value) return
  try { await runCanvasNode(props.id) } catch (e) { /* error shown in node */ }
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 270) + 'px', minHeight: (data.height || 150) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="audioGen" icon="music_note" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop @mousedown.stop class="cv-input" :value="data.model" @change="syncModel(($event.target as HTMLSelectElement).value)">
        <option v-for="model in audioModels" :key="model.id" :value="model.model">{{ model.label }}</option>
      </select>
      <input v-if="hasField('title')" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.title || ''" placeholder="歌曲标题" @input="patch({ title: ($event.target as HTMLInputElement).value })" />
      <input v-if="hasField('tags')" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.tags || ''" placeholder="音乐风格" @input="patch({ tags: ($event.target as HTMLInputElement).value })" />
      <input v-if="hasField('negative_tags')" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.negativeTags || ''" placeholder="排除风格" @input="patch({ negativeTags: ($event.target as HTMLInputElement).value })" />
      <select v-if="mediaFieldOptions(selectedModel(), 'mv').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.mv || 'chirp-fenix'" @change="patch({ mv: ($event.target as HTMLSelectElement).value })">
        <option v-for="option in mediaFieldOptions(selectedModel(), 'mv')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
      </select>
      <select v-if="mediaFieldOptions(selectedModel(), 'language').length" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.language || '中文'" @change="patch({ language: ($event.target as HTMLSelectElement).value })">
        <option v-for="option in mediaFieldOptions(selectedModel(), 'language')" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
      </select>
      <div v-if="hasField('start_time') || hasField('end_time')" class="cv-row">
        <input v-if="hasField('start_time')" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.startTime || '0:00'" placeholder="开始时间" @input="patch({ startTime: ($event.target as HTMLInputElement).value })" />
        <input v-if="hasField('end_time')" @pointerdown.stop @mousedown.stop class="cv-input" :value="data.endTime || '0:11'" placeholder="结束时间" @input="patch({ endTime: ($event.target as HTMLInputElement).value })" />
      </div>
      <textarea v-if="hasField('ref_text')" @pointerdown.stop class="cv-textarea" :value="data.refText || ''" placeholder="参考音频文字" @input="patch({ refText: ($event.target as HTMLTextAreaElement).value })" />
      <textarea v-if="hasField('text')" @pointerdown.stop class="cv-textarea" :value="data.text || ''" placeholder="输出文字/文稿" @input="patch({ text: ($event.target as HTMLTextAreaElement).value })" />
      <textarea v-if="hasField('voice_prompt')" @pointerdown.stop class="cv-textarea" :value="data.voicePrompt || ''" placeholder="人设音色风格" @input="patch({ voicePrompt: ($event.target as HTMLTextAreaElement).value })" />
      <div class="cv-indicators">
        <span :class="['cv-ind', connectedTexts > 0 ? 'active' : '']">📝 {{ connectedTexts || '○' }}</span>
        <span :class="['cv-ind', connectedAudios > 0 ? 'active' : '']">🎵 {{ connectedAudios || '○' }}</span>
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
    <CanvasResizeHandle :id="id" :default-width="270" :default-height="150" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { position:relative; border:1px solid var(--border); background:var(--paper); border-radius:8px; box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:visible; }
.cv-node.selected { border-color:var(--olive-dark); box-shadow:0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node-body { padding:8px; display:flex; flex-direction:column; gap:8px; }
.cv-row { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:6px; }
.cv-textarea { border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:6px 8px; font:inherit; font-size:12px; resize:vertical; min-height:48px; }
.cv-indicators { display:flex; gap:8px; font-size:11px; padding:2px 0; }
.cv-ind { color: var(--ink3); }
.cv-ind.active { color: var(--olive-dark); font-weight:600; }
.cv-gen-btn { width:100%; height:32px; display:flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:8px; background:var(--olive-dark); color:#fff; font:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:opacity .15s; }
.cv-gen-btn:hover:not(:disabled) { opacity:.88; }
.cv-gen-btn:disabled { opacity:.55; cursor:not-allowed; }
.cv-gen-btn .mso { font-size:16px; }
.cv-input { min-width:0; height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-textarea { min-width:0; min-height:50px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:6px 8px; font:inherit; font-size:12px; resize:vertical; }
.cv-hint, .cv-progress { font-size:11px; color:var(--ink3); }
.cv-error { color:var(--jc-error); font-size:12px; }
</style>
