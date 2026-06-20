<template>
  <!-- Custom edge with image order selector | 带图片顺序选择器的自定义边 -->
  <BaseEdge :path="path" :style="edgeStyle" />
  
  <!-- Edge label with order selector | 带顺序选择器的边标签 -->
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
        <button 
          class="edge-order-btn"
          @mousedown.stop="toggleMenu"
        >
          {{ currentOrderLabel }}
        </button>
        <div v-if="menuOpen" class="edge-dropdown-menu" @mousedown.stop>
          <button
            v-for="opt in orderOptions"
            :key="opt.key"
            class="edge-dropdown-item"
            :class="{ active: currentOrder === opt.key }"
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
  id: string
  source: string
  target: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  data?: Record<string, any>
  markerEnd?: string
  style?: Record<string, any>
}>()

const menuOpen = ref(false)
const toggleMenu = () => { menuOpen.value = !menuOpen.value }

const onDocClick = () => { menuOpen.value = false }
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

// Order labels | 顺序标签
const orderLabels = [
  { label: '① 第一张', key: 1 },
  { label: '② 第二张', key: 2 },
  { label: '③ 第三张', key: 3 },
  { label: '④ 第四张', key: 4 },
  { label: '⑤ 第五张', key: 5 },
]

// Dynamic order options | 动态顺序选项
const orderOptions = computed(() => {
  const sameTargetEdges = canvasStore.edges.filter(
    edge => edge.target === props.target && edge.type === 'imageOrder',
  )
  const edgeCount = sameTargetEdges.length || 1

  // Count @ mentioned images from connected TextNodes
  let mentionedImageCount = 0
  const connectedEdges = canvasStore.edges.filter(e => e.target === props.target)
  for (const edge of connectedEdges) {
    const sourceNode = canvasStore.nodes.find(n => n.id === edge.source)
    if (sourceNode?.type === 'text') {
      const textContent = (sourceNode.data as any)?.content || ''
      const mentionRegex = /@\[([^\]|]+)(?:\|([^\]]+))?\]/g
      let match: RegExpExecArray | null
      while ((match = mentionRegex.exec(textContent)) !== null) {
        const mentionedNode = canvasStore.nodes.find(n => n.id === match![1])
        if (mentionedNode?.type === 'imageResult') {
          mentionedImageCount++
        }
      }
    }
  }

  const minOrder = mentionedImageCount + 1
  const totalCount = edgeCount + mentionedImageCount
  const maxOrder = Math.min(totalCount, 5)

  return orderLabels.filter(label => label.key >= minOrder && label.key <= maxOrder)
})

// Current order from edge data
const currentOrder = computed(() => (props.data as any)?.imageOrder || 1)

const currentOrderLabel = computed(() => {
  const opt = orderLabels.find(o => o.key === currentOrder.value)
  return opt?.label || '① 第一张'
})

// Calculate bezier path
const path = computed(() => {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: (props.sourcePosition as Position) || Position.Left,
    targetPosition: (props.targetPosition as Position) || Position.Right,
  })
  return edgePath
})

// Label position (center of edge)
const labelX = computed(() => (props.sourceX + props.targetX) / 2)
const labelY = computed(() => (props.sourceY + props.targetY) / 2)

// Edge style
const edgeStyle = computed(() => ({
  stroke: '#3b82f6',
  strokeWidth: 2,
  ...props.style,
}))

// Handle order selection
const handleOrderSelect = (newOrder: number) => {
  const sameTargetEdges = canvasStore.edges.filter(
    edge => edge.target === props.target && edge.type === 'imageOrder',
  )
  const edgeWithSameOrder = sameTargetEdges.find(
    edge => edge.id !== props.id && (edge.data as any)?.imageOrder === newOrder,
  )
  if (edgeWithSameOrder) {
    updateEdgeData(edgeWithSameOrder.id, { imageOrder: currentOrder.value })
  }
  updateEdgeData(props.id, { imageOrder: newOrder })
  menuOpen.value = false
}
</script>

<style scoped>
.edge-dropdown-wrapper {
  position: relative;
}

.edge-order-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 50%;
  background: #3b82f6;
  color: #fff;
  border: 2px solid #fff;
  cursor: pointer;
  box-shadow: var(--jc-shadow-sm);
  transition: transform 0.15s;
  font-family: var(--jc-font-body);
}

.edge-order-btn:hover {
  transform: scale(1.1);
}

.edge-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--jc-shadow-sm);
  z-index: 1000;
  white-space: nowrap;
}

.edge-dropdown-item {
  padding: 4px 10px;
  font-size: 11px;
  border: none;
  background: transparent;
  color: var(--ink);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-family: var(--jc-font-body);
  transition: background 0.1s;
}

.edge-dropdown-item:hover,
.edge-dropdown-item.active {
  background: color-mix(in srgb, #3b82f6 10%, transparent);
  color: #3b82f6;
}
</style>
