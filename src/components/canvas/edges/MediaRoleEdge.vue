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
const roleOptions: Array<{ value: NonNullable<CanvasEdgeData['role']>; label: string }> = [
  { value: 'first_frame', label: '首帧' },
  { value: 'last_frame', label: '尾帧' },
  { value: 'reference',  label: '参考' },
  { value: 'voice',      label: '声音' },
  { value: 'music',      label: '音乐' },
]

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
const currentRole = computed(() => props.data?.role || 'reference')

function onRoleChange(e: Event) {
  const role = (e.target as HTMLSelectElement).value as CanvasEdgeData['role']
  canvasStore.updateEdgeData(props.id, { role })
}
</script>

<template>
  <BaseEdge :id="id" :path="edgePath" class="media" />
  <EdgeLabelRenderer>
    <div
      class="cv-edge-label-wrap nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
    >
      <select
        class="cv-edge-select media"
        :value="currentRole"
        @change="onRoleChange"
        @pointerdown.stop
        @mousedown.stop
        @click.stop
        title="设置素材角色"
      >
        <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.cv-edge-label-wrap {
  position: absolute;
  z-index: 8;
  pointer-events: all;
}
.cv-edge-select {
  appearance: none;
  -webkit-appearance: none;
  min-width: 48px;
  height: 24px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--olive-dark) 70%, #0077aa);
  background: var(--paper);
  color: color-mix(in srgb, var(--olive-dark) 70%, #0077aa);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: var(--jc-shadow-sm);
  text-align: center;
}
.cv-edge-select:hover {
  background: color-mix(in srgb, var(--paper) 85%, var(--olive-dark));
}
</style>
