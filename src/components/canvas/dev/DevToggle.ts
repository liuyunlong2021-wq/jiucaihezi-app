/**
 * DevToggle.ts
 *
 * 开发期开关，用于在真实 CanvasWorkspace 中安全测试 手感系统。
 * 
 * 使用方法：
 * 在浏览器控制台执行：
 *   localStorage.setItem('nb_canvas_enabled', 'true')
 * 然后刷新页面。
 *
 * 要关闭：
 *   localStorage.removeItem('nb_canvas_enabled')
 */

export function isV8CanvasEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  return localStorage.getItem('nb_canvas_enabled') === 'true'
}

/**
 * 临时激活 手感（仅开发环境）
 */
export function enableV8CanvasForThisSession() {
  if (import.meta.env.DEV) {
    localStorage.setItem('nb_canvas_enabled', 'true')
    console.log('%c[Canvas] 本次会话已临时启用 手感系统，刷新后生效', 'color:#10b981')
  }
}