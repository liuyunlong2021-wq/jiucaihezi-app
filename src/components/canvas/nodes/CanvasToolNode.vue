<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasToolNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasToolNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()

function patch(patch: Partial<CanvasToolNodeData>) {
  canvasStore.updateNodeData(props.id, patch)
}

function runNode() {
  window.dispatchEvent(new CustomEvent('jc-canvas-run-node', { detail: props.id }))
}
</script>

<template>
  <div class="cv-node" :class="{ selected }">
    <Handle type="target" :position="Position.Left" />
    <div class="cv-node-head">
      <span class="mso">construction</span>
      <span>{{ data.label }}</span>
      <button @pointerdown.stop class="cv-run" :disabled="data.status === 'running'" @click.stop="runNode">
        <span class="mso">{{ data.status === 'running' ? 'hourglass_top' : 'play_arrow' }}</span>
      </button>
    </div>
    <div class="cv-body">
      <select @pointerdown.stop class="cv-input" :value="data.toolKind" @change="patch({ toolKind: ($event.target as HTMLSelectElement).value as CanvasToolNodeData['toolKind'] })">
        <option value="tomd">ToMD</option>
        <option value="browser-read">浏览器读取</option>
      </select>
      <textarea @pointerdown.stop class="cv-textarea" :value="data.input || ''" placeholder="URL、搜索词或补充要求..." @input="patch({ input: ($event.target as HTMLTextAreaElement).value })" />
      <div v-if="data.status === 'running' || data.status === 'queued'" class="cv-progress">
        {{ data.detail || data.status }} · {{ data.progress || 0 }}%
      </div>
      <div v-if="data.outputContent" class="cv-output">{{ data.outputContent }}</div>
      <div v-if="data.error" class="cv-error">{{ data.error }}</div>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { width:270px; border:1px solid var(--border); background:var(--paper); border-radius:8px; box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:hidden; }
.cv-node.selected { border-color:var(--olive-dark); box-shadow:0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node-head { height:34px; display:flex; align-items:center; gap:6px; padding:0 8px 0 10px; border-bottom:1px solid var(--border2); font-size:12px; font-weight:700; }
.cv-node-head .mso { font-size:16px; color:var(--olive-dark); }
.cv-run { margin-left:auto; width:26px; height:26px; border:1px solid var(--border); border-radius:6px; background:var(--surface-alt); color:var(--ink2); cursor:pointer; }
.cv-body { padding:8px; display:flex; flex-direction:column; gap:6px; }
.cv-input { height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-textarea { height:68px; resize:vertical; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:8px; font:inherit; font-size:12px; line-height:1.5; outline:0; }
.cv-output { max-height:120px; overflow:auto; white-space:pre-wrap; padding:8px; border-radius:6px; background:color-mix(in srgb, var(--olive) 10%, transparent); font-size:12px; line-height:1.5; }
.cv-progress { font-size:11px; color:var(--ink3); }
.cv-error { color:var(--jc-error); font-size:12px; }
</style>
