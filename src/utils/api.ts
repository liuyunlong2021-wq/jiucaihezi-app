/**
 * utils/api.ts — API 请求工具
 * 源自 code.html resolveApiConfig() (行 9845-9870)
 * 源自 code.html streamChat() headers (行 10285-10289)
 */

export interface ApiConfig {
  apiKey: string
  apiBase: string
  model: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'

/**
 * 从 localStorage 解析 API 配置
 * 精确复制自 code.html 行 9845-9870 的 resolveApiConfig()
 */
export async function resolveApiConfig(): Promise<ApiConfig> {
  const config = {
    apiKey: localStorage.getItem('jcApiKey') || '',
    // API 统一走 https://api.jiucaihezi.studio（不再回退到 window.location.origin）
    apiBase: 'https://api.jiucaihezi.studio',
    model: localStorage.getItem('jcModel') || DEFAULT_MODEL,
  }

  // ─── 桌面端 OpenClaw 本地 Gateway ───
  const useLocal = localStorage.getItem('jcUseLocalGateway') === 'true'
  if (useLocal && '__TAURI__' in window) {
    const port = parseInt(localStorage.getItem('jcOpenClawPort') || '') || 18789
    const authToken = localStorage.getItem('jcOpenClawAuth') || ''
    return {
      apiKey: authToken || 'local',
      apiBase: `http://127.0.0.1:${port}`,
      model: config.model,
    }
  }

  // 行 9851-9857: JC_WORKSPACE.getConfig 覆盖（桌面版 Tauri 用）
  if ((window as any).JC_WORKSPACE?.getConfig) {
    try {
      const shared = await (window as any).JC_WORKSPACE.getConfig()
      config.apiKey = shared.apiKey || config.apiKey
      config.apiBase = (shared.apiBase || config.apiBase || ((window as any).JC_DEFAULT_API_BASE || window.location.origin)).replace(/\/+$/, '').replace(/\/v1$/, '')
      config.model = shared.model || config.model
    } catch (_) {}
  }

  // Decode base64-encoded key (行 9859-9863)
  let apiKey = config.apiKey || ''
  try {
    const decoded = atob(apiKey)
    if (decoded.startsWith('sk-')) apiKey = decoded
  } catch (_) {}

  // 行 9864: 无 key 时抛错
  if (!apiKey) throw new Error('未检测到 API Key，请先在设置中填写')

  return { apiKey, apiBase: config.apiBase, model: config.model }
}

/**
 * 构建请求头
 * 精确复制自 code.html 行 10285-10289
 */
export function buildHeaders(config: ApiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + config.apiKey,
    'x-api-key': config.apiKey,
  }
  // OpenRouter 兼容 (行 10286-10289)
  if (config.apiBase.includes('openrouter')) {
    headers['HTTP-Referer'] = window.location.href
    headers['X-Title'] = '韭菜盒子'
  }
  return headers
}

/**
 * 检查登录状态 — 简化自 code.html 行 1986-1989
 */
export function checkAuth(): boolean {
  const apiKey = localStorage.getItem('jcApiKey')
  const providerMode = localStorage.getItem('jcProviderMode')
  return !!(apiKey || providerMode === 'member')
}

/**
 * 构建 chat 错误信息 — 精确复制自 code.html 行 10219-10224
 */
export function buildChatErrorMessage(status: number, payload: any, fallbackText: string): string {
  const providerMessage = payload?.error?.message
    ? payload.error.message
    : (payload?.message ? payload.message : fallbackText)
  return 'API ' + status + ': ' + String(providerMessage || '请求失败')
}

/**
 * 通用 LLM 调用（非流式）
 * 返回 assistant 消息的 content 文本
 */
export async function callLLM(opts: {
  model?: string
  systemPrompt: string
  userMessage: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const config = await resolveApiConfig()
  const model = opts.model || config.model || 'claude-sonnet-4-6'
  const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userMessage },
      ],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2000,
      stream: false,
    }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(buildChatErrorMessage(res.status, payload, '请求失败'))
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''
  // 清理可能的 markdown code fence
  return content.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim()
}

/**
 * 构建云同步请求头 — 精确复制自 code.html 行 2156-2181
 * 用于对话历史/搭子/偏好等云同步
 */
export function buildCloudSyncHeaders(): Record<string, string> {
  const hdrs: Record<string, string> = { 'Content-Type': 'application/json' }
  const PLACEHOLDER = '__JC_MANAGED_SESSION__'
  // 行 2160-2164: 优先级从高到低尝试所有 token
  const candidates = [
    localStorage.getItem('jcUserAccessToken'),
    localStorage.getItem('jcMemberAccessToken'),
    localStorage.getItem('jcMemberApiKey'),
    localStorage.getItem('jcApiKey'),
  ]
  let accessToken = ''
  for (const c of candidates) {
    const v = String(c || '').trim()
    if (v && v !== PLACEHOLDER) { accessToken = v; break }
  }
  const userId = String(
    localStorage.getItem('jcNewApiUserId') ||
    localStorage.getItem('jcMemberUserId') || ''
  ).trim()
  if (accessToken) {
    hdrs['Authorization'] = 'Bearer ' + accessToken
    hdrs['x-api-key'] = accessToken
  }
  if (userId) hdrs['New-API-User'] = userId
  return hdrs
}
