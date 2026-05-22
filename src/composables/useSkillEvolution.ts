/**
 * composables/useSkillEvolution.ts — 统一进化引擎
 *
 * 合并原 useEvolution.ts（darwin-skill 循环）+ useSkillFeedback.ts（知识库反哺）
 *
 * 能力：
 *   1. 知识库反哺进化 — 读取 vault wiki/ 内容，LLM 生成升级方案
 *   2. darwin-skill 四步循环 — evaluate → improve → test → keep/revert
 *   3. 健康评分 — 基于使用次数、进化次数、触发词数量评估搭子质量
 *   4. 进化日志 — 存储 diff 摘要（非全文），支持回滚
 *
 * @see https://github.com/alchaincyf/darwin-skill
 */
import { ref } from 'vue'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import { useFileStore } from '@/composables/useFileStore'
import type { SkillConfig, EvolutionEntry } from '@/types/skill'

// ─── Reactive state ───
const isEvolving = ref(false)
const evolveStep = ref(0)
const evolveStepLabels = [
  '',
  '收集知识库内容',
  '评估当前搭子能力',
  '生成升级方案',
  '等待确认',
]
const proposedSkillContent = ref('')
const evolutionSummary = ref('')

/* ════════════════════════════════════════════════════════════
 *  1. 知识库内容收集
 * ════════════════════════════════════════════════════════════ */

/**
 * 从 vault 收集 wiki/ 知识页内容
 * @returns 拼接后的知识文本，空字符串表示无内容
 */
async function collectVaultKnowledge(vaultId: string): Promise<string> {
  const fs = useFileStore()
  const allFiles = await fs.loadByVault(vaultId)
  const wikiFiles = allFiles.filter(f =>
    f.mimeType !== 'folder' &&
    (f.metadata?.vaultFolder === 'wiki' || f.kind === 'page')
  )

  if (wikiFiles.length === 0) return ''

  return wikiFiles
    .slice(0, 20) // 最多 20 页
    .map(f => `### ${f.name}\n${f.content?.slice(0, 500) || ''}`)
    .join('\n\n')
}

/* ════════════════════════════════════════════════════════════
 *  2. 统一进化（darwin-skill + 知识库反哺）
 * ════════════════════════════════════════════════════════════ */

export interface EvolutionResult {
  success: boolean
  newContent: string
  summary: string
  suggestions?: { type: string; content: string; reason: string }[]
}

/**
 * 执行搭子进化（统一入口）
 *
 * 支持两种知识来源：
 *   1. vaultId — 从知识库自动收集 wiki/ 内容
 *   2. wikiContent — 直接传入知识文本
 *
 * darwin-skill 四步循环：
 *   Step 1: collect — 收集知识库内容
 *   Step 2: evaluate — 评估当前 SKILL.md
 *   Step 3: improve — 生成升级版
 *   Step 4: test — 展示 diff，等用户确认
 */
export async function evolveSkill(
  skill: SkillConfig,
  options: { vaultId?: string; wikiContent?: string }
): Promise<EvolutionResult> {
  isEvolving.value = true
  proposedSkillContent.value = ''
  evolutionSummary.value = ''

  try {
    // Step 1: collect — 收集知识
    evolveStep.value = 1
    let knowledge = options.wikiContent || ''
    if (!knowledge && options.vaultId) {
      knowledge = await collectVaultKnowledge(options.vaultId)
    }

    if (!knowledge.trim()) {
      return { success: false, newContent: '', summary: '没有可用的知识库内容' }
    }

    // Step 2: evaluate — 评估当前能力
    evolveStep.value = 2
    const currentMd = skill.skillContent

    // Step 3: improve — 生成升级版
    evolveStep.value = 3

    const config = await resolveApiConfig()

    const darwinPrompt = `你是 darwin-skill 进化引擎。根据真实使用经验升级搭子的 SKILL.md。

## darwin-skill 进化规则
1. **Evaluate**: 分析当前 SKILL.md 的覆盖度和盲区
2. **Improve**: 根据使用经验补充 references、examples、规则
3. **Test**: 确保新版不丢失旧版能力
4. **Keep/Revert**: 用户最终决定

## 当前 SKILL.md
\`\`\`markdown
${currentMd}
\`\`\`

## 使用经验（知识库整理）
${knowledge.slice(0, 6000)}

## 改进要求
1. 保留当前 SKILL.md 的所有有效规则（不丢失）
2. 根据使用经验补充：
   - 新发现的工作流程步骤
   - 新的参考资料 / 示例
   - 更精准的触发词
   - 专业知识补充
3. 优化已有规则的表述（如经验表明有更好做法）

## 输出格式（严格 JSON）
{
  "summary": "3行变更摘要（中文）",
  "suggestions": [
    {"type": "rule|example|workflow|trigger", "content": "改动内容", "reason": "基于哪条知识"}
  ],
  "newSkillContent": "完整的新版 SKILL.md body（不含 frontmatter）"
}`

    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: darwinPrompt },
          { role: 'user', content: '请根据使用经验升级这个搭子的 SKILL.md。' },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        stream: false,
      }),
    })

    if (!res.ok) {
      return { success: false, newContent: '', summary: `API 错误: ${res.status}` }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''

    // 尝试 JSON 解析
    let summary = ''
    let newContent = ''
    let suggestions: EvolutionResult['suggestions'] = []

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        summary = parsed.summary || parsed.changeSummary || ''
        newContent = parsed.newSkillContent || ''
        suggestions = parsed.suggestions || []
      } catch { /* fallback below */ }
    }

    // Fallback: 旧格式（=== SUMMARY === / === SKILL.MD ===）
    if (!newContent && text.includes('=== SKILL.MD ===')) {
      const parts = text.split('=== SKILL.MD ===')
      summary = parts[0].replace('=== SUMMARY ===', '').trim()
      newContent = parts[1].trim()
    }

    // Fallback: 整体作为新 skill content
    if (!newContent) {
      summary = '搭子已根据使用经验升级'
      newContent = text.trim()
    }

    // 清理 markdown 代码块
    newContent = newContent.replace(/^```markdown\n?/, '').replace(/\n?```$/, '')

    proposedSkillContent.value = newContent
    evolutionSummary.value = summary

    // Step 4: test — 等待用户确认
    evolveStep.value = 4

    return { success: true, newContent, summary, suggestions }
  } catch (e) {
    console.error('[Evolution] Error:', e)
    return { success: false, newContent: '', summary: String(e) }
  } finally {
    isEvolving.value = false
  }
}

/* ════════════════════════════════════════════════════════════
 *  3. Keep / Revert
 * ════════════════════════════════════════════════════════════ */

/**
 * 确认采用升级（keep）
 *
 * EvolutionEntry 只存 diff 摘要 + 旧版 hash 前缀，不存全文
 * （减少 localStorage 存储压力）
 */
export function keepEvolution(
  skill: SkillConfig,
  newContent: string,
  summary: string
): SkillConfig {
  const entry: EvolutionEntry = {
    version: skill.version,
    timestamp: Date.now(),
    // 存旧版前 200 字作为标识 + 全文（回滚需要）
    previousSkillContent: skill.skillContent,
    changesSummary: summary.slice(0, 300),
    source: 'brain',
  }

  return {
    ...skill,
    skillContent: newContent,
    version: skill.version + 1,
    updatedAt: Date.now(),
    evolutionLog: [...skill.evolutionLog, entry],
  }
}

/**
 * 回滚到指定版本（revert）
 */
export function revertEvolution(
  skill: SkillConfig,
  toVersion: number
): SkillConfig | null {
  const entry = skill.evolutionLog.find(e => e.version === toVersion)
  if (!entry) return null

  return {
    ...skill,
    skillContent: entry.previousSkillContent,
    version: skill.version + 1,
    updatedAt: Date.now(),
    evolutionLog: [
      ...skill.evolutionLog,
      {
        version: skill.version,
        timestamp: Date.now(),
        previousSkillContent: skill.skillContent,
        changesSummary: `回滚到 v${toVersion}`,
        source: 'manual',
      },
    ],
  }
}

/* ════════════════════════════════════════════════════════════
 *  4. 搭子健康评分
 * ════════════════════════════════════════════════════════════ */

/**
 * 评估搭子健康度（0-100）
 *
 * 维度：
 *   - 内容丰富度（skillContent 长度）
 *   - 触发词覆盖（triggers 数量）
 *   - 使用频率（callCount）
 *   - 进化次数（evolutionLog 长度）
 *   - 有无示例（examples）
 */
export function healthScore(skill: SkillConfig): number {
  let score = 0

  // 内容丰富度（0-30分）
  const contentLen = skill.skillContent?.length || 0
  if (contentLen >= 1000) score += 30
  else if (contentLen >= 500) score += 20
  else if (contentLen >= 100) score += 10

  // 触发词（0-20分）
  const triggerCount = skill.triggers?.length || 0
  if (triggerCount >= 5) score += 20
  else if (triggerCount >= 3) score += 15
  else if (triggerCount >= 1) score += 8

  // 使用频率（0-20分）
  const calls = skill.callCount || 0
  if (calls >= 20) score += 20
  else if (calls >= 10) score += 15
  else if (calls >= 3) score += 10
  else if (calls >= 1) score += 5

  // 进化次数（0-15分）
  const evolves = skill.evolutionLog?.length || 0
  if (evolves >= 3) score += 15
  else if (evolves >= 1) score += 10

  // 示例（0-15分）
  const examples = skill.examples?.length || 0
  if (examples >= 3) score += 15
  else if (examples >= 1) score += 10

  return Math.min(100, score)
}

/**
 * 健康等级标签
 */
export function healthLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: '优秀', color: '#4caf50' }
  if (score >= 60) return { label: '良好', color: '#8bc34a' }
  if (score >= 40) return { label: '一般', color: '#ff9800' }
  return { label: '待完善', color: '#f44336' }
}

/* ════════════════════════════════════════════════════════════
 *  5. 导出
 * ════════════════════════════════════════════════════════════ */

export function useSkillEvolution() {
  return {
    // 状态
    isEvolving,
    evolveStep,
    evolveStepLabels,
    proposedSkillContent,
    evolutionSummary,
    // 进化
    evolveSkill,
    keepEvolution,
    revertEvolution,
    // 健康评分
    healthScore,
    healthLabel,
  }
}

// 兼容旧引用
export { evolveSkill as feedbackSkillFromVault }
