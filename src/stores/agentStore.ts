/**
 * stores/agentStore.ts — 搭子管理 Store（SKILL.md 标准格式）
 *
 * 对齐标准：
 *   - superpowers SKILL.md frontmatter (name, description, triggers)
 *   - colleague-skill .skill 格式
 *   - PILL_MODELS (行 2754)
 */
import { defineStore } from 'pinia'
import { useFileStore } from '@/composables/useFileStore'
import { ref, computed } from 'vue'
import type { SkillConfig } from '../types/skill'
import { migrateAgentToSkill, parseSkillMd } from '../types/skill'
import { SUPERPOWER_SKILLS } from '@/data/superpowerSkills'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import { getModelProviderId, updateDefaultProviderModels } from '@/utils/providerConfig'
import { resolveModelSelection } from '@/utils/modelSelection'

// ─── 向后兼容：旧 Agent 类型（迁移用） ───
export interface Agent {
  id: string
  name: string
  icon: string
  folder?: string
  systemPrompt: string
  openingMessage?: string
  specialMode?: string
  source?: string
  nextAgent?: string
}

// ─── 模型系统 ───

export interface ModelEntry {
  id: string
  label: string
  providerId?: string
  /** 能力分类：text=文本LLM, image=图片生成, video=视频生成, audio=音频生成 */
  capability?: 'text' | 'image' | 'video' | 'audio'
}

/** 本地兜底默认模型（当 /v1/models 拉取失败时使用） */
const DEFAULT_MODELS: ModelEntry[] = [
  { id: 'claude-opus-4-7', label: 'Opus-4.7', capability: 'text' },
  { id: 'claude-opus-4-6', label: 'Opus', capability: 'text' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet', capability: 'text' },
  { id: 'gpt-5.5', label: 'GPT-5.5', capability: 'text' },
  { id: 'gpt-5.4', label: 'GPT-5.4', capability: 'text' },
  { id: 'qwen3.6-plus', label: 'Qwen-3.6', capability: 'text' },
  { id: 'deepseek-v4-flash', label: 'DS-V4-Flash', capability: 'text' },
  { id: 'deepseek-v4-pro', label: 'DS-V4-Pro', capability: 'text' },
  { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS', capability: 'text' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma-31B', capability: 'text' },
  { id: 'gemini-3.1-flash-lite-preview', label: 'G-Flash-Lite', capability: 'text' },
  { id: 'gemini-3.1-pro-preview', label: 'G-3.1-Pro', capability: 'text' },
  // ─── 媒体生成模型 ───
  { id: 'gpt-image-2', label: '🎨 GPT Image', capability: 'image' },
  { id: 'grok-video-3', label: '🎬 Grok Video', capability: 'video' },
  { id: 'seedance-2.0-fast', label: '🎬 Seedance', capability: 'video' },
  { id: 'suno-5.5', label: '🎵 Suno', capability: 'audio' },
]

/** 根据模型 ID 推断能力分类 */
function inferCapability(id: string): ModelEntry['capability'] {
  const lower = id.toLowerCase()
  if (/image|dall|midjourney|sd-|stable.?diff|flux/.test(lower)) return 'image'
  if (/video|veo|seedance|grok-video|kling|runway|pika|luma/.test(lower)) return 'video'
  if (/suno|audio|music|tts|whisper/.test(lower)) return 'audio'
  return 'text'
}

/** 模型能力层级：知识库整理需要 strong 级别模型 */
export type ModelTier = 'strong' | 'medium' | 'light'

export function inferModelTier(id: string): ModelTier {
  const lower = id.toLowerCase()
  // 强力模型：适合知识库整理、复杂推理
  if (/opus|gpt-5\.4|gpt-5\.5|o[1-9]|o3|deepseek.*pro|qwen.*plus|gemini.*pro/.test(lower)) return 'strong'
  // 轻量模型：快速但不适合复杂知识整理
  if (/haiku|flash.*lite|gemma|free|mini|nano|tiny/.test(lower)) return 'light'
  // 中等模型：sonnet 等
  return 'medium'
}

/** 知识库操作推荐的最低模型 tier */
export const VAULT_RECOMMENDED_TIER: ModelTier = 'medium'

// 兼容旧代码：导出 PILL_MODELS 作为 DEFAULT_MODELS 的别名
/** @deprecated 请使用 agentStore.availableModels 代替 */
export const PILL_MODELS = DEFAULT_MODELS

export const REMOVED_PRESET_SKILL_IDS = new Set(['ppt_designer'])

export function isRemovedPresetSkillId(id: string): boolean {
  return REMOVED_PRESET_SKILL_IDS.has(id)
}

// ─── PRESETS — 全部改为 SKILL.md 标准格式 ───
const SKILL_PRESETS: SkillConfig[] = [
  {
    id: 'guide', name: '新手指导',
    oneLineDesc: '韭菜盒子使用向导，有问必答',
    description: '当用户初次使用韭菜盒子，或对功能有疑问时自动激活。引导新用户快速上手所有功能。',
    triggers: ['怎么用', '帮助', '教程', '不会', '新手'],
    skillContent: `## 角色定义\n你是「新手指导」— 韭菜盒子 AI 工作站的专属向导搭子。\n\n## 工作流程\n1. 识别用户的困惑点\n2. 用最简单直白的语言解释功能\n3. 给出具体操作步骤\n4. 确认用户是否理解\n\n## 输出格式\n- 用数字编号列出步骤\n- 每步不超过一句话\n- 关键按钮用【】标注`,
    references: [], examples: ['欢迎来到韭菜盒子！有任何问题随时问我。'],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'manhua', name: '漫剧剧本',
    oneLineDesc: '把你的故事变成漫画分镜剧本',
    description: '当用户想创作漫剧、短剧、分镜剧本时自动激活。从灵感碎片生成完整剧本。',
    triggers: ['漫剧', '剧本', '分镜', '短剧', '故事'],
    skillContent: `## 角色定义\n你是「漫剧剧本」创作搭子，擅长将灵感碎片转化为结构化的漫剧剧本。\n\n## 工作流程\n1. 收集用户灵感\n2. 提炼核心冲突和情感线\n3. 生成分镜大纲\n4. 迭代优化\n\n## 输出格式\n- 标题行\n- 每个分镜编号 + 画面 + 台词 + 镜头\n- 情绪标注`,
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'ppt_designer', name: 'PPT 设计师',
    oneLineDesc: '帮你设计专业的演示文稿内容',
    description: '当用户需要制作PPT、设计演示文稿内容和素材时自动激活。',
    triggers: ['PPT', 'ppt', '演示', '幻灯片', '汇报'],
    skillContent: `## 角色定义\n你是「PPT 设计师」，负责PPT内容设计和素材设计。\n\n## 工作流程\n1. 了解主题和用途\n2. 设计内容大纲\n3. 建议配色和版式\n4. 逐页输出内容\n\n## 输出格式\n- 每页标题 + 3-5个要点\n- 配图建议\n- 演讲备注`,
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'write_000', name: '写作',
    oneLineDesc: '文章、小说、文案等文字创作',
    description: '当用户需要写文章、小说、文案等文字创作时自动激活。',
    triggers: ['写作', '文章', '小说', '文案', '写'],
    skillContent: `## 角色定义\n你是「写作总管」，小说与文字创作流水线的总调度。\n\n## 工作流程\n1. 了解写作类型和目标读者\n2. 确定风格、调性、篇幅\n3. 生成大纲或直接创作\n4. 迭代修改`,
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'tomd', name: 'ToMD',
    description: '',
    triggers: ['ToMD', 'tomd', '转MD', '转 Markdown', '转换Markdown', '文件转MD', 'PDF转MD', '资料转MD'],
    skillContent: `## 角色定义\n你是 ToMD，负责把用户上传的资料转换成 Markdown。\n\n## 工作流程\n1. 用户上传文件或要求转 Markdown 时，优先调用 document_to_markdown 工具。\n2. 工具返回成功后，告诉用户已生成哪些 Markdown 文件，并把核心结果简要说明清楚。\n3. 如果工具提示没有可读文本、需要 OCR、需要音视频转写或引擎未接入，如实说明原因，不要伪造转换结果。\n4. 当前统一使用 MarkItDown 处理普通文档，使用 RapidOCR 处理扫描 PDF 和图片型文档。\n\n## 输出格式\n- 先给转换结果\n- 再列出生成的 Markdown 文件名\n- 不要输出与转换无关的长篇解释`,
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },

  // ═══ 以下 17 个 Skill 来自 /skills/ 目录 ═══

  {
    id: 'film-type-analysis', name: '影片风格分析师',
    oneLineDesc: '分析剧本确定视觉风格和叙事节奏',
    description: '分析剧本确定视觉风格、画面比例与叙事节奏',
    triggers: ['风格', '分析', '类型', '比例', '节奏'],
    skillContent: 'skill://skills/film-type-analysis/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'film-character-asset', name: '角色设定师',
    oneLineDesc: '从剧本提取角色资产和制作手册',
    description: '从剧本提取角色资产控制表与制作手册',
    triggers: ['角色', '人设', '立绘', '角色表'],
    skillContent: 'skill://skills/film-character-asset/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'film-scene-asset', name: '场景设定师',
    oneLineDesc: '设计可复用的空镜主场景资产',
    description: '设计可复用的空镜主场景资产规格',
    triggers: ['场景', '空镜', '环境', '背景'],
    skillContent: 'skill://skills/film-scene-asset/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'film-prop-asset', name: '道具设定师',
    description: '拆解剧本道具为精确可生图的资产规格',
    triggers: ['道具', '物件', '细节', '物品'],
    skillContent: 'skill://skills/film-prop-asset/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'film-engineering-book', name: '素材工程师',
    description: '将剧本转化为镜头级可复用素材单元',
    triggers: ['工程', '拆解', '素材', '工程书'],
    skillContent: 'skill://skills/film-engineering-book/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'film-shot-design', name: '分镜设计师',
    description: '将工程素材编排成可执行的分镜表',
    triggers: ['分镜', '镜头', '运镜', '分镜表'],
    skillContent: 'skill://skills/film-shot-design/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'banana-character-prompt', name: '角色提示词生成',
    description: '将角色设定转为 Banana 生图 JSON 提示词',
    triggers: ['Banana', '角色提示词', '角色生图'],
    skillContent: 'skill://skills/banana-character-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'banana-scene-prompt', name: '场景提示词生成',
    description: '将场景设定转为 Banana 生图提示词',
    triggers: ['场景提示词', '场景生图', 'Banana场景'],
    skillContent: 'skill://skills/banana-scene-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'banana-prop-prompt', name: '道具提示词生成',
    description: '将道具设定转为 Banana 生图提示词',
    triggers: ['道具提示词', '道具生图', 'Banana道具'],
    skillContent: 'skill://skills/banana-prop-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'banana-grid-shot-prompt', name: '分镜板提示词',
    description: '将分镜转为 3×3 格子分镜板提示词',
    triggers: ['分镜板', '3x3', 'grid', '网格分镜'],
    skillContent: 'skill://skills/banana-grid-shot-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'banana-storyboard-edit-prompt', name: '分镜修图提示词',
    description: '针对单帧分镜板的精修编辑提示词',
    triggers: ['修图', '分镜修复', '编辑分镜', '精修'],
    skillContent: 'skill://skills/banana-storyboard-edit-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'grok-video-prompt', name: 'Grok 视频提示词',
    description: '将分镜转为 Grok 视频时间线格式',
    triggers: ['Grok', 'Grok视频', '视频提示词'],
    skillContent: 'skill://skills/grok-video-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'veo-video-prompt', name: 'Veo 视频提示词',
    description: '将分镜转为 Veo 兼容生视频提示词',
    triggers: ['Veo', 'Veo视频', '视频生成'],
    skillContent: 'skill://skills/veo-video-prompt/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'ltx-video-action', name: 'LTX 视频提示词',
    description: '将分镜转为 LTX 2.3 图生视频提示词',
    triggers: ['LTX', '动作视频', 'LTX视频'],
    skillContent: 'skill://skills/ltx-video-action/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'video-composer', name: '视频合成工具',
    description: '拼接视频片段并添加字幕',
    triggers: ['合成', '拼接', '字幕', '剪辑'],
    skillContent: 'skill://skills/video-composer/skill.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'voice-bound-shot-video', name: '配音绑定镜头',
    description: '用音频驱动单镜头对白视频生成',
    triggers: ['配音', '对白', '声音镜头', '音频驱动'],
    skillContent: 'skill://skills/voice-bound-shot-video/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'qwen-tts-voice-design', name: '声音设计师',
    description: '为角色设计 Qwen TTS 语音提示词',
    triggers: ['TTS', '声音', '语音', '配音设计'],
    skillContent: 'skill://skills/qwen-tts-voice-design/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  // ─── 纯文本技能（从 skills-main 搬运） ───
  {
    id: 'algorithmic-art', name: '算法艺术',
    description: '用 p5.js 创建交互式生成艺术，输出自包含 HTML 文件',
    triggers: ['算法艺术', '生成艺术', 'p5', 'generative', 'art', '交互艺术'],
    skillContent: 'skill://skills/algorithmic-art/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'frontend-design', name: '前端设计',
    description: '创建独特的生产级前端界面，拒绝千篇一律的 AI 风格',
    triggers: ['前端设计', 'UI', '界面', '网页设计', 'frontend', 'HTML', 'CSS'],
    skillContent: 'skill://skills/frontend-design/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'doc-coauthoring', name: '文档协作',
    description: '三阶段结构化文档协作：收集背景 → 逐节起草 → 读者测试',
    triggers: ['文档协作', '写文档', '技术文档', '规格文档', '决策文档', '提案'],
    skillContent: 'skill://skills/doc-coauthoring/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'internal-comms', name: '内部通讯',
    description: '编写公司内部通讯稿件：周报、新闻稿、FAQ、状态报告',
    triggers: ['内部通讯', '周报', '新闻稿', 'FAQ', '状态报告', '公司通讯'],
    skillContent: 'skill://skills/internal-comms/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'brand-guidelines', name: '品牌指南',
    description: '提供专业品牌色彩和排版规范，为任何内容应用一致的视觉风格',
    triggers: ['品牌', '配色', '品牌色', '视觉规范', 'brand', '色彩方案'],
    skillContent: 'skill://skills/brand-guidelines/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  // ─── Office 文档处理技能（需服务器后端） ───
  {
    id: 'docx-office', name: 'Word 文档',
    description: '创建、阅读、编辑 Word 文档(.docx)，支持表格、目录、页眉页脚等专业排版',
    triggers: ['word', 'docx', '文档', '报告', '合同', '简历', '信函', 'Word'],
    skillContent: 'skill://skills/docx-office/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'pdf-office', name: 'PDF 处理',
    description: '读取、合并、拆分、创建 PDF，支持表格提取、水印、加密、OCR',
    triggers: ['pdf', 'PDF', '合并pdf', '拆分pdf', '水印', 'OCR'],
    skillContent: 'skill://skills/pdf-office/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'pptx-office', name: '演示文稿',
    description: '创建精美 PowerPoint 演示文稿(.pptx)，专业配色排版设计',
    triggers: ['ppt', 'pptx', '演示', '幻灯片', 'PPT', '演示文稿', 'slides'],
    skillContent: 'skill://skills/pptx-office/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
  {
    id: 'xlsx-office', name: 'Excel 表格',
    description: '创建、分析、编辑 Excel 表格(.xlsx)，支持公式、格式、数据分析',
    triggers: ['excel', 'xlsx', '表格', '电子表格', 'Excel', '数据分析', 'csv'],
    skillContent: 'skill://skills/xlsx-office/SKILL.md',
    references: [], examples: [],
    version: 1, source: 'preset', createdAt: 0, updatedAt: 0, evolutionLog: [],
  },
]

export const useAgentStore = defineStore('agents', () => {
  const currentAgent = ref<SkillConfig | null>(null)
  const currentModel = ref(localStorage.getItem('jcModel') || 'claude-sonnet-4-6')
  // 超能模式（原 routerEnabled）：开启后自动分析意图 → 规划 → 分派搭子
  const superpowerEnabled = ref(
    localStorage.getItem('jc_superpower_mode') !== '0'
    && localStorage.getItem('jc_router_enabled') !== '0' // 向后兼容旧 key
  )

  // ─── 动态模型系统 ───
  /** 响应式模型列表：初始化为本地兜底，/v1/models 成功后替换 */
  const availableModels = ref<ModelEntry[]>([...DEFAULT_MODELS])
  const modelsFetched = ref(false)
  const modelsFetchError = ref('')

  /** 按能力分类的视图 */
  const textModels = computed(() => availableModels.value.filter(m => (m.capability || 'text') === 'text'))
  const imageModels = computed(() => availableModels.value.filter(m => m.capability === 'image'))
  const videoModels = computed(() => availableModels.value.filter(m => m.capability === 'video'))
  const audioModels = computed(() => availableModels.value.filter(m => m.capability === 'audio'))

  /**
   * 静默拉取 /v1/models，成功后合并到 availableModels。
   * 策略：API 返回的模型与本地默认合并（去重），保留本地 label。
   */
  async function fetchModels() {
    try {
      const config = await resolveApiConfig()
      const res = await fetch(`${config.apiBase}/v1/models`, {
        headers: buildHeaders(config),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const data = json.data || json.models || json
      if (!Array.isArray(data) || data.length === 0) return

      // 构建 ID → 默认标签的映射，保留我们精心取的中文标签
      const defaultMap = new Map(DEFAULT_MODELS.map(m => [m.id, m]))

      const merged: ModelEntry[] = data.map((item: any) => {
        const id = item.id || item.model || ''
        if (!id) return null
        const existing = defaultMap.get(id)
        return {
          id,
          label: existing?.label || item.name || id.split('/').pop() || id,
          providerId: config.providerId,
          capability: existing?.capability || inferCapability(id),
        }
      }).filter(Boolean) as ModelEntry[]

      // 只显示用户 Key 实际可用的模型，不强制回填默认列表
      availableModels.value = merged
      const resolvedModel = resolveModelSelection(currentModel.value, merged)
      if (resolvedModel !== currentModel.value) {
        setModel(resolvedModel)
      } else {
        localStorage.setItem('jcModelProviderId', getModelProviderId(merged.find(model => model.id === currentModel.value)))
      }
      modelsFetched.value = true
      modelsFetchError.value = ''

      // 缓存到 localStorage（下次启动时快速恢复，再异步刷新）
      try {
        localStorage.setItem('jc_models_cache', JSON.stringify(merged))
        updateDefaultProviderModels(merged)
      } catch { /* quota exceeded, ignore */ }
    } catch (e: any) {
      modelsFetchError.value = e.message || 'fetch failed'
      // 尝试从缓存恢复
      try {
        const cached = localStorage.getItem('jc_models_cache')
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed) && parsed.length > 0) {
            availableModels.value = parsed
            const resolvedModel = resolveModelSelection(currentModel.value, parsed)
            if (resolvedModel !== currentModel.value) setModel(resolvedModel)
            modelsFetched.value = true
          }
        }
      } catch { /* noop */ }
    }
  }

  // 启动时立即尝试从缓存恢复
  try {
    const cached = localStorage.getItem('jc_models_cache')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (Array.isArray(parsed) && parsed.length > 0) {
        availableModels.value = parsed
        const resolvedModel = resolveModelSelection(currentModel.value, parsed)
        if (resolvedModel !== currentModel.value) setModel(resolvedModel)
      }
    }
  } catch { /* noop */ }

  // ═══ 三层迁移系统 ═══

  // 迁移状态（给 UI 弹 toast 用）
  const migrationCount = ref(0)

  // ─── L1: 自动嗅探 — 扫描所有已知 V5 localStorage key ───
  function autoSniffMigration(): SkillConfig[] {
    // 如果已经迁移过，跳过
    if (localStorage.getItem('jc_migration_done') === '1') return []

    const migrated: SkillConfig[] = []
    const existingIds = new Set<string>()

    // 所有已知的 V5 存储 key 格式
    const V5_KEYS = [
      'jc_agents_v1',           // V5 标准格式
      'agents',                 // 最早版本
      'customAgents',           // 桌面版
      'daziList',               // 搭子Studio
      'dazi_agents',            // 搭子Studio 另一个 key
      'jc_custom_agents',       // V4 格式
      'assistants',             // 通用格式
    ]

    for (const key of V5_KEYS) {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const arr = JSON.parse(raw)
        if (!Array.isArray(arr)) continue

        for (const item of arr) {
          // 兼容多种旧格式
          const id = item.id || item.name || ('v5_' + Math.random().toString(36).slice(2, 8))
          if (existingIds.has(id)) continue

          const name = item.name || item.label || item.title || '旧搭子'
          const prompt = item.systemPrompt || item.system_prompt || item.prompt || item.content || item.instruction || ''

          if (!prompt && !name) continue // 空数据跳过

          migrated.push(migrateAgentToSkill({
            id: 'v5_' + id.replace(/[^a-zA-Z0-9_]/g, '_'),
            name,
            systemPrompt: prompt,
            source: 'user',
          }))
          existingIds.add(id)
        }
      } catch { /* 格式不对的 key 静默跳过 */ }
    }

    if (migrated.length > 0) {
      migrationCount.value = migrated.length
      localStorage.setItem('jc_migration_done', '1')
    }

    return migrated
  }

  // ─── L2: 粘贴即导入 — 纯文本系统提示词 → SkillConfig ───
  function importFromText(text: string, name?: string): SkillConfig | null {
    const trimmed = text.trim()
    if (!trimmed) return null

    // 尝试判断是否是 SKILL.md 格式
    if (trimmed.startsWith('---\n')) {
      const parsed = parseSkillMd(trimmed)
      const skill: SkillConfig = {
        id: parsed.id || 'paste_' + Date.now().toString(36),
        name: parsed.name || name || '粘贴搭子',
        description: parsed.description || trimmed.slice(0, 80),
        triggers: parsed.triggers || [],
        skillContent: parsed.skillContent || trimmed,
        references: [],
        examples: [],
        version: 1,
        source: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        evolutionLog: [],
      }
      createAgent(skill)
      moveToMy(skill.id)
      return skill
    }

    // 纯文本 → 直接当 systemPrompt
    const autoName = name || extractNameFromPrompt(trimmed)
    const skill: SkillConfig = {
      id: 'paste_' + Date.now().toString(36),
      name: autoName,
      description: trimmed.slice(0, 100).replace(/\n/g, ' '),
      triggers: [autoName],
      skillContent: trimmed,
      references: [],
      examples: [],
      version: 1,
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evolutionLog: [],
    }
    createAgent(skill)
    moveToMy(skill.id)
    return skill
  }

  // ─── L3: JSON 批量导入 ───
  function importFromJSON(jsonStr: string): number {
    try {
      const arr = JSON.parse(jsonStr)
      if (!Array.isArray(arr)) return 0
      let count = 0
      for (const item of arr) {
        const name = item.name || item.label || '导入搭子'
        const prompt = item.systemPrompt || item.system_prompt || item.prompt || item.content || ''
        if (!prompt && !name) continue
        const skill: SkillConfig = {
          id: 'import_' + Date.now().toString(36) + '_' + count,
          name,
          description: (item.description || prompt.slice(0, 80)).replace(/\n/g, ' '),
          triggers: item.triggers || [name],
          skillContent: prompt,
          references: [],
          examples: [],
          version: 1,
          source: 'user',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          evolutionLog: [],
        }
        createAgent(skill)
        moveToMy(skill.id)
        count++
      }
      return count
    } catch { return 0 }
  }

  // 从提示词自动提取名字
  function extractNameFromPrompt(prompt: string): string {
    // 尝试匹配 "你是XXX" / "你扮演XXX" / "## 角色: XXX"
    const patterns = [
      /你是[「『""]?(.{2,12})[」』""]?/,
      /角色[:：]\s*(.{2,12})/,
      /扮演[「『""]?(.{2,12})[」』""]?/,
      /^#\s+(.{2,15})/m,
    ]
    for (const p of patterns) {
      const m = prompt.match(p)
      if (m) return m[1].replace(/[，。、！？]/g, '').trim()
    }
    return '导入搭子 ' + new Date().toLocaleDateString('zh-CN')
  }

  // ─── 迁移旧数据 (兼容原有调用) ───
  function migrateOldAgents(): SkillConfig[] {
    return autoSniffMigration()
  }

  // ─── skill:// 协议解析缓存 ───
  const skillContentCache = new Map<string, string>()
  const skillContentPending = new Set<string>()

  /**
   * 解析 skill:// 协议路径，从 /skills/ 目录加载真实 SKILL.md 内容
   * BUG-10 修复: 17个 preset 搭子的 skillContent 是 skill:// 路径，
   * 不解析的话 AI 收到的 system prompt 是路径字符串而非实际内容
   */
  function resolveSkillContent(skill: SkillConfig): SkillConfig {
    if (!skill.skillContent.startsWith('skill://')) return skill
    const cached = skillContentCache.get(skill.id)
    if (cached) return { ...skill, skillContent: cached }
    const fallback = `## ${skill.name}\n\n${skill.description}\n\n请根据以上角色定义完成用户的请求。`
    if (skillContentPending.has(skill.id)) return { ...skill, skillContent: fallback }

    skillContentPending.add(skill.id)
    // 异步加载（不阻塞），先返回占位内容
    const filePath = new URL(skill.skillContent.replace('skill://', ''), window.location.href).toString()
    fetch(filePath).then(r => {
      if (r.ok) return r.text()
      throw new Error(`${r.status}`)
    }).then(text => {
      skillContentCache.set(skill.id, text)
      // 触发 agents 列表刷新
      _skillsVersion.value++
    }).catch(() => {
      // 加载失败时用 skill 描述作为兜底
      skillContentCache.set(skill.id, fallback)
      _skillsVersion.value++
    }).finally(() => {
      skillContentPending.delete(skill.id)
    })
    // 首次返回时用描述兜底，等异步加载完成后自动刷新
    return { ...skill, skillContent: fallback }
  }

  // ─── BUG-9 修复: 用版本号 ref 驱动 computed，避免每次访问都解析 localStorage ───
  const _skillsVersion = ref(0)

  // ─── loadSkills ───
  function loadSkills(): SkillConfig[] {
    let custom: SkillConfig[] = []
    try {
      const raw = localStorage.getItem('jc_skills_v2')
      if (raw) {
        custom = JSON.parse(raw) || []
      } else {
        // 尝试迁移 v1 数据
        custom = migrateOldAgents()
        if (custom.length > 0) {
          localStorage.setItem('jc_skills_v2', JSON.stringify(custom))
        }
      }
    } catch { custom = [] }

    // BUG-5 修复: preset 搭子的用户修改也存在 custom 中（通过 id 覆盖）
    const customIds = new Set(custom.map(c => c.id))
    const presets = SKILL_PRESETS.concat(SUPERPOWER_SKILLS)
      .filter(p => !customIds.has(p.id))  // custom 中有同 id 的则用 custom 版本

    // BUG-10 修复: 解析 skill:// 协议路径
    const all = [...presets, ...custom]
      .filter(s => !isRemovedPresetSkillId(s.id))
      .map(s => resolveSkillContent(s))
    return all
  }

  // ─── getCustomSkills ───
  function getCustomSkills(): SkillConfig[] {
    try {
      const raw = localStorage.getItem('jc_skills_v2')
      return raw ? JSON.parse(raw) || [] : []
    } catch { return [] }
  }

  // ─── saveCustomSkills ───
  function saveCustomSkills(list: SkillConfig[]) {
    localStorage.setItem('jc_skills_v2', JSON.stringify(list))
    _skillsVersion.value++  // 触发 agents computed 刷新
  }

  function refreshSkills() {
    _skillsVersion.value++
  }

  // ─── 向后兼容 loadAgents / getCustomAgents / saveCustomAgents ───
  function loadAgents(): SkillConfig[] { return loadSkills() }
  function getCustomAgents(): SkillConfig[] { return getCustomSkills() }
  function saveCustomAgents(list: SkillConfig[]) { saveCustomSkills(list) }

  // BUG-9 修复: computed 依赖 _skillsVersion ref，只在版本变化时重新计算
  const agents = computed(() => { void _skillsVersion.value; return loadSkills() })

  function selectAgent(id: string | null) {
    if (!id) {
      currentAgent.value = null
      localStorage.removeItem('jc_last_agent_id')
      return
    }
    if (currentAgent.value?.id === id) {
      currentAgent.value = null
      localStorage.removeItem('jc_last_agent_id')
      return
    }
    const found = loadSkills().find(s => s.id === id) || null
    currentAgent.value = found
    if (found) localStorage.setItem('jc_last_agent_id', found.id)
  }

  function setModel(modelId: string) {
    currentModel.value = modelId
    localStorage.setItem('jcModel', modelId)
    const model = availableModels.value.find(x => x.id === modelId)
    localStorage.setItem('jcModelProviderId', getModelProviderId(model))
  }

  const modelLabel = computed(() => {
    const f = availableModels.value.find(x => x.id === currentModel.value)
    return f ? f.label : currentModel.value.split('-')[0]
  })

  function restoreLastAgent() {
    const lastId = localStorage.getItem('jc_last_agent_id')
    if (lastId) {
      const found = loadSkills().find(s => s.id === lastId)
      if (found) currentAgent.value = found
    }
  }

  function createAgent(skill: SkillConfig) {
    const custom = getCustomSkills()
    custom.push(skill)
    saveCustomSkills(custom)
  }

  // BUG-5 修复: preset 搭子的修改也要持久化（存为 custom 覆盖版本）
  function updateSkill(id: string, patch: Partial<SkillConfig>) {
    const all = loadSkills()
    const idx = all.findIndex(s => s.id === id)
    if (idx === -1) return
    const updated = { ...all[idx], ...patch, updatedAt: Date.now() }

    // 更新 custom 列表（包括 preset 的覆盖版本）
    const custom = getCustomSkills()
    const customIdx = custom.findIndex(s => s.id === id)
    if (customIdx >= 0) {
      custom[customIdx] = updated
    } else {
      // preset 搭子首次修改 → 添加到 custom 中覆盖
      custom.push(updated)
    }
    saveCustomSkills(custom)

    // 更新 skill:// 缓存
    if (patch.skillContent) {
      skillContentCache.set(id, patch.skillContent)
    }
  }

  function deleteAgent(id: string) {
    if (SKILL_PRESETS.some(p => p.id === id)) return
    const custom = getCustomSkills().filter(s => s.id !== id)
    saveCustomSkills(custom)
    if (currentAgent.value?.id === id) currentAgent.value = null
  }

  function toggleSuperpower(enabled?: boolean) {
    superpowerEnabled.value = enabled !== undefined ? enabled : !superpowerEnabled.value
    localStorage.setItem('jc_superpower_mode', superpowerEnabled.value ? '1' : '0')
    localStorage.setItem('jc_router_enabled', superpowerEnabled.value ? '1' : '0') // 向后兼容
  }
  // 向后兼容别名
  const routerEnabled = superpowerEnabled
  function toggleRouter(enabled?: boolean) { toggleSuperpower(enabled) }

  // ─── 仓库整体开关 ───
  const warehouseEnabled = ref(localStorage.getItem('jc_warehouse_enabled') !== '0')
  const presetEnabled = ref(localStorage.getItem('jc_preset_enabled') !== '0')

  function toggleWarehouse(enabled?: boolean) {
    warehouseEnabled.value = enabled !== undefined ? enabled : !warehouseEnabled.value
    localStorage.setItem('jc_warehouse_enabled', warehouseEnabled.value ? '1' : '0')
  }

  function togglePresetEnabled(enabled?: boolean) {
    presetEnabled.value = enabled !== undefined ? enabled : !presetEnabled.value
    localStorage.setItem('jc_preset_enabled', presetEnabled.value ? '1' : '0')
  }

  // ─── 我的搭子：用户主动添加的搭子列表 ───
  function getMySkills(): SkillConfig[] {
    let myIds: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')

    // 兼容迁移：如果 jc_my_skills 为空但有自建搭子，自动迁移
    if (myIds.length === 0) {
      const custom = getCustomSkills().filter(s => s.source !== 'superpower')
      if (custom.length > 0) {
        myIds = custom.map(s => s.id)
        localStorage.setItem('jc_my_skills', JSON.stringify(myIds))
      }
    }

    const all = loadSkills()
    return myIds.map(id => all.find(s => s.id === id)).filter(Boolean) as SkillConfig[]
  }

  function saveMySkillIds(ids: string[]) {
    localStorage.setItem('jc_my_skills', JSON.stringify(ids))
  }

  async function moveToMy(id: string) {
    const ids: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')
    if (!ids.includes(id)) {
      ids.push(id)
      saveMySkillIds(ids)

      // 同步到 FileStore: 创建搭子物理文件夹
      try {
        const fileStore = useFileStore()
        await fileStore.syncSkillsFromStore(loadSkills())
      } catch (e) {
        console.error('Failed to sync agent to FileTree', e)
      }
    }
  }

  async function moveToPreset(id: string) {
    const ids: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')
    saveMySkillIds(ids.filter(i => i !== id))
    if (currentAgent.value?.id === id) currentAgent.value = null

    // 同步到 FileStore: 删除物理文件夹
    try {
      const fileStore = useFileStore()
      await fileStore.syncSkillsFromStore(loadSkills())
    } catch (e) {
      console.error('Failed to sync agent removal to FileTree', e)
    }
  }

  function isInMySkills(id: string): boolean {
    const ids: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')
    return ids.includes(id)
  }

  // ─── 获取内置搭子（不在"我的搭子"中的预设） ───
  function getPresetSkills(): SkillConfig[] {
    const myIds: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')
    return SKILL_PRESETS.filter(p => !myIds.includes(p.id))
  }

  // ─── 启用/禁用仓库搭子（保留向后兼容） ───
  function enableWarehouseSkill(id: string) { moveToMy(id) }
  function disableWarehouseSkill(id: string) { moveToPreset(id) }
  function isWarehouseSkillEnabled(id: string): boolean { return isInMySkills(id) }

  // ─── 调用计数 ───
  function incrementCallCount(id: string) {
    const counts: Record<string, number> = JSON.parse(localStorage.getItem('jc_call_counts') || '{}')
    counts[id] = (counts[id] || 0) + 1
    localStorage.setItem('jc_call_counts', JSON.stringify(counts))
  }

  function getCallCount(id: string): number {
    const counts: Record<string, number> = JSON.parse(localStorage.getItem('jc_call_counts') || '{}')
    return counts[id] || 0
  }

  // ─── 获取可被自动搭子路由的搭子 ───
  function getRoutableSkills(): SkillConfig[] {
    if (!routerEnabled.value) return []
    const result: SkillConfig[] = [...getMySkills()]
    if (presetEnabled.value) {
      result.push(...getPresetSkills())
    }
    // 始终包含 superpower 搭子
    result.push(...SUPERPOWER_SKILLS)
    return result
  }

  // ─── 获取第二列显示的搭子（向后兼容，现在等同 getMySkills） ───
  function getUserSkills(): SkillConfig[] {
    return getMySkills()
  }

  // ─── 排序 ───
  type SortMode = 'name' | 'callCount'
  const sortMode = ref<SortMode>((localStorage.getItem('jc_sort_mode') as SortMode) || 'callCount')

  function setSortMode(mode: SortMode) {
    sortMode.value = mode
    localStorage.setItem('jc_sort_mode', mode)
  }

  function sortSkills(skills: SkillConfig[]): SkillConfig[] {
    if (sortMode.value === 'name') {
      return [...skills].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    }
    return [...skills].sort((a, b) => getCallCount(b.id) - getCallCount(a.id))
  }

  return {
    currentAgent,
    currentModel,
    superpowerEnabled,
    routerEnabled, // 向后兼容别名
    warehouseEnabled,
    presetEnabled,
    sortMode,
    migrationCount,
    agents,
    modelLabel,
    // ─── 动态模型系统 ───
    availableModels,
    modelsFetched,
    modelsFetchError,
    textModels,
    imageModels,
    videoModels,
    audioModels,
    fetchModels,
    // ─── 搭子管理 ───
    loadAgents,
    loadSkills,
    getCustomAgents,
    getCustomSkills,
    saveCustomAgents,
    saveCustomSkills,
    refreshSkills,
    selectAgent,
    setModel,
    restoreLastAgent,
    createAgent,
    updateSkill,
    deleteAgent,
    toggleSuperpower,
    toggleRouter, // 向后兼容别名
    toggleWarehouse,
    togglePresetEnabled,
    enableWarehouseSkill,
    disableWarehouseSkill,
    isWarehouseSkillEnabled,
    getMySkills,
    getPresetSkills,
    moveToMy,
    moveToPreset,
    isInMySkills,
    incrementCallCount,
    getCallCount,
    getRoutableSkills,
    getUserSkills,
    sortSkills,
    setSortMode,
    importFromText,
    importFromJSON,
    PRESETS: SKILL_PRESETS.concat(SUPERPOWER_SKILLS),
  }
})
