import { inferModelTier, useAgentStore } from '@/stores/agentStore'
import { getLocalOllamaModels, LOCAL_OLLAMA_PROVIDER_ID } from '@/utils/providerConfig'
import {
  createLlmDecisionProvider,
  createRuleDecisionProvider,
  isToolGrantedByUser,
  type DecisionModelRef,
} from './providers'
import type { DecisionModelTier, DecisionProvider, DecisionRequest, DecisionResult } from './types'

export * from './types'
export type { DecisionModelRef } from './providers'
export {
  buildDecisionPrompt,
  createLlmDecisionProvider,
  createRuleDecisionProvider,
  isToolGrantedByUser,
  LOCAL_GRANT_INTENT,
  LOCAL_GRANT_TOOL_IDS,
  parseDecisionOutput,
} from './providers'

/** 决策调用用的模型：本地 Ollama 优先（零 token、零网络），不可用再回落云端轻量档。 */
export function resolveDecisionModelRef(): DecisionModelRef | null {
  const local = getLocalOllamaModels()[0]
  if (local) return { modelId: local.id, providerId: LOCAL_OLLAMA_PROVIDER_ID }
  const agentStore = useAgentStore()
  const light = agentStore.textModels.find(model => inferModelTier(model.id) === 'light')
  const modelId = light?.id || agentStore.currentModel
  if (!modelId) return null
  return {
    modelId,
    providerId: light?.providerId || localStorage.getItem('jcModelProviderId') || 'jiucaihezi',
  }
}

/**
 * 决策链：规则先跑（零成本零延迟），没把握才花一次轻量调用。
 * 这就是「Provider 可替换」的证据——换实现只动这个数组，执行层完全不知情。
 */
export const DECISION_PROVIDER_CHAIN: DecisionProvider[] = [
  createRuleDecisionProvider(),
  createLlmDecisionProvider(resolveDecisionModelRef),
]

/**
 * 一次决策。任一 provider 抛错只当作「没把握」继续往下走；全都没把握返回 null。
 * null 的含义是「什么都不改」，也就是和其它所有轮一样的手动行为——
 * 决策层是增强，不能变成发送的单点故障。
 *
 * 授权边界在这里统一执行（不是在各 provider 里）：provider 可以想要 `@文件`，
 * 但只要用户自己的话里没点名文件，就只能进 suggestions，由界面上请用户自己开。
 */
export async function decide(
  request: DecisionRequest,
  providers: DecisionProvider[] = DECISION_PROVIDER_CHAIN,
): Promise<DecisionResult | null> {
  const startedAt = Date.now()
  const suggestions = new Set<string>()
  let lastProvider = ''
  for (const provider of providers) {
    lastProvider = provider.id
    let result: DecisionResult | null = null
    try {
      result = await provider.decide(request)
    } catch {
      continue
    }
    if (!result) continue
    const granted: string[] = []
    for (const id of result.tools) {
      if (isToolGrantedByUser(id, request.userRequest)) granted.push(id)
      else suggestions.add(id)
    }
    if (granted.length || result.skills.length || result.modelTier)
      return {
        ...result,
        tools: granted,
        suggestions: [...suggestions],
        latencyMs: Date.now() - startedAt,
      }
  }
  if (!suggestions.size) return null
  return {
    skills: [],
    tools: [],
    modelTier: null,
    suggestions: [...suggestions],
    reason: '这些能力需要你自己开',
    provider: lastProvider,
    latencyMs: Date.now() - startedAt,
  }
}

/**
 * 按档位在当前 Provider 内找模型。找不到就返回 null（保持当前模型不动）——
 * 不跨 Provider 切换，避免把用户的 Claude 会话悄悄换成别的厂。
 */
export function resolveModelForTier(tier: DecisionModelTier): DecisionModelRef | null {
  const agentStore = useAgentStore()
  const providerId = localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const target = agentStore.textModels.find(
    model => (model.providerId || 'jiucaihezi') === providerId && inferModelTier(model.id) === tier,
  )
  if (!target || target.id === agentStore.currentModel) return null
  return { modelId: target.id, providerId: target.providerId || providerId }
}
