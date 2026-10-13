import route from '../../../public/skills/manju-route.json'

export const MANJU_ROUTER = route.router
export const MANJU_SKILLS: readonly string[] = route.skills
export const WIKI_MEMORY_SKILL = 'wiki-memory'
export interface ManjuPreference { enabled: boolean; wikiMemoryWasSelected?: boolean }

export function restoreManjuSelection(names: string[], preference?: ManjuPreference): string[] {
  const migrated = [...new Set(names.map(name => name === 'jc-manju-minimaxh3' ? MANJU_ROUTER : name === 'jc-daoyan-fenjing' ? 'jc-seedance' : name))]
  if (preference?.enabled) {
    return [MANJU_ROUTER, ...migrated.filter(name => name !== MANJU_ROUTER && MANJU_SKILLS.includes(name)), WIKI_MEMORY_SKILL]
  }
  if (preference?.enabled === false) {
    const outsideRoute = migrated.filter(name => name !== MANJU_ROUTER && !MANJU_SKILLS.includes(name))
    return preference.wikiMemoryWasSelected === false
      ? outsideRoute.filter(name => name !== WIKI_MEMORY_SKILL)
      : outsideRoute
  }
  if (!migrated.includes(MANJU_ROUTER)) return migrated
  return [...migrated.filter(name => name === MANJU_ROUTER || MANJU_SKILLS.includes(name) || name === WIKI_MEMORY_SKILL),
    ...(migrated.includes(WIKI_MEMORY_SKILL) ? [] : [WIKI_MEMORY_SKILL])]
}

export function manjuRoutePrompt(): string {
  return [
    '【漫剧制作设置】',
    '用户明确指定的业务 Skill 优先：直接读取并执行该 Skill，不自动补跑其他制作阶段。',
    '依次按明确指定、已有产物续改、明确交付物、新手求起步处理；其余未指定创作请求默认使用 h3-prompt-writing 生成 MiniMax H3 视频提示词。',
    '脑暴、发散、对白／招式／角色／场景／道具候选、逐句／逐动作给选项，或明确要工程脚本却只有灵感、画面和零散节点时，读取 jc-manju-brainstorm；已有完整剧本只做工程转换仍直接使用 jc-gongchengjuben。脑暴中的选择、混搭与继续承接当前选择点，不落入 H3 默认。',
    '脑暴只在当前授权片段内按需使用清单中的风格、资产和工程技能；每个未定戏剧节拍提供具体候选，支持自由输入、逐句／整组选择与明确委托推荐。选定后即时成稿；未选候选不作为项目事实、正式剧本或媒体生成依据。完整短剧与分集文学创作仍使用独立短剧写作路线。',
    '设计角色面相／骨相／体相、根据性格设计长相、帅哥美女写真与人物肖像提示词，属于明确角色交付物，使用 jc-juese-sheji 的内置相术与写真参考，不落入 H3 默认、不加载名单外个人技能；角色候选先走脑暴再交接。',
    '续改已有产物沿用原 Skill 与格式；自然语言指定交付物视为指定对应入口。仅明确求起步才引导，不因消息短判断新手；只推荐当前一步，带我做且材料足够才执行第一步。',
    '用户明确说用 H3 即使用 h3-prompt-writing；说用 Seedance 2.5／SD2.5 即使用 jc-seedance。只处理指定范围，不混合两套格式。',
    '仅从漫剧路线清单中选择；缺少必要输入或指令冲突时才询问。默认交付当前任务的文字、资料或提示词，不自动生成媒体。',
    '【Wiki 产物归档】完成用户明确要求的正式制作产物后，依照 wiki-memory 的唯一 Wiki 与索引规则，在最终回答前调用 wiki_save_artifact 保存完整 Markdown 正文；只讨论、比较方向、提供起步建议时不保存。用户说“只在对话里”“不要保存”时不调用。',
    '类型映射：项目资料→story_summary／episode_summaries／story_background／world_rules；人物小传→character_bio；确认后的项目改编方向、视觉与制作总纲→project_overview；已确认的分集剧本→screenplay；工程剧本→engineering_script；角色／场景／道具提示词→character_asset／scene_asset／prop_asset；视频提示词→video_prompt。',
    '按一个文件一个实体／集／视频片段调用 wiki_save_artifact；必填集数、人物或资产名称、视频模型与片段范围。只提供类型和内容，不能提供任意路径。按工具返回状态与真实路径交付；警告存在时不得说索引归档已完整。已有文件默认不覆盖。同一资产新增独立提示词章节时用 write_mode=append；只有用户明确修订时才用 write_mode=update。',
    '资料整理仅保存用户要求生成的资料，不复制原作附件；改编方向选项未确认前不保存项目总纲。第一份产物保存成功时才建立 Wiki。',
  ].join('\n')
}
