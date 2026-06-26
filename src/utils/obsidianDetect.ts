/**
 * Obsidian 本地环境检测工具
 * ponytail: 只做最少的检测，不引入额外依赖
 */

// Obsidian 常见安装路径（fallback）
const OBSIDIAN_PATHS = ['/Applications/Obsidian.app']

// Local REST API 插件默认端口
const OBSIDIAN_API_BASE = 'https://localhost:27124'

export interface ObsidianStatus {
  /** Obsidian.app 是否安装 */
  installed: boolean | null
  /** 插件是否运行中（localhost:27124 可达） */
  pluginRunning: boolean | null
  /** API Key 是否有效 */
  keyValid: boolean | null
  /** 错误信息 */
  error?: string
}

/** 检查 Obsidian.app 是否存在 */
export async function checkObsidianInstalled(): Promise<boolean> {
  // 优先走 Rust 命令（无 FS 权限限制）
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<boolean>('check_obsidian_installed')
    } catch {
      // Rust 命令不可用时走 fallback
    }
  }

  // Web 端无法检测
  if (!isTauri()) return false

  // Fallback: plugin-fs exists（需要 fs:allow-exists 权限 + 路径在 scope 内）
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    for (const p of OBSIDIAN_PATHS) {
      if (await exists(p)) return true
    }
  } catch { /* ignore */ }
  return false
}

/** 轮询 Obsidian Local REST API，返回 HTTP 状态码或错误 */
export async function probeObsidianApi(): Promise<{ reachable: boolean; statusCode?: number; error?: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const resp = await fetch(OBSIDIAN_API_BASE + '/', {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return { reachable: true, statusCode: resp.status }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return { reachable: false, error: '连接超时 — Obsidian 可能未启动或插件未安装' }
    }
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch')) {
      return { reachable: false, error: '无法连接 localhost:27124 — 请确认 Obsidian 已启动且插件已启用' }
    }
    return { reachable: false, error: msg }
  }
}

/** 用 API Key 测试连接 */
export async function testObsidianKey(apiKey: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const resp = await fetch(OBSIDIAN_API_BASE + '/', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return resp.status === 200
  } catch {
    return false
  }
}

/** 获取完整的检测状态 */
export async function getObsidianStatus(): Promise<ObsidianStatus> {
  const status: ObsidianStatus = { installed: null, pluginRunning: null, keyValid: null }

  status.installed = await checkObsidianInstalled()
  if (!status.installed) return status

  const probe = await probeObsidianApi()
  status.pluginRunning = probe.reachable
  if (!probe.reachable) {
    status.error = probe.error
    return status
  }

  // 200 = 无需认证或 key 有效；401 = 需要 key 但没传或无效
  if (probe.statusCode === 200) {
    status.keyValid = true
  } else if (probe.statusCode === 401) {
    status.keyValid = false
  } else {
    status.keyValid = false
    status.error = `服务器返回 HTTP ${probe.statusCode}`
  }

  return status
}

/** 保存 API Key 到 localStorage */
export function saveObsidianKey(key: string): void {
  localStorage.setItem('jc_obsidian_key', key)
}

/** 读取已保存的 API Key */
export function getSavedObsidianKey(): string {
  return localStorage.getItem('jc_obsidian_key') || ''
}

/** 清除已保存的 API Key */
export function clearObsidianKey(): void {
  localStorage.removeItem('jc_obsidian_key')
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined
}
