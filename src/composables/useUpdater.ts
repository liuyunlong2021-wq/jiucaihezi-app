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

  async function checkUpdate() {
    try {
      const update = await check()
      if (!update) return
      updateAvailable.value = true
      updateVersion.value = update.version
      updateNotes.value = update.body || ''
    } catch {
      // ponytail: 网络不通/服务端未就绪时静默失败
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
    checkUpdate,
    downloadAndInstall,
  }
}
