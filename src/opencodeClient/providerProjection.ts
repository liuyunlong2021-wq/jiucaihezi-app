import { getApiKey, getGatewaySessionToken, initApiKey, initGatewaySessionToken } from '@/services/newApiClient'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { supportsVision } from '@/utils/providerConfig'
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

function buildModelConfig(modelId: string): Record<string, unknown> {
  const context = getModelContextWindow(modelId)
  const attachment = supportsVision(modelId)
  return {
    name: modelId,
    tool_call: true,
    attachment,
    limit: {
      context,
      output: 8192,
    },
    modalities: {
      input: attachment ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
  }
}

export function projectNewApiForOpenCode(input: ProjectNewApiForOpenCodeInput): ProjectedOpenCodeProvider {
  const textModels = input.models.filter(model => model.capability === 'text')
  // ponytail: OpenCode config 中的 model 字段仅作服务端默认值，实际每次 prompt 会
  // 通过 buildPromptPayload 传入具体模型。这里固定取第一个文本模型，避免当前选择变化
  // 导致 config_signature 变化 → Rust 杀 OpenCode 进程 → 所有会话数据丢失。
  const modelId = normalizeModelId(textModels[0]?.id || 'claude-sonnet-4-6')
  const apiKey = String(input.apiKey ?? getApiKey() ?? '').trim()
  const gatewaySessionToken = String(input.gatewaySessionToken ?? getGatewaySessionToken() ?? '').trim()

  if (!apiKey && gatewaySessionToken) {
    throw new Error('账号 Session 需要先兑换 OpenCode 可用的短期 NewAPI API Key。')
  }
  if (!apiKey) {
    throw new Error('当前没有可用于 OpenCode 的 API Key。账号登录和模型调用 Key 是两件事：请在设置里完成一键登录生成 Key，或在高级功能里填写手动 API Key。')
  }

  const models: Record<string, unknown> = {}
  for (const model of textModels) {
    const id = normalizeModelId(model.id)
    if (!id) continue
    models[id] = buildModelConfig(id)
  }
  if (!models[modelId]) models[modelId] = buildModelConfig(modelId)

  return {
    enabled_providers: [OPENCODE_JC_PROVIDER_ID],
    model: `${OPENCODE_JC_PROVIDER_ID}/${modelId}`,
    provider: {
      [OPENCODE_JC_PROVIDER_ID]: {
        name: '韭菜盒子 NewAPI',
        npm: '@ai-sdk/openai-compatible',
        api: OPENCODE_JC_API_BASE,
        options: {
          apiKey,
          timeout: false,
          chunkTimeout: 60000,
        },
        models,
      },
    },
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
  return {
    providerID: OPENCODE_JC_PROVIDER_ID,
    modelID: normalizeModelId(modelId),
  }
}
