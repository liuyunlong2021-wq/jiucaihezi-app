export function isNearBottom(input: {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  threshold?: number
}): boolean {
  const threshold = input.threshold ?? 80
  return input.scrollTop + input.clientHeight >= input.scrollHeight - threshold
}

export function shouldAutoScrollAfterContentChange(input: {
  wasAtBottom: boolean
  userScrolled: boolean
}): boolean {
  return input.wasAtBottom && !input.userScrolled
}

export function createBottomAnchorFollow(input: {
  frames?: number
  isAnchored: () => boolean
  scrollToBottom: () => void
}) {
  let remaining = Math.max(0, input.frames ?? 90)
  return {
    tick(): boolean {
      if (remaining <= 0) return false
      if (!input.isAnchored()) {
        remaining = 0
        return false
      }
      input.scrollToBottom()
      remaining -= 1
      return remaining > 0
    },
  }
}
