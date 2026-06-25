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

const userScrolled = ref(false)
let scrollFrameId: number | null = null
let bottomAnchorFrameId: number | null = null
let pendingAutoScrollAllowed = false
let programmaticScroll = false
let programmaticScrollTimer: number | null = null
let programmaticScrollTarget = 0
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

// 占位——原用于控制滚动导航按钮显隐，按钮已移除
function update() {}

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
  // 流式输出时每次都重新排队 rAF，确保最新内容触达时能及时滚到底部
  if (scrollFrameId !== null) {
    cancelAnimationFrame(scrollFrameId)
    scrollFrameId = null
  }
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

defineExpose({ autoScrollIfNeeded, scheduleAutoScrollIfNeeded, startStickyFollow, userScrolled })

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
