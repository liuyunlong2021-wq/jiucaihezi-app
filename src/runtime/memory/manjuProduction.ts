import route from '../../../public/skills/manju-route.json'

export const MANJU_ROUTER = route.router
export const MANJU_SKILLS: readonly string[] = route.skills
export type ManjuVideoModel = 'ask' | 'minimax-h3' | 'seedance-2.5'
export interface ManjuPreference { enabled: boolean; videoModel: ManjuVideoModel }

export function normalizeManjuVideoModel(value: unknown): ManjuVideoModel {
  return value === 'minimax-h3' || value === 'seedance-2.5' ? value : 'ask'
}

export function restoreManjuSelection(names: string[], preference?: ManjuPreference): string[] {
  const migrated = [...new Set(names.map(name => name === 'jc-manju-minimaxh3' ? MANJU_ROUTER : name === 'jc-daoyan-fenjing' ? 'jc-seedance' : name))]
  if (preference?.enabled) return [MANJU_ROUTER, ...migrated.filter(name => name !== MANJU_ROUTER && MANJU_SKILLS.includes(name))]
  if (preference?.enabled === false) return migrated.filter(name => name !== MANJU_ROUTER)
  return migrated.includes(MANJU_ROUTER) ? migrated.filter(name => MANJU_SKILLS.includes(name)) : migrated
}

export function manjuRoutePrompt(videoModel: ManjuVideoModel): string {
  const model = videoModel === 'minimax-h3' ? 'MiniMax H3' : videoModel === 'seedance-2.5' ? 'Seedance 2.5' : '未指定'
  return [
    '【漫剧制作设置】',
    `默认视频模型：${model}。此值只作为本次未点名片段的后备选择。`,
    '本轮用户明确指定的模型和镜头范围优先；不同镜头可使用不同模型，同一请求可以分别输出两套提示词。',
    'MiniMax H3 使用 h3-prompt-writing；Seedance 2.5／SD2.5 使用 jc-seedance。没有模型选择时，仅在当前需要视频提示词且无法判断时询问。',
    'Seedance 时间戳可有可无，按用户习惯选择；H3 遵循自身格式。切换模型只转换指定镜头或片段，复用已有资料、风格、资产和工程台本。',
  ].join('\n')
}
