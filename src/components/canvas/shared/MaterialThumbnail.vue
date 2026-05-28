<script setup lang="ts">
/* MaterialThumbnail — Vue 版，对齐 T8 MaterialThumbnail.tsx */
import type { Material } from '@/canvas/composables/useUpstreamMaterials'
import { useMaterialDragSource } from '@/canvas/composables/useMaterialDragSource'
const p = defineProps<{ material: Material; showLabel?: boolean; removable?: boolean }>()
const emit = defineEmits<{ (e: 'remove', m: Material): void }>()
const onDragStart = useMaterialDragSource(() => ({
  kind: p.material.kind, url: p.material.url, sourceNodeId: p.material.sourceNodeId, previewUrl: p.material.url,
}))
</script>
<template>
  <div class="mt">
    <img v-if="material.kind==='image'" :src="material.url" class="mt-img" @mousedown="onDragStart" />
    <video v-if="material.kind==='video'" :src="material.url" class="mt-img" muted @mousedown="onDragStart" />
    <div v-if="material.kind==='audio'" class="mt-audio" @mousedown="onDragStart">🎵{{ material.label||'音频' }}</div>
    <div v-if="material.kind==='text'" class="mt-text">{{ (material.url||'').slice(0,50) }}</div>
    <button v-if="removable" class="mt-rm" @pointerdown.stop @click.stop="emit('remove', material)">×</button>
    <div v-if="showLabel" class="mt-label">{{ material.label||'' }}</div>
  </div>
</template>
<style scoped>
.mt { position:relative; display:inline-flex; flex-direction:column; }
.mt-img { width:48px; height:48px; border-radius:4px; object-fit:cover; background:#0003; cursor:grab; }
.mt-audio { width:48px; height:48px; border-radius:4px; background:var(--surface); display:flex; align-items:center; justify-content:center; font-size:10px; cursor:grab; }
.mt-text { max-width:120px; padding:4px 6px; border-radius:4px; background:var(--surface); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mt-rm { position:absolute; top:-4px; right:-4px; width:16px; height:16px; border-radius:8px; border:none; background:rgba(239,68,68,.8); color:#fff; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.mt-label { font-size:9px; color:var(--ink3); text-align:center; margin-top:2px; max-width:48px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
