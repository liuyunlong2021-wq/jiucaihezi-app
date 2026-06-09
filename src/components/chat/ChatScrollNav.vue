<script setup lang="ts">
/**
 * ChatScrollNav.vue — 逐条消息滚动导航（右侧浮动）
 *
 * 功能：
 *   - 上按钮：滚动到上一条消息的头部
 *   - 下按钮：滚动到下一条消息的头部
 *   - 发送后默认贴着当前输出，用户手动上滚后暂停跟随
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { ChatMessage } from '@/composables/useChat'
import {
  createBottomAnchorFollow,
  isNearBottom,
  shouldAutoScrollAfterContentChange,
} from './display/autoScrollPolicy'

const props = defineProps<{
  container: HTMLElement | null
  isStreaming: boolean
  messages?: ChatMessage[]
}>()

const showNav = ref(false)
const userScrolled = ref(false)
let scrollFrameId: number | null = null
let bottomAnchorFrameId: number | null = null
let pendingAutoScrollAllowed = false
let programmaticScroll = false
let programmaticScrollTimer: number | null = null
let programmaticScrollTarget = 0
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

// 当前可视的消息索引

function update() {
  const el = props.container
  if (!el) return
  showNav.value = el.scrollHeight > el.clientHeight + 24
}

// 获取所有 .msg 元素
function getMsgElements(): HTMLElement[] {
  if (!props.container) return []
  return Array.from(props.container.querySelectorAll('.msg'))
}

// 找到当前可见的消息索引
function findCurrentVisibleIndex(): number {
  const els = getMsgElements()
  if (!els.length || !props.container) return -1
  const containerTop = props.container.scrollTop
  for (let i = els.length - 1; i >= 0; i--) {
    if (els[i].offsetTop <= containerTop + 10) return i
  }
  return 0
}

// 上一条消息
function scrollPrev() {
  const els = getMsgElements()
  if (!els.length || !props.container) return
  const current = findCurrentVisibleIndex()
  const target = Math.max(0, current - 1)
  els[target].scrollIntoView({ behavior: 'smooth', block: 'start' })
  userScrolled.value = true
}

// 下一条消息 — 滚到当前消息底部
function scrollNext() {
  const els = getMsgElements()
  if (!els.length || !props.container) return
  const current = findCurrentVisibleIndex()
  // 先滚到当前消息底部，如果已经在底部则滚到下一条
  const el = els[current]
  const elBottom = el.offsetTop + el.offsetHeight
  const viewBottom = props.container.scrollTop + props.container.clientHeight
  if (elBottom > viewBottom + 10) {
    // 当前消息还没看完，滚到当前消息底部
    els[current].scrollIntoView({ behavior: 'smooth', block: 'end' })
  } else {
    // 已看完，滚到下一条消息底部
    const target = Math.min(els.length - 1, current + 1)
    els[target].scrollIntoView({ behavior: 'smooth', block: 'end' })
    if (target === els.length - 1) {
      userScrolled.value = false
    }
  }
}

// 检测用户手动滚动
function onScroll() {
  update()
  if (programmaticScroll && props.container) {
    if (Math.abs(props.container.scrollTop - programmaticScrollTarget) < 2) return
  }
  if (props.isStreaming && props.container) {
    const el = props.container
    userScrolled.value = !isNearBottom(el)
  }
}

// 流式输出时智能滚底
function autoScrollIfNeeded() {
  if (!userScrolled.value && props.container) {
    props.container.scrollTop = props.container.scrollHeight
  }
}

function scrollToBottomNow() {
  const el = props.container
  if (!el) return
  if (programmaticScrollTimer !== null) window.clearTimeout(programmaticScrollTimer)
  programmaticScroll = true
  programmaticScrollTarget = Math.max(0, el.scrollHeight - el.clientHeight)
  el.scrollTop = el.scrollHeight
  requestAnimationFrame(() => {
    const nextEl = props.container
    if (nextEl && !userScrolled.value) {
      programmaticScrollTarget = Math.max(0, nextEl.scrollHeight - nextEl.clientHeight)
      nextEl.scrollTop = nextEl.scrollHeight
    }
    programmaticScrollTimer = window.setTimeout(() => {
      programmaticScroll = false
      programmaticScrollTimer = null
    }, 1500)
  })
}

function startMeasuredBottomAnchor(frames = props.isStreaming ? 90 : 12) {
  const el = props.container
  if (!el || userScrolled.value) return
  const follow = createBottomAnchorFollow({
    frames,
    isAnchored: () => Boolean(props.container && !userScrolled.value),
    scrollToBottom: () => {
      const nextEl = props.container
      if (!nextEl) return
      nextEl.scrollTop = nextEl.scrollHeight
    },
  })
  const tick = () => {
    bottomAnchorFrameId = null
    if (!follow.tick()) return
    bottomAnchorFrameId = requestAnimationFrame(tick)
  }
  if (bottomAnchorFrameId !== null) cancelAnimationFrame(bottomAnchorFrameId)
  bottomAnchorFrameId = requestAnimationFrame(tick)
}

function startStickyFollow() {
  userScrolled.value = false
  pendingAutoScrollAllowed = true
  scrollToBottomNow()
  startMeasuredBottomAnchor()
}

function scheduleAutoScrollIfNeeded() {
  const el = props.container
  if (!el) return
  const wasAtBottom = isNearBottom(el)
  pendingAutoScrollAllowed = pendingAutoScrollAllowed || (props.isStreaming ? !userScrolled.value : wasAtBottom)
  if (scrollFrameId !== null) return
  scrollFrameId = requestAnimationFrame(() => {
    scrollFrameId = null
    const el = props.container
    const shouldScroll = pendingAutoScrollAllowed
    pendingAutoScrollAllowed = false
    if (!el || !shouldAutoScrollAfterContentChange({ wasAtBottom: shouldScroll, userScrolled: userScrolled.value })) return
    if (programmaticScrollTimer !== null) window.clearTimeout(programmaticScrollTimer)
    programmaticScroll = true
    programmaticScrollTarget = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = el.scrollHeight
    startMeasuredBottomAnchor()
    programmaticScrollTimer = window.setTimeout(() => {
      programmaticScroll = false
      programmaticScrollTimer = null
    }, 1500)
  })
}

function observeMessageElements() {
  const el = props.container
  if (!el || typeof ResizeObserver === 'undefined') return
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => {
    update()
    if (props.isStreaming) scheduleAutoScrollIfNeeded()
  })
  resizeObserver.observe(el)
  for (const messageEl of getMsgElements().slice(-4)) {
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
      update()
      observeMessageElements()
      if (props.isStreaming) scheduleAutoScrollIfNeeded()
    })
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }
  observeMessageElements()
}

watch(() => props.isStreaming, (streaming) => {
  if (streaming) {
    observeMessageElements()
    scheduleAutoScrollIfNeeded()
  } else {
    userScrolled.value = false
  }
})

defineExpose({ autoScrollIfNeeded, scheduleAutoScrollIfNeeded, startStickyFollow, userScrolled, scrollNext, scrollPrev })

onMounted(() => {
  props.container?.addEventListener('scroll', onScroll, { passive: true })
  attachContainerObservers(props.container)
  update()
})

onBeforeUnmount(() => {
  if (scrollFrameId !== null) cancelAnimationFrame(scrollFrameId)
  if (bottomAnchorFrameId !== null) cancelAnimationFrame(bottomAnchorFrameId)
  if (programmaticScrollTimer !== null) window.clearTimeout(programmaticScrollTimer)
  props.container?.removeEventListener('scroll', onScroll)
  detachContainerObservers()
})

watch(() => props.container, (newEl, oldEl) => {
  oldEl?.removeEventListener('scroll', onScroll)
  newEl?.addEventListener('scroll', onScroll, { passive: true })
  attachContainerObservers(newEl)
  update()
})
</script>

<template>
  <div v-if="showNav" class="scroll-nav-rail">
    <button class="scroll-btn" @click="scrollPrev" title="上一条消息">
      <span class="mso">keyboard_arrow_up</span>
    </button>
    <button class="scroll-btn" @click="scrollNext" title="下一条消息">
      <span class="mso">keyboard_arrow_down</span>
    </button>
  </div>
</template>

<style scoped>
.scroll-nav-rail {
  position: absolute;
  right: 44px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 20;
  animation: fade-in .2s ease;
  pointer-events: none;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.scroll-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--paper); color: var(--ink2);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .12s;
  box-shadow: 0 2px 6px rgba(0,0,0,.08);
  opacity: 0.7;
  pointer-events: auto;
}
.scroll-btn:hover {
  background: var(--olive); color: #fff; border-color: var(--olive);
  opacity: 1;
}
.scroll-btn .mso { font-size: 20px; }
</style>
