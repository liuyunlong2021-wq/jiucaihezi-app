export const DEFAULT_PROVIDER_ID = 'jiucaihezi'
export const DEFAULT_PROVIDER_HOST = 'https://api.jiucaihezi.studio'
export const LOCAL_WEB_API_PROXY_BASE = '/__jc_api'
export const DEFAULT_PROVIDER_NAME = '韭菜盒子'
export const LOCAL_MLX_PROVIDER_ID = 'local-mlx'
export const LOCAL_MLX_PROVIDER_HOST = 'internal://local-mlx'
export const LOCAL_MLX_PROVIDER_NAME = '本地模型'
export const LOCAL_MLX_API_BASE = 'http://127.0.0.1:17880'
export const LOCAL_MLX_MODELS_KEY = 'jcLocalMlxModels'
export const LOCAL_MLX_HIDDEN_MODELS_KEY = 'jcLocalMlxHiddenModels'
export const LOCAL_OLLAMA_PROVIDER_ID = 'local-ollama'
export const LOCAL_OLLAMA_PROVIDER_HOST = 'http://127.0.0.1:11434'
export const LOCAL_OLLAMA_PROVIDER_NAME = 'Ollama'
export const LOCAL_OLLAMA_API_BASE = 'http://127.0.0.1:11434'
export const LOCAL_OLLAMA_MODELS_KEY = 'jcLocalOllamaModels'

// ─── 自定义 OpenAI 兼容 Provider ───
// 照抄 OpenCode 的 openai-compatible provider 模式：用户配置 name + apiBase + 可选 apiKey，
// 生成 OpenCode config 时作为独立 provider 条目注入。本地模型（vLLM/llama.cpp/LM Studio 等）
// 只要能提供 /v1/chat/completions 端点，就能驱动 文/武 模式。
export const CUSTOM_PROVIDERS_KEY = 'jcCustomProviders'

export interface CustomProviderConfig {
  id: string
  name: string
  apiBase: string
  apiKey?: string
  modelIds: string[]
}

export function getCustomProviders(store: KeyValueStore = getStorage()): CustomProviderConfig[] {
  const raw = readStore(store, CUSTOM_PROVIDERS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((p: Partial<CustomProviderConfig>) => ({
      id: String(p.id || '').trim(),
      name: String(p.name || p.id || '').trim(),
      apiBase: String(p.apiBase || '').trim().replace(/\/+$/, ''),
      apiKey: p.apiKey ? String(p.apiKey).trim() : undefined,
      modelIds: Array.isArray(p.modelIds) ? p.modelIds.map(String) : [],
    })).filter(p => p.id && p.apiBase)
  } catch (_) {
    return []
  }
}

export function saveCustomProviders(providers: CustomProviderConfig[], store: KeyValueStore = getStorage()): void {
  writeStore(store, CUSTOM_PROVIDERS_KEY, JSON.stringify(providers))
}

export interface LocalMlxModelDefinition {
  id: string
  label: string
  repo: string
  oneLineDesc: string
  sizeHint: string
  downloadBytesHint?: number
}

export const LOCAL_MLX_MODEL_CATALOG: LocalMlxModelDefinition[] = [
  {
    id: 'local-mlx/jiucai-local',
    label: '韭菜盒子本地模型',
    repo: 'mlx-community/gemma-4-e4b-it-OptiQ-4bit',
    oneLineDesc: '轻量稳定，适合离线聊天、隐私问答和基础资料整理。',
    sizeHint: '约 5-7GB',
    downloadBytesHint: 6 * 1024 * 1024 * 1024,
  },
]

export const DEFAULT_LOCAL_MLX_MODEL_ID = 'local-mlx/jiucai-local'

export function getLocalMlxModelDefinition(modelId: string | null | undefined): LocalMlxModelDefinition | undefined {
  return LOCAL_MLX_MODEL_CATALOG.find(model => model.id === modelId)
}

export function getLocalMlxModelRepo(modelId: string | null | undefined): string {
  return getLocalMlxModelDefinition(modelId)?.repo || getLocalMlxModelDefinition(DEFAULT_LOCAL_MLX_MODEL_ID)!.repo
}

export function getLocalMlxModelLabel(modelId: string | null | undefined): string {
  return getLocalMlxModelDefinition(modelId)?.label || getLocalMlxModelDefinition(DEFAULT_LOCAL_MLX_MODEL_ID)!.label
}

export function resolveLocalMlxModelId(modelId: string | null | undefined): string {
  const current = String(modelId || '').trim()
  return getLocalMlxModelDefinition(current)?.id || DEFAULT_LOCAL_MLX_MODEL_ID
}

export type ProviderType = 'new-api' | 'local-mlx' | 'local-ollama'

export interface JcModelRef {
  id: string
  label?: string
  providerId?: string
}

export interface JcProvider {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  apiHost: string
  enabled: boolean
  models: JcModelRef[]
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>

function readStore(store: KeyValueStore, key: string): string | null {
  if (store instanceof Map) return store.get(key) || null
  return store.getItem(key)
}

function writeStore(store: KeyValueStore, key: string, value: string): void {
  if (store instanceof Map) {
    store.set(key, value)
    return
  }
  store.setItem(key, value)
}

function getStorage(): Storage | Map<string, string> {
  if (
    typeof localStorage !== 'undefined'
    && typeof localStorage.getItem === 'function'
    && typeof localStorage.setItem === 'function'
  ) return localStorage
  return new Map<string, string>()
}

export function getHiddenLocalMlxModelIds(store: KeyValueStore = getStorage()): string[] {
  const raw = readStore(store, LOCAL_MLX_HIDDEN_MODELS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(item => String(item || '')).filter(id => Boolean(id) && getLocalMlxModelDefinition(id))
  } catch (_) {
    return []
  }
}

export function isLocalMlxModelHidden(modelId: string, store: KeyValueStore = getStorage()): boolean {
  return getHiddenLocalMlxModelIds(store).includes(modelId)
}

export function hideLocalMlxModel(modelId: string, store: KeyValueStore = getStorage()): void {
  if (!getLocalMlxModelDefinition(modelId)) return
  const next = Array.from(new Set([...getHiddenLocalMlxModelIds(store), modelId]))
  writeStore(store, LOCAL_MLX_HIDDEN_MODELS_KEY, JSON.stringify(next))
}

export function unhideLocalMlxModel(modelId: string, store: KeyValueStore = getStorage()): void {
  const next = getHiddenLocalMlxModelIds(store).filter(id => id !== modelId)
  writeStore(store, LOCAL_MLX_HIDDEN_MODELS_KEY, JSON.stringify(next))
}

export function normalizeApiHost(host = DEFAULT_PROVIDER_HOST): string {
  return (host || DEFAULT_PROVIDER_HOST)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
    .replace(/\/api$/, '')
}

export function isLocalWebOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return false
    const host = url.hostname
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') return true
    // 局域网 IP（手机真机测试等场景）
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true
    return false
  } catch {
    return false
  }
}

export function resolveWebApiBaseUrl(
  host = DEFAULT_PROVIDER_HOST,
  origin = typeof window !== 'undefined' ? window.location?.origin : '',
): string {
  const normalized = normalizeApiHost(host)
  if (normalized === DEFAULT_PROVIDER_HOST && isLocalWebOrigin(origin)) {
    return LOCAL_WEB_API_PROXY_BASE
  }
  return normalized
}

export function withApiVersion(host: string): string {
  return `${normalizeApiHost(host)}/v1`
}

export function createDefaultProvider(apiKey = ''): JcProvider {
  return {
    id: DEFAULT_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    type: 'new-api',
    apiKey,
    apiHost: DEFAULT_PROVIDER_HOST,
    enabled: true,
    models: [],
  }
}

function sanitizeProvider(provider: Partial<JcProvider> | null | undefined, legacyKey = ''): JcProvider {
  if (provider?.id === LOCAL_MLX_PROVIDER_ID || provider?.type === 'local-mlx') {
    return sanitizeLocalMlxProvider(provider)
  }
  if (provider?.id === LOCAL_OLLAMA_PROVIDER_ID || provider?.type === 'local-ollama') {
    return sanitizeLocalOllamaProvider(provider)
  }

  return {
    ...createDefaultProvider(legacyKey),
    ...provider,
    id: DEFAULT_PROVIDER_ID,
    name: provider?.name || DEFAULT_PROVIDER_NAME,
    type: 'new-api',
    apiKey: '',
    apiHost: normalizeApiHost(DEFAULT_PROVIDER_HOST),
    enabled: true,
    models: Array.isArray(provider?.models) ? provider.models : [],
  }
}

function sanitizeLocalOllamaProvider(provider: Partial<JcProvider> | null | undefined): JcProvider {
  return {
    id: LOCAL_OLLAMA_PROVIDER_ID,
    name: provider?.name || LOCAL_OLLAMA_PROVIDER_NAME,
    type: 'local-ollama',
    apiKey: '',
    apiHost: LOCAL_OLLAMA_PROVIDER_HOST,
    enabled: provider?.enabled !== false,
    models: Array.isArray(provider?.models)
      ? provider.models.map(model => ({
          id: String(model.id || '').trim(),
          label: model.label || model.id,
          providerId: LOCAL_OLLAMA_PROVIDER_ID,
        })).filter(model => model.id)
      : [],
  }
}

function sanitizeLocalMlxProvider(provider: Partial<JcProvider> | null | undefined): JcProvider {
  return {
    id: LOCAL_MLX_PROVIDER_ID,
    name: provider?.name || LOCAL_MLX_PROVIDER_NAME,
    type: 'local-mlx',
    apiKey: '',
    apiHost: LOCAL_MLX_PROVIDER_HOST,
    enabled: provider?.enabled !== false,
    models: Array.isArray(provider?.models)
      ? provider.models.map(model => ({
          id: model.id,
          label: model.label,
          providerId: LOCAL_MLX_PROVIDER_ID,
        })).filter(model => model.id)
      : [],
  }
}

export function createLocalMlxProvider(models: JcModelRef[] = []): JcProvider {
  return sanitizeLocalMlxProvider({
    models,
    enabled: models.length > 0,
  })
}

export function createLocalOllamaProvider(models: JcModelRef[] = []): JcProvider {
  return sanitizeLocalOllamaProvider({
    models,
    enabled: models.length > 0,
  })
}

// ponytail: isLocalMlxProviderId removed (SDD Phase 0.1)
export function isLocalMlxProviderId(_providerId: string | null | undefined): boolean {
  return false // ponytail: MLX removed, always returns false
}

export function isLocalOllamaProviderId(providerId: string | null | undefined): boolean {
  return providerId === LOCAL_OLLAMA_PROVIDER_ID
}

export function isLocalModelProviderId(providerId: string | null | undefined): boolean {
  return providerId === LOCAL_OLLAMA_PROVIDER_ID
}

// ─── 视觉模型检测 ───
//
// 策略：乐观放行，只黑名单确认不支持 vision 的模型。
// DeepSeek、Qwen、Kimi 等模型本身支持图片，但需 Gateway/NewAPI 端点配合。
// 端点未配置好时，这些模型返回 false 避免 502；端点修复后改为 true。
// 当前 Gateway 已验证支持 vision：GPT / Claude / Gemini / Doubao 系列。

/** 确认只支持 text 的模型 + Gateway 端点暂未配置 vision 的模型 */
const GATEWAY_VISION_DISABLED_KEYWORDS = [
  // 确认 text-only（OpenAI 文档）
  'o1-mini', 'o1-preview', 'o3-mini', 'codex',
  // Gateway 端点暂未配 vision，等端点支持后移出此列表
  'deepseek', 'qwen', 'kimi', 'hunyuan', 'zhipu', 'mistral', 'mixtral',
]

/**
 * 检测模型是否支持 vision（image_url）。
 *
 * 对 Gateway/jiucaihezi 模型：用黑名单判断（部分端点未配置 vision）。
 * 对本地/custom provider 模型：乐观返回 true —— 本地模型自己决定是否支持图片，
 * 不应被 Gateway 端点的黑名单误判。
 */
export function supportsVision(modelId: string | null | undefined, providerId?: string): boolean {
  if (!modelId) return false
  // 本地模型和自定义 provider 乐观放行
  if (providerId === LOCAL_OLLAMA_PROVIDER_ID) return true
  if (providerId && providerId !== DEFAULT_PROVIDER_ID) return true
  const lower = modelId.toLowerCase()
  if (GATEWAY_VISION_DISABLED_KEYWORDS.some(kw => lower.includes(kw))) return false
  return true
}

export function getLocalOllamaModels(store: KeyValueStore = getStorage()): JcModelRef[] {
  const raw = readStore(store, LOCAL_OLLAMA_MODELS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((model: Partial<JcModelRef>) => ({
        id: String(model?.id || '').trim(),
        label: model?.label ? String(model.label) : String(model?.id || '').trim(),
        providerId: LOCAL_OLLAMA_PROVIDER_ID,
      }))
      .filter(model => model.id)
  } catch (_) {
    return []
  }
}

export function saveLocalOllamaModels(models: JcModelRef[], store: KeyValueStore = getStorage()): JcModelRef[] {
  const sanitized = models
    .map(model => ({
      id: String(model.id || '').trim(),
      label: model.label || String(model.id || '').trim(),
      providerId: LOCAL_OLLAMA_PROVIDER_ID,
    }))
    .filter(model => model.id)

  writeStore(store, LOCAL_OLLAMA_MODELS_KEY, JSON.stringify(sanitized))

  const providers = loadProvidersFromStorage(store)
  const defaultProvider = providers.find(provider => provider.id === DEFAULT_PROVIDER_ID) || createDefaultProvider()
  const ollamaProvider = createLocalOllamaProvider(sanitized)
  saveProvidersToStorage([
    defaultProvider,
    ...(sanitized.length > 0 ? [ollamaProvider] : []),
  ], store)
  return sanitized
}

export function getLocalMlxModels(store: KeyValueStore = getStorage()): JcModelRef[] {
  const raw = readStore(store, LOCAL_MLX_MODELS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const hiddenIds = new Set(getHiddenLocalMlxModelIds(store))
    return parsed
      .map((model: Partial<JcModelRef>) => ({
        id: String(model?.id || '').trim(),
        label: model?.label ? String(model.label) : getLocalMlxModelLabel(model?.id),
        providerId: LOCAL_MLX_PROVIDER_ID,
      }))
      .filter(model => model.id && getLocalMlxModelDefinition(model.id) && !hiddenIds.has(model.id))
  } catch (_) {
    return []
  }
}

export function saveLocalMlxModels(models: JcModelRef[], store: KeyValueStore = getStorage()): JcModelRef[] {
  const hiddenIds = new Set(getHiddenLocalMlxModelIds(store))
  const sanitized = models
    .map(model => ({
      id: String(model.id || '').trim(),
      label: model.label || getLocalMlxModelLabel(model.id),
      providerId: LOCAL_MLX_PROVIDER_ID,
    }))
    .filter(model => model.id && getLocalMlxModelDefinition(model.id) && !hiddenIds.has(model.id))

  writeStore(store, LOCAL_MLX_MODELS_KEY, JSON.stringify(sanitized))

  const providers = loadProvidersFromStorage(store)
  const defaultProvider = providers.find(provider => provider.id === DEFAULT_PROVIDER_ID) || createDefaultProvider()
  const localProvider = createLocalMlxProvider(sanitized)
  saveProvidersToStorage(sanitized.length > 0 ? [defaultProvider, localProvider] : [defaultProvider], store)
  return sanitized
}

export function registerLocalMlxModel(modelId: string, store: KeyValueStore = getStorage()): JcModelRef[] {
  const modelDef = getLocalMlxModelDefinition(modelId)
  if (!modelDef) return getLocalMlxModels(store)
  unhideLocalMlxModel(modelDef.id, store)
  const existing = getLocalMlxModels(store)
  return saveLocalMlxModels([
    ...existing.filter(model => model.id !== modelDef.id),
    {
      id: modelDef.id,
      label: modelDef.label,
      providerId: LOCAL_MLX_PROVIDER_ID,
    },
  ], store)
}

export function unregisterLocalMlxModel(modelId: string, store: KeyValueStore = getStorage()): JcModelRef[] {
  hideLocalMlxModel(modelId, store)
  return saveLocalMlxModels(getLocalMlxModels(store).filter(model => model.id !== modelId), store)
}

export function registerDefaultLocalMlxModel(store: KeyValueStore = getStorage()): JcModelRef[] {
  return registerLocalMlxModel(DEFAULT_LOCAL_MLX_MODEL_ID, store)
}

export function clearLocalMlxModels(store: KeyValueStore = getStorage()): void {
  saveLocalMlxModels([], store)
}

export function getModelProviderId(model: JcModelRef | string | null | undefined): string {
  if (!model) return DEFAULT_PROVIDER_ID
  if (typeof model === 'string') return DEFAULT_PROVIDER_ID
  return model.providerId || DEFAULT_PROVIDER_ID
}

export function resolveModelProviderId(model: JcModelRef | string | null | undefined): string {
  if (!model) return DEFAULT_PROVIDER_ID
  const modelId = typeof model === 'string' ? model : model.id
  if (getLocalOllamaModels().some(item => item.id === modelId)) return LOCAL_OLLAMA_PROVIDER_ID
  if (getLocalMlxModelDefinition(modelId)) return LOCAL_MLX_PROVIDER_ID
  if (typeof model === 'string') return DEFAULT_PROVIDER_ID
  return getModelProviderId(model)
}

export function loadProvidersFromStorage(store: KeyValueStore = getStorage()): JcProvider[] {
  const legacyKey = ''
  const raw = readStore(store, 'jcProviders')
  const localModels = getLocalMlxModels(store)
  const ollamaModels = getLocalOllamaModels(store)
  const maybeLocalProvider = [
    ...(localModels.length > 0 ? [createLocalMlxProvider(localModels)] : []),
    ...(ollamaModels.length > 0 ? [createLocalOllamaProvider(ollamaModels)] : []),
  ]

  if (!raw) return [createDefaultProvider(legacyKey), ...maybeLocalProvider]

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const defaultProvider = parsed.find((p: Partial<JcProvider>) => p?.id === DEFAULT_PROVIDER_ID) || parsed[0]
      const localProvider = parsed.find((p: Partial<JcProvider>) => p?.id === LOCAL_MLX_PROVIDER_ID || p?.type === 'local-mlx')
      const ollamaProvider = parsed.find((p: Partial<JcProvider>) => p?.id === LOCAL_OLLAMA_PROVIDER_ID || p?.type === 'local-ollama')
      const sanitizedLocal = localProvider ? sanitizeLocalMlxProvider({
        ...localProvider,
        models: localProvider.models?.length ? localProvider.models : localModels,
      }) : maybeLocalProvider.find(provider => provider.id === LOCAL_MLX_PROVIDER_ID)
      const sanitizedOllama = ollamaProvider ? sanitizeLocalOllamaProvider({
        ...ollamaProvider,
        models: ollamaProvider.models?.length ? ollamaProvider.models : ollamaModels,
      }) : maybeLocalProvider.find(provider => provider.id === LOCAL_OLLAMA_PROVIDER_ID)
      return [
        sanitizeProvider(defaultProvider, legacyKey),
        ...(sanitizedLocal && sanitizedLocal.models.length > 0 ? [sanitizedLocal] : []),
        ...(sanitizedOllama && sanitizedOllama.models.length > 0 ? [sanitizedOllama] : []),
      ]
    }
  } catch (_) {}

  return [createDefaultProvider(legacyKey), ...maybeLocalProvider]
}

export function rotateProviderKey(
  providerId: string,
  apiKey: string,
  store: KeyValueStore = getStorage()
): string {
  const keys = apiKey
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)

  if (keys.length === 0) return ''
  if (keys.length === 1) return keys[0]

  const keyName = `provider:${providerId}:last_used_key`
  const lastUsedKey = readStore(store, keyName)
  const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  writeStore(store, keyName, nextKey)
  return nextKey
}

export function decodeApiKey(rawKey: string): string {
  let apiKey = rawKey.trim()
  try {
    const decoded = atob(apiKey)
    if (decoded.startsWith('sk-')) apiKey = decoded
  } catch (_) {}
  return apiKey
}

export function saveProvidersToStorage(providers: JcProvider[], store: KeyValueStore = getStorage()): void {
  const legacyKey = ''
  const defaultProvider = providers.find(provider => provider.id === DEFAULT_PROVIDER_ID) || providers[0]
  const localProvider = providers.find(provider => provider.id === LOCAL_MLX_PROVIDER_ID || provider.type === 'local-mlx')
  const ollamaProvider = providers.find(provider => provider.id === LOCAL_OLLAMA_PROVIDER_ID || provider.type === 'local-ollama')
  const sanitized = [
    sanitizeProvider(defaultProvider, legacyKey),
    ...(localProvider ? [sanitizeLocalMlxProvider(localProvider)] : []),
    ...(ollamaProvider ? [sanitizeLocalOllamaProvider(ollamaProvider)] : []),
  ]
  writeStore(store, 'jcProviders', JSON.stringify(sanitized))
}

export function resolveDefaultProviderFromStorage(store: KeyValueStore = getStorage()): JcProvider {
  const provider = loadProvidersFromStorage(store)[0] || createDefaultProvider()
  return sanitizeProvider(provider)
}

export function updateDefaultProviderModels(
  models: JcModelRef[],
  store: KeyValueStore = getStorage()
): JcProvider[] {
  const provider = resolveDefaultProviderFromStorage(store)
  provider.models = models.map(model => ({
    id: model.id,
    label: model.label,
    providerId: DEFAULT_PROVIDER_ID,
  }))
  const localModels = getLocalMlxModels(store)
  const ollamaModels = getLocalOllamaModels(store)
  const providers = [
    provider,
    ...(localModels.length > 0 ? [createLocalMlxProvider(localModels)] : []),
    ...(ollamaModels.length > 0 ? [createLocalOllamaProvider(ollamaModels)] : []),
  ]
  saveProvidersToStorage(providers, store)
  return providers
}
