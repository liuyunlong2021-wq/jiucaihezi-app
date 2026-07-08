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
    <span v-if="shouldSplit" class="tst-prefix" :class="{ 'tst-shimmer-text': active }">{{ commonParts.prefix }}</span>
    <span
      v-if="shouldSplit"
      data-slot="tst-varying"
      :style="width ? { width, transition: 'width 350ms ease' } : undefined"
    >
      <span v-show="active" ref="activeRef" class="tst-shimmer-text">{{ displayActive }}</span>
      <span v-show="!active" ref="doneRef">{{ displayDone }}</span>
    </span>
    <span v-else-if="active" class="tst-shimmer-text">{{ activeText }}</span>
    <span v-else>{{ doneText }}</span>
  </span>
</template>

<!-- ponytail: TextShimmer CSS — 流光动画（对齐 OpenCode text-shimmer.tsx） -->
<style scoped>
.tst-shimmer-text {
  /* 渐变：当前色 → 半透明 → 当前色，左右扫 */
  background: linear-gradient(
    90deg,
    currentColor 0%,
    color-mix(in srgb, currentColor 20%, transparent) 45%,
    color-mix(in srgb, currentColor 20%, transparent) 55%,
    currentColor 100%
  );
  background-size: 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: tst-shimmer 2s ease-in-out infinite;
}

@keyframes tst-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -50% 0; }
}
</style>
