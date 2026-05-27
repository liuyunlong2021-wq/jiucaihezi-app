/**
 * composables/useSkillRouter.ts — Superpowers 完全体引擎 v2
 *
 * obra/superpowers 架构完整移植，适配韭菜盒子小白用户场景：
 *   1. Session Hook — 对话开始时注入 bootstrap prompt（搭子互相感知）
 *   2. Planner-First — 超能模式下，规划师为默认入口，先分析意图再分派
 *   3. Fast Match — 本地关键词快速匹配（0ms，避免 503）
 *   4. Ambiguous → Planner — 多搭子同分时交给规划师裁决，不盲目 chain
 *   5. Chain Invoke — 检测 [INVOKE:xxx] 自动流转到下一个搭子
 *   6. Pipeline Tracking — 追踪当前阶段 + 历史
 *
 * @see https://github.com/obra/superpowers
 */
import { ref } from 'vue'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import type { SkillConfig, RouteResult } from '@/types/skill'
import {
  buildSessionHookPrompt,
  detectChainInvoke,
  getSkillPhase,
  type SuperpowerMeta,
} from '@/data/superpowerSkills'

// ─── 路由状态 ───
const lastRouteResult = ref<RouteResult | null>(null)
const isRouting = ref(false)
const routeNotification = ref('')

// ─── Superpowers Pipeline 状态 ───
const currentPhase = ref(0)            // 当前阶段编号，0=未激活
const currentSkillId = ref('')         // 当前激活的 skill id
const pendingInvoke = ref('')          // 待用户确认的 chain invoke target
const pipelineActive = ref(false)      // pipeline 是否激活
const phaseHistory = ref<string[]>([]) // 已经过的阶段 id 列表

// ─── Pipeline 阶段定义（供 UI 消费） ───
const PIPELINE_STAGES = [
  { id: 'planner', name: '超能规划', icon: 'bolt' },
]

// ─── 常量 ───
const PLANNER_SKILL_ID = 'planner'

/* ════════════════════════════════════════════════════════════
 *  1. System Prompt 构建
 * ════════════════════════════════════════════════════════════ */

/**
 * 构建路由 system prompt（用于 LLM 判断意图）
 * 仅在 fastMatch 未命中时才调用 LLM，所以这里的 prompt 需要精简高效
 */
function buildRouterPrompt(skills: SkillConfig[]): string {
  // 排除 planner 自身，路由器只负责选搭子
  const skillList = skills
    .filter(s => s.id !== PLANNER_SKILL_ID)
    .map((s, i) => {
      return `### Skill ${i + 1}: ${s.name} (id: ${s.id})
描述: ${s.description}
触发词: ${s.triggers.join(', ')}
能力摘要: ${s.skillContent.slice(0, 200)}...`
    }).join('\n\n')

  return `你是韭菜盒子的意图路由器（Skill Dispatcher）。

## 你的职责
判断用户的请求应该由哪个搭子来处理。

## 已安装的搭子清单

${skillList}

## 路由规则
1. **明确匹配（single）**：请求明确属于某个搭子的职责 → 直接路由。
2. **多步协作（chain）**：请求需要多个搭子按顺序配合 → 列出执行顺序。
3. **无法判断（ambiguous）**：多个搭子都可能匹配、或意图模糊 → 交给规划师裁决。
4. **无匹配（none）**：没有搭子能处理。
5. 优先匹配 triggers 关键词，也要理解语义。
6. 每个匹配必须说明理由。

## 输出格式
严格输出 JSON（不要 markdown 代码块）：
{"matched": [{"skillId": "xxx", "reason": "xxx"}], "strategy": "single|chain|ambiguous|none"}`
}

/**
 * 构建完整的 superpowers system prompt
 * = session hook + 当前 skill 的完整 SKILL.md + pipeline 上下文
 *
 * 在超能模式 ON 时，每次对话都注入，让 AI 感知所有搭子并能主动调度。
 */
export function buildSuperpowersPrompt(
  allSkills: SkillConfig[],
  activeSkill: SkillConfig | null
): string {
  const parts: string[] = []

  // 1. Session Hook（始终注入 — 让 AI 知道所有已安装搭子）
  parts.push(buildSessionHookPrompt(allSkills))

  // 2. 当前激活 skill 的完整工作流指令
  if (activeSkill) {
    parts.push(`\n\n---\n\n## 当前激活技能: ${activeSkill.name}\n\n${activeSkill.skillContent}`)
  }

  // 3. Pipeline 上下文（让 AI 知道当前处于协作流程的哪一步）
  if (pipelineActive.value && phaseHistory.value.length > 0) {
    parts.push(`\n\n## Pipeline 状态\n已完成阶段: ${phaseHistory.value.join(' → ')}\n当前阶段: ${currentSkillId.value}`)
  }

  return parts.join('\n')
}

/* ════════════════════════════════════════════════════════════
 *  2. 路由核心 — Fast Match + LLM Fallback
 * ════════════════════════════════════════════════════════════ */

/**
 * 本地关键词快速匹配（0ms，不调 API）
 *
 * 匹配策略：
 *   - 单个搭子明显领先 → single
 *   - 多个搭子分数接近 → ambiguous（交给 planner 裁决）
 *   - 无匹配 → null（交给 LLM 语义路由）
 *
 * 注意：planner 的通用触发词（帮我、我想等）不参与快速匹配，
 *       避免所有消息都被 planner 吃掉。
 */
function fastMatchTriggers(
  userMessage: string,
  allSkills: SkillConfig[]
): RouteResult | null {
  const msg = userMessage.toLowerCase()
  const scored: { skillId: string; score: number; reason: string }[] = []

  for (const skill of allSkills) {
    // 跳过 planner — planner 是兜底角色，不参与快速匹配竞争
    if (skill.id === PLANNER_SKILL_ID) continue

    let score = 0
    let matchedTrigger = ''

    for (const trigger of skill.triggers) {
      const t = trigger.toLowerCase()
      if (msg.includes(t)) {
        // 更长的 trigger 权重更高（更精确）
        const s = t.length * 2
        if (s > score) {
          score = s
          matchedTrigger = trigger
        }
      }
    }

    // 也匹配 skill 名字（用户可能直接说"用XX搭子"）
    if (msg.includes(skill.name.toLowerCase())) {
      const s = skill.name.length * 2
      if (s > score) {
        score = s
        matchedTrigger = skill.name
      }
    }

    if (score > 0) {
      scored.push({ skillId: skill.id, score, reason: `关键词匹配: "${matchedTrigger}"` })
    }
  }

  if (scored.length === 0) return null

  // 按分数降序
  scored.sort((a, b) => b.score - a.score)

  // 单个匹配 或 第一名远超第二名 → single（明确路由）
  if (scored.length === 1 || scored[0].score > scored[1].score * 1.5) {
    return {
      matched: [{ skillId: scored[0].skillId, reason: scored[0].reason }],
      strategy: 'single',
    }
  }

  // 多个搭子分数接近 → ambiguous（交给 planner 裁决，不盲目 chain）
  return {
    matched: scored.slice(0, 3).map(s => ({ skillId: s.skillId, reason: s.reason })),
    strategy: 'ambiguous',
  }
}

/**
 * 执行路由分析（主入口）
 *
 * 三级降级策略：
 *   1. 本地关键词快速匹配（0ms）
 *   2. LLM 语义路由（需要 API，100-500ms）
 *   3. 静默降级为 none（API 不可用时）
 */
export async function routeMessage(
  userMessage: string,
  allSkills: SkillConfig[]
): Promise<RouteResult> {
  if (allSkills.length === 0) {
    return { matched: [], strategy: 'none' }
  }

  isRouting.value = true

  try {
    // ★ Level 1: 本地关键词快速匹配（不调 API，0ms）
    const fastResult = fastMatchTriggers(userMessage, allSkills)
    if (fastResult) {
      lastRouteResult.value = fastResult
      applyRouteResult(fastResult, allSkills)
      return fastResult
    }

    // ★ Level 2: LLM 语义路由
    let config
    try {
      config = await resolveApiConfig()
    } catch {
      // Gateway session 未恢复 → 静默降级
      return { matched: [], strategy: 'none' }
    }

    const routerPrompt = buildRouterPrompt(allSkills)

    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: routerPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 300,
        stream: false,
      }),
    })

    if (!res.ok) {
      // 503/429 等错误 → 静默降级，不刷屏
      return { matched: [], strategy: 'none' }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const result: RouteResult = JSON.parse(jsonMatch[0])
        lastRouteResult.value = result
        applyRouteResult(result, allSkills)
        return result
      } catch {
        // LLM 返回了非法 JSON → 静默降级
      }
    }

    return { matched: [], strategy: 'none' }
  } catch {
    // 网络错误 → 静默降级
    return { matched: [], strategy: 'none' }
  } finally {
    isRouting.value = false
  }
}

/* ════════════════════════════════════════════════════════════
 *  3. 路由结果处理 + Pipeline 管理
 * ════════════════════════════════════════════════════════════ */

/**
 * 应用路由结果（通知 UI + 激活 pipeline）
 */
function applyRouteResult(result: RouteResult, allSkills: SkillConfig[]) {
  if (result.strategy === 'single' && result.matched.length > 0) {
    const skill = allSkills.find(s => s.id === result.matched[0].skillId)
    routeNotification.value = `🔀 已切换 → ${skill?.name || result.matched[0].skillId}`

    const meta = getSkillPhase(result.matched[0].skillId)
    if (meta) {
      activatePipeline(result.matched[0].skillId, meta)
    }
  } else if (result.strategy === 'chain' && result.matched.length > 1) {
    // 多步协作：显示协作链，激活第一个
    const names = result.matched.map(m => {
      const s = allSkills.find(sk => sk.id === m.skillId)
      return s?.name || m.skillId
    })
    routeNotification.value = `🔗 协作链 → ${names.join(' → ')}`

    const firstMeta = getSkillPhase(result.matched[0].skillId)
    if (firstMeta) {
      activatePipeline(result.matched[0].skillId, firstMeta)
    }
  } else if (result.strategy === 'ambiguous') {
    // 多搭子同分 → 交给 planner 裁决
    const candidates = result.matched.map(m => {
      const s = allSkills.find(sk => sk.id === m.skillId)
      return s?.name || m.skillId
    }).join('、')
    routeNotification.value = `🤔 多个搭子匹配（${candidates}），规划师分析中…`

    // 自动激活 planner
    const plannerMeta = getSkillPhase(PLANNER_SKILL_ID)
    if (plannerMeta) {
      activatePipeline(PLANNER_SKILL_ID, plannerMeta)
    }
  } else {
    routeNotification.value = ''
  }
}

/**
 * 激活 superpowers pipeline
 */
function activatePipeline(skillId: string, meta: SuperpowerMeta) {
  pipelineActive.value = true
  currentSkillId.value = skillId
  currentPhase.value = meta.phase
  if (!phaseHistory.value.includes(skillId)) {
    phaseHistory.value.push(skillId)
  }
}

/* ════════════════════════════════════════════════════════════
 *  4. Chain Invoke — [INVOKE:xxx] 检测与流转
 * ════════════════════════════════════════════════════════════ */

/**
 * 处理 AI 回复中的 chain invoke
 *
 * 当 AI（通常是 planner）输出 [INVOKE:skillId] 时，
 * 系统检测到后设置 pendingInvoke，等用户确认后切换到目标搭子。
 *
 * @returns 待确认的 skill id，或 null（无 chain invoke）
 */
export function processChainInvoke(
  aiReply: string,
  allSkills?: SkillConfig[]
): string | null {
  const invokeId = detectChainInvoke(aiReply)
  if (!invokeId) return null

  // 验证目标搭子存在（优先检查 allSkills，兜底检查 SUPERPOWER_META）
  if (allSkills) {
    const targetExists = allSkills.some(s => s.id === invokeId)
    if (!targetExists) return null
  } else {
    const meta = getSkillPhase(invokeId)
    if (!meta) return null
  }

  // 设置待确认状态（等用户确认后才切换）
  pendingInvoke.value = invokeId
  return invokeId
}

/**
 * 用户确认 chain invoke → 激活下一个 skill
 */
export function confirmChainInvoke(allSkills: SkillConfig[]): SkillConfig | null {
  const skillId = pendingInvoke.value
  if (!skillId) return null

  pendingInvoke.value = ''
  const skill = allSkills.find(s => s.id === skillId)
  if (!skill) return null

  const meta = getSkillPhase(skillId)
  if (meta) {
    activatePipeline(skillId, meta)
  }

  routeNotification.value = `⏭️ 进入阶段 → ${skill.name}`
  return skill
}

/**
 * 用户拒绝 chain invoke
 */
export function rejectChainInvoke() {
  pendingInvoke.value = ''
}

/* ════════════════════════════════════════════════════════════
 *  5. Pipeline 生命周期
 * ════════════════════════════════════════════════════════════ */

/**
 * 重置 pipeline（新对话时调用）
 */
export function resetPipeline() {
  currentPhase.value = 0
  currentSkillId.value = ''
  pendingInvoke.value = ''
  pipelineActive.value = false
  phaseHistory.value = []
  routeNotification.value = ''
}

/**
 * 合并多 skill 的 skillContent 用于 chain 模式
 */
export function buildChainPrompt(
  skills: SkillConfig[],
  matchedIds: string[]
): string {
  const parts = matchedIds.map((id, i) => {
    const skill = skills.find(s => s.id === id)
    if (!skill) return ''
    return `--- Skill ${i + 1}: ${skill.name} ---\n${skill.skillContent}`
  }).filter(Boolean)

  return `你现在需要按顺序使用以下搭子的能力来完成用户的请求：

${parts.join('\n\n')}

请按照以上搭子的工作流程，依次完成任务。完成一个阶段后，用 [INVOKE:下一个搭子id] 切换到下一个。`
}

/* ════════════════════════════════════════════════════════════
 *  6. 导出
 * ════════════════════════════════════════════════════════════ */

export function useSkillRouter() {
  return {
    // 路由状态
    lastRouteResult,
    isRouting,
    routeNotification,
    routeMessage,
    buildChainPrompt,
    // Superpowers Pipeline
    currentPhase,
    currentSkillId,
    pendingInvoke,
    pipelineActive,
    phaseHistory,
    PIPELINE_STAGES,
    PLANNER_SKILL_ID,
    // Prompt 构建
    buildSuperpowersPrompt,
    // Chain Invoke
    processChainInvoke,
    confirmChainInvoke,
    rejectChainInvoke,
    // 生命周期
    resetPipeline,
  }
}
