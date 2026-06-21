<script setup lang="ts">
defineProps<{ selectedCount: number }>()

const emit = defineEmits<{
  (e: 'zoom-in'): void
  (e: 'zoom-out'): void
  (e: 'fit-view'): void
  (e: 'group-selected'): void
}>()
</script>

<template>
  <div class="cmc" @pointerdown.stop>
    <button class="cmc-btn" title="缩小 -" @click="emit('zoom-out')"><JcIcon name="remove" /></button>
    <button class="cmc-btn" title="放大 +" @click="emit('zoom-in')"><JcIcon name="add" /></button>
    <button class="cmc-btn" title="适应视图 0" @click="emit('fit-view')"><JcIcon name="fit_screen" /></button>
    <span class="cmc-sep"></span>
    <button
      class="cmc-btn"
      :disabled="selectedCount < 2"
      title="将选中节点建成分组 Cmd/Ctrl+G"
      @click="emit('group-selected')"
    >
      <JcIcon name="create_new_folder" />
    </button>
  </div>
</template>

<style scoped>
.cmc {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--paper);
  box-shadow: var(--jc-shadow-sm);
}
.cmc-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.cmc-btn:hover:not(:disabled) { background: var(--surface-alt); color: var(--ink1); }
.cmc-btn:disabled { opacity: .38; cursor: not-allowed; }
.cmc-btn .mso { font-size: 18px; }
.cmc-sep { width: 1px; height: 22px; background: var(--border); margin: 0 2px; }
</style>
