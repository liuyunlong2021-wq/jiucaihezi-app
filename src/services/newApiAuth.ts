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
  return `${labels[kind] || '此功能'}需要先填写 API Key。\n\n请到 **设置** 点击"获取 Key"，复制后粘贴到输入框并保存。\n\n或者切换到本地模型（Ollama / 本地 MLX）继续使用。`
}

export { getApiKey }
