<script setup lang="ts">
defineProps<{
  message: string
}>()
</script>

<template>
  <div class="msg-text-warning" role="note">
    <span class="mso" aria-hidden="true">info</span>
    <span>{{ message }}</span>
  </div>
</template>

<style scoped>
.msg-text-warning {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-bottom: 8px;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--line) 70%, #d89b29);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, #fff4d6);
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.35;
}

.msg-text-warning .mso {
  font-size: 14px;
  color: #a66a00;
}
</style>
