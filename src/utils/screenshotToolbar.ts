export function screenshotToolbarPosition(
  selection: { left: number; top: number; width: number; height: number },
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const gap = 8
  const inset = 8
  const left = Math.max(inset, Math.min(selection.left, viewport.width - toolbar.width - inset))
  const below = selection.top + selection.height + gap
  const above = selection.top - toolbar.height - gap
  const top = below + toolbar.height <= viewport.height - inset
    ? below
    : Math.max(inset, above)
  return { left, top }
}
