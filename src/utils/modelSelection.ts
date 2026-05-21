export interface SelectableModel {
  id: string
  capability?: 'text' | 'image' | 'video' | 'audio'
}

export const DEFAULT_TEXT_MODEL = 'claude-sonnet-4-6'

export function resolveModelSelection(
  currentModelId: string,
  models: SelectableModel[],
  fallback = DEFAULT_TEXT_MODEL,
): string {
  const current = String(currentModelId || '').trim()
  if (current && models.some(model => model.id === current)) return current

  const firstText = models.find(model => (model.capability || 'text') === 'text')
  return firstText?.id || fallback
}
