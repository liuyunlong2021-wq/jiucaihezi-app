<script setup lang="ts">
/* ImageOpFrame — Vue 版，对齐 T8 ImageOpFrame.tsx */
import { computed } from 'vue'
const p = defineProps<{ title: string; icon: string; color?: string; selected?: boolean }>()
const emit = defineEmits<{ (e: 'run'): void }>()
const accent = computed(() => p.color || '#fb923c')
</script>
<template>
  <div class="iof" :class="{ sel: selected }" :style="{ borderColor: selected ? accent : 'var(--border)' }">
    <div class="iof-hd">
      <div class="iof-ic" :style="{ background: accent + '33', color: accent }"><JcIcon :name="icon" style="font-size:13px" /></div>
      <div class="iof-lb">{{ title }}</div>
      <button class="iof-run" @pointerdown.stop @click.stop="emit('run')"><JcIcon name="play_arrow" /></button>
    </div>
    <div class="iof-bd"><slot /></div>
  </div>
</template>
<style scoped>
.iof { border:2px solid var(--border); border-radius:12px; background:var(--paper); box-shadow:var(--jc-shadow-sm); color:var(--ink1); }
.iof.sel { border-color:var(--olive-dark); }
.iof-hd { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border2); }
.iof-ic { width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; }
.iof-lb { flex:1; font-size:13px; font-weight:600; }
.iof-run { width:26px; height:26px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink2); cursor:pointer; display:flex; align-items:center; justify-content:center; }
.iof-bd { padding:10px; }
</style>
