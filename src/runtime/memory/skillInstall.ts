import { parseSkillMd } from '@/types/skill'

export interface SkillInstallPlan {
  id: string
  name: string
  description: string
  triggers: string[]
  skillMd: string
}

const INSTALL_BLOCK = /```jc-skill-install\s*\n([\s\S]*?)\n```/
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseSkillInstallPlan(content: string): SkillInstallPlan {
  const skillMd = String(content || '').match(INSTALL_BLOCK)?.[1]?.trim() || ''
  if (!skillMd) throw new Error('回复中没有可安装的 Skill')
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

export function stripSkillInstallBlock(content: string): string {
  return String(content || '').replace(INSTALL_BLOCK, '').trim()
}
