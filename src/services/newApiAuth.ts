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
  return `${labels[kind] || '此功能'}需要可用于模型调用的 API Key。请在设置里完成一键登录生成 Key，或在高级功能里填写自己的 API Key。\n\n也可以切换到本地模型（Ollama / 本地 MLX）继续使用。`
}

export { getApiKey }
