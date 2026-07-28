import { isTauriRuntime } from './tauriEnv'

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_clipboard_text', { text })
      return true
    } catch { /* WebView fallback below */ }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* legacy fallback below */ }

  const textarea = document.createElement('textarea')
  const selection = document.getSelection()
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    if (selection && selectedRange) {
      selection.removeAllRanges()
      selection.addRange(selectedRange)
    }
  }
}
