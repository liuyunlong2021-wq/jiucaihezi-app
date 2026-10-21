import { nativeWikiSelection, PROJECT_WIKI } from './projectWiki'
import route from '../../../public/skills/manju-route.json'

export const MANJU_ROUTER = route.router
export const MANJU_SKILLS: readonly string[] = route.skills
export const WIKI_MEMORY_SKILL = PROJECT_WIKI
export interface ManjuPreference { enabled: boolean; wikiMemoryWasSelected?: boolean }

export function restoreManjuSelection(names: string[], preference?: ManjuPreference): string[] {
  const migrated = [...new Set(nativeWikiSelection(names).map(name => name === 'jc-manju-minimaxh3' ? MANJU_ROUTER : name === 'jc-daoyan-fenjing' ? 'jc-seedance' : name))]
  if (preference?.enabled) {
    return [MANJU_ROUTER, ...migrated.filter(name => name !== MANJU_ROUTER && MANJU_SKILLS.includes(name)), ...migrated.filter(name => name === WIKI_MEMORY_SKILL)]
  }
  if (preference?.enabled === false) {
    const outsideRoute = migrated.filter(name => name !== MANJU_ROUTER && !MANJU_SKILLS.includes(name))
    return preference.wikiMemoryWasSelected === false
      ? outsideRoute.filter(name => name !== WIKI_MEMORY_SKILL)
      : outsideRoute
  }
  if (!migrated.includes(MANJU_ROUTER)) return migrated
  return migrated.filter(name => name === MANJU_ROUTER || MANJU_SKILLS.includes(name) || name === WIKI_MEMORY_SKILL)
}
