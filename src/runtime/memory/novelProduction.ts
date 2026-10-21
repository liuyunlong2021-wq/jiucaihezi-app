import { nativeWikiSelection, PROJECT_WIKI } from './projectWiki'
export const NOVEL_SKILL = 'jc-novel'
export const NOVEL_SKILLS: readonly string[] = [NOVEL_SKILL]

export interface NovelPreference {
  enabled: boolean
  /** Whether wiki-memory was already selected before novel mode added its dependency. */
  wikiMemoryWasSelected?: boolean
}

export function restoreNovelSelection(names: string[], preference?: NovelPreference): string[] {
  const unique = nativeWikiSelection(names)
  if (preference?.enabled === false) {
    const withoutNovel = unique.filter(name => name !== NOVEL_SKILL)
    return preference.wikiMemoryWasSelected === false
      ? withoutNovel.filter(name => name !== PROJECT_WIKI)
      : withoutNovel
  }

  if (!preference?.enabled && !unique.includes(NOVEL_SKILL)) return unique

  return [NOVEL_SKILL, ...unique.filter(name => name === PROJECT_WIKI)]
}
