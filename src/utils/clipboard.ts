import { isTauriRuntime } from './tauriEnv'

export function shouldReadNativeClipboardImage(
  imageCount: number,
  text: string,
  desktopRuntime: boolean,
  mobileRuntime: boolean,
): boolean {
  return desktopRuntime && !mobileRuntime && imageCount === 0 && !text
}

export async function readClipboardImageFile(): Promise<File | null> {
  if (!isTauriRuntime()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const image = await invoke<{
      width: number
      height: number
      rgbaBase64: string
    } | null>('read_clipboard_image')
    if (!image) return null
    const binary = atob(image.rgbaBase64)
    if (binary.length !== image.width * image.height * 4) return null
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return null
    const pixels = context.createImageData(image.width, image.height)
    for (let i = 0; i < binary.length; i++) pixels.data[i] = binary.charCodeAt(i)
    context.putImageData(pixels, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    return blob ? new File([blob], `粘贴图片_${Date.now()}.png`, { type: 'image/png' }) : null
  } catch {
    return null
  }
}

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
