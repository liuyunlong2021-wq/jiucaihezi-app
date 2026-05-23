<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasAudioGenNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasAudioGenNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()

function patch(patch: Partial<CanvasAudioGenNodeData>) {
  canvasStore.updateNodeData(props.id, patch)
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 270) + 'px', minHeight: (data.height || 150) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="audioGen" icon="music_note" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop class="cv-input" :value="data.model" @change="patch({ model: ($event.target as HTMLSelectElement).value })">
        <option value="suno-5.5">Suno</option>
      </select>
      <div class="cv-hint">连接文本节点作为音频生成要求</div>
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
.cv-input { min-width:0; height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-hint, .cv-progress { font-size:11px; color:var(--ink3); }
.cv-error { color:var(--jc-error); font-size:12px; }
</style>
