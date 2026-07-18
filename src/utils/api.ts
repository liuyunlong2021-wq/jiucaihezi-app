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

export interface ResolveApiConfigOptions {
  forceCloud?: boolean
  startLocal?: boolean
  modelId?: string
  modelProviderId?: string
  allowAnonymous?: boolean
}

import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_HOST,
  LOCAL_OLLAMA_API_BASE,
  LOCAL_OLLAMA_PROVIDER_ID,
  decodeApiKey,
  isLocalOllamaProviderId,
  normalizeApiHost,
  resolveWebApiBaseUrl,
  resolveDefaultProviderFromStorage,
  rotateProviderKey,
} from './providerConfig'
import { isTauriRuntime } from './tauriEnv'
import { DEFAULT_TEXT_MODEL } from './modelSelection'
// ponytail: MLX 本地模型已删除（SDD Phase 0.1），ensureLocalMlxServer 已移除
import { getApiKey, initApiKey } from '../services/newApiClient'

const DEFAULT_MODEL = DEFAULT_TEXT_MODEL

/**
 * 从 localStorage 解析 API 配置
 */
export async function resolveApiConfig(options: ResolveApiConfigOptions = {}): Promise<ApiConfig> {
  const config = {
    providerId: DEFAULT_PROVIDER_ID,
    apiKey: getApiKey(),
    apiBase: DEFAULT_PROVIDER_HOST,
    model: options.modelId || localStorage.getItem('jcModel') || DEFAULT_MODEL,
  }
  const selectedProviderId = options.modelProviderId || localStorage.getItem('jcModelProviderId') || ''

  if (!options.forceCloud && isLocalOllamaProviderId(selectedProviderId)) {
    return resolveLocalOllamaApiConfig(config.model)
  }

  if ((window as any).JC_WORKSPACE?.getConfig) {
    try {
      const shared = await (window as any).JC_WORKSPACE.getConfig()
      config.apiKey = shared.apiKey || config.apiKey
      config.apiBase = resolveWebApiBaseUrl(DEFAULT_PROVIDER_HOST)
      if (!options.modelId) config.model = shared.model || config.model
    } catch (_) {}
  }

  const provider = resolveDefaultProviderFromStorage()
  config.apiKey = config.apiKey || await initApiKey() || provider.apiKey
  config.apiBase = isTauriRuntime()
    ? normalizeApiHost(provider.apiHost)
    : resolveWebApiBaseUrl(provider.apiHost)
  // 本地开发走 Vite proxy，强制覆盖
  // ⚠️ Tauri 桌面端 origin 因平台而异，必须排除：
  //   macOS/Linux: tauri://localhost
  //   Windows:      https://tauri.localhost
  if (typeof window !== 'undefined' && !isTauriRuntime()) {
    const origin = window.location?.origin || ''
    const isTauriOrigin = origin.startsWith('tauri://') || origin.includes('tauri.localhost')
    if (!isTauriOrigin && origin.includes('localhost')) {
      config.apiBase = '/__jc_api'
    }
  }

  if (!config.apiKey && options.allowAnonymous) {
    return {
      providerId: config.providerId,
      apiKey: '__JC_MANAGED_SESSION__',
      apiBase: config.apiBase,
      model: config.model,
    }
  }

  const apiKey = rotateProviderKey(config.providerId, decodeApiKey(config.apiKey || ''))

  if (!apiKey) throw new Error('当前没有可用于模型调用的 API Key。账号登录和模型调用 Key 是两件事：请在设置里完成一键登录生成 Key，或在高级功能里填写手动 API Key。')

  return { providerId: config.providerId, apiKey, apiBase: config.apiBase, model: config.model }
}

export async function resolveLocalOllamaApiConfig(modelId: string): Promise<ApiConfig> {
  const model = String(modelId || '').trim()
  if (!model || model === DEFAULT_MODEL) throw new Error('请先在设置中连接 Ollama 并选择本地模型。')
  return {
    providerId: LOCAL_OLLAMA_PROVIDER_ID,
    apiKey: 'ollama',
    apiBase: localStorage.getItem('jcLocalOllamaApiBase') || LOCAL_OLLAMA_API_BASE,
    model,
  }
}

/**
 * 构建请求头
 */
export function buildHeaders(config: ApiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey && config.apiKey !== '__JC_MANAGED_SESSION__') {
    headers.Authorization = 'Bearer ' + config.apiKey
    headers['x-api-key'] = config.apiKey
  }
  if (config.apiBase.includes('openrouter')) {
    headers['HTTP-Referer'] = window.location.href
    headers['X-Title'] = '韭菜盒子'
  }
  return headers
}

export function buildChatCompletionExtras(_config: ApiConfig): Record<string, unknown> {
  // ponytail: MLX extras 已删除（SDD Phase 0.1）
  return {}
}

export function getAssistantMessageContent(data: any): string {
  const message = data?.choices?.[0]?.message || {}
  return message.content || message.reasoning || message.reasoning_content || ''
}

/**
 * 检查登录状态
 */
export function checkAuth(): boolean {
  return Boolean(getApiKey())
}

/**
 * 构建 chat 错误信息
 */
export function sanitizeProviderError(value: unknown, apiKey = ''): string {
  let text = String(value || '')
  if (apiKey) {
    text = text.replaceAll(apiKey, '[REDACTED_API_KEY]')
  }
  return text
    .replace(/Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Authorization: Bearer [REDACTED_API_KEY]')
    .replace(/Bearer\s+(?:sk|jc|or|wr)-[A-Za-z0-9_\-]{12,}/gi, 'Bearer [REDACTED_API_KEY]')
    .replace(/\b(?:sk|jc|or|wr)-[A-Za-z0-9_\-]{20,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/\bx-api-key\s*:\s*[A-Za-z0-9._~+/=-]{12,}/gi, 'x-api-key: [REDACTED_API_KEY]')
    .replace(/\bapi[_-]?key\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{16,}['"]?/gi, 'api_key=[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}\b/g, '[REDACTED_JWT]')
}

export function buildChatErrorMessage(status: number, payload: any, fallbackText: string, apiKey = ''): string {
  const providerMessage = payload?.error?.message
    ? payload.error.message
    : (payload?.message ? payload.message : fallbackText)
  return 'API ' + status + ': ' + sanitizeProviderError(providerMessage || '请求失败', apiKey)
}

export function buildProviderNetworkErrorMessage(err: unknown): string {
  const message = String((err as Error)?.message || err || '')
  const normalized = message.toLowerCase()
  const likelyInterception = normalized.includes('load failed')
    || normalized.includes('dns')
    || normalized.includes('tls')
    || normalized.includes('clienthello')
    || normalized.includes('connection reset')
    || normalized.includes('reset by peer')
    || normalized.includes('certificate')
  if (likelyInterception) {
    return '本机网络可能存在 DNS 污染、TLS 拦截或连接重置；这通常不是 API Key、账号或余额错误。请换网络、关闭代理/VPN/安全软件，或稍后重试。'
  }
  return '网络连接中断，已保留上方已生成内容。可以点击“继续写”让Skill从断点续写。'
}

/**
 * 通用 LLM 调用（非流式）
 */
export async function callLLM(opts: {
  model?: string
  systemPrompt: string
  userMessage: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const config = await resolveApiConfig()
  const model = opts.model || config.model || DEFAULT_MODEL
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
    throw new Error(buildChatErrorMessage(res.status, payload, '请求失败', config.apiKey))
  }
  const data = await res.json()
  const content = getAssistantMessageContent(data)
  return content.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim()
}

/**
 * 构建云同步请求头
 */
export function buildCloudSyncHeaders(): Record<string, string> {
  const hdrs: Record<string, string> = { 'Content-Type': 'application/json' }
  const PLACEHOLDER = '__JC_MANAGED_SESSION__'
  const candidates = [
    getApiKey(),
    localStorage.getItem('jcUserAccessToken'),
    localStorage.getItem('jcMemberAccessToken'),
    localStorage.getItem('jcMemberApiKey'),
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
