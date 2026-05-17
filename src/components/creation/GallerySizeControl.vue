<script setup lang="ts">
/**
 * GallerySizeControl.vue — 缩略图尺寸切换器（小/中/大）
 * 纯 UI 组件，不碰任何业务逻辑
 */
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [val: string] }>()
const sizes = [
  { key: 'small', label: '小' },
  { key: 'medium', label: '中' },
  { key: 'large', label: '大' },
]
</script>

<template>
  <div class="gsc">
    <button
      v-for="s in sizes" :key="s.key"
      class="gsc-btn"
      :class="{ active: modelValue === s.key }"
      @click="emit('update:modelValue', s.key)"
    >{{ s.label }}</button>
  </div>
</template>

<style scoped>
.gsc {
  display: inline-flex; align-items: center; gap: 3px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--paper); padding: 3px;
}
.gsc-btn {
  height: 24px; min-width: 26px; border: none; border-radius: 7px;
  background: transparent; color: var(--ink2); font: inherit;
  font-size: 11px; font-weight: 700; cursor: pointer; transition: all .12s;
}
.gsc-btn.active {
  background: rgba(107,142,35,.15); color: var(--olive-dark);
}
.gsc-btn:hover:not(.active) { background: rgba(0,0,0,.04); }
</style>
