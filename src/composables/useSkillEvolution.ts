/**
 * composables/useSkillEvolution.ts — 统一进化引擎 v2
 *
 * 多源进化：对话历史（始终可用）+ 知识库（可选）+ 编辑器内容（可选）+ 用户口述 + 拖入文件
 *
 * 能力：
 *   1. 多源知识收集 — 对话/知识库/编辑器/口述/文件
 *   2. darwin-skill 四步循环 — evaluate → improve → test → keep/revert
 *   3. 健康评分 — 基于内容丰富度、使用次数、进化次数
 *   4. 进化日志 — 存储完整历史，支持回滚
 *
 * @see https://github.com/alchaincyf/darwin-skill
 */
import { ref } from 'vue'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import { useFileStore } from '@/composables/useFileStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useVaultStore } from '@/stores/vaultStore'
import { getAll } from '@/utils/idb'
import type { SkillConfig, EvolutionEntry } from '@/types/skill'

// ─── 知识源定义 ───
export interface EvolutionSource {
  conversationHistory?: string
  vaultKnowledge?: string
  editorContent?: string
  userNotes?: string
  attachedFiles?: { name: string; content: string }[]
}

// ─── 源状态（给 UI 展示用） ───
export interface EvolutionSourceStatus {
  conversationCount: number
  vaultPageCount: number
  editorHasContent: boolean
}

// ─── Reactive state ───
const isEvolving = ref(false)
const evolveStep = ref(0)
const evolveStepLabels = [
  '',
  '收集使用反馈',
  '分析当前能力',
  '生成升级方案',
  '等待确认',
]
const proposedSkillContent = ref('')
const evolutionSummary = ref('')
const sourceStatus = ref<EvolutionSourceStatus>({ conversationCount: 0, vaultPageCount: 0, editorHasContent: false })

/* ════════════════════════════════════════════════════════════
 *  1. 多源知识收集
 * ════════════════════════════════════════════════════════════ */

/** 从对话历史中收集该Skill的使用记录（始终可用，不需要知识库） */
async function collectConversationHistory(skillId: string): Promise<string> {
  const sessionStore = useSessionStore()
  await sessionStore.loadAllSessions()

  // 找到所有使用该Skill的会话
  const skillSessions = sessionStore.sessions.filter(s => s.agentId === skillId)
  if (skillSessions.length === 0) return ''

  const parts: string[] = []
  for (const session of skillSessions.slice(-5)) { // 最多取最近5个会话
    const messages = await sessionStore.loadSessionMessages(session.id)
    if (messages.length === 0) continue

    // 构建对话摘要：只取用户消息和助手前100字
    const userMsgs = messages.filter(m => m.role === 'user')
    const assistantMsgs = messages.filter(m => m.role === 'assistant')

    const userSamples = userMsgs.slice(-5).map(m =>
      `用户: ${String(m.content).slice(0, 200)}`
    ).join('\n')

    const assistantSamples = assistantMsgs.slice(-3).map(m =>
      `助手回复: ${String(m.content).slice(0, 150)}`
    ).join('\n')

    parts.push(`## 会话: ${session.title}\n### 用户需求\n${userSamples}\n### 助手表现\n${assistantSamples}`)
  }

  sourceStatus.value.conversationCount = Math.min(skillSessions.length, 5)
  return parts.join('\n\n')
}

/** 从知识库收集 wiki 内容 */
async function collectVaultKnowledge(vaultId: string): Promise<string> {
  const fs = useFileStore()
  const allFiles = await fs.loadByVault(vaultId)
  const wikiFiles = allFiles.filter(f =>
    f.mimeType !== 'folder' &&
    (f.metadata?.vaultFolder === 'wiki' || f.kind === 'page')
  )

  sourceStatus.value.vaultPageCount = wikiFiles.length
  if (wikiFiles.length === 0) return ''

  return wikiFiles
    .slice(0, 10)
    .map(f => `### ${f.name}\n${f.content?.slice(0, 400) || ''}`)
    .join('\n\n')
}

/** 从编辑器收集当前打开的内容 */
async function collectEditorContent(): Promise<string> {
  // 从 fileStore 查找当前正在编辑的文件
  try {
    const docs = await getAll('documents') as any[]
    const editingDoc = docs.find((d: any) =>
      d.metadata?.isEditing && d.content && d.content.trim().length > 0
    )
    sourceStatus.value.editorHasContent = !!editingDoc
    if (!editingDoc) return ''
    return `## 编辑器内容: ${editingDoc.name}\n${editingDoc.content.slice(0, 2000)}`
  } catch {
    return ''
  }
}

/* ════════════════════════════════════════════════════════════
 *  2. 统一进化（多源）
 * ════════════════════════════════════════════════════════════ */

export interface EvolutionResult {
  success: boolean
  newContent: string
  summary: string
  suggestions?: { type: string; content: string; reason: string }[]
}

/**
 * 进化Skill — 多源统一入口
 *
 * 知识来源优先级：对话历史 > 知识库 > 编辑器 > 用户口述 > 拖入文件
 * 至少有一个来源就能进化（对话历史始终可用）
 */
export async function evolveSkill(
  skill: SkillConfig,
  source: EvolutionSource
): Promise<EvolutionResult> {
  isEvolving.value = true
  proposedSkillContent.value = ''
  evolutionSummary.value = ''

  try {
    // Step 1: collect — 收集所有可用知识
    evolveStep.value = 1

    const knowledgeParts: string[] = []

    // 对话历史（优先）
    if (source.conversationHistory) {
      knowledgeParts.push(`## 📊 对话使用记录\n${source.conversationHistory}`)
    }

    // 知识库
    if (source.vaultKnowledge?.trim()) {
      knowledgeParts.push(`## 📚 知识库内容\n${source.vaultKnowledge}`)
    }

    // 编辑器
    if (source.editorContent?.trim()) {
      knowledgeParts.push(source.editorContent)
    }

    // 用户口述
    if (source.userNotes?.trim()) {
      knowledgeParts.push(`## 💬 用户改进要求\n${source.userNotes}`)
    }

    // 拖入文件
    if (source.attachedFiles?.length) {
      const fileParts = source.attachedFiles.map(f =>
        `### 📎 ${f.name}\n${f.content.slice(0, 3000)}`
      )
      knowledgeParts.push(`## 📎 参考文件\n${fileParts.join('\n\n')}`)
    }

    const knowledge = knowledgeParts.join('\n\n---\n\n')

    if (!knowledge.trim()) {
      return { success: false, newContent: '', summary: '没有可用的进化素材。请先用Skill聊几次，或者绑定知识库，或者在编辑区打开参考文档。' }
    }

    // Step 2: evaluate — 评估当前能力
    evolveStep.value = 2
    const currentMd = skill.skillContent

    // Step 3: improve — 生成升级版
    evolveStep.value = 3

    const config = await resolveApiConfig()

    const darwinPrompt = `你是 darwin-skill 进化引擎。根据真实使用反馈升级Skill的 SKILL.md。

## 进化规则
1. **Evaluate**: 分析当前 SKILL.md 的覆盖度和盲区，特别关注用户实际需求和助手表现之间的差距
2. **Improve**: 根据使用反馈补充规则、示例、工作流程步骤
3. **Preserve**: 确保新版不丢失旧版的有效能力
4. **Keep/Revert**: 用户最终决定

## 当前 SKILL.md
\`\`\`markdown
${currentMd}
\`\`\`

## 使用反馈（多源）
${knowledge.slice(0, 8000)}

## 改进要求
1. 保留当前 SKILL.md 的所有有效规则
2. 根据使用反馈补充：
   - 新的工作流程步骤（如果对话中发现缺失）
   - 更精准的触发词（如果用户表达方式与现有不匹配）
   - 输出格式优化（如果助手输出与用户期望不符）
   - 专业知识补充
3. 只改确实需要改的地方，不要为了改而改

## 输出格式（严格 JSON）
{
  "summary": "3行变更摘要（中文，说明改了什么和为什么）",
  "suggestions": [
    {"type": "rule|example|workflow|trigger", "content": "改动内容", "reason": "基于哪条使用反馈"}
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
          { role: 'user', content: '请根据使用反馈升级这个Skill。' },
        ],
        temperature: 0.3,
        max_tokens: 6000,
        stream: false,
      }),
    })

    if (!res.ok) {
      return { success: false, newContent: '', summary: `API 错误: ${res.status}` }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''

    let summary = ''
    let newContent = ''
    let suggestions: EvolutionResult['suggestions'] = []

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        summary = parsed.summary || ''
        newContent = parsed.newSkillContent || ''
        suggestions = parsed.suggestions || []
      } catch { /* fallback */ }
    }

    if (!newContent) {
      summary = 'Skill已根据使用反馈升级'
      newContent = text.trim()
    }

    newContent = newContent.replace(/^```markdown\n?/, '').replace(/\n?```$/, '')

    proposedSkillContent.value = newContent
    evolutionSummary.value = summary

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
 *  4. Skill健康评分
 * ════════════════════════════════════════════════════════════ */

/**
 * 评估Skill健康度（0-100）
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
    sourceStatus,
    // 进化
    evolveSkill,
    collectConversationHistory,
    collectVaultKnowledge,
    collectEditorContent,
    keepEvolution,
    revertEvolution,
    // 健康评分
    healthScore,
    healthLabel,
  }
}

// 兼容旧引用
export { evolveSkill as feedbackSkillFromVault }
