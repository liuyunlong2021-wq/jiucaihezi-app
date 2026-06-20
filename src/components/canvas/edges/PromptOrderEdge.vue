<template>
  <!-- Custom edge with prompt order selector | 带提示词顺序选择器的自定义边 -->
  <BaseEdge :path="path" :style="edgeStyle" />
  
  <EdgeLabelRenderer>
    <div 
      :style="{ 
        position: 'absolute', 
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all'
      }"
      class="nodrag nopan"
    >
      <div class="edge-dropdown-wrapper">
        <button class="edge-order-btn" @mousedown.stop="toggleMenu">
          {{ currentOrderLabel }}
        </button>
        <div v-if="menuOpen" class="edge-dropdown-menu" @mousedown.stop>
          <button
            v-for="opt in orderOptions" :key="opt.key"
            class="edge-dropdown-item" :class="{ active: currentOrder === opt.key }"
            @mousedown.stop="handleOrderSelect(opt.key)"
          >{{ opt.label }}</button>
        </div>
      </div>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'

const canvasStore = useCanvasStore()
const { updateEdgeData } = useVueFlow()

const props = defineProps<{
  id: string; source: string; target: string
  sourceX: number; sourceY: number; targetX: number; targetY: number
  sourcePosition: string; targetPosition: string
  data?: Record<string, any>; markerEnd?: string; style?: Record<string, any>
}>()

const menuOpen = ref(false)
const toggleMenu = () => { menuOpen.value = !menuOpen.value }
const onDocClick = () => { menuOpen.value = false }
onMounted(() => document.addEventListener('mousedown', onDocClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocClick))

const orderLabels = [
  { label: '①', key: 1 }, { label: '②', key: 2 }, { label: '③', key: 3 },
  { label: '④', key: 4 }, { label: '⑤', key: 5 },
]

const orderOptions = computed(() => {
  const sameTargetEdges = canvasStore.edges.filter(
    edge => edge.target === props.target && edge.type === 'promptOrder',
  )
  return orderLabels.slice(0, sameTargetEdges.length || 1)
})

const currentOrder = computed(() => (props.data as any)?.order || (props.data as any)?.promptOrder || 1)

const currentOrderLabel = computed(() => {
  return orderLabels.find(o => o.key === currentOrder.value)?.label || '①'
})

const path = computed(() => {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: (props.sourcePosition as Position) || Position.Left, targetPosition: (props.targetPosition as Position) || Position.Right,
  })
  return edgePath
})

const labelX = computed(() => (props.sourceX + props.targetX) / 2)
const labelY = computed(() => (props.sourceY + props.targetY) / 2)

const edgeStyle = computed(() => ({ stroke: '#10b981', strokeWidth: 2, ...props.style }))

const handleOrderSelect = (newOrder: number) => {
  const sameTargetEdges = canvasStore.edges.filter(
    edge => edge.target === props.target && edge.type === 'promptOrder',
  )
  const conflict = sameTargetEdges.find(
    edge => edge.id !== props.id && ((edge.data as any)?.order === newOrder || (edge.data as any)?.promptOrder === newOrder),
  )
  if (conflict) updateEdgeData(conflict.id, { order: currentOrder.value })
  updateEdgeData(props.id, { order: newOrder })
  menuOpen.value = false
}
</script>

<style scoped>
.edge-dropdown-wrapper { position: relative; }

.edge-order-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; font-size: 12px; font-weight: 700;
  border-radius: 50%; background: var(--olive); color: #fff;
  border: 2px solid #fff; cursor: pointer;
  box-shadow: var(--jc-shadow-sm); transition: transform 0.15s;
  font-family: var(--jc-font-body);
}
.edge-order-btn:hover { transform: scale(1.1); }

.edge-dropdown-menu {
  position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 1px; padding: 3px;
  background: var(--paper); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: var(--jc-shadow-sm); z-index: 1000; white-space: nowrap;
}

.edge-dropdown-item {
  padding: 4px 10px; font-size: 11px; border: none; background: transparent;
  color: var(--ink); border-radius: 4px; cursor: pointer; text-align: left;
  font-family: var(--jc-font-body); transition: background 0.1s;
}
.edge-dropdown-item:hover, .edge-dropdown-item.active { background: var(--olive-pale); color: var(--olive-dark); }
</style>
