<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useCanvasStore } from '@/stores/canvasStore'

const props = withDefaults(defineProps<{
  id: string
  minWidth?: number
  minHeight?: number
  defaultWidth?: number
  defaultHeight?: number
}>(), {
  minWidth: 180,
  minHeight: 120,
  defaultWidth: 260,
  defaultHeight: 180,
})

const canvasStore = useCanvasStore()
const dragging = ref(false)
let startX = 0
let startY = 0
let startWidth = 0
let startHeight = 0

function cleanup() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  dragging.value = false
}

function onDown(event: PointerEvent) {
  event.stopPropagation()
  event.preventDefault()
  const node = canvasStore.nodes.find(item => item.id === props.id)
  startX = event.clientX
  startY = event.clientY
  startWidth = Number((node?.data as any)?.width || props.defaultWidth)
  startHeight = Number((node?.data as any)?.height || props.defaultHeight)
  dragging.value = true
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onMove(event: PointerEvent) {
  if (!dragging.value) return
  const width = Math.max(props.minWidth, startWidth + event.clientX - startX)
  const height = Math.max(props.minHeight, startHeight + event.clientY - startY)
  canvasStore.updateNodeData(props.id, { width: Math.round(width), height: Math.round(height) } as any)
}

function onUp() {
  cleanup()
}

onUnmounted(cleanup)
</script>

<template>
  <button class="cv-resize" title="拖拽缩放" @pointerdown="onDown"></button>
</template>

<style scoped>
.cv-resize {
  position: absolute;
  right: 3px;
  bottom: 3px;
  z-index: 12;
  width: 15px;
  height: 15px;
  border: 0;
  background:
    linear-gradient(135deg, transparent 0 48%, var(--ink3) 49% 56%, transparent 57%),
    linear-gradient(135deg, transparent 0 66%, var(--ink3) 67% 74%, transparent 75%);
  opacity: .55;
  cursor: nwse-resize;
}
.cv-resize:hover { opacity: 1; }
</style>
