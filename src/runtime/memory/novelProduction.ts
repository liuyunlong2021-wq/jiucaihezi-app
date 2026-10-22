import { nativeWikiSelection, PROJECT_WIKI } from './projectWiki'
export const NOVEL_MODE = 'production:novel'
export const NOVEL_SKILLS: readonly string[] = [NOVEL_MODE, 'jc-novel']

export interface NovelPreference {
  enabled: boolean
  /** Whether wiki-memory was already selected before novel mode added its dependency. */
  wikiMemoryWasSelected?: boolean
}

export function restoreNovelSelection(names: string[], preference?: NovelPreference): string[] {
  const unique = nativeWikiSelection(names).map(name => name === 'jc-novel' ? NOVEL_MODE : name)
  if (preference?.enabled === false) {
    const withoutNovel = unique.filter(name => name !== NOVEL_MODE)
    return preference.wikiMemoryWasSelected === false
      ? withoutNovel.filter(name => name !== PROJECT_WIKI)
      : withoutNovel
  }

  if (!preference?.enabled && !unique.includes(NOVEL_MODE)) return unique

  return [NOVEL_MODE, ...unique.filter(name => name === PROJECT_WIKI)]
}
