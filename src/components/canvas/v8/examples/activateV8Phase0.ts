/**
 * Temporary activation script for Phase 0 development.
 * 
 * In a real dev environment, you can import and call this
 * from CanvasWorkspace to test the new hand-feel system.
 */

import { useActivateV8Canvas } from '../composables/useActivateV8Canvas'
import { globalFreeze } from '../composables/useCanvasInteractionFreeze'

export function activateV8Phase0() {
  const { activate } = useActivateV8Canvas()
  activate()

  // Expose some debug tools on window during development
  if (typeof window !== 'undefined') {
    (window as any).__v8 = {
      freeze: globalFreeze,
      activateV8Phase0,
    }
    console.log('[V8 Phase 0] Debug tools available on window.__v8')
  }
}