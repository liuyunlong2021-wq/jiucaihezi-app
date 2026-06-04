<script setup lang="ts">
/**
 * ChatScrollNav.vue — 逐条消息滚动导航（右侧浮动）
 *
 * 功能：
 *   - 上按钮：滚动到上一条消息的头部
 *   - 下按钮：滚动到下一条消息的头部
 *   - 输出时用户可自由滚动（不强制拉底）
 */
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import type { ChatMessage } from '@/composables/useChat'
import { isNearBottom, shouldAutoScrollAfterContentChange } from './display/autoScrollPolicy'

const props = defineProps<{
  container: HTMLElement | null
  isStreaming: boolean
  messages?: ChatMessage[]
}>()

const showNav = ref(false)
const userScrolled = ref(false)
let scrollFrameId: number | null = null
let pendingAutoScrollAllowed = false

// 当前可视的消息索引
let currentMsgIndex = -1

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

function scheduleAutoScrollIfNeeded() {
  const el = props.container
  if (!el) return
  const wasAtBottom = isNearBottom(el)
  pendingAutoScrollAllowed = pendingAutoScrollAllowed || wasAtBottom || !props.isStreaming
  if (scrollFrameId !== null) return
  scrollFrameId = requestAnimationFrame(() => {
    scrollFrameId = null
    const el = props.container
    const shouldScroll = pendingAutoScrollAllowed
    pendingAutoScrollAllowed = false
    if (!el || !shouldAutoScrollAfterContentChange({ wasAtBottom: shouldScroll, userScrolled: userScrolled.value })) return
    el.scrollTop = el.scrollHeight
  })
}

watch(() => props.isStreaming, (streaming) => {
  if (!streaming) userScrolled.value = false
})

defineExpose({ autoScrollIfNeeded, scheduleAutoScrollIfNeeded, userScrolled, scrollNext, scrollPrev })

onMounted(() => {
  props.container?.addEventListener('scroll', onScroll, { passive: true })
  update()
})

onBeforeUnmount(() => {
  if (scrollFrameId !== null) cancelAnimationFrame(scrollFrameId)
  props.container?.removeEventListener('scroll', onScroll)
})

watch(() => props.container, (newEl, oldEl) => {
  oldEl?.removeEventListener('scroll', onScroll)
  newEl?.addEventListener('scroll', onScroll, { passive: true })
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
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 20;
  animation: fade-in .2s ease;
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
}
.scroll-btn:hover {
  background: var(--olive); color: #fff; border-color: var(--olive);
  opacity: 1;
}
.scroll-btn .mso { font-size: 20px; }
</style>
