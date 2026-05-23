<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasEdgeData } from '@/types/canvas'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: any
  targetPosition: any
  data?: CanvasEdgeData
}>()

const canvasStore = useCanvasStore()
const orderOptions = [1, 2, 3, 4, 5]

const path = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
}))
const edgePath = computed(() => path.value[0])
const labelX = computed(() => path.value[1])
const labelY = computed(() => path.value[2])
const label = computed(() => String(props.data?.order || 1))

function cycleOrder() {
  const edge = canvasStore.edges.find(item => item.id === props.id)
  const targetId = edge?.target || ''
  const used = new Set(canvasStore.edges
    .filter(item => item.id !== props.id && item.target === targetId && item.data?.kind === 'image-role')
    .map(item => Number(item.data?.order || 0))
    .filter(Boolean))
  const current = Number(props.data?.order || 1)
  const start = orderOptions.indexOf(current)
  for (let step = 1; step <= orderOptions.length; step++) {
    const next = orderOptions[(start + step + orderOptions.length) % orderOptions.length]
    if (!used.has(next)) {
      canvasStore.updateEdgeData(props.id, { order: next, role: 'reference' })
      return
    }
  }
  canvasStore.updateEdgeData(props.id, { order: current, role: 'reference' })
}
</script>

<template>
  <BaseEdge :id="id" :path="edgePath" class="image" />
  <EdgeLabelRenderer>
    <button
      class="cv-edge-label image"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      title="点击切换参考图顺序"
      @click.stop="cycleOrder"
    >
      {{ label }}
    </button>
  </EdgeLabelRenderer>
</template>

<style scoped>
.cv-edge-label {
  position: absolute;
  z-index: 8;
  min-width: 44px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--olive-dark);
  background: var(--paper);
  color: var(--olive-dark);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  pointer-events: all;
  box-shadow: var(--jc-shadow-sm);
}
.cv-edge-label.media { border-color: color-mix(in srgb, var(--olive-dark) 70%, #0077aa); color: color-mix(in srgb, var(--olive-dark) 70%, #0077aa); }
</style>
