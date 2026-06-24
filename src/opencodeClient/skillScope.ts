import type { PermissionRuleset } from '@opencode-ai/sdk/v2'

export interface SkillScopeInput {
  skillName?: string | null
}

export const CLAUDE_OBSIDIAN_SKILL_NAMES = [
  'Obsidian',
  'wiki',
  'wiki-ingest',
  'wiki-query',
  'wiki-lint',
  'wiki-mode',
  'wiki-cli',
  'wiki-retrieve',
  'wiki-fold',
  'save',
  'autoresearch',
  ,
  'defuddle',
  'obsidian-markdown',
  'obsidian-bases',
  'think',
] as const

export function buildSkillPermissionScope(input: SkillScopeInput): PermissionRuleset | undefined {
  const skillName = String(input.skillName || '').trim()
  if (!skillName) return undefined
  if (isObsidianSkillBundleName(skillName)) {
    return [
      { permission: 'skill', pattern: '*', action: 'deny' },
      ...CLAUDE_OBSIDIAN_SKILL_NAMES.map(pattern => ({
        permission: 'skill' as const,
        pattern,
        action: 'allow' as const,
      })),
    ]
  }
  // OpenCode Permission.evaluate uses findLast; deny-all must stay before the narrow allow.
  return [
    { permission: 'skill', pattern: '*', action: 'deny' },
    { permission: 'skill', pattern: skillName, action: 'allow' },
  ]
}

export function buildFixedSkillSystemInstruction(skillName?: string | null): string {
  const name = String(skillName || '').trim()
  if (!name) return ''
  if (isObsidianSkillBundleName(name)) {
    return [
      '固定 Skill 已选择：Obsidian',
      '本轮开始时必须先调用 OpenCode 官方 skill 工具加载 Obsidian 入口：{"name":"Obsidian"}；如果该入口不可用，加载 claude-obsidian 的 wiki skill：{"name":"wiki"}。',
      '这是 claude-obsidian 套装的用户级入口。你可以按任务需要继续调用 wiki、wiki-ingest、wiki-query、wiki-lint、wiki-mode、wiki-cli、wiki-retrieve、wiki-fold、save、autoresearch、canvas、defuddle、obsidian-markdown、obsidian-bases、think 等子 Skill。',
      '对用户只说 Obsidian。把当前项目目录当作 vault 根目录，不要要求用户理解 MCP、Local REST API、hooks 或插件市场细节。',
    ].join('\n')
  }
  return [
    `固定 Skill 已选择：${name}`,
    `本轮开始时必须先调用 OpenCode 官方 skill 工具加载这个 Skill：{"name":"${name}"}`,
    '加载成功后，严格按照该 Skill 的 SKILL.md 工作流和输出要求回答。',
    '不要改用其他 Skill；如果加载失败，明确说明加载失败原因。',
  ].join('\n')
}

function isObsidianSkillBundleName(skillName: string) {
  const normalized = skillName.trim().toLowerCase()
  return normalized === 'obsidian' || normalized === 'claude-obsidian'
}
