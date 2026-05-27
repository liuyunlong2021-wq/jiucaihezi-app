/**
 * NewAPI 登录链路
 * - 跳转 NewAPI 登录页（带 jc_return 让 NewAPI 知道登录后回哪）
 * - 跳回客户端时由 Rust on_navigation 拦截，URL ?key=sk-xxx → 存 Keychain
 */
import { setApiKey, getApiKey, clearApiKey, DEFAULT_API_BASE_URL } from './newApiClient'

const NEWAPI_BASE = DEFAULT_API_BASE_URL
const RETURN_URL = 'https://jiucaihezi.studio'   // 在 MYnewapi workbenchReturn.js 白名单里

/** 已登录？*/
export async function isCloudLoggedIn(): Promise<boolean> {
  const key = getApiKey()
  if (key) return true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const stored = await invoke<string | null>('get_api_key').catch(() => null)
    return Boolean(stored)
  } catch {
    return false
  }
}

/** 跳转 NewAPI 密钥管理页（一键登录入口） */
export function gotoLogin() {
  const url = `${NEWAPI_BASE}/keys?jc_return=${encodeURIComponent(RETURN_URL)}`
  window.location.href = url
}

/** 跳转 NewAPI 管理后台 */
export function gotoConsole(path = '/console') {
  const url = `${NEWAPI_BASE}${path}?jc_return=${encodeURIComponent(RETURN_URL)}`
  window.location.href = url
}

/** 退出登录 */
export async function logout() {
  await clearApiKey()
}

/** 启动时从 URL ?key= 读 token 并存 Keychain（被 on_navigation 切回工作台时触发）*/
export async function consumeKeyFromUrl(): Promise<boolean> {
  try {
    const params = new URLSearchParams(window.location.search)
    const key = params.get('key')
    if (key && key.trim()) {
      await setApiKey(key.trim())
      // 清掉 URL 上的 key，避免泄露
      const cleanUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', cleanUrl)
      return true
    }
  } catch {}
  return false
}

/** 给未登录用户的引导文案（替换原 getCloudRequiredMessage）*/
export function getCloudRequiredMessage(kind: string = 'chat'): string {
  const labels: Record<string, string> = {
    chat: '云端对话',
    files: '文件分析',
    media: '图片/视频/音频生成',
  }
  return `${labels[kind] || '此功能'}需要先登录韭菜盒子账号。\n\n请到 **设置 → 账号** 点击"登录使用云端模型"。\n\n或者切换到本地模型（Ollama / 本地 MLX）继续使用。`
}

export { getApiKey } from './newApiClient'
