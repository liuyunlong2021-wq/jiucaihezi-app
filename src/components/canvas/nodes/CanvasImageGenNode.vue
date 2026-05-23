<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasImageGenNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasImageGenNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()

function patch(patch: Partial<CanvasImageGenNodeData>) {
  canvasStore.updateNodeData(props.id, patch)
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 270) + 'px', minHeight: (data.height || 132) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="imageGen" icon="image" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop class="cv-input" :value="data.model" @change="patch({ model: ($event.target as HTMLSelectElement).value })">
        <option value="gpt-image-2">GPT Image</option>
        <option value="grok-4.2-image">Grok Image</option>
      </select>
      <select @pointerdown.stop class="cv-input" :value="data.aspectRatio || '1:1'" @change="patch({ aspectRatio: ($event.target as HTMLSelectElement).value })">
        <option value="1:1">1:1</option>
        <option value="16:9">16:9</option>
        <option value="9:16">9:16</option>
      </select>
      <div class="cv-hint">连接文本节点作为图片生成要求</div>
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
.cv-hint { font-size:11px; color:var(--ink3); }
.cv-progress { font-size:11px; color:var(--ink3); }
.cv-error { color: var(--jc-error); font-size: 12px; }
</style>
