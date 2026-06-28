<script setup lang="ts">
/**
 * AnimatedCountList.vue — 工具计数动画列表（对齐 OpenCode 官方 AnimatedCountList）
 *
 * 官方源码: tool-count-summary.tsx
 * 功能：显示上下文工具计数（如 "2 reads, 1 search"），零项不显示
 */
import { computed } from 'vue'

export interface CountItem {
  key: string
  count: number
  one: string
  other: string
}

const props = defineProps<{
  items: CountItem[]
  fallback?: string
}>()

const visible = computed(() => props.items.filter(item => item.count > 0))
const showEmpty = computed(() => visible.value.length === 0 && Boolean(props.fallback))

function label(item: CountItem): string {
  const c = Math.max(0, Math.round(item.count))
  if (c === 1) return `1 ${item.one}`
  return `${c} ${item.other}`
}
</script>

<template>
  <span data-component="tool-count-summary">
    <span v-if="showEmpty" data-slot="tool-count-summary-empty">{{ fallback }}</span>
    <template v-for="(item, i) in visible" :key="item.key">
      <span v-if="i > 0" data-slot="tool-count-summary-prefix">, </span>
      <span data-slot="tool-count-summary-item">{{ label(item) }}</span>
    </template>
  </span>
</template>
