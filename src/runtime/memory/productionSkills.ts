import skills from '../../../public/skills/production-skills.json'

export type ProductionMode = 'none' | 'manju' | 'short-drama' | 'novel' | `skills:${string}`
export const PRODUCTION_SELECTIONS = { 'production:manju': 'manju', 'production:short-drama': 'short-drama', 'production:novel': 'novel', 'jc-manju-zhizuo': 'manju', 'jc-manju-minimaxh3': 'manju', 'jc-duanju': 'short-drama', 'jc-novel': 'novel' } as const
export function productionMode(names: readonly string[]): ProductionMode {
  const modes = names.flatMap(name => Object.hasOwn(PRODUCTION_SELECTIONS, name) ? [PRODUCTION_SELECTIONS[name as keyof typeof PRODUCTION_SELECTIONS]] : [])
  if (new Set(modes).size > 1) throw new Error('只能选择一个创作 Skill 范围')
  const selected = [...new Set(names.filter(name => !isProductionSelection(name) && name !== 'wiki-memory' && name !== 'project-wiki'))].sort()
  return selected.length ? `skills:${selected.join(',')}` : modes[0] ?? 'none'
}
export function isProductionSelection(name: string): boolean { return Object.hasOwn(PRODUCTION_SELECTIONS, name) }
export const PRODUCTION_SKILLS = skills
