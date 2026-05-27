export interface SelectableModel {
  id: string
  capability?: 'text' | 'image' | 'video' | 'audio'
}

export const DEFAULT_TEXT_MODEL = 'claude-sonnet-4-6'

export function isRemovedModelId(modelId: string): boolean {
  const id = String(modelId || '').trim().toLowerCase()
  if (!id) return false
  if (id === 'nano-banana' || id === 'nano-banana-hd') return true
  if (id === 'grok-4.2-image' || id === 'grok-4.1-image') return true
  if (id.includes('seedance')) return true
  return false
}

export function filterExecutableModels<T extends SelectableModel>(models: T[]): T[] {
  return (Array.isArray(models) ? models : []).filter(model => !isRemovedModelId(model.id))
}

export function resolveModelSelection(
  currentModelId: string,
  models: SelectableModel[],
  fallback = DEFAULT_TEXT_MODEL,
): string {
  const current = String(currentModelId || '').trim()
  const executableModels = filterExecutableModels(models)
  if (current && !isRemovedModelId(current) && executableModels.some(model => model.id === current)) return current

  const firstText = executableModels.find(model => (model.capability || 'text') === 'text')
  return firstText?.id || fallback
}

export function resolveTextModelSelection(
  currentModelId: string,
  models: SelectableModel[],
  fallback = DEFAULT_TEXT_MODEL,
): string {
  const current = String(currentModelId || '').trim()
  const executableModels = filterExecutableModels(models)
  const currentEntry = current && !isRemovedModelId(current) ? executableModels.find(model => model.id === current) : null
  if (currentEntry && (currentEntry.capability || 'text') === 'text') return current

  const firstText = executableModels.find(model => (model.capability || 'text') === 'text')
  return firstText?.id || fallback
}
