import { buildSkillConnection } from './skillConnection'
import type {
  SkillConnection,
  SkillConnectionResource,
  SkillSelectedBy,
} from './types'

export interface SkillConnectionCandidate {
  id: string
  skillContent?: string | null
  appendSkillMd?: string
  resources?: SkillConnectionResource[]
}

export interface SkillRuntimeAgentLike {
  id: string
  name?: string
  description?: string
  oneLineDesc?: string
  triggers?: string[]
  skillContent?: string | null
}

export interface ResolveSelectedSkillCandidateInput {
  agentId?: string
  explicitSystemPrompt?: string
  agents?: SkillRuntimeAgentLike[]
  currentAgent?: SkillRuntimeAgentLike | null
  getSkillById?: (id: string) => SkillRuntimeAgentLike | undefined | null
}

export interface ResolveSelectedSkillCandidateResult {
  skill?: SkillConnectionCandidate
  skillHint: string
  contextCount?: number
}

export interface ResolveSkillConnectionInput {
  skill?: SkillConnectionCandidate | null
  selectedBy: SkillSelectedBy
  loadSkillContent?: (uri: string) => Promise<string>
}

export interface ResolveSkillConnectionResult {
  connection?: SkillConnection
  error?: string
}

export async function resolveSkillConnection(
  input: ResolveSkillConnectionInput,
): Promise<ResolveSkillConnectionResult> {
  if (!input.skill) return {}

  const rawContent = String(input.skill.skillContent || '').trim()
  if (!rawContent) {
    return {
      error: `Skill "${input.skill.id}" is missing SKILL.md content.`,
    }
  }

  const loaded = await resolveSkillMdContent(rawContent, input.loadSkillContent)
  if (loaded.error) return { error: loaded.error }
  const skillMd = [loaded.skillMd || '', input.skill.appendSkillMd || '']
    .filter(Boolean)
    .join('\n')

  return {
    connection: buildSkillConnection({
      id: input.skill.id,
      selectedBy: input.selectedBy,
      skillMd,
      resources: input.skill.resources || [],
    }),
  }
}

export function resolveSelectedSkillCandidate(
  input: ResolveSelectedSkillCandidateInput,
): ResolveSelectedSkillCandidateResult {
  if (!input.agentId) return { skillHint: '' }

  const agent = resolveAgentLike(input)
  if (!agent) return { skillHint: '' }

  const content = String(agent.skillContent || '').trim()
  if (!content) return { skillHint: buildSkillRetrievalHint(agent) }

  return {
    skill: {
      id: agent.id || input.agentId,
      skillContent: content,
      appendSkillMd: input.agentId === 'preset_skill-creator' ? SKILL_CREATOR_RUNTIME_APPENDIX : undefined,
    },
    skillHint: buildSkillRetrievalHint(agent),
    contextCount: (agent as any)?.contextCount,
  }
}

export function buildSkillRetrievalHint(agent?: SkillRuntimeAgentLike | null): string {
  if (!agent) return ''
  return [
    agent.name,
    agent.oneLineDesc || agent.description,
    Array.isArray(agent.triggers) && agent.triggers.length ? `触发词：${agent.triggers.join('、')}` : '',
  ].filter(Boolean).join('\n').slice(0, 600)
}

export async function loadPublicSkillContent(skillUri: string): Promise<string> {
  if (typeof fetch !== 'function') return ''
  const relativePath = skillUri.replace(/^skill:\/\//, '').replace(/^\/+/, '')
  if (!relativePath || relativePath.includes('..') || relativePath.includes('\0')) return ''
  try {
    const base = typeof window !== 'undefined' && window.location?.href
      ? window.location.href
      : 'http://localhost/'
    const url = new URL(`/skills/${relativePath}`, base).toString()
    const res = await fetch(url)
    if (!res.ok) return ''
    return (await res.text()).slice(0, 50_000)
  } catch {
    return ''
  }
}

export function isSkillUri(value: string): boolean {
  return value.trim().startsWith('skill://')
}

function resolveAgentLike(input: ResolveSelectedSkillCandidateInput): SkillRuntimeAgentLike | undefined | null {
  return input.agents?.find(agent => agent.id === input.agentId)
    || (input.currentAgent?.id === input.agentId ? input.currentAgent : undefined)
    || input.getSkillById?.(input.agentId || '')
}

const SKILL_CREATOR_RUNTIME_APPENDIX = `

---
## 强制工作流（不可跳过任何步骤）

你只能使用 2 个工具：run_skill_tests 和 save_skill。没有其他工具可用。

### 步骤 1：了解需求
追问用户：Skill做什么？什么场景触发？输出什么格式？

### 步骤 2：起草 SKILL.md
用 \`\`\`markdown 代码块输出完整 SKILL.md（含 YAML frontmatter）。向用户展示并确认。

### 步骤 3：设计测试用例并告知用户
告诉用户："我设计了以下 3 个测试用例来验证这个Skill："，然后列出每个用例的 prompt 和期望表现。等用户确认后再继续。

### 步骤 4：运行测试
调用 run_skill_tests 工具。它会返回 summary（with/without 通过率对比）、benchmark（均值/标准差/delta）、notes（分析发现）。

### 步骤 5：展示结果并必须询问反馈
把测试结果翻译成用户看得懂的表格，然后必须问用户反馈。不允许自己判断"可以了"就跳过，必须等待用户明确回复后再继续。

### 步骤 6：迭代
根据用户反馈修改 SKILL.md，回到步骤 2，再测，再问。循环直到用户说满意。

### 步骤 7：等待用户确认后保存
用户必须明确说"满意"、"可以了"、"ok"、"保存吧" 等确认词之后，你才能调用 save_skill 工具。绝对不要在用户确认之前自行保存。保存后告诉用户："Skill已保存，在「我的Skill」中可用。"
`

async function resolveSkillMdContent(
  rawContent: string,
  loadSkillContent?: (uri: string) => Promise<string>,
): Promise<{ skillMd: string; error?: undefined } | { skillMd?: undefined; error: string }> {
  if (!isSkillUri(rawContent)) return { skillMd: rawContent }

  if (!loadSkillContent) {
    return {
      error: `Cannot resolve ${rawContent}: missing Skill content loader.`,
    }
  }

  try {
    const loaded = String(await loadSkillContent(rawContent) || '').trim()
    if (!loaded) {
      return {
        error: `Cannot resolve ${rawContent}: loader returned empty SKILL.md content.`,
      }
    }
    return { skillMd: loaded }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      error: `Cannot resolve ${rawContent}: ${message}`,
    }
  }
}
