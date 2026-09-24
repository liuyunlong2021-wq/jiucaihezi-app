import { inferModelTier, useAgentStore } from '@/stores/agentStore'
import {
  createLlmDecisionProvider,
  createRuleDecisionProvider,
  isToolGrantedByUser,
  pickLocalDecisionModel,
  PRODUCING_TOOL_IDS,
  wantsTextDeliverable,
  type DecisionModelRef,
} from './providers'
import { createLocalScorerProvider } from './localScorer'
import type { DecisionModelTier, DecisionProvider, DecisionRequest, DecisionResult } from './types'

export * from './types'
export type { DecisionModelRef } from './providers'
export {
  buildDecisionPrompt,
  createLlmDecisionProvider,
  createRuleDecisionProvider,
  gateSkillsByOwnTriggers,
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

/** 芯片（@文件/@排版/@影音/@3D）的拥有者。芯片是结构判断，只有规则层会给。 */
export const CHIP_PROVIDER_ID = 'rule'

/**
 * 决策链：打分器先跑（语义判断 Skill，本地、离线、0.6 秒），规则层接着补能力芯片，
 * 云端/本地模型是兜底——前两个都没给出结论时才轮到它。
 * 这就是「Provider 可替换」的证据——换实现只动这个数组，执行层完全不知情。
 */
export const DECISION_PROVIDER_CHAIN: DecisionProvider[] = [
  createLocalScorerProvider(),
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
 * 分层叠加，不是「谁先出声谁说了算」：规则层管能力芯片（关键词是结构判断），
 * 打分器管 Skill（语义判断，见 localScorer）。曾经是拿第一个非空结果就 return，
 * 于是规则层给出 @影音/@3D 之后就返回了，Skill 那一步永远轮不到——
 * 实测端到端只有 75%，而打分器单独跑是 93%。
 *
 * 现在的契约：**第一个给出结论的 provider 拥有 Skill 决定权**（包括「本轮不挂 Skill」这个结论），
 * 芯片和档位各家叠加、谁先给用谁的。真机实测规则层单独只有 33%，它凭关键词撞上的 Skill
 * 不能盖掉 93% 的打分器（「广告短片」被撞成 3D 短片 Skill 就是这么来的）。
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
  const granted: string[] = []
  let skills: string[] = []
  let modelTier: DecisionModelTier | null = null
  let lastProvider = ''
  let verdictProvider = ''
  let anyResult = false
  let skillVerdictTaken = false
  for (const provider of providers) {
    // Skill 有结论就不再问别人（尤其是别把云端/本地模型拖进来），
    // 但芯片必须问：@文件 / @排版 / @影音 / @3D 是结构判断，只有规则层会给。
    if (skillVerdictTaken && provider.id !== CHIP_PROVIDER_ID) continue
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
    anyResult = true
    // 第一个答话的 provider 就是本次决策的出处（打分器在跑就是它，没跑就是规则层）。
    if (!verdictProvider) verdictProvider = provider.id
    // 要文字的那轮不开产出型能力：规则层和模型层都可能想开 @影音，
    // 所以闸门只在这里执行一次，provider 绕不过去。改放进 suggestions，用户想开自己点。
    const wantsText = wantsTextDeliverable(request.userRequest)
    for (const id of result.tools) {
      if (granted.includes(id)) continue
      if (wantsText && PRODUCING_TOOL_IDS.has(id)) {
        suggestions.add(id)
        continue
      }
      if (isToolGrantedByUser(id, request.userRequest)) granted.push(id)
      else suggestions.add(id)
    }
    if (!modelTier && result.modelTier) modelTier = result.modelTier
    // 谁先答话谁定 Skill。各层自己对自己的结论负责：规则层的命中就是候选自带的
    // triggers（同源，不用复核），打分器是真的读过候选描述做语义比对，
    // 而模型层是自由发挥——它的复核查在 createLlmDecisionProvider 里。
    if (!skillVerdictTaken) {
      skillVerdictTaken = true
      skills = result.skills
    }
  }
  if (!anyResult) return null
  // suggestions 也算「有话说」：模型想要的东西需要用户自己开，这条提示得送出去。
  if (!skills.length && !granted.length && !modelTier && !suggestions.size) return null
  return {
    skills,
    tools: granted,
    modelTier,
    suggestions: [...suggestions],
    reason: providerReason(skills, granted, suggestions.size),
    provider: verdictProvider || lastProvider,
    latencyMs: Date.now() - startedAt,
  }
}

function providerReason(skills: string[], tools: string[], suggestionCount: number): string {
  if (skills.length) return '已选定 Skill'
  if (tools.length) return '只开了能力芯片'
  if (suggestionCount) return '这些能力需要你自己开'
  return '没把握，不改动'
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
