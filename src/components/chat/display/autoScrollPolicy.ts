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
