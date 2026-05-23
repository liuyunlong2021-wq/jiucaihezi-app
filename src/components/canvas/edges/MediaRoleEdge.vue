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
const roleOptions = [{"value":"first_frame","label":"首帧"},{"value":"last_frame","label":"尾帧"},{"value":"reference","label":"参考"}] as Array<{ value: CanvasEdgeData['role']; label: string }>

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
const label = computed(() => roleOptions.find(item => item.value === props.data?.role)?.label || roleOptions[0]?.label || '素材')

function cycleRole() {
  const current = roleOptions.findIndex(item => item.value === props.data?.role)
  const next = roleOptions[(current + 1 + roleOptions.length) % roleOptions.length]
  if (next) canvasStore.updateEdgeData(props.id, { role: next.value })
}
</script>

<template>
  <BaseEdge :id="id" :path="edgePath" class="media" />
  <EdgeLabelRenderer>
    <button
      class="cv-edge-label media"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      @click.stop="cycleRole"
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
