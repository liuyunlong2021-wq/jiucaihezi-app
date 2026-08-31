export interface ToolSearchResult {
  name: string
  description: string
}

type ToolDefinition = {
  function?: {
    name?: unknown
    description?: unknown
  }
}

function normalizeTools(tools: unknown[]): ToolDefinition[] {
  const seen = new Set<string>()
  return tools.flatMap(tool => {
    if (!tool || typeof tool !== 'object') return []
    const definition = tool as ToolDefinition
    const name = typeof definition.function?.name === 'string' ? definition.function.name : ''
    if (!name || seen.has(name)) return []
    seen.add(name)
    return [definition]
  })
}

export function searchToolDefinitions(
  tools: unknown[],
  query = '',
  limit = 8,
): ToolSearchResult[] {
  const cleanQuery = String(query || '').trim().toLocaleLowerCase()
  const maxResults = Math.max(1, Math.min(50, Math.floor(limit) || 8))
  return normalizeTools(tools)
    .map((tool, index) => {
      const name = String(tool.function?.name)
      const description = String(tool.function?.description || '')
      const haystack = `${name} ${description}`.toLocaleLowerCase()
      const match = !cleanQuery ? 0 : haystack.includes(cleanQuery) ? 1 : -1
      return { tool, index, match }
    })
    .filter(item => item.match >= 0)
    .sort((a, b) => b.match - a.match || a.index - b.index)
    .slice(0, maxResults)
    .map(({ tool }) => ({
      name: String(tool.function?.name),
      description: String(tool.function?.description || ''),
    }))
}

export function describeToolDefinition(tools: unknown[], name: string): unknown | null {
  const cleanName = String(name || '').trim()
  if (!cleanName) return null
  return (
    normalizeTools(tools).find(tool => tool.function?.name === cleanName) || null
  )
}
