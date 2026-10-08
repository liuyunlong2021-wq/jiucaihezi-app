export const NOVEL_SKILL = 'jc-novel'
export const NOVEL_SKILLS: readonly string[] = [NOVEL_SKILL, 'wiki-memory']

export interface NovelPreference {
  enabled: boolean
  /** Whether wiki-memory was already selected before novel mode added its dependency. */
  wikiMemoryWasSelected?: boolean
}

export function restoreNovelSelection(names: string[], preference?: NovelPreference): string[] {
  const unique = [...new Set(names)]
  if (preference?.enabled === false) {
    const withoutNovel = unique.filter(name => name !== NOVEL_SKILL)
    return preference.wikiMemoryWasSelected === false
      ? withoutNovel.filter(name => name !== 'wiki-memory')
      : withoutNovel
  }

  if (!preference?.enabled && !unique.includes(NOVEL_SKILL)) return unique

  return [NOVEL_SKILL, 'wiki-memory']
}
