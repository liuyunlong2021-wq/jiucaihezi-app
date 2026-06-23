<script setup lang="ts">
/**
 * LoopNode.vue
 * Week 4-6 orchestration node — basic functional loop.
 * Uses NodeFrame role="orchestrate".
 * Supports iteration count, input/output for prompt-flow.
 */

import { computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useNodeBehavior } from '@/components/canvas/nodes-next/composables/useNodeBehavior'
import type { CanvasNode } from '@/types/canvas'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useNodeBehavior(node.value, {})

const d = computed(() => props.data || {})
const loopCount = computed({
  get: () => d.value.loopCount || 3,
  set: v => canvasStore.updateNodeData(props.id, { loopCount: Math.max(1, Math.min(20, v)) })
})
const currentIteration = computed(() => d.value.currentIteration || 0)
const status = computed(() => d.value.status || 'idle')

function runLoop() {
  canvasStore.updateNodeData(props.id, { status: 'running', currentIteration: 0 })
  // Simple simulation (real execution would be in future executor layer)
  let i = 0
  const interval = setInterval(() => {
    i++
    canvasStore.updateNodeData(props.id, { currentIteration: i })
    if (i >= loopCount.value) {
      clearInterval(interval)
      canvasStore.updateNodeData(props.id, { status: 'success' })
    }
  }, 400)
}

function resetLoop() {
  canvasStore.updateNodeData(props.id, { status: 'idle', currentIteration: 0 })
}

// Wire global run (from toolbar/right-click runCanvasNode path) to local sim for full working
const v8ExecHandler = (ev: Event) => {
  const detail = (ev as CustomEvent).detail || {}
  if (detail.id === props.id && (detail.type === 'loop' || !detail.type)) {
    runLoop()
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
    label="循环器"
    icon="repeat"
    role="orchestrate"
    :status="status"
    :selected="selected"
    executable
    @run="runLoop"
    @stop="resetLoop"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <Handle id="left-in" type="target" :position="Position.Left" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />
    <Handle id="right-out" type="source" :position="Position.Right" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />

    <div class="v8-loop">
      <div>迭代次数: <input type="number" v-model.number="loopCount" min="1" max="20" /> </div>
      <div v-if="status === 'running'" class="v8-iter">当前: {{ currentIteration }} / {{ loopCount }}</div>
      <div class="v8-hint">循环输入内容 {{ loopCount }} 次输出</div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-loop { padding: 8px; font-size: 12px; }
.v8-iter { color: #f59e0b; font-weight: 600; }
.v8-hint { font-size: 10px; color: var(--ink3); margin-top: 4px; }
</style>
