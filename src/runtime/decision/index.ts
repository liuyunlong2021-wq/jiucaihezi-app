import { inferModelTier, useAgentStore } from '@/stores/agentStore'
import {
  createLlmDecisionProvider,
  createRuleDecisionProvider,
  isToolGrantedByUser,
  matchesOwnTriggers,
  pickLocalDecisionModel,
  PRODUCING_TOOL_IDS,
  wantsTextDeliverable,
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
  NON_CHAT_LOCAL_MODEL,
  parseDecisionOutput,
  pickLocalDecisionModel,
  PRODUCING_TOOL_IDS,
  wantsTextDeliverable,
} from './providers'
export { createLocalScorerProvider, type LocalScorerOptions } from './localScorer'

/**
 * 决策先试云端还是先试本地？
 *
 * - 云端（你正在用的模型）：1~3 秒，判断力明显更好，代价是每次发送多一次调用
 *   （决策提示词约 4.5k token，会算进你的额度）。
 * - 本地（ollama 里最小的对话模型）：零 token 零网络，但 9b 级判断力偏弱
 *   ——实测「这部小说太长了帮我总结一下」仍会被挂上写小说的 Skill；冷启动还要 20 秒。
 *
 * 默认云端优先：@Jev 的价值就是挑对，挑错的代价（挂错一整份 SKILL.md、用户重做一遍）
 * 比一次调用贵。想回到零 token 就把这里改成 false —— 本地永远是兜底，不会退化成「什么都不做」。
 */
const PREFER_CLOUD_DECISION = true

/** 尝试顺序。云端优先时本地只做兜底；反之本地先试、云端接住。null 直接排掉。 */
export function orderDecisionModelRefs(
  cloud: DecisionModelRef | null,
  local: DecisionModelRef | null,
): DecisionModelRef[] {
  const ordered = PREFER_CLOUD_DECISION ? [cloud, local] : [local, cloud]
  return ordered.filter((ref): ref is DecisionModelRef => Boolean(ref))
}

/**
 * 决策调用用的模型列表。返回多个而不是一个，是因为「配了但不可用」也得能落到下一个——
 * 只判断有没有配是不够的，实测那正是「@Jev 什么都没开」的原因。
 *
 * 云端那一档优先取轻量档（便宜），没配轻量档就用当前模型；本地那台由
 * pickLocalDecisionModel 按体积挑最小的（大模型读 4k token 的决策提示词会超
 * HTTP 层 30s 上限，表现成「判断没回来」）。
 */
export async function resolveDecisionModelRefs(): Promise<DecisionModelRef[]> {
  const agentStore = useAgentStore()
  const light = agentStore.textModels.find(model => inferModelTier(model.id) === 'light')
  const cloudId = light?.id || agentStore.currentModel
  const cloud: DecisionModelRef | null = cloudId
    ? {
        modelId: cloudId,
        providerId: light?.providerId || localStorage.getItem('jcModelProviderId') || 'jiucaihezi',
      }
    : null

  const refs = orderDecisionModelRefs(cloud, await pickLocalDecisionModel())

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

const BUDGET_EXCEEDED = Symbol('budget-exceeded')

/**
 * 到点就把这次决策当作「没把握」。底层请求不会因此中止（HTTP 层有它自己的 30s 上限），
 * 但发送不再等它——决策迟到比决策缺席更贵。
 */
function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | typeof BUDGET_EXCEEDED> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<typeof BUDGET_EXCEEDED>(resolve => {
    timer = setTimeout(() => resolve(BUDGET_EXCEEDED), ms)
  })
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

/**
 * 一次决策的时间上限。决策是可选增强，不能把发送卡住——最坏路径（本地模型不可用 → 云端
 * 回落）实测能把发送键按住一分钟以上，用户看到的就是「发送键点不动了」。
 * 实测本机 qwen3.8:9b 一次判断 4.6s（热）~21s（冷），HTTP 层单次请求上限 30s，
 * 所以 35s 够一次完整的本地尝试，又切掉了「本地 + 云端」双份等待。
 */
export const DECISION_BUDGET_MS = 35_000

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
  budgetMs = DECISION_BUDGET_MS,
): Promise<DecisionResult | null> {
  const startedAt = Date.now()
  const suggestions = new Set<string>()
  let lastProvider = ''
  for (const provider of providers) {
    lastProvider = provider.id
    const remaining = budgetMs - (Date.now() - startedAt)
    if (remaining <= 0) break
    let result: DecisionResult | null = null
    try {
      const raced = await withBudget(provider.decide(request), remaining)
      if (raced === BUDGET_EXCEEDED) break
      result = raced
    } catch {
      continue
    }
    if (!result) continue
    // 要文字的那轮不开产出型能力：规则层和模型层都可能想开 @影音，
    // 所以闸门只在这里执行一次，provider 绕不过去。改放进 suggestions，用户想开自己点。
    const wantsText = wantsTextDeliverable(request.userRequest)
    const granted: string[] = []
    for (const id of result.tools) {
      if (wantsText && PRODUCING_TOOL_IDS.has(id)) {
        suggestions.add(id)
        continue
      }
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
