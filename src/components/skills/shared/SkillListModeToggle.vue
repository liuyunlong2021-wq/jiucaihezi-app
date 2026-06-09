<script setup lang="ts">
defineProps<{
  modelValue: 'all' | 'folders'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: 'all' | 'folders'): void
}>()
</script>

<template>
  <div class="mode-toggle" role="group" aria-label="列表模式">
    <button
      type="button"
      :class="{ active: modelValue === 'all' }"
      aria-label="全部 Skill"
      @click="emit('update:modelValue', 'all')"
    >
      <span class="mso">view_agenda</span>
      全部
    </button>
    <button
      type="button"
      :class="{ active: modelValue === 'folders' }"
      aria-label="文件夹"
      @click="emit('update:modelValue', 'folders')"
    >
      <span class="mso">folder_open</span>
      文件夹
    </button>
  </div>
</template>

<style scoped>
.mode-toggle {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
button {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
button.active {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.mso { font-size: 15px; }
</style>
