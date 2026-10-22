import { nativeWikiSelection, PROJECT_WIKI } from './projectWiki'
import { PRODUCTION_SKILLS } from './productionSkills'

export const SHORT_DRAMA_MODE = 'production:short-drama'
export const SHORT_DRAMA_SKILLS: readonly string[] = [SHORT_DRAMA_MODE, ...PRODUCTION_SKILLS['short-drama']]

export interface ShortDramaPreference {
  enabled: boolean
  wikiMemoryWasSelected?: boolean
}

export function restoreShortDramaSelection(names: string[], preference?: ShortDramaPreference): string[] {
  const unique = nativeWikiSelection(names).map(name => name === 'jc-duanju' ? SHORT_DRAMA_MODE : name)
  if (preference?.enabled === false) {
    const withoutShortDrama = unique.filter(name => !SHORT_DRAMA_SKILLS.includes(name))
    return preference.wikiMemoryWasSelected === false
      ? withoutShortDrama.filter(name => name !== PROJECT_WIKI)
      : withoutShortDrama
  }

  if (!preference?.enabled && !unique.includes(SHORT_DRAMA_MODE)) return unique

  return [SHORT_DRAMA_MODE, ...unique.filter(name => name !== SHORT_DRAMA_MODE && SHORT_DRAMA_SKILLS.includes(name)), ...unique.filter(name => name === PROJECT_WIKI)]
}
