export interface KbCommandPreset {
  icon: string
  title: string
  desc: string
  template: string
}

export const KB_COMMAND_PRESETS: KbCommandPreset[] = [
  {
    icon: '🏗️',
    title: '完本小说 → Wiki 记忆体',
    desc: '把已有小说导入 vault，按角色/世界观/时间线建档',
    template: '把 [小说路径] 导入当前 vault：原文存进 .raw/，用 wiki 架构整理 —— 在 wiki/角色/ 给每个主要角色建一份档案（记录他在各章的出场、行为、性格、说话风格、外貌、关系变化），在 wiki/世界观/ 整理世界观和设定体系，建时间线，所有笔记用 [[双链]] 关联，最后生成 wiki/hot.md 热缓存。不要只按章节拆。',
  },
  {
    icon: '✍️',
    title: '续写（不失忆）',
    desc: '续写前先读角色档案，严格延续设定',
    template: '我要续写当前 vault 里的小说。先读 wiki/hot.md 和相关角色档案，严格延续他们的性格、说话方式、外貌和已发生的事，从 [第几章/某情节] 接着写。写完更新对应角色档案和 hot.md。',
  },
  {
    icon: '🆕',
    title: '从 0 开新书',
    desc: '建 wiki 骨架，边写正文边同步更新知识库',
    template: '我要写一本 [题材] 新小说。先用 wiki 架构建好骨架，从灵感和核心设定开始，每确定一个角色就在 wiki/角色/ 建档案，边写正文边同步更新知识库，保证后续不失忆。',
  },
  {
    icon: '🔍',
    title: '从记忆体查询',
    desc: '查角色行为/性格/关系，只查笔记不编造',
    template: '从当前 vault 查：[某角色] 都做过什么、性格怎样、和谁有关系。只根据笔记回答，不要编。',
  },
  {
    icon: '⚖️',
    title: '一致性体检',
    desc: '检查角色外貌/性格/能力前后有无矛盾',
    template: '检查当前 vault 小说有没有前后矛盾：同一角色的外貌、性格、能力、关系在不同章节是否一致，列出所有冲突点。',
  },
  {
    icon: '🎬',
    title: '写短剧/剧本',
    desc: '建角色档案+分集大纲，每集同步更新状态',
    template: '我要写 [题材] 短剧。用 wiki 架构建库：先定世界观和核心角色档案（动机、压力值、关系网），再生成分集大纲，每集写完更新角色状态。',
  },
]
