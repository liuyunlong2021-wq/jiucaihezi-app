/**
 * myFilesProvider.ts — P3 我的文件夹路径解析
 *
 * 职责：提供 ~/韭菜盒子/ 路径。
 * 桌面专属，Web 端不调用。
 *
 * 当前状态：预留文件。实际「我的文件」按钮直接打开 data/media/。
 * 未来切换到 ~/韭菜盒子/ 中文目录 + symlink 方案时启用此模块。
 */

import { isTauriRuntime } from './tauriEnv'

const MY_FILES_DIR = '韭菜盒子'

let homedir = ''

async function getHomeDir(): Promise<string> {
  if (homedir) return homedir
  const { homeDir } = await import('@tauri-apps/api/path')
  homedir = await homeDir()
  return homedir
}

/**
 * 获取「我的文件」根路径
 */
export async function getMyFilesRoot(): Promise<string> {
  const home = await getHomeDir()
  const { join } = await import('@tauri-apps/api/path')
  return await join(home, MY_FILES_DIR)
}
