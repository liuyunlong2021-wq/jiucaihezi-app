import type { SkillConfig } from '@/types/skill'

export type AgentTier = 'L1' | 'L2'

export interface SkillRuntimeSpec {
  id: string
  name: string
  tier: AgentTier
  version: number
  source: SkillConfig['source']
  contentHash: string
  fullSkillMd: string
  summary: string
  triggers: string[]
}

export function resolveAgentTier(skill: SkillConfig | null | undefined): AgentTier {
  return skill?.tier === 'L2' ? 'L2' : 'L1'
}

export function isSkillContentResolved(skill: SkillConfig | null | undefined): boolean {
  const content = String(skill?.skillContent || '').trim()
  if (!content || content.startsWith('skill://')) return false
  const isGeneratedFallback = (
    skill?.source === 'preset' || skill?.source === 'superpower'
  ) && content.endsWith('请根据以上角色定义完成用户的请求。')
  return !isGeneratedFallback
}

export function createSkillRuntimeSpec(skill: SkillConfig): SkillRuntimeSpec {
  const fullSkillMd = String(skill.skillContent || '')
  return {
    id: skill.id,
    name: skill.name,
    tier: resolveAgentTier(skill),
    version: skill.version || 1,
    source: skill.source,
    contentHash: hashText16(fullSkillMd),
    fullSkillMd,
    summary: skill.oneLineDesc || skill.description || '',
    triggers: [...(skill.triggers || [])],
  }
}

export function canAutoRouteAgent(input: {
  currentAgent: SkillConfig | null | undefined
  smartSwitchEnabled: boolean
}): boolean {
  return input.smartSwitchEnabled
}

export function buildExplicitAgentLockNotice(
  currentAgent: SkillConfig | null | undefined,
  suggestedName: string,
): string {
  const current = currentAgent?.name || '当前Skill'
  return `已锁定当前Skill「${current}」。如果想切换到「${suggestedName}」，请手动选择或开启智能切换。`
}

function hashText16(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= code + i
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}
