<script setup lang="ts">
/**
 * ToolErrorCard.vue — 工具错误卡片（对齐 OpenCode 官方 ToolErrorCard）
 *
 * 官方源码: tool-error-card.tsx
 * 功能：显示工具执行错误的详细信息，可折叠展开
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  tool: string
  error: string
  title?: string
  subtitle?: string
  defaultOpen?: boolean
}>()

const open = ref(props.defaultOpen ?? false)

const name = computed(() => {
  if (props.title) return props.title
  return props.tool
})

const cleaned = computed(() => props.error.replace(/^Error:\s*/, '').trim())

const tail = computed(() => {
  const value = cleaned.value
  const prefix = `${props.tool} `
  if (value.startsWith(prefix)) return value.slice(prefix.length)
  return value
})

const displaySubtitle = computed(() => {
  if (props.subtitle) return props.subtitle
  const parts = tail.value.split(': ')
  if (parts.length <= 1) return '执行失败'
  return parts[0] || '执行失败'
})

const body = computed(() => {
  const parts = tail.value.split(': ')
  return parts.length > 1 ? parts.slice(1).join(': ') : tail.value
})
</script>

<template>
  <div data-component="tool-error-card" :data-open="open ? 'true' : 'false'">
    <button class="tec-trigger" @click="open = !open">
      <span class="tec-icon">⚠</span>
      <span class="tec-name">{{ name }}</span>
      <span class="tec-subtitle">{{ displaySubtitle }}</span>
      <span class="tec-arrow" :class="{ open }">▾</span>
    </button>
    <div v-if="open" class="tec-body">
      <pre class="tec-error-text">{{ body }}</pre>
    </div>
  </div>
</template>
