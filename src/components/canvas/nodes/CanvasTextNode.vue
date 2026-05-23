<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasTextNodeData } from '@/types/canvas'

const props = defineProps<{
  id: string
  data: CanvasTextNodeData
  selected?: boolean
}>()

const canvasStore = useCanvasStore()

function updateContent(event: Event) {
  canvasStore.updateNodeData(props.id, { content: (event.target as HTMLTextAreaElement).value })
}

function insertMention(nodeId: string) {
  const token = canvasStore.mentionToken(nodeId)
  if (!token) return
  canvasStore.updateNodeData(props.id, { content: [props.data.content || '', token].filter(Boolean).join(' ') } as any)
}
</script>

<template>
  <div class="cv-node cv-text" :class="{ selected }" :style="{ width: (data.width || 260) + 'px', minHeight: (data.height || 150) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="text" icon="notes" :label="data.label" :status="data.status" />
    <div v-if="canvasStore.publicNodes.length" class="cv-mentions">
      <button @pointerdown.stop v-for="node in canvasStore.publicNodes" :key="node.id" @click.stop="insertMention(node.id)">@{{ (node.data as any).publicName || node.data.label }}</button>
    </div>
    <textarea
      @pointerdown.stop
      class="cv-node-textarea"
      :value="data.content"
      placeholder="写提示词、分镜、备注..."
      @input="updateContent"
     
    />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node {
  
  min-height: 150px;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 8px;
  box-shadow: var(--jc-shadow-sm);
  color: var(--ink1);
  overflow: visible;
}
.cv-node.selected { border-color: var(--olive-dark); box-shadow: 0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-mentions { display:flex; gap:5px; padding:7px 8px 0; overflow:hidden; }
.cv-mentions button { height:22px; border:1px solid var(--border); border-radius:999px; background:var(--surface); color:var(--ink3); font:inherit; font-size:11px; padding:0 7px; cursor:pointer; white-space:nowrap; }
.cv-mentions button:hover { color:var(--olive-dark); border-color:var(--olive-dark); }
.cv-node-textarea {
  width: 100%;
  height: 110px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink1);
  padding: 10px;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
}
</style>
