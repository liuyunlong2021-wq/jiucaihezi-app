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
  return /^skill:\/\/[^\s]+$/i.test(String(value || '').trim())
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
## 韭菜盒子运行时差异（只列宿主差异；流程以本 Skill 正文为准）

当前运行环境是韭菜盒子，不是 Claude/Codex。不得调用 claude-with-access-to-the-skill 或 subagent；读写项目外绝对路径时，是否放行由系统运行时判定（用户消息里给过该路径才可用，本会话内持续有效）；Skill 不得假设或代为决定权限。
Skill 包内的 references、scripts、agents、eval-viewer 和 assets 必须使用当前 Skill 的相对路径读取；产品会将其安全映射到已加载包根目录。
官方 Python 脚本通过韭菜盒子已接入的受限脚本执行能力运行；Web/Mobile 不伪造本地脚本执行结果。

**文件能力**：Skill 层不限制文件权限。用户已给出某个目录或文件的绝对路径时，直接用 read、write、edit 读写它（含 references、scripts、assets），不要绕道其他写法；没有路径时用 skill_creator_load_installed_skill 按精确 ID 读「我的 Skill」里的 SKILL.md，并请用户把 Skill 文件夹的绝对路径发过来。不得自造路径，也不得用 Terminal 兜底搜索。

**草稿位置**：草稿写在项目文件树里 —— \`.raw/jc-media/文档/skill-<skill-name>/\`，用文件工具写（write_text_batch 一次写多份，或 create_document 写单份）。所有生命周期工具都传同一个 draft_path，不再有别的草稿标识。改内容就用文件工具改那个目录，改完重新调用 skill_creator_validate。

可用工具：skill_creator_load_installed_skill、skill_creator_validate、run_skill_tests、skill_creator_submit_eval_feedback、skill_creator_load_eval_feedback、skill_creator_open_eval_review、skill_creator_compare_outputs、skill_creator_analyze_comparison、skill_creator_aggregate_benchmark、skill_creator_improve_description、skill_creator_package、save_skill。
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
9. 草稿展示给用户之后，就可以调用 save_skill，并优先传入 draft_id，不要复制大段 references JSON。出卡不等于保存：用户点击安装卡后才真正保存，所以不要先追问确认，也不要要求用户复述特定字串。
10. 出卡后不要声称已经保存；只有用户点击安装卡并拿到成功回执后，才能说"Skill已保存，在「我的Skill」中可用。"
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
9. 草稿展示给用户之后，就可以调用 save_skill，并优先传入 draft_id，不要复制大段 references JSON。出卡不等于保存：用户点击安装卡后才真正保存，所以不要先追问确认，也不要要求用户复述特定字串。
10. 出卡后不要声称已经保存；只有用户点击安装卡并拿到成功回执后，才能说"Skill已保存，在「我的Skill」中可用。"
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
