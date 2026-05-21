export interface WikiArchitectureDirection {
  id: string
  title: string
  description: string
  wikiFolders: string[]
  rationale: string
  tradeoffs: string
}

interface UploadDirectionInput {
  files: Array<{
    name: string
    extractedText?: string
    status?: string
  }>
  draftWikiFolders?: string[]
}

interface DescribeDirectionInput {
  role: string
  goal: string
}

function cleanText(value: unknown): string {
  return String(value || '').trim()
}

function uniqueFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map(item => cleanText(item).replace(/^wiki\//, '').replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
  ))
}

export function normalizeWikiArchitectureDirections(input: unknown): WikiArchitectureDirection[] {
  const rawDirections = Array.isArray(input) ? input : []
  const normalized = rawDirections
    .map((item: any, index) => {
      const title = cleanText(item?.title || item?.name)
      const description = cleanText(item?.description || item?.summary)
      const wikiFolders = uniqueFolders(item?.wikiFolders || item?.folders)
      if (!title || !description || wikiFolders.length === 0) return null

      return {
        id: cleanText(item?.id) || `direction_${index + 1}`,
        title,
        description,
        wikiFolders,
        rationale: cleanText(item?.rationale || item?.reason) || '根据资料内容和使用目标生成。',
        tradeoffs: cleanText(item?.tradeoffs || item?.risk) || '后续可通过整理继续补齐遗漏栏目。',
      }
    })
    .filter(Boolean) as WikiArchitectureDirection[]

  return normalized.slice(0, 3)
}

function readyFileCount(files: UploadDirectionInput['files']): number {
  return files.filter(file => file.status !== 'error' && cleanText(file.extractedText)).length
}

function hasBookLikeStructure(files: UploadDirectionInput['files']): boolean {
  return files.some(file => /(^|\n)\s*(第[一二三四五六七八九十\d]+[章节篇部]|chapter\s+\d+|目录|contents)/i.test(file.extractedText || ''))
}

export function buildUploadArchitectureDirections(input: UploadDirectionInput): WikiArchitectureDirection[] {
  const draftFolders = Array.from(new Set((input.draftWikiFolders || []).map(folder => folder.replace(/^wiki\//, '')).filter(Boolean)))
  const filesCount = readyFileCount(input.files)
  const bookLike = hasBookLikeStructure(input.files)
  const baseTopicFolders = draftFolders.length ? draftFolders : ['总览', '概念', '流程', '实体', '素材']

  return normalizeWikiArchitectureDirections([
    {
      title: bookLike ? '沿用资料原结构' : '资料原结构优先',
      description: filesCount > 1
        ? '先保留每份资料的天然目录，再逐步沉淀跨资料主题。'
        : '先保留原文目录和章节脉络，适合工具书、课程、手册类资料。',
      wikiFolders: ['总览', '原文脉络', ...baseTopicFolders.slice(0, 4)],
      rationale: '能最快把上传资料变成可查阅的 Wiki，同时减少模型误拆。',
      tradeoffs: '跨章节主题需要后续通过整理功能继续归并。',
    },
    {
      title: '按主题能力整理',
      description: '把资料拆成概念、流程、案例、规范等主题页面，方便对话时精准召回。',
      wikiFolders: baseTopicFolders,
      rationale: '适合希望 AI 直接使用资料解决问题的知识库。',
      tradeoffs: '首版会重组原文结构，部分原文顺序需要回到 raw 查看。',
    },
    {
      title: '按对象关系整理',
      description: '围绕人物、产品、道具、地点、规则、关系等对象建立页面。',
      wikiFolders: ['总览', '对象', '关系', '流程', '案例', ...baseTopicFolders.slice(0, 2)],
      rationale: '适合小说设定、项目资料、业务系统、研究对象较多的资料。',
      tradeoffs: '如果资料实体较少，这种结构会显得偏细。',
    },
  ])
}

export function buildDescribeArchitectureDirections(input: DescribeDirectionInput): WikiArchitectureDirection[] {
  const role = cleanText(input.role) || '用户'
  const goal = cleanText(input.goal) || '管理资料'
  return normalizeWikiArchitectureDirections([
    {
      title: '主题检索型',
      description: `围绕「${goal}」拆成高频主题，适合日常提问和长文输出。`,
      wikiFolders: ['总览', '主题', '流程', '案例', '素材'],
      rationale: `${role}可以用主题快速找到上下文。`,
      tradeoffs: '需要后续把新增对话持续整理进主题页面。',
    },
    {
      title: '对象档案型',
      description: '把关键对象分别建档，再记录对象之间的关系和变化。',
      wikiFolders: ['总览', '对象', '关系', '规则', '变更记录'],
      rationale: '适合人物、客户、产品、道具、概念较多的知识库。',
      tradeoffs: '前期需要多维护对象名称，避免同义重复。',
    },
    {
      title: '流程工作型',
      description: '按任务流程、步骤、模板和检查清单组织，适合让搭子直接照流程干活。',
      wikiFolders: ['总览', '流程', '模板', '检查清单', '经验复盘'],
      rationale: '适合把知识库变成搭子执行任务时的操作手册。',
      tradeoffs: '不适合完全开放、尚未形成流程的探索型内容。',
    },
  ])
}
