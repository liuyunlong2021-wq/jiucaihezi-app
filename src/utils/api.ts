/**
 * utils/api.ts — API 请求工具
 * 源自 code.html resolveApiConfig() (行 9845-9870)
 * 源自 code.html streamChat() headers (行 10285-10289)
 */

export interface ApiConfig {
  apiKey: string
  apiBase: string
  model: string
  providerId: string
}

import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_HOST,
  DEFAULT_LOCAL_MLX_MODEL_ID,
  LOCAL_MLX_API_BASE,
  LOCAL_MLX_PROVIDER_ID,
  LOCAL_OLLAMA_API_BASE,
  LOCAL_OLLAMA_PROVIDER_ID,
  decodeApiKey,
  getLocalMlxModelDefinition,
  getLocalMlxModelRepo,
  isLocalMlxProviderId,
  isLocalOllamaProviderId,
  normalizeApiHost,
  resolveDefaultProviderFromStorage,
  resolveLocalMlxModelId,
  rotateProviderKey,
} from './providerConfig'
import { isTauriRuntime } from './tauriEnv'
import { ensureLocalMlxServer } from './localMlxRuntime'

const DEFAULT_MODEL = 'claude-sonnet-4-6'

/**
 * 从 localStorage 解析 API 配置
 * 精确复制自 code.html 行 9845-9870 的 resolveApiConfig()
 */
export async function resolveApiConfig(options: { forceCloud?: boolean; startLocal?: boolean } = {}): Promise<ApiConfig> {
  const config = {
    providerId: DEFAULT_PROVIDER_ID,
    apiKey: localStorage.getItem('jcApiKey') || '',
    // URL 隐藏在内置 Provider 中，不暴露给用户编辑。
    apiBase: DEFAULT_PROVIDER_HOST,
    model: localStorage.getItem('jcModel') || DEFAULT_MODEL,
  }
  const selectedProviderId = localStorage.getItem('jcModelProviderId') || ''

  if (!options.forceCloud && isLocalMlxProviderId(selectedProviderId)) {
    return resolveLocalMlxApiConfig(config.model, options)
  }
  if (!options.forceCloud && isLocalOllamaProviderId(selectedProviderId)) {
    return resolveLocalOllamaApiConfig(config.model)
  }

  // 行 9851-9857: JC_WORKSPACE.getConfig 覆盖（桌面版 Tauri 用）
  if ((window as any).JC_WORKSPACE?.getConfig) {
    try {
      const shared = await (window as any).JC_WORKSPACE.getConfig()
      config.apiKey = shared.apiKey || config.apiKey
      config.apiBase = normalizeApiHost(DEFAULT_PROVIDER_HOST)
      config.model = shared.model || config.model
    } catch (_) {}
  }

  const provider = resolveDefaultProviderFromStorage()
  config.apiKey = config.apiKey || provider.apiKey
  config.apiBase = normalizeApiHost(provider.apiHost)

  const apiKey = rotateProviderKey(config.providerId, decodeApiKey(config.apiKey || ''))

  // 行 9864: 无 key 时抛错
  if (!apiKey) throw new Error('未检测到 API Key，请先在设置中填写')

  return { providerId: config.providerId, apiKey, apiBase: config.apiBase, model: config.model }
}

export async function resolveLocalMlxApiConfig(modelId: string, options: { startLocal?: boolean } = {}): Promise<ApiConfig> {
  if (!isTauriRuntime()) throw new Error('本地模型只支持桌面版')
  const resolvedModelId = resolveLocalMlxModelId(modelId)
  if (!getLocalMlxModelDefinition(resolvedModelId)) {
    throw new Error('没有可用的本地模型，请先在设置中导入。')
  }
  if (resolvedModelId !== modelId) {
    localStorage.setItem('jcModel', resolvedModelId || DEFAULT_LOCAL_MLX_MODEL_ID)
    localStorage.setItem('jcModelProviderId', LOCAL_MLX_PROVIDER_ID)
  }
  const status = options.startLocal === false
    ? null
    : await ensureLocalMlxServer(resolvedModelId)
  return {
    providerId: LOCAL_MLX_PROVIDER_ID,
    apiKey: 'local',
    apiBase: status?.apiBase || localStorage.getItem('jcLocalMlxApiBase') || LOCAL_MLX_API_BASE,
    model: status?.modelSource || getLocalMlxModelRepo(resolvedModelId),
  }
}

export async function resolveLocalOllamaApiConfig(modelId: string): Promise<ApiConfig> {
  const model = String(modelId || '').trim()
  if (!model) throw new Error('请先在设置中连接 Ollama 并选择本地模型。')
  return {
    providerId: LOCAL_OLLAMA_PROVIDER_ID,
    apiKey: 'ollama',
    apiBase: localStorage.getItem('jcLocalOllamaApiBase') || LOCAL_OLLAMA_API_BASE,
    model,
  }
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

export function buildChatCompletionExtras(config: ApiConfig): Record<string, unknown> {
  if (config.providerId !== LOCAL_MLX_PROVIDER_ID) return {}
  const enableThinking = typeof localStorage !== 'undefined' && localStorage.getItem('jcLocalMlxThinking') === 'true'
  return {
    chat_template_kwargs: {
      enable_thinking: enableThinking,
    },
  }
}

export function getAssistantMessageContent(data: any): string {
  const message = data?.choices?.[0]?.message || {}
  return message.content || message.reasoning || message.reasoning_content || ''
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
      ...buildChatCompletionExtras(config),
    }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(buildChatErrorMessage(res.status, payload, '请求失败'))
  }
  const data = await res.json()
  const content = getAssistantMessageContent(data)
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
