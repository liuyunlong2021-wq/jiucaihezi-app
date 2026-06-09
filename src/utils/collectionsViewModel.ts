import type { AgentWithStatus, Skill, SkillWithLinks } from '@/types/skillsManage'

function normalizePath(path: string | null | undefined): string {
  return (path || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

export function filterCollectionSkills(skills: Skill[], query: string): Skill[] {
  return skills.filter((skill) =>
    matchesQuery([
      skill.id,
      skill.name,
      skill.description,
      skill.file_path,
      skill.canonical_path,
      skill.source,
    ], query)
  )
}

export function filterSkillPickerCandidates(
  skills: SkillWithLinks[],
  existingSkillIds: string[],
  query: string,
): SkillWithLinks[] {
  const existing = new Set(existingSkillIds)
  return skills.filter((skill) =>
    !existing.has(skill.id) &&
    matchesQuery([
      skill.id,
      skill.name,
      skill.description,
      skill.file_path,
      skill.canonical_path,
    ], query)
  )
}

export function getCollectionInstallTargets(
  agents: AgentWithStatus[],
): AgentWithStatus[] {
  return agents.filter((agent) => agent.is_install_target)
}

export function buildCollectionExportFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'collection'}-collection.json`
}
