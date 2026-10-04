import route from '../../../public/skills/manju-route.json'

export const MANJU_ROUTER = route.router
export const MANJU_SKILLS: readonly string[] = route.skills
export interface ManjuPreference { enabled: boolean }

export function restoreManjuSelection(names: string[], preference?: ManjuPreference): string[] {
  const migrated = [...new Set(names.map(name => name === 'jc-manju-minimaxh3' ? MANJU_ROUTER : name === 'jc-daoyan-fenjing' ? 'jc-seedance' : name))]
  if (preference?.enabled) return [MANJU_ROUTER, ...migrated.filter(name => name !== MANJU_ROUTER && MANJU_SKILLS.includes(name))]
  if (preference?.enabled === false) return migrated.filter(name => name !== MANJU_ROUTER)
  return migrated.includes(MANJU_ROUTER) ? migrated.filter(name => MANJU_SKILLS.includes(name)) : migrated
}

export function manjuRoutePrompt(): string {
  return [
    '【漫剧制作设置】',
    '用户明确指定的业务 Skill 优先：直接读取并执行该 Skill，不自动补跑其他制作阶段。',
    '依次按明确指定、已有产物续改、明确交付物、新手求起步处理；其余未指定创作请求默认使用 h3-prompt-writing 生成 MiniMax H3 视频提示词。',
    '续改已有产物沿用原 Skill 与格式；自然语言指定交付物视为指定对应入口。仅明确求起步才引导，不因消息短判断新手；只推荐当前一步，带我做且材料足够才执行第一步。',
    '用户明确说用 H3 即使用 h3-prompt-writing；说用 Seedance 2.5／SD2.5 即使用 jc-seedance。只处理指定范围，不混合两套格式。',
    '仅从漫剧路线清单中选择；缺少必要输入或指令冲突时才询问。默认只交付提示词，不自动生成媒体。',
  ].join('\n')
}
