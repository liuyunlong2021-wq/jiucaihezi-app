import type { SkillConfig } from '@/types/skill'

export interface SuperpowerAdvisorConfig {
  id: 'superpower-advisor'
  name: '帮我配置'
  description: string
}

export const SUPERPOWER_ADVISOR: SuperpowerAdvisorConfig = {
  id: 'superpower-advisor',
  name: '帮我配置',
  description: '在正式执行前，帮助用户推荐 Skill、Knowledge、Tool 和 Model；用户确认后才进入手动工作台执行。',
}

export const SUPERPOWER_SKILLS: SkillConfig[] = []
