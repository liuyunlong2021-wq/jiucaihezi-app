import type { AgentWithStatus, DiscoveredProject, DiscoveredSkill } from '@/types/skillsManage'

export interface DiscoverSkillWithProject {
  project: DiscoveredProject
  skill: DiscoveredSkill
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

export function countDiscoveredSkills(projects: DiscoveredProject[]): number {
  return projects.reduce((sum, project) => sum + project.skills.length, 0)
}

export function flattenDiscoveredSkills(projects: DiscoveredProject[]): DiscoverSkillWithProject[] {
  return projects.flatMap((project) =>
    project.skills.map((skill) => ({ project, skill }))
  )
}

export function filterDiscoveredProjects(
  projects: DiscoveredProject[],
  input: { projectQuery: string; skillQuery: string },
): DiscoveredProject[] {
  return projects
    .filter((project) =>
      matchesQuery([project.project_name, project.project_path], input.projectQuery)
    )
    .map((project) => ({
      ...project,
      skills: project.skills.filter((skill) =>
        matchesQuery([
          skill.id,
          skill.name,
          skill.description,
          skill.file_path,
          skill.dir_path,
          skill.platform_id,
          skill.platform_name,
        ], input.skillQuery)
      ),
    }))
    .filter((project) => project.skills.length > 0)
}

export function toggleDiscoveredSkillSelection(selected: Set<string>, skillId: string): Set<string> {
  const next = new Set(selected)
  if (next.has(skillId)) {
    next.delete(skillId)
  } else {
    next.add(skillId)
  }
  return next
}

export function isSkillSelected(selected: Set<string>, skillId: string): boolean {
  return selected.has(skillId)
}

export function getDiscoverImportTargets(
  agents: AgentWithStatus[],
  sourcePlatformId: string | null | undefined,
): AgentWithStatus[] {
  return agents.filter((agent) =>
    agent.id !== sourcePlatformId &&
    agent.is_install_target
  )
}
