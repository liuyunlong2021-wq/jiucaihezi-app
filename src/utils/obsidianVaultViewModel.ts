import type { DiscoveredSkill, ObsidianVault } from '@/types/skillsManage'

export interface ObsidianSkillGroup {
  label: string
  skills: DiscoveredSkill[]
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

export function filterObsidianVaults(vaults: ObsidianVault[], query: string): ObsidianVault[] {
  return vaults.filter((vault) =>
    matchesQuery([vault.id, vault.name, vault.path], query)
  )
}

export function filterObsidianVaultSkills(skills: DiscoveredSkill[], query: string): DiscoveredSkill[] {
  return skills.filter((skill) =>
    matchesQuery([
      skill.id,
      skill.name,
      skill.description,
      skill.file_path,
      skill.dir_path,
      skill.project_name,
      skill.project_path,
    ], query)
  )
}

export function getObsidianReadonlyNotice(): string {
  return 'Obsidian Vault Skill 是只读来源，不创建可卸载安装记录。'
}

export function groupObsidianSkillsByPlatformPath(skills: DiscoveredSkill[]): ObsidianSkillGroup[] {
  const groups = new Map<string, DiscoveredSkill[]>()
  for (const skill of skills) {
    const label = skill.dir_path.includes('/.claude/skills/')
      ? '.claude/skills'
      : skill.dir_path.includes('/.agents/skills/')
        ? '.agents/skills'
        : skill.dir_path.includes('/.skills/')
          ? '.skills'
          : '其他路径'
    groups.set(label, [...(groups.get(label) || []), skill])
  }
  return [...groups.entries()]
    .map(([label, groupedSkills]) => ({ label, skills: groupedSkills }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}
