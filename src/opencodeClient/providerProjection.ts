import { getApiKey, getGatewaySessionToken, initApiKey, initGatewaySessionToken } from '@/services/newApiClient'
import { getModelContextWindow } from '@/data/modelContextWindows'
import {
  supportsVision,
  LOCAL_OLLAMA_PROVIDER_ID,
  LOCAL_OLLAMA_API_BASE,
  resolveModelProviderId,
  getCustomProviders,
} from '@/utils/providerConfig'
import type { ModelEntry } from '@/stores/agentStore'

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

function buildModelConfig(modelId: string, providerId?: string): Record<string, unknown> {
  const context = getModelContextWindow(modelId, providerId)
  // 照抄 OpenCode：所有 openai-compatible 模型默认 attachment: true，
  // 确保模型能接收文件上下文（项目文件查看等工具依赖此标志）。
  const hasVision = supportsVision(modelId, providerId)
  // output 按上下文动态计算：云端 8192，本地模型保守取 context/8（不低于 2048），
  // 避免小模型（如 3B 只支持 2048 max_tokens）API 报错。
  const isLocal = providerId === LOCAL_OLLAMA_PROVIDER_ID || providerId === 'local-mlx'
  const outputLimit = isLocal ? Math.max(2048, Math.ceil(context / 8)) : 8192
  return {
    name: modelId,
    tool_call: true,
    attachment: true,
    limit: {
      context,
      output: outputLimit,
    },
    modalities: {
      input: hasVision ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
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

  // jiucaihezi — 始终包含（云模型主 Provider）
  result.push({
    providerId: OPENCODE_JC_PROVIDER_ID,
    models: groups.get(OPENCODE_JC_PROVIDER_ID) || [],
    api: OPENCODE_JC_API_BASE,
    name: '韭菜盒子 NewAPI',
  })

  // local-ollama — 始终包含，即使当前没有模型。
  // 这是 config_signature 稳定性关键：Ollama 启停不改变 enabled_providers 列表。
  result.push({
    providerId: LOCAL_OLLAMA_PROVIDER_ID,
    models: groups.get(LOCAL_OLLAMA_PROVIDER_ID) || [],
    api: `${LOCAL_OLLAMA_API_BASE}/v1`,
    name: 'Ollama',
    extraOptions: { timeout: false, chunkTimeout: 60000 },
  })

  // 自定义 openai-compatible provider — 始终包含所有已存储的 provider
  const customProviders = getCustomProviders()
  for (const cp of customProviders) {
    result.push({
      providerId: cp.id,
      models: groups.get(cp.id) || [],
      api: cp.apiBase,
      apiKey: cp.apiKey,
      name: cp.name,
      extraOptions: { timeout: false, chunkTimeout: 60000 },
    })
  }

  return result
}

export function projectNewApiForOpenCode(input: ProjectNewApiForOpenCodeInput): ProjectedOpenCodeProvider {
  const textModels = input.models.filter(model => model.capability === 'text')
  const providerGroups = groupModelsByProvider(textModels)

  // ponytail: OpenCode config 中的 model 字段仅作服务端默认值，实际每次 prompt 会
  // 通过 buildPromptPayload 传入具体模型。这里固定用 jiucaihezi/claude-sonnet-4-6，
  // 避免当前选择变化导致 config_signature 变化 → Rust 杀 OpenCode 进程 → 所有会话数据丢失。
  // 本地 Provider（Ollama/自定义）始终在 enabled_providers 和 provider 中，保证签名稳定。
  const modelId = normalizeModelId('claude-sonnet-4-6')

  const apiKey = String(input.apiKey ?? getApiKey() ?? '').trim()
  const gatewaySessionToken = String(input.gatewaySessionToken ?? getGatewaySessionToken() ?? '').trim()

  // 仅当 jiucaihezi 实际有模型时才需要 apiKey 校验
  // （jiucaihezi provider 始终在列表里保证签名稳定，但没模型时不应拦住纯本地模型场景）
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
    model: `${OPENCODE_JC_PROVIDER_ID}/${modelId}`,
    provider: providerConfig,
  }
}

export async function projectStoredNewApiForOpenCode(
  input: Omit<ProjectNewApiForOpenCodeInput, 'apiKey' | 'gatewaySessionToken'> & Partial<Pick<ProjectNewApiForOpenCodeInput, 'apiKey' | 'gatewaySessionToken'>>
): Promise<ProjectedOpenCodeProvider> {
  const apiKey = String(input.apiKey || getApiKey() || await initApiKey() || '').trim()
  const gatewaySessionToken = String(
    input.gatewaySessionToken || getGatewaySessionToken() || await initGatewaySessionToken() || ''
  ).trim()
  return projectNewApiForOpenCode({
    ...input,
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
