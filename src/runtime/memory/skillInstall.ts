import { parseSkillMd } from '@/types/skill'
import { getSkillBuilderDraft } from '@/utils/skillBuilderTools'

export interface SkillInstallTokenV2 {
  schemaVersion: 2
  draftId: string
  sessionId: string
  revision: number
  contentHash: string
  targetSkillId: string
}

export interface SkillInstallPlan {
  id: string
  name: string
  description: string
  triggers: string[]
  skillMd: string
  files: string[]
  token?: SkillInstallTokenV2
}

const INSTALL_BLOCK = /```jc-skill-install\s*\n([\s\S]*?)\n```/
const INSTALL_V2_BLOCK = /```jc-skill-install-v2\s*\n([\s\S]*?)\n```/
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// 评测报告固定在 skill-workspaces 下，文件名固定；只认绝对路径，避免把项目内的同名文件当报告。
// 路径可能含空格（macOS 的 Application Support），所以从分隔符后起、允许中间有空格，尾部锚定到固定文件名。
const EVAL_REVIEW_PATH = /(?:^|[\s(（【「[`'"：:，,。；;])((?:file:\/\/)?(?:\/|[A-Za-z]:\/)[^\n]*?skill-workspaces\/[^/\s]+\/eval-review\.html)/i

/** 从助手回复里认出评测报告文件（`file://` 链接、绝对路径都能认），用于在应用内打开。 */
export function parseEvalReviewPath(content: string): string | null {
  const matched = String(content || '').match(EVAL_REVIEW_PATH)?.[1]
  if (!matched) return null
  // `file:///Users/...` 会多带一层前缀与斜杠，这里折掉；%20 这类转义同时还原。
  const path = matched.replace(/^file:\/\//i, '/').replace(/^(\/){2,}/, '/')
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export async function parseSkillInstallPlan(content: string): Promise<SkillInstallPlan> {
  const tokenText = String(content || '').match(INSTALL_V2_BLOCK)?.[1]?.trim()
  if (tokenText) {
    const token = parseInstallToken(tokenText)
    const draft = await getSkillBuilderDraft(token.draftId, token.sessionId)
    if (!draft) throw new Error('找不到可安装的 Skill 草稿')
    if (draft.revision !== token.revision || draft.contentHash !== token.contentHash) throw new Error('Skill 草稿版本已变化，请重新生成安装卡')
    const plan = parseLegacySkillMd(draft.skillMd)
    if (plan.id !== token.targetSkillId) throw new Error('安装目标与 Skill 名称不一致')
    return { ...plan, files: ['SKILL.md', ...draft.references.map(file => file.path)], token }
  }

  const skillMd = String(content || '').match(INSTALL_BLOCK)?.[1]?.trim() || ''
  if (!skillMd) throw new Error('回复中没有可安装的 Skill')
  return { ...parseLegacySkillMd(skillMd), files: ['SKILL.md'] }
}

function parseLegacySkillMd(skillMd: string): Omit<SkillInstallPlan, 'files' | 'token'> {
  if (skillMd.length > 80_000) throw new Error('SKILL.md 过大，无法安装')

  const parsed = parseSkillMd(skillMd)
  const name = String(parsed.name || '').trim()
  const description = String(parsed.description || '').trim()
  const body = String(parsed.skillContent || '').trim()
  if (!SKILL_NAME.test(name)) throw new Error('Skill 名称必须使用小写字母、数字和连字符')
  if (!description) throw new Error('Skill 缺少 description')
  if (!body) throw new Error('SKILL.md 正文不能为空')

  return {
    id: name,
    name,
    description,
    triggers: parsed.triggers || [],
    skillMd,
  }
}

function parseInstallToken(value: string): SkillInstallTokenV2 {
  let parsed: Partial<SkillInstallTokenV2>
  try { parsed = JSON.parse(value) } catch { throw new Error('Skill 安装令牌格式无效') }
  if (parsed.schemaVersion !== 2 || !parsed.draftId || !parsed.sessionId || !Number.isSafeInteger(parsed.revision) || !parsed.contentHash || !parsed.targetSkillId) {
    throw new Error('Skill 安装令牌不完整')
  }
  return parsed as SkillInstallTokenV2
}

export function stripSkillInstallBlock(content: string): string {
  return String(content || '').replace(INSTALL_V2_BLOCK, '').replace(INSTALL_BLOCK, '').trim()
}
