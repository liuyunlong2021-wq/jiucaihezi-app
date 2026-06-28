/**
 * pacedStreaming.ts — 流式文本步进渲染（对齐 OpenCode 官方 PacedMarkdown / createPacedValue）
 *
 * 官方源码: message-part.tsx:205-260
 *
 * 算法：
 *   TEXT_RENDER_PACE_MS = 24    每步间隔 24ms
 *   TEXT_RENDER_IMMEDIATE = 512  剩余 <=512 字符立即渲染
 *   TEXT_RENDER_SNAP            在词边界断句（空格、标点等）
 *   step(size)                  动态步长：12→2, 48→4, 96→8, 256→min(256,size/4)
 */
import { ref, watch, onBeforeUnmount } from 'vue'

const TEXT_RENDER_PACE_MS = 24
const TEXT_RENDER_IMMEDIATE = 512
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

function step(size: number): number {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(256, Math.ceil(size / 4))
}

function nextEnd(text: string, start: number): number {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? '')) return i + 1
  }
  return end
}

/**
 * usePacedValue — 创建步进渲染的响应式值（对齐 OpenCode createPacedValue）
 *
 * @param getText 获取最新完整文本的回调（通常返回 computed/ref 值）
 * @param isLive  是否处于流式接收中
 * @returns 步进后的显示文本 ref
 */
export function usePacedValue(getText: () => string, isLive: () => boolean) {
  const shown = ref('')
  let timeout: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (timeout !== undefined) {
      clearTimeout(timeout)
      timeout = undefined
    }
  }

  const sync = (text: string) => {
    shown.value = text
  }

  const run = () => {
    timeout = undefined
    const text = getText()
    if (!isLive()) {
      sync(text)
      return
    }
    if (!text.startsWith(shown.value) || text.length <= shown.value.length) {
      sync(text)
      return
    }
    if (text.length - shown.value.length <= TEXT_RENDER_IMMEDIATE) {
      sync(text)
      return
    }
    const end = nextEnd(text, shown.value.length)
    sync(text.slice(0, end))
    if (end < text.length) timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  }

  watch(
    () => getText(),
    (text) => {
      if (!isLive()) {
        clear()
        sync(text)
        return
      }
      if (!text.startsWith(shown.value) || text.length < shown.value.length) {
        clear()
        sync(text)
        return
      }
      if (text.length - shown.value.length <= TEXT_RENDER_IMMEDIATE) {
        clear()
        sync(text)
        return
      }
      if (text.length === shown.value.length || timeout) return
      timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    clear()
  })

  return shown
}
