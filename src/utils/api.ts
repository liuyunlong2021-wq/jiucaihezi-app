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
  DEFAULT_LOCAL_MLX_MODEL_ID,
  LOCAL_MLX_API_BASE,
  LOCAL_MLX_PROVIDER_ID,
  LOCAL_OLLAMA_API_BASE,
  LOCAL_OLLAMA_PROVIDER_ID,
  getLocalMlxModelDefinition,
  getLocalMlxModelRepo,
  isLocalMlxProviderId,
  isLocalOllamaProviderId,
  normalizeApiHost,
  resolveLocalMlxModelId,
} from './providerConfig'
import { isTauriRuntime } from './tauriEnv'
import { ensureLocalMlxServer } from './localMlxRuntime'
import { getGatewaySessionToken } from '../services/newApiClient'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
export const MANAGED_SESSION_PLACEHOLDER = '__JC_MANAGED_SESSION__'

/**
 * 从 localStorage 解析 API 配置
 * 精确复制自 code.html 行 9845-9870 的 resolveApiConfig()
 */
export async function resolveApiConfig(options: ResolveApiConfigOptions = {}): Promise<ApiConfig> {
  const config = {
    providerId: DEFAULT_PROVIDER_ID,
    apiKey: getGatewaySessionToken(),
    // 云端统一走正式 Gateway，不再要求用户填写自己的 Key。
    apiBase: DEFAULT_PROVIDER_HOST,
    model: options.modelId || localStorage.getItem('jcModel') || DEFAULT_MODEL,
  }
  const selectedProviderId = options.modelProviderId || localStorage.getItem('jcModelProviderId') || ''

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
      config.apiKey = getGatewaySessionToken()
      config.apiBase = normalizeApiHost(DEFAULT_PROVIDER_HOST)
      if (!options.modelId) config.model = shared.model || config.model
    } catch (_) {}
  }

  config.apiBase = normalizeApiHost(DEFAULT_PROVIDER_HOST)
  const apiKey = config.apiKey

  // 云端功能需要登录后使用
  if (!apiKey && options.allowAnonymous) {
    return {
      providerId: config.providerId,
      apiKey: MANAGED_SESSION_PLACEHOLDER,
      apiBase: config.apiBase,
      model: config.model,
    }
  }
  if (!apiKey) throw new Error('请先在设置中填入 API Key')

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
 * 精确复制自 code.html 行 10285-10289
 */
export function buildHeaders(config: ApiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey && config.apiKey !== MANAGED_SESSION_PLACEHOLDER) {
    headers.Authorization = 'Bearer ' + config.apiKey
    headers['X-JC-Session'] = config.apiKey
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
  const apiKey = getGatewaySessionToken()
  return !!apiKey
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
 * 构建云同步请求头。桌面版统一使用 Gateway session。
 */
export function buildCloudSyncHeaders(): Record<string, string> {
  const hdrs: Record<string, string> = { 'Content-Type': 'application/json' }
  const accessToken = getGatewaySessionToken()
  if (accessToken) {
    hdrs.Authorization = 'Bearer ' + accessToken
    hdrs['X-JC-Session'] = accessToken
  }
  return hdrs
}
