<script setup lang="ts">
/**
 * ToolStatusTitle.vue — 工具状态标题（对齐 OpenCode 官方 ToolStatusTitle）
 *
 * 官方源码: tool-status-title.tsx
 * 功能：active 态显示 shimmer 文本，done 态显示静态文本，切换时有 common prefix 和宽度动画
 */
import { computed, ref, onBeforeUnmount } from 'vue'

const props = defineProps<{
  active: boolean
  activeText: string
  doneText: string
  split?: boolean
}>()

// 对齐官方 common() 函数：找出 activeText 和 doneText 的共同前缀
const commonParts = computed(() => {
  const a = Array.from(props.activeText)
  const b = Array.from(props.doneText)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return {
    prefix: a.slice(0, i).join(''),
    activeSuffix: a.slice(i).join(''),
    doneSuffix: b.slice(i).join(''),
  }
})

const shouldSplit = computed(() => {
  if (props.split === false) return false
  const { prefix, activeSuffix, doneSuffix } = commonParts.value
  return prefix.length >= 2 && activeSuffix.length > 0 && doneSuffix.length > 0
})

const displayActive = computed(() => shouldSplit.value ? commonParts.value.activeSuffix : props.activeText)
const displayDone = computed(() => shouldSplit.value ? commonParts.value.doneSuffix : props.doneText)

const animating = ref(false)
const width = ref<string | undefined>(undefined)
let frame: number | undefined
let finishTimer: ReturnType<typeof setTimeout> | undefined
let activeRef: HTMLSpanElement | undefined
let doneRef: HTMLSpanElement | undefined

const finish = () => {
  if (frame !== undefined) cancelAnimationFrame(frame)
  if (finishTimer !== undefined) clearTimeout(finishTimer)
  frame = undefined
  finishTimer = undefined
  animating.value = false
  width.value = undefined
}

const startAnimate = () => {
  finish()
  animating.value = true
  const el = props.active ? activeRef : doneRef
  if (!el) { finish(); return }
  const w = `${Math.ceil(el.getBoundingClientRect().width)}px`
  width.value = w
  finishTimer = setTimeout(finish, 600)
}

onBeforeUnmount(finish)
</script>

<template>
  <span data-component="tool-status-title" :class="{ animating }">
    <span v-if="shouldSplit" class="tst-prefix">{{ commonParts.prefix }}</span>
    <span
      v-if="shouldSplit"
      data-slot="tst-varying"
      :style="width ? { width, transition: 'width 350ms ease' } : undefined"
    >
      <span v-show="active" ref="activeRef">{{ displayActive }}</span>
      <span v-show="!active" ref="doneRef">{{ displayDone }}</span>
    </span>
    <span v-else-if="active">{{ activeText }}</span>
    <span v-else>{{ doneText }}</span>
  </span>
</template>
