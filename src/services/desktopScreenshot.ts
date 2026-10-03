import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { createRuntimeProjectFileService } from './projectFileService'
import { nextMaterialPath } from '@/utils/projectMaterials'

export function pngBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}
export function screenshotName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `截图-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`
}
export async function startScreenshotProjectBridge(getOwner: () => string | undefined, files: ReturnType<typeof createRuntimeProjectFileService>, onError: (error: string) => void) {
  // 同一截图任务超时后重试时复用成功结果，避免重复落盘。
  const saves = new Map<string, Promise<void>>()
  const stopSave = await listen<{ id: string; owner: string; pngBase64: string }>('screenshot:save-project', async ({ payload }) => {
    const save = saves.get(payload.id) || (async () => {
      if (getOwner() !== payload.owner) throw new Error('来源项目已切换，不能保存截图')
      const existing = new Set((await files.list(payload.owner)).map(item => item.path))
      if (getOwner() !== payload.owner) throw new Error('来源项目已切换，不能保存截图')
      await invoke('screenshot_validate_project', { id: payload.id, owner: payload.owner })
      if (getOwner() !== payload.owner) throw new Error('来源项目已切换，不能保存截图')
      await files.importBinary({ owner: payload.owner, path: nextMaterialPath('.raw/jc-media/图片', screenshotName(), existing), data: pngBytes(payload.pngBase64), mimeType: 'image/png' })
    })()
    saves.set(payload.id, save)
    let error: string | null = null
    try { await save } catch (cause) { error = String(cause); saves.delete(payload.id) }
    await invoke('screenshot_save_result', { id: payload.id, error }).catch(() => {})
    // ponytail: 保留最多 16 个已完成截图的回执；持久恢复需求出现时再用项目写入账本。
    if (saves.size > 16) saves.delete(saves.keys().next().value!)
  })
  let stopError: (() => void)
  try { stopError = await listen<string>('screenshot:error', ({ payload }) => onError(payload)) }
  catch (error) { stopSave(); throw error }
  return () => { stopSave(); stopError(); saves.clear() }
}
