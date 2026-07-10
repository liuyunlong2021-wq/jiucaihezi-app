/**
 * useUpdater.ts — OTA 自动更新
 * 对齐 tauri-plugin-updater 官方 API
 */
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ref } from 'vue'

export function useUpdater() {
  const updateAvailable = ref(false)
  const updateVersion = ref('')
  const updateNotes = ref('')
  const downloading = ref(false)
  const downloadProgress = ref(0)
  const checking = ref(false)
  const checkError = ref('')

  async function checkUpdate() {
    if (checking.value) return
    checking.value = true
    checkError.value = ''
    try {
      const update = await check()
      if (!update) {
        checkError.value = '已是最新版本'
        setTimeout(() => { checkError.value = '' }, 3000)
        return
      }
      updateAvailable.value = true
      updateVersion.value = update.version
      updateNotes.value = update.body || ''
    } catch {
      checkError.value = '检查更新失败（仅桌面端可用）'
      setTimeout(() => { checkError.value = '' }, 4000)
    } finally {
      checking.value = false
    }
  }

  async function downloadAndInstall() {
    try {
      const update = await check()
      if (!update) return
      downloading.value = true

      let downloaded = 0
      await update.downloadAndInstall((e) => {
        switch (e.event) {
          case 'Started':
            downloaded = 0
            break
          case 'Progress':
            downloaded += e.data.chunkLength
            break
          case 'Finished':
            downloading.value = false
            break
        }
      })

      await relaunch()
    } catch {
      downloading.value = false
    }
  }

  return {
    updateAvailable,
    updateVersion,
    updateNotes,
    downloading,
    downloadProgress,
    checking,
    checkError,
    checkUpdate,
    downloadAndInstall,
  }
}
