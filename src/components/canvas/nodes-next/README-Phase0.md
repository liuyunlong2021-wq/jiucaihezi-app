# Phase 0 - Hand-feel Infrastructure (V8)

## Status
**In Progress** (Internal execution only)

## Delivered Components

### Core
- `NodeFrame.vue` — Unified lightweight node shell with:
  - Role-based left color bar
  - Collapsed support (content completely unmounted from render tree)
  - Bottom execution bar
  - Resize handle

### Composables
- `useCanvasInteractionFreeze.ts` — Global drag/resize freeze strategy (with VueFlow enhancement)
- `useNodeResize.ts` — RAF-based high performance resize (zero reactive updates during drag)
- `useNodeBehavior.ts` — Recommended high-level wrapper (combines freeze + resize)
- `useNode.ts` — Convenience wrapper (legacy)

### Utilities
- `performanceBenchmark.ts` — Jank measurement tools for TDD validation (F-002, F-003, TN-003)

### Styles
- `canvas-freeze.css` — Critical styles activated during `.canvas-interacting`

## How to Test (Dev Only)
```ts
import { NodeFrame, useNodeBehavior, activatePhase0 } from '@/components/canvas/v8'

// 推荐
activatePhase0() // 一键激活样式和调试工具
```

开发调试面板：
```ts
import { DevPhase0Panel } from '@/components/canvas/v8'
```

## TDD Tests This Phase Targets
- F-002: Global freeze strategy during interaction
- F-003: Collapsed nodes stop rendering content
- TN-003: 30-node performance benchmark

## Next (still Phase 0)
- Wire freeze + resize into a real demo inside CanvasWorkspace (feature-flagged)
- Run actual benchmark numbers
- Final cleanup + documentation

**Do not merge into main until full Phase 0 sign-off.**
