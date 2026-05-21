import { isTauriRuntime } from './tauriEnv'

export interface SaveGeneratedFileInput {
  filename: string
  mimeType: string
  data: Blob | string | ArrayBuffer | Uint8Array
}

export interface SaveGeneratedFileResult {
  status: 'saved' | 'downloaded' | 'cancelled'
  path?: string
}

export function normalizeExportFilename(filename: string, fallbackExt: string): string {
  const fallback = `韭菜盒子导出.${fallbackExt.replace(/^\./, '') || 'md'}`
  const clean = String(filename || fallback)
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || fallback

  if (/\.[a-z0-9]{1,8}$/i.test(clean)) return clean
  return `${clean}.${fallbackExt.replace(/^\./, '') || 'md'}`
}

function extensionOf(filename: string): string {
  return String(filename || '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || ''
}

export function buildSaveDialogFilters(filename: string): Array<{ name: string; extensions: string[] }> {
  const ext = extensionOf(filename)
  return ext ? [{ name: `${ext.toUpperCase()} 文件`, extensions: [ext] }] : []
}

async function dataToUint8Array(data: SaveGeneratedFileInput['data']): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return new TextEncoder().encode(String(data || ''))
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function downloadInBrowser(input: SaveGeneratedFileInput): SaveGeneratedFileResult {
  const blob = input.data instanceof Blob
    ? input.data
    : new Blob([input.data as any], { type: input.mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = input.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return { status: 'downloaded' }
}

export async function saveGeneratedFile(input: SaveGeneratedFileInput): Promise<SaveGeneratedFileResult> {
  const ext = extensionOf(input.filename) || 'md'
  const filename = normalizeExportFilename(input.filename, ext)

  if (!isTauriRuntime()) {
    return downloadInBrowser({ ...input, filename })
  }

  const [{ save }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ])
  const path = await save({
    defaultPath: filename,
    filters: buildSaveDialogFilters(filename),
  })
  if (!path) return { status: 'cancelled' }

  const bytes = await dataToUint8Array(input.data)
  await invoke('save_generated_file', {
    input: {
      path,
      dataBase64: uint8ArrayToBase64(bytes),
    },
  })
  return { status: 'saved', path }
}

export async function fetchBlobForExport(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败: ${res.status}`)
  return await res.blob()
}
