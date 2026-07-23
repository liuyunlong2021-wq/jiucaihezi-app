import type { WorkbenchAttachment, SingleTurnWorkbenchRequest } from './singleTurnWorkbench'

export type ProductionStep =
  | 'style'
  | 'characters'
  | 'scenes'
  | 'props'
  | 'storyboard-images'
  | 'storyboard-video'

export interface ProductionSource {
  id: string
  name: string
  path: string
  content: string
}

export interface ProductionProfile {
  id: string
  sourceSkillId: string
  heading: string
  content: string
}

export interface ProductionPromptCard {
  name: string
  prompt: string
}

const profiles: Record<ProductionStep, ProductionProfile> = {
  style: {
    id: 'production-style',
    sourceSkillId: 'jc-film-style',
    heading: '风格定调',
    content: '基于当前输入提出可执行的影视制作风格方案。给出媒介、画幅、视觉语言、色彩和光影。不要要求先有项目资料，也不要调用工具或读取未提供内容。',
  },
  characters: {
    id: 'production-characters',
    sourceSkillId: 'jc-character-prompt',
    heading: '角色设计',
    content: '基于当前输入设计角色资产。最终只输出 JSON：{"cards":[{"name":"角色名","prompt":"可直接用于角色设定图的完整提示词"}]}。可返回多个角色，每张卡只保留角色名和一条提示词。不要搜索网络、读取文件或要求已有风格。',
  },
  scenes: {
    id: 'production-scenes',
    sourceSkillId: 'jc-scene-prompt',
    heading: '场景设计',
    content: '基于当前输入设计场景资产。场景必须是没有角色的空镜。最终只输出 JSON：{"cards":[{"name":"场景名","prompt":"可直接用于场景设定图的完整提示词"}]}。可返回多个场景，每张卡只保留名称和一条提示词。不要调用工具或读取未提供内容。',
  },
  props: {
    id: 'production-props',
    sourceSkillId: 'jc-prop-prompt',
    heading: '道具设计',
    content: '基于当前输入设计道具资产。最终只输出 JSON：{"cards":[{"name":"道具名","prompt":"可直接用于道具设定图的完整提示词"}]}。可返回多个道具，每张卡只保留名称和一条提示词。不要调用工具或读取未提供内容。',
  },
  'storyboard-images': {
    id: 'production-storyboard-images',
    sourceSkillId: 'jc-script-storyboard+jc-storyboard-image',
    heading: '分镜图',
    content: '基于当前输入输出可执行分镜：按镜号给出景别、机位、运镜、画面、时长和图像提示词。没有已定风格时自行从当前输入作出明确假设，不要调用工具或读取未提供内容。',
  },
  'storyboard-video': {
    id: 'production-storyboard-video',
    sourceSkillId: 'jc-storyboard-image',
    heading: '分镜视频',
    content: '基于当前输入输出单镜视频制作提示词：明确主体、动作、镜头运动、时长、画幅、光影和负面约束。不要拼接成片、不要调用工具或读取未提供内容。',
  },
}

export function getProductionProfile(step: ProductionStep): ProductionProfile {
  return profiles[step]
}

export function isProductionAssetStep(step: ProductionStep): boolean {
  return step === 'characters' || step === 'scenes' || step === 'props'
}

export function parseProductionPromptCards(content: string): ProductionPromptCard[] {
  const normalized = String(content || '').trim()
  const candidates = [
    normalized.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)?.[1],
    normalized,
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as { cards?: unknown }
      if (!Array.isArray(value.cards)) continue
      const cards = value.cards
        .filter((card): card is { name?: unknown; prompt?: unknown } => Boolean(card && typeof card === 'object'))
        .map(card => ({ name: String(card.name || '').trim(), prompt: String(card.prompt || '').trim() }))
        .filter(card => card.name && card.prompt)
      if (cards.length) return cards
    } catch {
      // Try the next explicitly delimited JSON candidate.
    }
  }
  return []
}

export function buildProductionWorkbenchRequest(input: {
  step: ProductionStep
  modelId: string
  userText: string
  sources: ProductionSource[]
  attachments: WorkbenchAttachment[]
  entityNames?: string[]
}): SingleTurnWorkbenchRequest {
  const userText = input.userText.trim()
  if (!userText && !input.sources.length && !input.attachments.length) {
    throw new Error('至少提供一句用户信息、资料或附件后才能运行。')
  }
  const profile = getProductionProfile(input.step)
  const entityNames = [...new Set((input.entityNames || []).map(name => name.trim()).filter(Boolean))]
  const entityInstruction = entityNames.length && isProductionAssetStep(input.step)
    ? `本次只返回${entityNames.join('、')}各一张卡，不得新增、遗漏或改名。`
    : ''
  return {
    modelId: input.modelId,
    skill: { id: profile.id, content: `${profile.content}${entityInstruction}` },
    input: {
      fields: {
        userText,
        sources: input.sources.map(source => `${source.name}\n${source.path}\n${source.content}`),
      },
      attachments: input.attachments,
    },
    output: { heading: profile.heading, format: 'text' },
  }
}
