export type ComposerSuggestion = {
  trigger: '@' | '/'
  start: number
  end: number
  query: string
}

/** Finds an @ reference or slash command token around the current caret. */
export function findComposerSuggestion(text: string, cursor: number): ComposerSuggestion | null {
  const caret = Math.max(0, Math.min(text.length, cursor))
  const prefix = text.slice(0, caret)
  const match = /(?:^|\s)([@/])([^\s]*)$/.exec(prefix)
  if (!match) return null
  const start = caret - match[2].length - 1
  const trigger = match[1] as '@' | '/'
  let end = caret
  while (end < text.length && !/\s/.test(text[end]!)) end += 1
  return { trigger, start, end, query: match[2] }
}

/** Replaces the complete token around the caret and reports the restored caret offset. */
export function replaceComposerSuggestion(
  text: string,
  suggestion: ComposerSuggestion,
  replacement: string,
) {
  const before = text.slice(0, suggestion.start)
  const after = text.slice(suggestion.end)
  return { text: before + replacement + after, cursor: before.length + replacement.length }
}
