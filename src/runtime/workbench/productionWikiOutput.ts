export type ProductionOutputKind = 'style' | 'character' | 'scene' | 'prop' | 'storyboard' | 'video'

function name(value: string | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized === '.' || normalized === '..') {
    throw new Error('名称无效')
  }
  return normalized
}

export function productionWikiOutputPath(kind: ProductionOutputKind, outputName?: string): string {
  if (kind === 'style') return 'wiki/世界观/style-design.md'
  const output = name(outputName)
  if (kind === 'character') return `wiki/角色/${output}.md`
  if (kind === 'scene') return `wiki/场景/${output}.md`
  if (kind === 'prop') return `wiki/道具/${output}.md`
  if (kind === 'storyboard') return `wiki/分镜/${output}.md`
  return `wiki/分镜/视频/${output}.json`
}

export function productionWikiDesignPath(kind: ProductionOutputKind, outputName?: string): string | undefined {
  const output = kind === 'style' ? '' : name(outputName)
  if (kind === 'character') return `wiki/角色/${output}.design.json`
  if (kind === 'scene') return `wiki/场景/${output}.design.json`
  if (kind === 'prop') return `wiki/道具/${output}.design.json`
  return undefined
}
