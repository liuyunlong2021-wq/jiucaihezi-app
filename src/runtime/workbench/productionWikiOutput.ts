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
  if (kind === 'character') return `wiki/角色/${output}/制作-角色提示词.md`
  if (kind === 'scene') return `wiki/场景/${output}/制作-场景提示词.md`
  if (kind === 'prop') return `wiki/道具/${output}/制作-道具提示词.md`
  if (kind === 'storyboard') return `wiki/分镜/${output}/制作-分镜提示词.md`
  return `wiki/分镜/视频/${output}/制作-视频提示词.md`
}
