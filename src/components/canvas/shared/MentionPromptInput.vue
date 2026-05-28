<script setup lang="ts">
/* MentionPromptInput — Vue 版，对齐 T8 MentionPromptInput.tsx */
import { computed } from 'vue'
import type { Material } from '@/canvas/composables/useUpstreamMaterials'
const p = defineProps<{ modelValue?: string; materials?: Material[]; placeholder?: string; isDark?: boolean; class?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const val = computed({ get: ()=>p.modelValue||'', set: v=>emit('update:modelValue',v) })
</script>
<template>
  <textarea :value="val" :placeholder="placeholder||'输入提示词...'" :class="p.class" class="mpi"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" spellcheck="false"
    @mousedown.stop rows="2" />
</template>
<style scoped>
.mpi { width:100%; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:6px 8px; font-size:11px; outline:none; resize:vertical; font:inherit; min-height:36px; }
.mpi:focus { border-color:var(--olive); }
</style>
