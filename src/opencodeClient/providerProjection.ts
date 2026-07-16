import { getApiKey, getGatewaySessionToken, initApiKey, initGatewaySessionToken } from '@/services/newApiClient'
import {
  supportsVision,
  LOCAL_OLLAMA_PROVIDER_ID,
  LOCAL_OLLAMA_API_BASE,
  resolveModelProviderId,
  getCustomProviders,
} from '@/utils/providerConfig'
import type { ModelEntry } from '@/stores/agentStore'
import { getModelContextWindow } from '@/data/modelContextWindows'

export const OPENCODE_JC_PROVIDER_ID = 'jiucaihezi'
export const OPENCODE_JC_API_BASE = 'https://api.jiucaihezi.studio/v1'

export interface ProjectNewApiForOpenCodeInput {
  currentModel?: string
  models: ModelEntry[]
  apiKey?: string
  gatewaySessionToken?: string
}

export interface ProjectedOpenCodeProvider {
  enabled_providers: string[]
  model: string
  provider: Record<string, unknown>
}

function normalizeModelId(modelId: string): string {
  return String(modelId || '').trim()
}

// 照抄 OpenCode V1 model schema：tool_call + attachment + modalities + limit。
// OpenCode 只有拿到 context 才能按官方规则自动压缩历史。
function buildModelConfig(modelId: string, providerId?: string): Record<string, unknown> {
  const hasVision = supportsVision(modelId, providerId)
  return {
    name: modelId,
    tool_call: true,
    attachment: true,
    modalities: {
      input: hasVision ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
    limit: { context: getModelContextWindow(modelId, providerId), output: 0 },
    ...(providerId === LOCAL_OLLAMA_PROVIDER_ID && /qwen3/i.test(modelId) ? { options: { reasoning_effort: 'none' } } : {}),
  }
}

// ─── 多 Provider 配置生成 ───
// 照抄 OpenCode：每个 openai-compatible provider 一条 { npm, api, options, models }
// 本地模型（Ollama/自定义）也能驱动 文/武 模式，关键就是把它们的 api URL 写进 OpenCode config。

interface ProviderGroup {
  providerId: string
  models: ModelEntry[]
  api: string
  apiKey?: string
  name: string
  extraOptions?: Record<string, unknown>
}

function groupModelsByProvider(textModels: ModelEntry[]): ProviderGroup[] {
  const groups = new Map<string, ModelEntry[]>()
  for (const model of textModels) {
    const pid = model.providerId || OPENCODE_JC_PROVIDER_ID
    if (!groups.has(pid)) groups.set(pid, [])
    groups.get(pid)!.push(model)
  }

  const result: ProviderGroup[] = []

  // jiucaihezi — 仅在有模型时才加入（有模型 = 用户已登录有 Key）
  const jcModels = groups.get(OPENCODE_JC_PROVIDER_ID)
  if (jcModels && jcModels.length > 0) {
    result.push({
      providerId: OPENCODE_JC_PROVIDER_ID,
      models: jcModels,
      api: OPENCODE_JC_API_BASE,
      name: '韭菜盒子 NewAPI',
    })
  }

  // local-ollama — 仅在有模型时才加入
  const ollamaModels = groups.get(LOCAL_OLLAMA_PROVIDER_ID)
  if (ollamaModels && ollamaModels.length > 0) {
    result.push({
      providerId: LOCAL_OLLAMA_PROVIDER_ID,
      models: ollamaModels,
      api: `${LOCAL_OLLAMA_API_BASE}/v1`,
      name: 'Ollama',
      extraOptions: { timeout: false, chunkTimeout: 60000 },
    })
  }

  // 自定义 provider
  const customProviders = getCustomProviders()
  for (const cp of customProviders) {
    const cpModels = groups.get(cp.id)
    if (cpModels && cpModels.length > 0) {
      result.push({
        providerId: cp.id,
        models: cpModels,
        api: cp.apiBase,
        apiKey: cp.apiKey,
        name: cp.name,
        extraOptions: { timeout: false, chunkTimeout: 60000 },
      })
    }
  }

  return result
}

export function projectNewApiForOpenCode(input: ProjectNewApiForOpenCodeInput): ProjectedOpenCodeProvider {
  const textModels = input.models.filter(model => model.capability === 'text')
  const providerGroups = groupModelsByProvider(textModels)

  const currentModelId = normalizeModelId(input.currentModel || '')
  const currentProviderId = currentModelId ? resolveModelProviderId(currentModelId) : ''
  const selectedGroup = providerGroups.find(group =>
    group.providerId === currentProviderId
    && group.models.some(model => normalizeModelId(model.id) === currentModelId)
  ) || providerGroups.find(group =>
    group.models.some(model => normalizeModelId(model.id) === currentModelId)
  )
  const selectedModel = selectedGroup?.models.find(model => normalizeModelId(model.id) === currentModelId)
  const firstGroup = selectedGroup || providerGroups[0]
  const defaultModel = firstGroup
    ? `${firstGroup.providerId}/${normalizeModelId(selectedModel?.id || firstGroup.models[0]?.id || 'unknown')}`
    : `${OPENCODE_JC_PROVIDER_ID}/claude-sonnet-4-6`

  const apiKey = String(input.apiKey ?? getApiKey() ?? '').trim()
  const gatewaySessionToken = String(input.gatewaySessionToken ?? getGatewaySessionToken() ?? '').trim()

  // 仅当 jiucaihezi 实际有模型时才需要 apiKey 校验
  const jcGroup = providerGroups.find(g => g.providerId === OPENCODE_JC_PROVIDER_ID)
  const hasJcModels = jcGroup != null && jcGroup.models.length > 0
  if (hasJcModels) {
    if (!apiKey && gatewaySessionToken) {
      throw new Error('账号 Session 需要先兑换 OpenCode 可用的短期 NewAPI API Key。')
    }
    if (!apiKey) {
      throw new Error('当前没有可用于 OpenCode 的 API Key。账号登录和模型调用 Key 是两件事：请在设置里完成一键登录生成 Key，或在高级功能里填写手动 API Key。')
    }
  }

  const enabledProviders: string[] = []
  const providerConfig: Record<string, unknown> = {}

  for (const group of providerGroups) {
    enabledProviders.push(group.providerId)

    const models: Record<string, unknown> = {}
    for (const model of group.models) {
      const id = normalizeModelId(model.id)
      if (!id) continue
      models[id] = buildModelConfig(id, group.providerId)
    }

    const options: Record<string, unknown> = {
      timeout: false,
      chunkTimeout: 60000,
      ...(group.extraOptions || {}),
    }

    if (group.providerId === OPENCODE_JC_PROVIDER_ID) {
      options.apiKey = apiKey
    } else if (group.apiKey) {
      options.apiKey = group.apiKey
    }
    // Ollama 不需要 apiKey

    providerConfig[group.providerId] = {
      name: group.name,
      npm: '@ai-sdk/openai-compatible',
      api: group.api,
      options,
      models,
    }
  }

  return {
    enabled_providers: enabledProviders,
    // ponytail: model 不绑定用户选择。真正切模型走 updateOpenCodeSessionModel (POST /api/session/:id/model)
    // 取第一个可用模型作为进程启动占位，用户选的模型在 session 级管理
    model: `${firstGroup.providerId}/${normalizeModelId(firstGroup.models[0]?.id || 'unknown')}`,
    provider: providerConfig,
  }
}

export async function projectStoredNewApiForOpenCode(
  input: Omit<ProjectNewApiForOpenCodeInput, 'apiKey' | 'gatewaySessionToken'> & Partial<Pick<ProjectNewApiForOpenCodeInput, 'apiKey' | 'gatewaySessionToken'>>
): Promise<ProjectedOpenCodeProvider> {
  const currentModelId = normalizeModelId(input.currentModel || '')
  const currentModelProviderId = input.models.find(model => normalizeModelId(model.id) === currentModelId)?.providerId
    || (currentModelId ? resolveModelProviderId(currentModelId) : OPENCODE_JC_PROVIDER_ID)
  const cachedApiKey = String(input.apiKey || getApiKey() || '').trim()
  const cachedGatewaySessionToken = String(input.gatewaySessionToken || getGatewaySessionToken() || '').trim()
  const models = currentModelProviderId !== OPENCODE_JC_PROVIDER_ID && !cachedApiKey
    ? input.models.filter(model => (model.providerId || OPENCODE_JC_PROVIDER_ID) !== OPENCODE_JC_PROVIDER_ID)
    : input.models
  const needsJcAuth = models.some(model =>
    model.capability === 'text'
    && (model.providerId || OPENCODE_JC_PROVIDER_ID) === OPENCODE_JC_PROVIDER_ID
  )
  const apiKey = needsJcAuth
    ? String(cachedApiKey || await initApiKey() || '').trim()
    : cachedApiKey
  const gatewaySessionToken = needsJcAuth
    ? String(cachedGatewaySessionToken || await initGatewaySessionToken() || '').trim()
    : cachedGatewaySessionToken
  return projectNewApiForOpenCode({
    ...input,
    models,
    apiKey,
    gatewaySessionToken,
  })
}

export function toOpenCodeModelProjection(modelId: string) {
  // resolveModelProviderId 处理 Ollama/MLX/jiucaihezi，不处理自定义 provider
  let providerID = resolveModelProviderId(modelId)
  // 自定义 provider fallback：如果默认解析没命中，查自定义 provider 列表
  if (providerID === OPENCODE_JC_PROVIDER_ID) {
    const customProviders = getCustomProviders()
    const match = customProviders.find(cp => cp.modelIds.includes(normalizeModelId(modelId)))
    if (match) providerID = match.id
  }
  return {
    providerID,
    modelID: normalizeModelId(modelId),
  }
}
