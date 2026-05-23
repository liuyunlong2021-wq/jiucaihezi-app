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

function editOrder() {
  const current = props.data?.order || 1
  const raw = prompt('输入顺序数字', String(current))
  if (raw == null) return
  const order = Number(raw)
  if (!Number.isFinite(order) || order < 1) return
  canvasStore.updateEdgeData(props.id, { order })
}
</script>

<template>
  <BaseEdge :id="id" :path="edgePath" />
  <EdgeLabelRenderer>
    <button
      class="cv-edge-label"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      @click.stop="editOrder"
    >
      {{ data?.order || 1 }}
    </button>
  </EdgeLabelRenderer>
</template>

<style scoped>
.cv-edge-label {
  position: absolute;
  z-index: 8;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--olive-dark);
  background: var(--paper);
  color: var(--olive-dark);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  pointer-events: all;
  box-shadow: var(--jc-shadow-sm);
}
</style>
