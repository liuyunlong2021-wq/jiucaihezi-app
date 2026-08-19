export interface CanvasPointEvent {
  getInnerPoint(node: unknown): { x: number; y: number }
}

export function canvasAnnotationPoint(event: CanvasPointEvent, node: unknown) {
  return event.getInnerPoint(node)
}

interface CanvasRect {
  x: number
  y: number
  width: number
  height: number
}

export function canvasMediaPosition(input: {
  selected: CanvasRect[]
  viewport: { width: number; height: number; x: number; y: number; scale: number }
  media: Pick<CanvasRect, 'width' | 'height'>
  gap: number
}) {
  if (input.selected.length) {
    return {
      x: Math.max(...input.selected.map(item => item.x + item.width)) + input.gap,
      y: Math.min(...input.selected.map(item => item.y)),
    }
  }
  const scale = Math.max(input.viewport.scale, 0.01)
  return {
    x: (input.viewport.width / 2 - input.viewport.x) / scale - input.media.width / 2,
    y: (input.viewport.height / 2 - input.viewport.y) / scale - input.media.height / 2,
  }
}
