/**
 * useOrderedMaterials — Vue 版，对齐 T8 nodes/useOrderedMaterials.ts
 * 按 materialOrder 对素材列表排序
 */
import { type Material } from './useUpstreamMaterials'

export function useOrderedMaterials(materials: Material[], order: string[]): Material[] {
  if (!order || order.length === 0) return materials

  const map = new Map(materials.map(m => [m.id, m]))
  const ordered: Material[] = []
  const seen = new Set<string>()

  for (const id of order) {
    const m = map.get(id)
    if (m && !seen.has(m.url)) {
      ordered.push(m)
      seen.add(m.url)
    }
  }
  // 追加未在 order 中的素材
  for (const m of materials) {
    if (!seen.has(m.url)) {
      ordered.push(m)
      seen.add(m.url)
    }
  }
  return ordered
}
