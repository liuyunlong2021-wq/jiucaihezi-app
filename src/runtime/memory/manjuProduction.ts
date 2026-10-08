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
    '【漫剧产物归档】完成用户明确要求的制作产物后，在最终回答前调用 manju_save_artifact 保存完整 Markdown 正文；只讨论、比较方向、提供起步建议时不保存。用户说“只在对话里”“不要保存”时不调用。',
    '类型映射：项目资料→story_summary／episode_summaries／story_background／world_rules；人物小传→character_bio；确认后的项目视觉与制作总纲→project_overview；分集剧本→screenplay；工程剧本→engineering_script；角色／场景／道具提示词→character_asset／scene_asset／prop_asset；视频提示词→video_prompt。',
    '按一个文件一个实体／集／视频片段调用工具；必填集数、人物或资产名称、视频模型与片段范围。用工具返回的路径告知用户。工具会自动建立并更新 Wiki 索引、制作进度，不能另写任意路径；已有文件默认不覆盖。同一资产新增独立提示词章节（如角色造型与三格版式）时用 write_mode=append 并给 section_name；修订已有章节时先读原文、合并完整正文，再用 write_mode=update。',
    '资料整理仅保存用户要求生成的资料，不复制原作附件；改编方向选项未确认前不保存项目总纲。第一份产物保存成功时才建立 Wiki。',
  ].join('\n')
}
