import { nativeWikiSelection, PROJECT_WIKI } from './projectWiki'
import { PRODUCTION_SKILLS } from './productionSkills'

export const MANJU_MODE = 'production:manju'
export const MANJU_SKILLS: readonly string[] = [MANJU_MODE, ...PRODUCTION_SKILLS.manju]
export const WIKI_MEMORY_SKILL = PROJECT_WIKI
export interface ManjuPreference { enabled: boolean; wikiMemoryWasSelected?: boolean }

export function restoreManjuSelection(names: string[], preference?: ManjuPreference): string[] {
  const migrated = [...new Set(nativeWikiSelection(names).map(name => ['jc-manju-minimaxh3', 'jc-manju-zhizuo'].includes(name) ? MANJU_MODE : name === 'jc-daoyan-fenjing' ? 'jc-seedance' : name))]
  if (preference?.enabled) {
    return [MANJU_MODE, ...migrated.filter(name => name !== MANJU_MODE && MANJU_SKILLS.includes(name)), ...migrated.filter(name => name === WIKI_MEMORY_SKILL)]
  }
  if (preference?.enabled === false) {
    const outsideRoute = migrated.filter(name => name !== MANJU_MODE && !MANJU_SKILLS.includes(name))
    return preference.wikiMemoryWasSelected === false
      ? outsideRoute.filter(name => name !== WIKI_MEMORY_SKILL)
      : outsideRoute
  }
  if (!migrated.includes(MANJU_MODE)) return migrated
  return migrated.filter(name => name === MANJU_MODE || MANJU_SKILLS.includes(name) || name === WIKI_MEMORY_SKILL)
}
