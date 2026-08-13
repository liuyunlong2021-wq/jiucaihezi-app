export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const runtime = window as any
  return runtime.isTauri === true ||
    typeof runtime.__TAURI_INTERNALS__ === 'object' ||
    '__TAURI__' in runtime
}

export function isTauriMobileRuntime(): boolean {
  if (!isTauriRuntime()) return false
  return /Android|iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
