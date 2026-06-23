/**
 * Temporary activation script for Phase 0 development.
 * 
 * In a real dev environment, you can import and call this
 * from CanvasWorkspace to test the new hand-feel system.
 */

import { useActivateCanvas } from '../composables/useActivateCanvas'
import { globalFreeze } from '../composables/useCanvasInteractionFreeze'

export function activatePhase0() {
  const { activate } = useActivateCanvas()
  activate()

  // Expose some debug tools on window during development
  if (typeof window !== 'undefined') {
    (window as any).__v8 = {
      freeze: globalFreeze,
      activatePhase0,
    }
    console.log('[Phase 0] Debug tools available on window.__v8')
  }
}