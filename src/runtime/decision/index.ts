import { inferModelTier, useAgentStore } from '@/stores/agentStore'
import { getLocalOllamaModels, LOCAL_OLLAMA_PROVIDER_ID } from '@/utils/providerConfig'
import {
  createLlmDecisionProvider,
  createRuleDecisionProvider,
  isToolGrantedByUser,
  matchesOwnTriggers,
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
  matchesOwnTriggers,
  parseDecisionOutput,
} from './providers'

/**
 * 不是聊天模型的本地模型不拿来决策。用户装的第一台本地模型可能是 OCR / 嵌入模型
 * （实测 ollama 列表第一个就是 `glm-ocr`），盲取 models[0] 会让决策落到一个不会做题的模型上。
 */
const NON_CHAT_LOCAL_MODEL = /ocr|embed|rerank|whisper|tts|bge|gte/i

/**
 * 决策调用用的模型，按优先级排：本地 Ollama 优先（零 token、零网络），再回落云端轻量档。
 * 返回多个而不是一个，是因为「本地配了但不可用」也得能落到云端——只判断有没有配
 * 是不够的，实测那正是「@Jev 什么都没开」的原因。
 */
export function resolveDecisionModelRefs(): DecisionModelRef[] {
  const refs: DecisionModelRef[] = []
  const local = getLocalOllamaModels().find(model => !NON_CHAT_LOCAL_MODEL.test(model.id))
  if (local) refs.push({ modelId: local.id, providerId: LOCAL_OLLAMA_PROVIDER_ID })

  const agentStore = useAgentStore()
  const light = agentStore.textModels.find(model => inferModelTier(model.id) === 'light')
  const cloudId = light?.id || agentStore.currentModel
  if (cloudId)
    refs.push({
      modelId: cloudId,
      providerId: light?.providerId || localStorage.getItem('jcModelProviderId') || 'jiucaihezi',
    })

  return refs.filter(
    (ref, index) =>
      refs.findIndex(
        other => other.modelId === ref.modelId && other.providerId === ref.providerId,
      ) === index,
  )
}

/**
 * 决策链：规则先跑（零成本零延迟），没把握才花一次轻量调用。
 * 这就是「Provider 可替换」的证据——换实现只动这个数组，执行层完全不知情。
 */
export const DECISION_PROVIDER_CHAIN: DecisionProvider[] = [
  createRuleDecisionProvider(),
  createLlmDecisionProvider(resolveDecisionModelRefs),
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
    // 复核模型挑的 Skill：它自己声明的 triggers 一个都没命中就退回不挂 Skill。
    // 「这一轮不挂 Skill」等于今天的手动模式，比强制注入一份方向相反的 SKILL.md 便宜。
    const skills = result.skills.filter(id =>
      matchesOwnTriggers(
        request.candidates.find(candidate => candidate.kind === 'skill' && candidate.id === id),
        request.userRequest,
      ),
    )
    if (granted.length || skills.length || result.modelTier)
      return {
        ...result,
        skills,
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
