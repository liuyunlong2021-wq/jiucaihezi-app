import { isTauriRuntime } from './tauriEnv'

export interface ConfirmActionOptions {
  title?: string
  kind?: 'info' | 'warning' | 'error'
  okLabel?: string
  cancelLabel?: string
}

export async function confirmAction(message: string, options: ConfirmActionOptions = {}): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      const { confirm } = await import('@tauri-apps/plugin-dialog')
      return await confirm(message, {
        title: options.title,
        kind: options.kind || 'warning',
        okLabel: options.okLabel || '确定',
        cancelLabel: options.cancelLabel || '取消',
      })
    } catch {
      // Fall back to the browser path below. Confirmation must not crash the action.
    }
  }

  const nativeConfirm = globalThis.confirm
  if (typeof nativeConfirm === 'function') {
    return Boolean(nativeConfirm(message))
  }
  return false
}
