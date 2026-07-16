import type { SkillWithLinks } from '@/types/skillsManage'
import type { WebSkillCatalogEntry } from '@/utils/skillContentResolver'

export type CreativeSkillSource = 'local' | 'builtin'

export interface CreativeSkillCatalogEntry {
  id: string
  name: string
  description: string | null
  source: CreativeSkillSource
  triggers: string[]
  commands: string[]
  files: string[]
}

/** The local source wins a name collision so an installed user Skill remains usable. */
export function mergeCreativeSkillCatalog(
  localSkills: Array<Pick<SkillWithLinks, 'id' | 'name' | 'description'>>,
  builtInSkills: WebSkillCatalogEntry[],
): CreativeSkillCatalogEntry[] {
  const seen = new Set<string>()
  const catalog: CreativeSkillCatalogEntry[] = []

  for (const skill of localSkills) {
    const name = String(skill.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    catalog.push({
      id: skill.id,
      name,
      description: skill.description || null,
      source: 'local',
      triggers: [],
      commands: [],
      files: ['SKILL.md'],
    })
  }

  for (const skill of builtInSkills) {
    const name = String(skill.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    catalog.push({ ...skill, name, source: 'builtin' })
  }

  return catalog
}
