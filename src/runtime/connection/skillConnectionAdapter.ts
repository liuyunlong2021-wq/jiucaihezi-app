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
  skillMaterialRuntimeAvailable?: boolean
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
      appendSkillMd: buildSkillRuntimeAppendix(input.agentId, {
        skillMaterialRuntimeAvailable: input.skillMaterialRuntimeAvailable === true,
      }),
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

function buildSkillRuntimeAppendix(
  agentId?: string,
  options: { skillMaterialRuntimeAvailable?: boolean } = {},
): string | undefined {
  if (agentId === 'skill-creator' || agentId === 'preset_skill-creator') return SKILL_CREATOR_RUNTIME_APPENDIX
  if (agentId === 'skill-builder' || agentId === 'preset_skill-builder') {
    return options.skillMaterialRuntimeAvailable
      ? SKILL_BUILDER_RUNTIME_APPENDIX_WITH_ADVANCED_RUNTIME
      : SKILL_BUILDER_RUNTIME_APPENDIX_BASE
  }
  return undefined
}

const SKILL_CREATOR_RUNTIME_APPENDIX = `

---
## 强制工作流（不可跳过任何步骤）

你可以使用 7 个官方生命周期工具：skill_creator_validate、run_skill_tests、skill_creator_aggregate_benchmark、skill_creator_open_eval_review、skill_creator_improve_description、skill_creator_package、save_skill。

### 步骤 1：了解需求
追问用户：Skill做什么？什么场景触发？输出什么格式？

### 步骤 2：起草 SKILL.md
用 \`\`\`markdown 代码块输出完整 SKILL.md（含 YAML frontmatter）。向用户展示并确认。

### 步骤 2.5：结构校验
起草或修改后调用 skill_creator_validate，确认 YAML frontmatter、name、description、正文和资料包路径符合官方 Skill 结构。失败时先修正，不要进入测试。

### 步骤 3：设计测试用例并告知用户
告诉用户："我设计了以下 3 个测试用例来验证这个Skill："，然后列出每个用例的 prompt 和期望表现。等用户确认后再继续。

### 步骤 4：运行测试
调用 run_skill_tests 工具。它会返回 summary（with/without 通过率对比）、benchmark（均值/标准差/delta）、notes（分析发现）。

### 步骤 5：展示结果并必须询问反馈
调用 skill_creator_open_eval_review 生成官方评审数据。把测试结果翻译成用户看得懂的表格，然后必须问用户反馈。不允许自己判断"可以了"就跳过，必须等待用户明确回复后再继续。

### 步骤 6：迭代
根据用户反馈修改 SKILL.md，回到步骤 2，再测，再问。循环直到用户说满意。

### 步骤 6.5：优化命中描述
如果测试显示命中不准、without_skill 也能通过、用户说"不够准"或"触发不稳定"，调用 skill_creator_improve_description 优化 YAML description，并把完整 SKILL.md 展示给用户确认。

### 步骤 7：等待用户确认后保存
用户必须明确说"满意"、"可以了"、"ok"、"保存吧" 等确认词之后，你才能调用 save_skill 工具。绝对不要在用户确认之前自行保存。保存后告诉用户："Skill已保存，在「我的Skill」中可用。"

### 步骤 8：打包预检
保存前可调用 skill_creator_package 做官方 .skill 包预检。这个步骤是内部能力，不要让用户理解文件夹、脚本或 manifest 细节。
`

const SKILL_BUILDER_RUNTIME_APPENDIX_BASE = `

---
## 产品运行时限制（韭菜盒子 Studio）

当前应用内不会暴露 Skill Seekers MCP 的 scrape_docs、scrape_github、scrape_pdf、enhance_skill、package_skill 等底层工具。你不能声称调用过这些外部工具。

当前只能处理文本、Markdown、可读取附件和可转换文档。你可以使用 5 个内置创建工具：build_skill_from_text、local_extract_attachment、document_to_markdown、run_skill_tests 和 save_skill。

### 可执行闭环
1. 先询问用户要从什么资料/文档/仓库/文件构建 Skill，并要求用户粘贴关键内容或上传可读取资料。
2. 如果用户上传了可读附件，先调用 local_extract_attachment；如果用户上传的是需要转换的文档资料，先调用 document_to_markdown。
3. 如果用户提供了文本或 Markdown 内容，或你已经读取/转换出 Markdown，调用 build_skill_from_text 生成 Skill 草稿、draft_id 和 references/source.md。
4. 如果用户只提供 PDF、文档 URL、GitHub 仓库或本地代码目录，说明当前高级构建能力不可用，请用户先提供文本/Markdown 或可读取附件；不要编造抓取或编译过程。
5. 向用户展示完整 SKILL.md（必须包含 YAML frontmatter 和正文），询问是否修改。
6. 设计测试用例，说明每个用例的 prompt 和期望表现，等待用户确认。
7. 用户确认后调用 run_skill_tests，至少提供 3 个测试用例，并沿用 draft_id。
8. 展示测试结果并询问是否需要修改。
9. 只有用户明确说"满意"、"可以了"、"ok"、"保存吧" 等确认词之后，才能调用 save_skill，并优先传入 draft_id，不要复制大段 references JSON。
10. 保存后告诉用户："Skill已保存，在「我的Skill」中可用。"
`

const SKILL_BUILDER_RUNTIME_APPENDIX_WITH_ADVANCED_RUNTIME = `

---
## 产品运行时限制（韭菜盒子 Studio）

当前应用内不会暴露 Skill Seekers MCP 的 scrape_docs、scrape_github、scrape_pdf、enhance_skill、package_skill 等底层工具。你不能声称调用过这些外部工具。

你可以使用 6 个内置创建工具：build_skill_from_text、local_extract_attachment、document_to_markdown、compile_skill_materials、run_skill_tests 和 save_skill。

### 可执行闭环
1. 先询问用户要从什么资料/文档/仓库/文件构建 Skill，并要求用户粘贴关键内容或上传可读取资料。
2. 如果用户上传了可读附件，先调用 local_extract_attachment；如果用户上传的是需要转换的文档资料，先调用 document_to_markdown。
3. 如果用户提供了文本或 Markdown 内容，或你已经读取/转换出 Markdown，调用 build_skill_from_text 生成 Skill 草稿、draft_id 和 references/source.md。
4. 如果用户提供的是 PDF、文档 URL、GitHub 仓库或本地代码目录，调用 compile_skill_materials。它只生成后台编译任务和 draft_id；如果 runtime 不可用，按工具返回的错误说明告诉用户当前只能使用文本/Markdown路径，不要编造执行过程。
5. 向用户展示完整 SKILL.md（必须包含 YAML frontmatter 和正文），询问是否修改。
6. 设计测试用例，说明每个用例的 prompt 和期望表现，等待用户确认。
7. 用户确认后调用 run_skill_tests，至少提供 3 个测试用例，并沿用 draft_id。
8. 展示测试结果并询问是否需要修改。
9. 只有用户明确说"满意"、"可以了"、"ok"、"保存吧" 等确认词之后，才能调用 save_skill，并优先传入 draft_id，不要复制大段 references JSON。
10. 保存后告诉用户："Skill已保存，在「我的Skill」中可用。"
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
