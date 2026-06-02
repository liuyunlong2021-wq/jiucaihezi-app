/**
 * useEnsureV8Styles.ts
 * 
 * 自动确保 V8 Phase 0 样式已加载
 * 在开发模式下可以安全多次调用
 */

let stylesLoaded = false

export function ensureV8Styles() {
  if (stylesLoaded) return

  // 动态加载样式（如果还没被 import）
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/src/components/canvas/v8/styles/v8-canvas-freeze.css' // 开发时路径

  // 更健壮的方式：直接内联关键规则
  const style = document.createElement('style')
  style.textContent = `
    .canvas-interacting .v8-node-frame { transition: none !important; }
    .canvas-interacting .v8-node-frame * { pointer-events: none !important; }
    .canvas-interacting .v8-node-frame .v8-resize-handle { pointer-events: auto !important; }
    .canvas-interacting { user-select: none; -webkit-user-select: none; }
  `
  document.head.appendChild(style)

  stylesLoaded = true
  console.log('[V8] Phase 0 styles ensured')
}