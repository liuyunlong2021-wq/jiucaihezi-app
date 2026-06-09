import { getApiKey, getGatewaySessionToken } from '@/services/newApiClient'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { supportsVision } from '@/utils/providerConfig'
import { resolveTextModelSelection } from '@/utils/modelSelection'
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
  const selected = resolveTextModelSelection(input.currentModel || '', textModels)
  const modelId = normalizeModelId(selected || textModels[0]?.id || 'claude-sonnet-4-6')
  const apiKey = String(input.apiKey ?? getApiKey() ?? '').trim()
  const gatewaySessionToken = String(input.gatewaySessionToken ?? getGatewaySessionToken() ?? '').trim()

  if (!apiKey && gatewaySessionToken) {
    throw new Error('账号 Session 需要先兑换 OpenCode 可用的短期 NewAPI API Key。')
  }
  if (!apiKey) {
    throw new Error('请先登录韭菜盒子账号或配置手动 API Key。')
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

export function toOpenCodeModelProjection(modelId: string) {
  return {
    providerID: OPENCODE_JC_PROVIDER_ID,
    modelID: normalizeModelId(modelId),
  }
}
