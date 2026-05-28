<script setup lang="ts">
/* MaterialPreviewSection — Vue 版，对齐 T8 MaterialPreviewSection.tsx */
import type { Material } from '@/canvas/composables/useUpstreamMaterials'
const p = defineProps<{ texts?: Material[]; images?: Material[]; videos?: Material[]; audios?: Material[]; order?: string[]; title?: string; isDark?: boolean }>()
</script>
<template>
  <div class="mps">
    <div class="mps-title">{{ title || '素材' }}</div>
    <div class="mps-grid">
      <img v-for="(m,i) in (images||[]).slice(0,6)" :key="i" :src="m.url" class="mps-thumb" :title="m.label||m.url.split('/').pop()" />
    </div>
    <div v-if="(videos||[]).length" class="mps-grid">
      <video v-for="(m,i) in (videos||[]).slice(0,3)" :key="i" :src="m.url" class="mps-thumb" muted />
    </div>
    <div v-if="(texts||[]).length" style="font-size:10px;color:var(--ink3);padding-top:4px">{{ texts!.length }} 条文本</div>
  </div>
</template>
<style scoped>
.mps { border:1px solid var(--border2); border-radius:6px; padding:6px; }
.mps-title { font-size:10px; color:var(--ink3); margin-bottom:4px; }
.mps-grid { display:flex; gap:4px; flex-wrap:wrap; }
.mps-thumb { width:48px; height:48px; border-radius:4px; object-fit:cover; background:#0003; }
</style>
