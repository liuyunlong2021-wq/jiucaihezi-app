import type { AgentWithStatus, SkillForAgent } from '@/types/skillsManage'

export type PlatformSkillSourceFilter = 'all' | 'user' | 'plugin'

export interface PlatformSkillFolderGroup {
  name: string
  relativePath: string
  skills: SkillForAgent[]
}

export interface PlatformSkillFolderSplit {
  rootSkills: SkillForAgent[]
  groups: PlatformSkillFolderGroup[]
}

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

export function filterPlatformAgents(agents: AgentWithStatus[], query: string): AgentWithStatus[] {
  return agents.filter((agent) =>
    matchesQuery([
      agent.id,
      agent.display_name,
      agent.category,
      agent.global_skills_dir,
      agent.project_skills_dir,
    ], query)
  )
}

function matchesSourceFilter(skill: SkillForAgent, source: PlatformSkillSourceFilter): boolean {
  if (source === 'all') return true
  if (source === 'plugin') return skill.source_kind === 'plugin'
  return !skill.source_kind || skill.source_kind === 'user'
}

export function filterPlatformSkills(
  skills: SkillForAgent[],
  input: { query: string; source: PlatformSkillSourceFilter }
): SkillForAgent[] {
  return skills.filter((skill) =>
    matchesSourceFilter(skill, input.source) &&
    matchesQuery([
      skill.id,
      skill.name,
      skill.description,
      skill.dir_path,
      skill.file_path,
      skill.link_type,
      skill.source_kind,
      skill.source_root,
    ], input.query)
  )
}

export function splitPlatformSkillsByFolder(input: {
  skills: SkillForAgent[]
  rootPath: string
}): PlatformSkillFolderSplit {
  const root = normalizePath(input.rootPath)
  const rootSkills: SkillForAgent[] = []
  const groupsByName = new Map<string, PlatformSkillFolderGroup>()

  for (const skill of input.skills) {
    const dir = normalizePath(skill.dir_path)
    const relativeDir = root && dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : ''
    const segments = relativeDir.split('/').filter(Boolean)
    const [topLevel] = segments

    if (!topLevel || segments.length <= 1 || topLevel === skill.id || topLevel === skill.name) {
      rootSkills.push(skill)
      continue
    }

    const group = groupsByName.get(topLevel) || {
      name: topLevel,
      relativePath: topLevel,
      skills: [],
    }
    group.skills.push(skill)
    groupsByName.set(topLevel, group)
  }

  return {
    rootSkills,
    groups: Array.from(groupsByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    ),
  }
}

export function canUninstallPlatformSkill(
  skill: SkillForAgent,
  agent: AgentWithStatus | null,
  centralRoot: string
): boolean {
  if (!agent || skill.is_read_only) return false
  return !agent.uses_central_root && normalizePath(agent.global_skills_dir) !== normalizePath(centralRoot)
}
