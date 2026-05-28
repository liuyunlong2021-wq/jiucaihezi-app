<script setup lang="ts">
/* ResizableCorners — Vue 版，对齐 T8 ResizableCorners.tsx */
import { ref, onMounted, onUnmounted } from 'vue'
const p = defineProps<{ selected?: boolean; minWidth?: number; minHeight?: number; accent?: string }>()
const emit = defineEmits<{ (e: 'resize', payload: { width: number; height: number }): void }>()
const root = ref<HTMLElement | null>(null)
let dragging = false, startX = 0, startY = 0, startW = 0, startH = 0

function onDown(e: MouseEvent, corner: string) {
  if (!root.value) return
  e.preventDefault(); e.stopPropagation()
  dragging = true
  startX = e.clientX; startY = e.clientY
  startW = root.value.offsetWidth; startH = root.value.offsetHeight
  const onMove = (ev: MouseEvent) => {
    if (!dragging) return
    const dx = ev.clientX - startX; const dy = ev.clientY - startY
    const w = Math.max(p.minWidth||180, startW + dx)
    const h = Math.max(p.minHeight||120, startH + dy)
    emit('resize', { width: w, height: h })
  }
  const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>
<template>
  <div v-if="selected" ref="root" class="rc" :style="{ '--accent': accent || '#66c' }">
    <div class="rc-corner rc-se" @mousedown.stop="onDown($event,'se')" />
    <div class="rc-corner rc-sw" @mousedown.stop="onDown($event,'sw')" />
    <div class="rc-corner rc-ne" @mousedown.stop="onDown($event,'ne')" />
    <div class="rc-corner rc-nw" @mousedown.stop="onDown($event,'nw')" />
  </div>
</template>
<style scoped>
.rc { position:absolute; inset:0; pointer-events:none; z-index:10; }
.rc-corner { position:absolute; width:10px; height:10px; border:2px solid var(--accent,#66c); border-radius:2px; pointer-events:all; background:var(--paper); }
.rc-se { right:-5px; bottom:-5px; cursor:se-resize; }
.rc-sw { left:-5px; bottom:-5px; cursor:sw-resize; }
.rc-ne { right:-5px; top:-5px; cursor:ne-resize; }
.rc-nw { left:-5px; top:-5px; cursor:nw-resize; }
</style>
