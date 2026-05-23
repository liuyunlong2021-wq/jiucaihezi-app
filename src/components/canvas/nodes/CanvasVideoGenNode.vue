<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasVideoGenNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasVideoGenNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()

function patch(patch: Partial<CanvasVideoGenNodeData>) {
  canvasStore.updateNodeData(props.id, patch)
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 280) + 'px', minHeight: (data.height || 170) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="videoGen" icon="movie" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop class="cv-input" :value="data.model" @change="patch({ model: ($event.target as HTMLSelectElement).value })">
        <option value="seedance-2.0-fast">Seedance</option>
        <option value="grok-video-3">Grok Video</option>
        <option value="veo3.1-fast">Veo Fast</option>
      </select>
      <div class="cv-row">
        <select @pointerdown.stop class="cv-input" :value="data.aspectRatio || '16:9'" @change="patch({ aspectRatio: ($event.target as HTMLSelectElement).value })">
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
        </select>
        <input @pointerdown.stop class="cv-input" type="number" min="3" max="15" :value="data.duration || 5" @input="patch({ duration: Number(($event.target as HTMLInputElement).value) || 5 })" />
      </div>
      <div class="cv-hint">连接文本/图片/音频节点作为视频生成要求</div>
      <div v-if="data.status === 'running' || data.status === 'queued'" class="cv-progress">
        {{ data.detail || data.status }} · {{ data.progress || 0 }}%
      </div>
      <div v-if="data.error" class="cv-error">{{ data.error }}</div>
    </div>
    <CanvasResizeHandle :id="id" :default-width="280" :default-height="170" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { position:relative; border:1px solid var(--border); background:var(--paper); border-radius:8px; box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:visible; }
.cv-node.selected { border-color:var(--olive-dark); box-shadow:0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node-body { padding:8px; display:flex; flex-direction:column; gap:6px; }
.cv-row { display:grid; grid-template-columns:1fr 72px; gap:6px; }
.cv-input { min-width:0; height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-hint { font-size:11px; color:var(--ink3); }
.cv-progress { font-size:11px; color:var(--ink3); }
.cv-error { color: var(--jc-error); font-size:12px; }
</style>
