<script setup lang="ts">
/**
 * ChatScrollNav.vue — 粘性滚动控制（对标 OpenCode ScrollBoxRenderable）
 *
 * 核心机制：
 *   stickyScrollBottom = true  → 新内容到达时自动滚到底部
 *   stickyScrollBottom = false → 用户手动离开了底部，停止自动跟滚
 *   用户滚回底部 → stickyScrollBottom 恢复 true → 重新开始跟滚
 *
 * 对标 OpenCode index.tsx：
 *   stickyScroll={true} + stickyStart="bottom"
 *   ScrollBoxRenderable._stickyScrollBottom
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { ChatMessage } from '@/composables/useChat'
import { isNearBottom } from './display/autoScrollPolicy'

const props = defineProps<{
  container: HTMLElement | null
  isStreaming: boolean
  messages?: ChatMessage[]
}>()

// ─── 核心状态：对标 ScrollBoxRenderable._stickyScrollBottom ───
const stickyScrollBottom = ref(true)

let programmaticScroll = false
let programmaticScrollTimer: number | null = null
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let autoScrollTimer: ReturnType<typeof setTimeout> | null = null
let settling = false
let settlingTimer: number | null = null

// ─── 公开给 ChatPanel 渲染「滚到底部」按钮 ───
const showScrollToBottom = computed(() => !stickyScrollBottom.value)

// ─── 公开给 ChatPanel（保持向后兼容） ───
const userScrolled = computed(() => !stickyScrollBottom.value)

// ─── 滚动位置判断 ───

function canScroll(el: HTMLElement): boolean {
  return el.scrollHeight - el.clientHeight > 1
}

function nearBottom(el: HTMLElement, threshold = 10): boolean {
  return isNearBottom({
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    threshold,
  })
}

// ─── stickyScroll 核心：对标 updateStickyState() ───
// 始终更新 stickyScrollBottom，不区分 streaming/non-streaming

function updateStickyState() {
  const el = props.container
  if (!el) return
  if (!canScroll(el)) {
    stickyScrollBottom.value = true
    return
  }
  // 程序化滚动中 → 不改变 sticky 状态（避免 programmatic scroll 被误判为用户滚动）
  if (programmaticScroll) return
  stickyScrollBottom.value = nearBottom(el, 10)
}

function onScroll() {
  updateStickyState()
}

function onWheel(e: WheelEvent) {
  // 只关心向上滚动（用户主动离开底部）
  if (e.deltaY >= 0) return
  const el = props.container
  const target = e.target instanceof Element ? e.target : undefined
  const nested = target?.closest('[data-scrollable]')
  // 嵌套滚动区域（如代码块）内的滚轮不触发粘性解除
  if (el && nested && nested !== el) return
  stickyScrollBottom.value = false
}

// ─── 滚到底部 ───

function scrollToBottomNow() {
  const el = props.container
  if (!el) return
  if (programmaticScrollTimer !== null) window.clearTimeout(programmaticScrollTimer)
  programmaticScroll = true
  // ponytail: 虚拟列表（useVirtualizer）会修改内部元素高度来模拟滚动区域，
  // el.scrollHeight 可能在虚拟列表重算之前返回旧值。
  // scrollTop = 极大值 比 scrollTop = scrollHeight 更可靠 —— 浏览器自动 clamp 到实际最大值
  el.scrollTop = 9_999_999
  // 双重 rAF 确保布局 + 虚拟列表重算完成后再滚一次
  requestAnimationFrame(() => {
    const nextEl = props.container
    if (nextEl) {
      nextEl.scrollTop = 9_999_999
    }
    programmaticScrollTimer = window.setTimeout(() => {
      programmaticScroll = false
      programmaticScrollTimer = null
    }, 150)
  })
}

// ─── 用户主动滚回底部（点击按钮或手动滚到底） ───

function scrollToBottom() {
  stickyScrollBottom.value = true
  scrollToBottomNow()
}

// ─── 发送消息后强制粘底（对标 startStickyFollow） ───

function startStickyFollow() {
  stickyScrollBottom.value = true
  scrollToBottomNow()
}

// ─── 内容变化时智能跟滚 ───

function scheduleAutoScrollIfNeeded() {
  if (!stickyScrollBottom.value) return
  // ponytail: 不用 rAF 防抖 —— 流式输出时 mutation 太快，
  // rAF 回调在执行前就被下一轮 cancel 掉了，导致永不滚底。
  // 改用 16ms throttle（~60fps），确保每个渲染帧至少滚一次。
  if (autoScrollTimer !== null) return
  autoScrollTimer = setTimeout(() => {
    autoScrollTimer = null
    scrollToBottomNow()
  }, 16)
}

// ─── 内容观察（MutationObserver + ResizeObserver） ───

function observeMessageElements() {
  const el = props.container
  if (!el || typeof ResizeObserver === 'undefined') return
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => {
    if (stickyScrollBottom.value) scrollToBottomNow()
  })
  resizeObserver.observe(el)
  // 观察最后 4 条消息的大小变化（图片加载等）
  for (const messageEl of Array.from(el.querySelectorAll('.msg')).slice(-4)) {
    resizeObserver.observe(messageEl)
  }
}

function detachContainerObservers() {
  mutationObserver?.disconnect()
  mutationObserver = null
  resizeObserver?.disconnect()
  resizeObserver = null
}

function attachContainerObservers(el: HTMLElement | null) {
  detachContainerObservers()
  if (!el) return
  if (typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(() => {
      observeMessageElements()
      if (stickyScrollBottom.value) scheduleAutoScrollIfNeeded()
    })
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }
  observeMessageElements()
}

// ─── 流式结束后的 "settling" 窗口（处理最后的渲染震荡） ───

watch(() => props.isStreaming, (streaming) => {
  if (settlingTimer !== null) {
    window.clearTimeout(settlingTimer)
    settlingTimer = null
  }
  settling = false
  if (streaming) {
    observeMessageElements()
    scheduleAutoScrollIfNeeded()
  } else {
    // 流式结束后短暂保持 "活跃" 状态，处理最后的布局震荡
    settling = true
    settlingTimer = window.setTimeout(() => { settling = false }, 300)
    // 结束时也滚一次，确保最终内容可见
    if (stickyScrollBottom.value) {
      scheduleAutoScrollIfNeeded()
    }
  }
})

// ─── 暴露 API ───

defineExpose({
  scheduleAutoScrollIfNeeded,
  startStickyFollow,
  scrollToBottom,
  stickyScrollBottom,
  showScrollToBottom,
  userScrolled,
})

// ─── 生命周期 ───

onMounted(() => {
  props.container?.addEventListener('scroll', onScroll, { passive: true })
  props.container?.addEventListener('wheel', onWheel, { passive: true })
  attachContainerObservers(props.container)
  updateStickyState()
})

onBeforeUnmount(() => {
  if (autoScrollTimer !== null) clearTimeout(autoScrollTimer)
  if (programmaticScrollTimer !== null) window.clearTimeout(programmaticScrollTimer)
  if (settlingTimer !== null) window.clearTimeout(settlingTimer)
  props.container?.removeEventListener('scroll', onScroll)
  props.container?.removeEventListener('wheel', onWheel)
  detachContainerObservers()
})

watch(() => props.container, (newEl, oldEl) => {
  oldEl?.removeEventListener('scroll', onScroll)
  oldEl?.removeEventListener('wheel', onWheel)
  newEl?.addEventListener('scroll', onScroll, { passive: true })
  newEl?.addEventListener('wheel', onWheel, { passive: true })
  attachContainerObservers(newEl)
  updateStickyState()
})
</script>

<template>
  <!-- renderless: 所有逻辑通过 defineExpose 暴露给 ChatPanel -->
</template>
