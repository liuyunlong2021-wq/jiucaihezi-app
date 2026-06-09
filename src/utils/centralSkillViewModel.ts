import type { SkillWithLinks } from '@/types/skillsManage'

export type CentralSkillSortField = 'name' | 'createdAt' | 'updatedAt'
export type CentralSkillSortDirection = 'asc' | 'desc'

export interface CentralSkillFolderGroup {
  name: string
  relativePath: string
  skillIds: string[]
  linkedAgentIds: string[]
  readOnlyAgentIds: string[]
  skills: SkillWithLinks[]
}

export interface CentralSkillFolderSplit {
  rootSkills: SkillWithLinks[]
  groups: CentralSkillFolderGroup[]
}

function normalizePath(path: string | null | undefined): string {
  return (path || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function relativeSkillDir(skill: SkillWithLinks, rootPath: string): string {
  const root = normalizePath(rootPath)
  const dir = normalizePath(skill.canonical_path || dirname(skill.file_path))
  if (!root || !dir.startsWith(`${root}/`)) return ''
  return dir.slice(root.length + 1)
}

export function splitCentralSkillsByTopLevel(input: {
  skills: SkillWithLinks[]
  rootPath: string
}): CentralSkillFolderSplit {
  const rootSkills: SkillWithLinks[] = []
  const groupsByName = new Map<string, CentralSkillFolderGroup>()

  for (const skill of input.skills) {
    const relativeDir = relativeSkillDir(skill, input.rootPath)
    const [topLevel] = relativeDir.split('/').filter(Boolean)
    if (!topLevel || topLevel === skill.id || topLevel === skill.name) {
      rootSkills.push(skill)
      continue
    }

    const group = groupsByName.get(topLevel) || {
      name: topLevel,
      relativePath: topLevel,
      skillIds: [],
      linkedAgentIds: [],
      readOnlyAgentIds: [],
      skills: [],
    }
    group.skillIds.push(skill.id)
    group.skills.push(skill)
    group.linkedAgentIds = Array.from(new Set([...group.linkedAgentIds, ...skill.linked_agents]))
    group.readOnlyAgentIds = Array.from(new Set([...group.readOnlyAgentIds, ...(skill.read_only_agents || [])]))
    groupsByName.set(topLevel, group)
  }

  return {
    rootSkills,
    groups: Array.from(groupsByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    ),
  }
}

function timestampForSort(skill: SkillWithLinks, field: CentralSkillSortField): number {
  const value = field === 'createdAt'
    ? skill.created_at || skill.scanned_at
    : skill.updated_at || skill.scanned_at
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function sortCentralSkills(
  skills: SkillWithLinks[],
  field: CentralSkillSortField,
  direction: CentralSkillSortDirection
): SkillWithLinks[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...skills].sort((a, b) => {
    const nameComparison = a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
    if (field === 'name') return nameComparison * multiplier

    const timeComparison = timestampForSort(a, field) - timestampForSort(b, field)
    return timeComparison === 0 ? nameComparison : timeComparison * multiplier
  })
}
