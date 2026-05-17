<script setup lang="ts">
/**
 * GalleryLoadingCard.vue — 生成中脉冲占位卡
 * 纯 UI 动画组件
 */
defineProps<{ text?: string }>()
</script>

<template>
  <div class="gc-loading">
    <div class="gc-loading-ring" />
    <div class="gc-loading-label">{{ text || '生成中...' }}</div>
  </div>
</template>

<style scoped>
.gc-loading {
  border-radius: 12px; min-height: 140px;
  background: linear-gradient(135deg, var(--surface-alt), var(--paper));
  border: 1px solid var(--line);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  animation: gcPulse 2s ease-in-out infinite;
}
@keyframes gcPulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }

.gc-loading-ring {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2.5px solid var(--line); border-top-color: var(--olive);
  animation: gcSpin .9s linear infinite;
}
@keyframes gcSpin { to { transform: rotate(360deg); } }

.gc-loading-label {
  font-size: 10px; color: var(--ink3); text-align: center; padding: 0 12px;
}
</style>
