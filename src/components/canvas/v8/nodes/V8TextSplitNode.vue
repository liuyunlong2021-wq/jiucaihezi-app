<script setup lang="ts">
/**
 * V8TextSplitNode.vue
 * Week 4-6 orchestration — text splitter (functional).
 * Splits input text by delimiter, exposes multiple outputs.
 */

import { computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useV8NodeBehavior(node.value, {})

const d = computed(() => props.data || {})
const delimiter = computed({
  get: () => d.value.delimiter || '\\n',
  set: v => canvasStore.updateNodeData(props.id, { delimiter: v })
})
const parts = computed(() => {
  const input = d.value.inputText || d.value.prompt || ''
  if (!input) return []
  return input.split(delimiter.value === '\\n' ? '\n' : delimiter.value).filter(Boolean)
})

function splitNow() {
  canvasStore.updateNodeData(props.id, { 
    status: 'success', 
    splitCount: parts.value.length,
    splitParts: parts.value 
  })
}

// Wire global run (from toolbar/right-click runCanvasNode path) to V8 local sim for full working
const v8ExecHandler = (ev: Event) => {
  const detail = (ev as CustomEvent).detail || {}
  if (detail.id === props.id && (detail.type === 'textSplit' || !detail.type)) {
    splitNow()
  }
}
onMounted(() => {
  window.addEventListener('v8-execute-node', v8ExecHandler)
})
onUnmounted(() => {
  window.removeEventListener('v8-execute-node', v8ExecHandler)
})
</script>

<template>
  <NodeFrame
    :id="id"
    label="文本分割"
    icon="call_split"
    role="orchestrate"
    :selected="selected"
    executable
    @run="splitNow"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <Handle id="left-in" type="target" :position="Position.Left" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />
    <!-- Dynamic output handles for split parts (simplified) -->
    <Handle v-for="(part, i) in parts.slice(0, 4)" :key="i" :id="`right-part-${Number(i)+1}`" type="source" :position="Position.Right" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none', top: `${30 + Number(i)*18}%` }" />

    <div class="v8-split">
      <div>分隔符: <input v-model="delimiter" placeholder="\n 或 , 或 |" /></div>
      <div class="v8-hint">输入将被分割成 {{ parts.length }} 份（前4份有独立输出端口）</div>
      <div v-if="parts.length" class="v8-parts-preview">
        {{ parts.slice(0, 3).join(' | ') }}{{ parts.length > 3 ? ' ...' : '' }}
      </div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-split { padding: 8px; font-size: 12px; }
.v8-hint { font-size: 10px; color: var(--ink3); }
.v8-parts-preview { margin-top: 4px; font-size: 11px; color: var(--ink2); background: var(--surface); padding: 4px; border-radius: 4px; }
</style>
