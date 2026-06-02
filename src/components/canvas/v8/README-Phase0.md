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
- `useV8NodeResize.ts` — RAF-based high performance resize (zero reactive updates during drag)
- `useV8NodeBehavior.ts` — Recommended high-level wrapper (combines freeze + resize)
- `useV8Node.ts` — Convenience wrapper (legacy)

### Utilities
- `performanceBenchmark.ts` — Jank measurement tools for TDD validation (F-002, F-003, TN-003)

### Styles
- `v8-canvas-freeze.css` — Critical styles activated during `.canvas-interacting`

## How to Test (Dev Only)
```ts
import { NodeFrame, useV8NodeBehavior, activateV8Phase0 } from '@/components/canvas/v8'

// 推荐
activateV8Phase0() // 一键激活样式和调试工具
```

开发调试面板：
```ts
import { DevV8Phase0Panel } from '@/components/canvas/v8'
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
