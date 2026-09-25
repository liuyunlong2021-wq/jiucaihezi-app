import {
  clearApiKey,
  getApiKey,
  initApiKey,
} from './newApiClient'

export async function isCloudLoggedIn(): Promise<boolean> {
  return Boolean(getApiKey() || await initApiKey())
}

/** 退出登录 */
export async function logout() {
  await clearApiKey()
  try { localStorage.removeItem('jcApiBase') } catch {}
}

/** 给未登录用户的引导文案 */
export function getCloudRequiredMessage(kind: string = 'chat'): string {
  const labels: Record<string, string> = {
    chat: '云端对话',
    files: '文件分析',
    media: '图片/视频/音频生成',
  }
  return `${labels[kind] || '此功能'}需要你自己的模型调用 Key。账号登录只开启云端同步，不会替你获取 Key。请在设置里填写 API Key（可在「管理密钥」页面创建），或切换到本地模型（Ollama / 自定义端点）继续使用。`
}

export { getApiKey }
