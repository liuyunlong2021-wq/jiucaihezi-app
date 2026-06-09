import type { PermissionRuleset } from '@opencode-ai/sdk/v2'

export interface SkillScopeInput {
  skillName?: string | null
}

export function buildSkillPermissionScope(input: SkillScopeInput): PermissionRuleset | undefined {
  const skillName = String(input.skillName || '').trim()
  if (!skillName) return undefined
  // OpenCode Permission.evaluate uses findLast; deny-all must stay before the narrow allow.
  return [
    { permission: 'skill', pattern: '*', action: 'deny' },
    { permission: 'skill', pattern: skillName, action: 'allow' },
  ]
}

export function buildFixedSkillSystemInstruction(skillName?: string | null): string {
  const name = String(skillName || '').trim()
  if (!name) return ''
  return [
    `固定 Skill 已选择：${name}`,
    `本轮开始时必须先调用 OpenCode 官方 skill 工具加载这个 Skill：{"name":"${name}"}`,
    '加载成功后，严格按照该 Skill 的 SKILL.md 工作流和输出要求回答。',
    '不要改用其他 Skill；如果加载失败，明确说明加载失败原因。',
  ].join('\n')
}
