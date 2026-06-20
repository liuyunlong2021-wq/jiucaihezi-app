<template>
  <!-- Custom edge with image role selector | 带图片角色选择器的自定义边 -->
  <BaseEdge :path="path" :style="edgeStyle" />
  
  <!-- Edge label with role dropdown | 带角色下拉的边标签 -->
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
          class="edge-role-btn"
          @mousedown.stop="toggleMenu"
        >
          {{ currentRoleLabel }}
          <span class="mso edge-chevron">expand_more</span>
        </button>
        <div v-if="menuOpen" class="edge-dropdown-menu" @mousedown.stop>
          <button
            v-for="opt in imageRoleOptions"
            :key="opt.key"
            class="edge-dropdown-item"
            :class="{ active: currentRole === opt.key }"
            @mousedown.stop="handleRoleSelect(opt.key)"
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

// 角色映射: canvasStore data.role ↔ 显示标签
const ROLE_MAP: Record<string, string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference: '参考图',
  first_frame_image: '首帧',
  last_frame_image: '尾帧',
  input_reference: '参考图',
}

const imageRoleOptions = [
  { label: '首帧', key: 'first_frame' },
  { label: '尾帧', key: 'last_frame' },
  { label: '参考图', key: 'reference' },
]

const currentRole = computed(() => (props.data as any)?.role || (props.data as any)?.imageRole || 'reference')

const currentRoleLabel = computed(() => ROLE_MAP[currentRole.value] || '参考图')

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

const edgeStyle = computed(() => ({
  stroke: '#6366f1',
  strokeWidth: 2,
  ...props.style,
}))

const handleRoleSelect = (role: string) => {
  if (role === 'first_frame' || role === 'last_frame') {
    const sameTargetEdges = canvasStore.edges.filter(
      edge => edge.target === props.target && edge.id !== props.id && ((edge.data as any)?.role === role || (edge.data as any)?.imageRole === role),
    )
    sameTargetEdges.forEach(edge => {
      const oppositeRole = role === 'first_frame' ? 'last_frame' : 'first_frame'
      updateEdgeData(edge.id, { role: oppositeRole })
    })
  }
  updateEdgeData(props.id, { role })
  menuOpen.value = false
}
</script>

<style scoped>
.edge-dropdown-wrapper { position: relative; }

.edge-role-btn {
  display: flex; align-items: center; gap: 2px;
  font-size: 11px; padding: 4px 8px; border-radius: 999px;
  background: var(--paper); border: 1px solid var(--border);
  color: var(--ink); cursor: pointer;
  box-shadow: var(--jc-shadow-sm); transition: box-shadow 0.15s;
  font-family: var(--jc-font-body); white-space: nowrap;
}
.edge-role-btn:hover { box-shadow: 0 2px 8px var(--jc-shadow-color); }

.edge-chevron { font-size: 12px; color: var(--ink3); }

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
