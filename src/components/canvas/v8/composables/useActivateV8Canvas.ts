/**
 * useActivateV8Canvas.ts
 *
 * Helper to activate V8 hand-feel behaviors on the current canvas.
 * This is temporary during Phase 0 development.
 *
 * Usage (in CanvasWorkspace for testing):
 *   const { activate } = useActivateV8Canvas()
 *   activate()
 */

import { onMounted, onUnmounted } from 'vue'

export function useActivateV8Canvas() {
  const activate = () => {
    // Future: This will patch VueFlow behaviors, register new node types, etc.
    console.log('[V8] Hand-feel infrastructure activated (Phase 0)')
    document.body.dataset.v8Canvas = 'active'
  }

  const deactivate = () => {
    document.body.dataset.v8Canvas = ''
  }

  onUnmounted(() => {
    deactivate()
  })

  return {
    activate,
    deactivate,
  }
}