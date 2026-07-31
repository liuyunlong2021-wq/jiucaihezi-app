<script setup lang="ts">
defineProps<{ message: string }>()
defineEmits<{
  reject: []
  once: []
  always: []
}>()
</script>

<template>
  <div class="tool-approval" role="alertdialog" aria-live="assertive">
    <span class="tool-approval-message">{{ message }}</span>
    <div class="tool-approval-actions">
      <button type="button" class="reject" @click="$emit('reject')">拒绝</button>
      <button type="button" @click="$emit('once')">允许</button>
      <button type="button" class="always" @click="$emit('always')">始终允许</button>
    </div>
  </div>
</template>

<style scoped>
.tool-approval { display: flex; align-items: center; gap: 10px; margin: 8px 12px 0; padding: 7px 8px 7px 12px; border: 1px solid color-mix(in srgb, var(--olive) 45%, var(--line)); border-radius: 8px; background: color-mix(in srgb, var(--surface) 86%, var(--olive-pale)); box-shadow: 0 4px 14px color-mix(in srgb, var(--ink) 9%, transparent); color: var(--ink1); font-size: 12px; line-height: 1.35; }
.tool-approval-message { min-width: 0; flex: 1; }
.tool-approval-actions { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.tool-approval-actions button { min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink2); cursor: pointer; font: inherit; font-size: 12px; }
.tool-approval-actions button:hover, .tool-approval-actions button:focus-visible { border-color: var(--olive); color: var(--olive-dark); outline: none; }
.tool-approval-actions .always { border-color: var(--olive); background: var(--olive); color: #fff; }
.tool-approval-actions .reject { color: var(--ink3); }
@media (max-width: 560px) {
  .tool-approval { align-items: flex-start; flex-direction: column; gap: 7px; }
  .tool-approval-actions { align-self: flex-end; }
}
</style>
