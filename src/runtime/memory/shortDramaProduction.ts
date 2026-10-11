export const SHORT_DRAMA_SKILL = 'jc-duanju'
export const SHORT_DRAMA_SKILLS: readonly string[] = [SHORT_DRAMA_SKILL, 'wiki-memory']

export interface ShortDramaPreference {
  enabled: boolean
  wikiMemoryWasSelected?: boolean
}

export function restoreShortDramaSelection(names: string[], preference?: ShortDramaPreference): string[] {
  const unique = [...new Set(names)]
  if (preference?.enabled === false) {
    const withoutShortDrama = unique.filter(name => name !== SHORT_DRAMA_SKILL)
    return preference.wikiMemoryWasSelected === false
      ? withoutShortDrama.filter(name => name !== 'wiki-memory')
      : withoutShortDrama
  }

  if (!preference?.enabled && !unique.includes(SHORT_DRAMA_SKILL)) return unique

  return [SHORT_DRAMA_SKILL, 'wiki-memory']
}
