/**
 * composables/useSkillRouter.ts — Superpowers 完全体引擎
 *
 * 完整移植 obra/superpowers 的全部能力：
 *   1. Session Hook — 对话开始时注入 bootstrap prompt
 *   2. Skill Dispatch — LLM 语义路由 + 完整 SKILL.md 注入
 *   3. Chain Invoke — 检测 [INVOKE:xxx] 自动流转
 *   4. Phase Gate — HARD-GATE 强制执行
 *   5. Pipeline Tracking — 追踪当前阶段
 *
 * @see https://github.com/obra/superpowers
 */
import { ref, computed } from 'vue'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import type { SkillConfig, RouteResult } from '@/types/skill'
import {
  SUPERPOWER_META,
  buildSessionHookPrompt,
  detectChainInvoke,
  getSkillPhase,
  type SuperpowerMeta,
} from '@/data/superpowerSkills'

// ─── 状态 ───
const lastRouteResult = ref<RouteResult | null>(null)
const isRouting = ref(false)
const routeNotification = ref('')

// ─── Superpowers Pipeline 状态 ───
const currentPhase = ref(0)           // 当前阶段 (1-7), 0=未激活
const currentSkillId = ref('')        // 当前激活的 skill id
const pendingInvoke = ref('')         // 待用户确认的 chain invoke
const pipelineActive = ref(false)     // pipeline 是否激活
const phaseHistory = ref<string[]>([]) // 已经过的阶段

// ─── Pipeline 信息（供 UI 消费） ───
const PIPELINE_STAGES = [
  { id: 'sp_brainstorming', name: '头脑风暴', icon: 'psychology' },
  { id: 'sp_writing_plans', name: '写计划', icon: 'assignment' },
  { id: 'sp_subagent_exec', name: '分步执行', icon: 'rocket_launch' },
  { id: 'sp_code_review',   name: '代码审查', icon: 'rate_review' },
  { id: 'sp_verification',  name: '验证确认', icon: 'verified' },
]

/**
 * 构建路由 system prompt（用于 LLM 判断意图）
 */
function buildRouterPrompt(skills: SkillConfig[]): string {
  const skillList = skills.map((s, i) => {
    return `### Skill ${i + 1}: ${s.name} (id: ${s.id})
描述: ${s.description}
触发词: ${s.triggers.join(', ')}
能力摘要: ${s.skillContent.slice(0, 200)}...`
  }).join('\n\n')

  return `你是韭菜盒子的意图路由器（Skill Dispatcher）。

## 你的职责
参考 superpowers 的 skill dispatch 模式：在用户发出任何请求之前，先扫描所有已安装的搭子（Skill），判断哪个搭子最适合处理这个请求。

## 已安装的搭子清单

${skillList}

## 路由规则
1. **单 skill 路由（single）**：如果请求明确属于某个搭子的职责范围，直接路由到该搭子。
2. **多 skill 协作（chain）**：如果请求需要多个搭子配合完成，按执行顺序列出。例如：先用"头脑风暴"搭子设计，再用"写计划"搭子规划。
3. **无匹配（none）**：如果没有搭子能处理，返回 none。
4. 优先匹配 triggers 关键词，但也要理解语义。
5. 每个匹配必须说明理由。
6. 如果匹配到 superpowers 系列技能（id 以 sp_ 开头），应优先触发 sp_brainstorming 开始完整流程。

## 输出格式
严格输出 JSON（不要 markdown 代码块）：
{"matched": [{"skillId": "xxx", "reason": "xxx"}], "strategy": "single|chain|none"}`
}

/**
 * 构建完整的 superpowers system prompt
 * = session hook + 当前 skill 的完整 SKILL.md
 */
export function buildSuperpowersPrompt(
  allSkills: SkillConfig[],
  activeSkill: SkillConfig | null
): string {
  const parts: string[] = []

  // 1. Session Hook（始终注入）
  parts.push(buildSessionHookPrompt(allSkills))

  // 2. 当前激活 skill 的完整工作流指令
  if (activeSkill) {
    parts.push(`\n\n---\n\n## 当前激活技能: ${activeSkill.name}\n\n${activeSkill.skillContent}`)
  }

  // 3. Pipeline 上下文
  if (pipelineActive.value && phaseHistory.value.length > 0) {
    parts.push(`\n\n## Pipeline 状态\n已完成阶段: ${phaseHistory.value.join(' → ')}\n当前阶段: ${currentSkillId.value}`)
  }

  return parts.join('\n')
}

/**
 * 本地关键词快速匹配（避免每条消息都调 LLM，解决 503 问题）
 */
function fastMatchTriggers(
  userMessage: string,
  allSkills: SkillConfig[]
): RouteResult | null {
  const msg = userMessage.toLowerCase()
  const scored: { skillId: string; score: number; reason: string }[] = []

  for (const skill of allSkills) {
    let score = 0
    let matchedTrigger = ''
    for (const trigger of skill.triggers) {
      const t = trigger.toLowerCase()
      if (msg.includes(t)) {
        // 更长的 trigger 权重更高
        const s = t.length * 2
        if (s > score) {
          score = s
          matchedTrigger = trigger
        }
      }
    }
    // 也匹配 skill 名字
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

  // 按分数排序
  scored.sort((a, b) => b.score - a.score)

  if (scored.length === 1 || scored[0].score > scored[1].score * 1.5) {
    // 明确匹配单个 skill
    return {
      matched: [{ skillId: scored[0].skillId, reason: scored[0].reason }],
      strategy: 'single',
    }
  }

  // 多个同等匹配 → chain
  return {
    matched: scored.slice(0, 3).map(s => ({ skillId: s.skillId, reason: s.reason })),
    strategy: scored.length > 1 ? 'chain' : 'single',
  }
}

/**
 * 执行路由分析
 * 优先本地关键词匹配，匹配不到才走 LLM（避免 503 浪费）
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
    // ★ 先尝试本地关键词快速匹配（不调 API，0ms）
    const fastResult = fastMatchTriggers(userMessage, allSkills)
    if (fastResult) {
      lastRouteResult.value = fastResult
      applyRouteResult(fastResult, allSkills)
      return fastResult
    }

    // 本地未匹配 → 走 LLM 语义路由
    let config
    try {
      config = await resolveApiConfig()
    } catch {
      // API Key 未配置时不走 LLM 路由
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
      // 503/429 等错误时静默降级，不再打印 console.warn 刷屏
      return { matched: [], strategy: 'none' }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const result: RouteResult = JSON.parse(jsonMatch[0])
      lastRouteResult.value = result
      applyRouteResult(result, allSkills)
      return result
    }

    return { matched: [], strategy: 'none' }
  } catch {
    // 网络错误静默降级
    return { matched: [], strategy: 'none' }
  } finally {
    isRouting.value = false
  }
}

/**
 * 应用路由结果（通知 + pipeline 激活）
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
    const names = result.matched.map(m => {
      const s = allSkills.find(sk => sk.id === m.skillId)
      return s?.name || m.skillId
    })
    routeNotification.value = `🔗 协作链 → ${names.join(' → ')}`

    const firstMeta = getSkillPhase(result.matched[0].skillId)
    if (firstMeta) {
      activatePipeline(result.matched[0].skillId, firstMeta)
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

/**
 * 处理 AI 回复中的 chain invoke
 * @returns 待确认的 skill id，或 null（无 chain invoke）
 */
export function processChainInvoke(aiReply: string): string | null {
  const invokeId = detectChainInvoke(aiReply)
  if (!invokeId) return null

  const meta = getSkillPhase(invokeId)
  if (!meta) return null

  // 设置待确认状态（等用户确认）
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

/**
 * 重置 pipeline（新对话时）
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

请按照以上搭子的工作流程，依次完成任务。`
}

export function useSkillRouter() {
  return {
    // 原有
    lastRouteResult,
    isRouting,
    routeNotification,
    routeMessage,
    buildChainPrompt,
    // Superpowers 新增
    currentPhase,
    currentSkillId,
    pendingInvoke,
    pipelineActive,
    phaseHistory,
    PIPELINE_STAGES,
    buildSuperpowersPrompt,
    processChainInvoke,
    confirmChainInvoke,
    rejectChainInvoke,
    resetPipeline,
  }
}
