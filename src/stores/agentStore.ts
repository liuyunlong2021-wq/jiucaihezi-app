/**
 * stores/agentStore.ts — Skill管理 Store（SKILL.md 标准格式）
 *
 * 对齐标准：
 *   - official Skill SKILL.md frontmatter (name, description, triggers)
 *   - colleague-skill .skill 格式
 *   - PILL_MODELS (行 2754)
 */
import { defineStore } from 'pinia'
import { useFileStore } from '@/composables/useFileStore'
import { ref, computed } from 'vue'
import type { SkillConfig } from '../types/skill'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { migrateAgentToSkill, parseSkillMd } from '../types/skill'
import { SUPERPOWER_SKILLS } from '@/data/superpowerSkills'
import { gatewayModels } from '@/services/newApiClient'
import {
  LOCAL_MLX_API_BASE,
  LOCAL_MLX_PROVIDER_ID,
  LOCAL_OLLAMA_API_BASE,
  LOCAL_OLLAMA_PROVIDER_ID,
  getLocalOllamaModels,
  resolveModelProviderId,
  updateDefaultProviderModels,
} from '@/utils/providerConfig'
import { filterExecutableModels, resolveModelSelection } from '@/utils/modelSelection'

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
  /** 上下文窗口大小（tokens），用于 Token 水位计显示 */
  contextWindow?: number
}

/** 本地兜底默认模型（当 Gateway 模型列表拉取失败时使用） */
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
  { id: 'nano-banana-2k', label: '🎨 Nano Banana 2K', capability: 'image' },
  { id: 'nano-banana-4k', label: '🎨 Nano Banana 4K', capability: 'image' },
  { id: 'grok-video-3', label: '🎬 Grok Video', capability: 'video' },
  { id: 'veo3.1-fast', label: '🎬 Veo Fast', capability: 'video' },
  { id: 'suno-custom-song', label: '🎵 Suno 自定义歌曲', capability: 'audio' },
]

function loadLocalModelEntries(): ModelEntry[] {
  return getLocalOllamaModels().map(model => ({
    id: model.id,
    label: model.label || model.id,
    providerId: LOCAL_OLLAMA_PROVIDER_ID,
    capability: 'text' as const,
  }))
}

function mergeLocalModels(models: ModelEntry[]): ModelEntry[] {
  const localModels = loadLocalModelEntries()
  const localProviderIds = new Set([LOCAL_MLX_PROVIDER_ID, LOCAL_OLLAMA_PROVIDER_ID])
  if (localModels.length === 0) {
    return models.filter(model => !localProviderIds.has(model.providerId || ''))
  }

  const next = models.filter(model => !localProviderIds.has(model.providerId || ''))
  const seen = new Set(next.map(model => model.id))
  for (const model of localModels) {
    if (!seen.has(model.id)) next.push(model)
  }
  return next
}

function loadCachedModelEntries(): ModelEntry[] | null {
  try {
    const cached = localStorage.getItem('jc_models_cache')
    if (!cached) return null
    const parsed = JSON.parse(cached)
    const filtered = Array.isArray(parsed) ? filterExecutableModels(parsed) : []
    return filtered.length > 0 ? filtered : null
  } catch {
    return null
  }
}

/** 根据模型 ID 推断能力分类 */
function inferCapability(id: string): ModelEntry['capability'] {
  const lower = id.toLowerCase()
  if (/image|dall|midjourney|sd-|stable.?diff|flux/.test(lower)) return 'image'
  if (/video|veo|grok-video|rh-mimic|kling|runway|pika|luma/.test(lower)) return 'video'
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

// ─── 内置Skill：来自 anthropics/skills 的 17 个标准 Skill ───
// 全部通过 skill:// 协议从 public/skills/ 加载 SKILL.md
// source: 'preset' → 内置锁定，用户不可编辑，仅可使用

// 内置Skill共用的默认字段
const PRESET_DEFAULTS = {
  references: [] as string[],
  examples: [] as string[],
  createdAt: 0,
  updatedAt: 0,
  evolutionLog: [] as any[],
} as const

const SKILL_PRESETS: SkillConfig[] = [
  // ═══ 内容创作 ═══
  {
    id: 'preset_manhua-script-agent',
    name: '漫剧剧本生成器',
    description: '漫剧/短剧剧本智能生成。基于世界观+极致角色+催化剂→故事自然涌现。触发词：漫剧、短剧、剧本、爽剧、写剧本、网文、分集、角色设计',
    triggers: ['漫剧', '短剧', '剧本', '爽剧', '网文', '写剧本', '生成故事', '爽点', '催化剂', '分集', '角色设计', 'manhua', 'script', 'drama'],
    skillContent: 'skill://manhua-script-agent/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_narrato-docu',
    name: '影视解说工坊',
    description: '通用影视解说文案生成。黄金三秒法则+十大爆款钩子，输出带时间戳的结构化解说JSON。对照NarratoAI。触发词：影视解说、视频解说、写解说词、解说脚本',
    triggers: ['影视解说', '视频解说', '纪录片解说', '写解说词', '视频文案', '解说脚本', '解说文案', 'narrato', '纪录'],
    skillContent: 'skill://narrato-docu/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_narrato-short',
    name: '短剧解说工坊',
    description: '短剧/爽剧专用解说脚本生成。精通黄金开场、爽点放大、个性吐槽、悬念预埋、原声标记。对照NarratoAI。触发词：短剧解说、爽剧解说、短剧文案',
    triggers: ['短剧解说', '爽剧解说', '短剧文案', '剧情解说', '短剧脚本', '解说短剧', '爽剧文案', '黄金开场', '爽点放大'],
    skillContent: 'skill://narrato-short/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  // ═══ 创意与设计 ═══
  {
    id: 'preset_algorithmic-art',
    name: '算法艺术',
    description: '使用 p5.js 创建算法艺术，含种子随机和交互式参数探索。触发词：生成艺术、算法艺术、流场、粒子系统',
    triggers: ['生成艺术', '算法艺术', '流场', '粒子系统', 'generative art', 'algorithmic art', 'p5.js', 'creative coding'],
    skillContent: 'skill://algorithmic-art/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_brand-guidelines',
    name: '品牌指南',
    description: '应用品牌颜色和排版到任何产出物。当涉及品牌色彩、风格指南、视觉格式或公司设计标准时使用。',
    triggers: ['品牌', '品牌色', '风格指南', '视觉规范', 'brand', 'brand guidelines', '配色'],
    skillContent: 'skill://brand-guidelines/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_gpt-image-2-prompts',
    name: 'GPT Image 2 提示词大师',
    description: '基于 162+ 精选提示词的图像生成专家，覆盖 30+ 类别（人像、海报、电商、角色、UI、品牌VI、插画等）。帮你精准匹配模板并输出生产级 prompt。触发词：AI生图、GPT生图、图片生成、生成海报、生成人像、产品图、角色设计',
    triggers: ['AI生图', 'GPT生图', '图片生成', '生成海报', '生成人像', '产品图', '角色设计', 'gpt-image', 'image generation', '文生图', '图生图', '广告图', '电商图', 'UI设计', '品牌VI', '插画', '动漫图', '游戏画面', '信息图'],
    skillContent: 'skill://gpt-image-2-prompts/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_frontend-design',
    name: '前端设计',
    description: '创建独特的生产级前端界面，具有高设计质量。用于构建网页组件、页面、落地页、仪表板等。',
    triggers: ['网页', '前端', 'UI', 'landing page', 'dashboard', 'React', 'HTML', 'CSS', '网站', '界面'],
    skillContent: 'skill://frontend-design/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_slack-gif-creator',
    name: 'Slack GIF 制作',
    description: '创建为 Slack 优化的动画 GIF。触发词：GIF、动画、Slack、表情、动图',
    triggers: ['GIF', '动画', 'Slack', '表情', 'animated gif', '动图', 'emoji'],
    skillContent: 'skill://slack-gif-creator/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_theme-factory',
    name: '主题工厂',
    description: '为产出物应用主题样式（10个预设主题含颜色/字体）。触发词：主题、配色、字体、幻灯片美化',
    triggers: ['主题', '配色', '字体搭配', '样式', 'theme', 'style', '幻灯片美化', '文档美化', '配色方案'],
    skillContent: 'skill://theme-factory/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_web-artifacts-builder',
    name: 'Web 产出物构建',
    description: '使用 React + Tailwind + shadcn/ui 创建复杂多组件 HTML 产出物。',
    triggers: ['web artifact', 'html组件', 'React组件', 'shadcn', '前端组件', '网页应用', 'tailwind'],
    skillContent: 'skill://web-artifacts-builder/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ 开发与技术 ═══
  {
    id: 'preset_mcp-builder',
    name: 'MCP 服务器构建',
    description: '创建高质量 MCP 服务器使 LLM 通过工具与外部服务交互。支持 TypeScript 和 Python。',
    triggers: ['MCP', '模型上下文协议', 'mcp server', '工具服务器', 'tool server', 'API集成'],
    skillContent: 'skill://mcp-builder/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_skill-creator',
    name: '创建Skill',
    description: '创建新Skill、改进现有Skill、衡量Skill性能。用于Skill创建、评估、基准测试和描述优化。',
    triggers: ['创建技能', '编写skill', '优化skill', 'skill评估', 'skill creator', 'Skill设计'],
    skillContent: 'skill://skill-creator/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_skill-builder',
    name: 'Skill Builder',
    description: '从文档站、GitHub仓库、PDF、视频、代码库等知识源自动构建Skill。使用 Skill Seekers 工具链进行抓取、增强和打包。',
    triggers: ['从文档创建skill', '抓取文档', '构建skill', 'skill builder', '文档转换skill', 'GitHub转skill'],
    skillContent: 'skill://skill-builder/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_webapp-testing',
    name: 'Web 应用测试',
    description: '使用 Playwright 与本地 Web 应用交互和测试。支持验证前端功能、调试 UI、截图和查看日志。',
    triggers: ['测试', 'Playwright', '浏览器测试', 'UI测试', 'e2e', '网页测试', '自动化测试', 'web testing'],
    skillContent: 'skill://webapp-testing/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ 企业与沟通 ═══
  {
    id: 'preset_doc-coauthoring',
    name: '文档协作',
    description: '引导用户通过结构化工作流协作撰写文档。用于共同撰写文档、提案、技术规范等。',
    triggers: ['写文档', '共同撰写', '提案', '技术规范', 'doc', 'co-authoring', '协作写作'],
    skillContent: 'skill://doc-coauthoring/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_internal-comms',
    name: '内部沟通',
    description: '撰写各种内部沟通文档：状态报告、领导层更新、公司通讯、FAQ、项目更新等。',
    triggers: ['内部通讯', '状态报告', '公司通讯', 'FAQ', 'internal comms', '周报', '项目更新'],
    skillContent: 'skill://internal-comms/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ 文档技能（Office 文档生成/转换） ═══
  {
    id: 'preset_docx',
    name: 'Word 文档',
    description: '创建和编辑专业 Word 文档（.docx），含格式、样式、表格、图片等。触发词：Word、docx、文档',
    triggers: ['Word', 'docx', '文档', 'word文档', '.docx', '办公文档'],
    skillContent: 'skill://docx-office/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_pdf',
    name: 'PDF 文档',
    description: '创建和编辑 PDF 文档，含表单提取、页面操作、格式转换等。触发词：PDF、pdf文档',
    triggers: ['PDF', 'pdf', 'pdf文档', 'PDF处理', '.pdf'],
    skillContent: 'skill://pdf-office/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_pptx',
    name: 'PPT 演示',
    description: '创建和编辑 PowerPoint 演示文稿（.pptx），含幻灯片、布局、图表等。触发词：PPT、幻灯片、演示',
    triggers: ['PPT', 'pptx', '幻灯片', '演示', 'presentation', '.pptx', 'PowerPoint'],
    skillContent: 'skill://pptx-office/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_xlsx',
    name: 'Excel 表格',
    description: '创建和编辑 Excel 电子表格（.xlsx），含公式、图表、数据透视表等。触发词：Excel、表格、xlsx',
    triggers: ['Excel', 'xlsx', '表格', '电子表格', 'spreadsheet', '.xlsx', '数据'],
    skillContent: 'skill://xlsx-office/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ AI 媒体生成 — 视频提示词 ═══
  {
    id: 'preset_grok-video-prompt',
    name: 'Grok 视频提示词',
    description: '将镜头设计结果转换为 Grok 视频生成提示词。触发词：Grok视频、grok video、视频生成提示词',
    triggers: ['Grok视频', 'grok video', 'grok-video', '视频生成', 'AI视频'],
    skillContent: 'skill://grok-video-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_veo-video-prompt',
    name: 'Veo 视频提示词',
    description: '将镜头设计结果转换为 Veo 图生视频/首尾帧生视频提示词。触发词：Veo视频、veo video',
    triggers: ['Veo视频', 'veo video', 'veo-video', '图生视频', '首尾帧'],
    skillContent: 'skill://veo-video-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_ltx-video-action',
    name: 'LTX 视频动作',
    description: '将镜头设计结果转换为 LTX 2.3 图生视频提示词。触发词：LTX、ltx video、动作生成',
    triggers: ['LTX', 'ltx video', 'ltx-video', '动作视频'],
    skillContent: 'skill://ltx-video-action/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_video-composer',
    name: '视频合成器',
    description: '拼接视频片段并添加字幕。触发词：视频合成、拼接视频、加字幕、视频剪辑',
    triggers: ['视频合成', '拼接视频', '加字幕', '视频剪辑', '视频合并', 'video compose'],
    skillContent: 'skill://video-composer/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_voice-bound-shot-video',
    name: '声绑镜头视频',
    description: '从首帧图+动作标签+配音音频生成单人对话/特写镜头视频。触发词：配音视频、对口型、声画同步',
    triggers: ['配音视频', '对口型', '声画同步', 'voice bound', 'talking head'],
    skillContent: 'skill://voice-bound-shot-video/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ 影视制作管线（Banana/Veo 短剧流水线） ═══
  {
    id: 'preset_film-type-analysis',
    name: '影片类型分析',
    description: '启动新影视项目时提供多种风格选项供选择。触发词：影片类型、剧集风格、电影类型分析',
    triggers: ['影片类型', '剧集风格', '电影分析', 'film type', '类型片', '风格选择'],
    skillContent: 'skill://film-type-analysis/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_film-character-asset',
    name: '角色资产分析',
    description: '分析剧本角色，输出双层角色资产规格（Banana/Veo 短剧流水线）。触发词：角色分析、人物设定、角色资产',
    triggers: ['角色分析', '人物设定', '角色资产', 'character asset', '角色卡'],
    skillContent: 'skill://film-character-asset/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_film-prop-asset',
    name: '道具资产分析',
    description: '分析剧本道具，输出双层道具资产规格。触发词：道具分析、道具设定、道具清单',
    triggers: ['道具分析', '道具设定', '道具清单', 'prop asset', '物品分析'],
    skillContent: 'skill://film-prop-asset/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_film-scene-asset',
    name: '场景资产分析',
    description: '将剧本场景转换为空镜主图场景资产。触发词：场景分析、场景设定、场景资产',
    triggers: ['场景分析', '场景设定', '场景资产', 'scene asset', '空镜'],
    skillContent: 'skill://film-scene-asset/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_film-engineering-book',
    name: '影视工程手册',
    description: '将原始剧本转换为镜头设计前的物料工程手册。触发词：工程手册、剧本拆解、分镜前准备',
    triggers: ['工程手册', '剧本拆解', 'engineering book', '物料清单', '分镜准备'],
    skillContent: 'skill://film-engineering-book/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_film-shot-design',
    name: '镜头设计',
    description: '将剧本+工程手册转换为可执行的镜头设计方案。触发词：镜头设计、分镜、shot design、故事板',
    triggers: ['镜头设计', '分镜', 'shot design', '故事板', '分镜头', '拍摄方案'],
    skillContent: 'skill://film-shot-design/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ Banana 图像生成提示词系列 ═══
  {
    id: 'preset_banana-character-prompt',
    name: 'Banana 角色提示词',
    description: '将角色分析结果转换为 Banana/Nano Banana Pro 图生图 JSON 提示词。触发词：banana角色、角色生图',
    triggers: ['banana角色', '角色生图', 'banana character', '角色转图'],
    skillContent: 'skill://banana-character-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_banana-prop-prompt',
    name: 'Banana 道具提示词',
    description: '将道具分析结果转换为 Banana/Nano Banana Pro JSON 提示词。触发词：banana道具、道具生图',
    triggers: ['banana道具', '道具生图', 'banana prop', '道具转图'],
    skillContent: 'skill://banana-prop-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_banana-scene-prompt',
    name: 'Banana 场景提示词',
    description: '将场景分析结果转换为 Banana/Nano Banana Pro JSON 提示词。触发词：banana场景、场景生图',
    triggers: ['banana场景', '场景生图', 'banana scene', '场景转图'],
    skillContent: 'skill://banana-scene-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_banana-grid-shot-prompt',
    name: 'Banana 网格镜头',
    description: '将镜头设计转换为 Banana 3×3 故事板网格 JSON 提示词。触发词：banana网格、3x3故事板、九宫格',
    triggers: ['banana网格', '3x3', '九宫格', 'grid shot', '故事板网格'],
    skillContent: 'skill://banana-grid-shot-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
  {
    id: 'preset_banana-storyboard-edit-prompt',
    name: 'Banana 故事板编辑',
    description: '将拆分后的故事板分镜图用 Nano Banana Pro 进行图生图编辑。触发词：故事板编辑、分镜编辑、banana edit',
    triggers: ['故事板编辑', '分镜编辑', 'banana edit', '图生图编辑', 'storyboard edit'],
    skillContent: 'skill://banana-storyboard-edit-prompt/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },

  // ═══ 音频 ═══
  {
    id: 'preset_qwen-tts-voice-design',
    name: '通义 TTS 声音设计',
    description: '将剧本台词/角色信息转换为 Qwen TTS 声音设计提示词。触发词：TTS、语音合成、配音、声音设计',
    triggers: ['TTS', '语音合成', '配音', '声音设计', 'qwen tts', '文字转语音', 'AI配音'],
    skillContent: 'skill://qwen-tts-voice-design/SKILL.md',
    source: 'preset', tier: 'L1', version: 1,
    ...PRESET_DEFAULTS,
  },
]

export const useAgentStore = defineStore('agents', () => {
  const currentAgent = ref<SkillConfig | null>(null)
  const currentModel = ref(localStorage.getItem('jcModel') || 'claude-sonnet-4-6')

  // ─── 动态模型系统 ───
  /** 响应式模型列表：初始化为本地兜底，Gateway /api/models 成功后替换 */
  const availableModels = ref<ModelEntry[]>(mergeLocalModels(loadCachedModelEntries() || [...DEFAULT_MODELS]))
  const modelsFetched = ref(false)
  const modelsFetchError = ref('')

  function syncModelProviderStorage(modelId = currentModel.value, explicitProviderId?: string) {
    const model = availableModels.value.find(x => x.id === modelId) || modelId
    const providerId = explicitProviderId || resolveModelProviderId(model)
    localStorage.setItem('jcModelProviderId', providerId)
    if (providerId === LOCAL_MLX_PROVIDER_ID) {
      localStorage.setItem('jcLocalMlxApiBase', LOCAL_MLX_API_BASE)
    } else if (providerId === LOCAL_OLLAMA_PROVIDER_ID) {
      localStorage.setItem('jcLocalOllamaApiBase', LOCAL_OLLAMA_API_BASE)
    } else {
      localStorage.setItem('jcApiBase', 'https://api.jiucaihezi.studio')
    }
    return providerId
  }

  /** 按能力分类的视图 */
  const textModels = computed(() => availableModels.value.filter(m => (m.capability || 'text') === 'text'))
  const imageModels = computed(() => availableModels.value.filter(m => m.capability === 'image'))
  const videoModels = computed(() => availableModels.value.filter(m => m.capability === 'video'))
  const audioModels = computed(() => availableModels.value.filter(m => m.capability === 'audio'))

  /**
   * 静默拉取 Gateway /api/models，成功后合并到 availableModels。
   * 策略：Gateway 返回用户可用模型；本地 Ollama/MLX 模型仍单独合并。
   */
  async function fetchModels() {
    try {
      const data = await gatewayModels()
      if (!Array.isArray(data) || data.length === 0) return

      const defaultMap = new Map(DEFAULT_MODELS.map(m => [m.id, m]))

      const merged: ModelEntry[] = filterExecutableModels(data.map((item: any) => {
        const id = item.id || item.model || ''
        if (!id) return null
        const existing = defaultMap.get(id)
        const providerId = item.providerId || 'jiucaihezi'
        return {
          id,
          label: existing?.label || item.label || item.name || id.split('/').pop() || id,
          providerId,
          capability: existing?.capability || item.capability || inferCapability(id),
          contextWindow: getModelContextWindow(id, providerId),
        }
      }).filter(Boolean) as ModelEntry[])

      // 只显示用户 Key 实际可用的模型，不强制回填默认列表
      availableModels.value = mergeLocalModels(merged)
      const resolvedModel = resolveModelSelection(currentModel.value, availableModels.value)
      if (resolvedModel !== currentModel.value) {
        setModel(resolvedModel)
      } else {
        syncModelProviderStorage()
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
          const filtered = Array.isArray(parsed) ? filterExecutableModels(parsed) : []
          if (filtered.length > 0) {
            availableModels.value = mergeLocalModels(filtered)
            const resolvedModel = resolveModelSelection(currentModel.value, availableModels.value)
            if (resolvedModel !== currentModel.value) setModel(resolvedModel)
            else syncModelProviderStorage()
            modelsFetched.value = true
          }
        }
      } catch { /* noop */ }
    }
  }

  const initialResolvedModel = resolveModelSelection(currentModel.value, availableModels.value)
  if (initialResolvedModel !== currentModel.value) {
    setModel(initialResolvedModel)
  } else {
    syncModelProviderStorage()
  }

  function refreshLocalModels() {
    availableModels.value = mergeLocalModels(availableModels.value)
    const model = availableModels.value.find(x => x.id === currentModel.value)
    if (!model) {
      setModel(resolveModelSelection(currentModel.value, availableModels.value))
      return
    }
    syncModelProviderStorage()
  }

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
      'daziList',               // SkillStudio
      'dazi_agents',            // SkillStudio 另一个 key
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

          const name = item.name || item.label || item.title || '旧Skill'
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

  // ─── 粘贴即导入 — 纯文本系统提示词 → SkillConfig ───
  function importFromText(text: string, name?: string): SkillConfig | null {
    const trimmed = text.trim()
    if (!trimmed) return null

    // 尝试判断是否是 SKILL.md 格式
    if (trimmed.startsWith('---\n')) {
      const parsed = parseSkillMd(trimmed)
      const skill: SkillConfig = {
        id: parsed.id || 'paste_' + Date.now().toString(36),
        name: parsed.name || name || '粘贴Skill',
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
        const name = item.name || item.label || '导入Skill'
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
    return '导入Skill ' + new Date().toLocaleDateString('zh-CN')
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
   * BUG-10 修复: 17个 preset Skill的 skillContent 是 skill:// 路径，
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
      if (currentAgent.value?.id === skill.id) {
        currentAgent.value = { ...currentAgent.value, skillContent: text }
      }
      // 触发 agents 列表刷新
      _skillsVersion.value++
    }).catch(() => {
      // 加载失败时用 skill 描述作为兜底
      skillContentCache.set(skill.id, fallback)
      if (currentAgent.value?.id === skill.id) {
        currentAgent.value = { ...currentAgent.value, skillContent: fallback }
      }
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

    // BUG-5 修复: preset Skill的用户修改也存在 custom 中（通过 id 覆盖）
    const customIds = new Set(custom.map(c => c.id))
    const presets = SKILL_PRESETS.concat(SUPERPOWER_SKILLS)
      .filter(p => !customIds.has(p.id))  // custom 中有同 id 的则用 custom 版本

    // BUG-10 修复: 解析 skill:// 协议路径
    const all = [...presets, ...custom]
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

  function setModel(modelId: string, providerId?: string) {
    currentModel.value = modelId
    localStorage.setItem('jcModel', modelId)
    syncModelProviderStorage(modelId, providerId)
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

  // BUG-5 修复: preset Skill的修改也要持久化（存为 custom 覆盖版本）
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
      // preset Skill首次修改 → 添加到 custom 中覆盖
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

  // ─── 我的Skill：用户主动添加的Skill列表 ───
  function getMySkills(): SkillConfig[] {
    void _skillsVersion.value // 响应式依赖：moveToMy/moveToPreset 触发刷新
    let myIds: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')

    // 兼容迁移：如果 jc_my_skills 为空但有自建Skill，自动迁移
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
      _skillsVersion.value++ // 触发 SkillPickerBar / FileTree 刷新

      // 同步到 FileStore: 创建Skill物理文件夹
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
    _skillsVersion.value++ // 触发 SkillPickerBar / FileTree 刷新
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

  // ─── 内置Skill判断：source 非 user 即为内置（不可查看 SKILL.md 内容） ───
  function isBuiltinSkill(id: string): boolean {
    const all = loadSkills()
    const skill = all.find(s => s.id === id)
    if (!skill) return false
    return skill.source !== 'user'
  }

  function getSkillById(id: string): SkillConfig | undefined {
    return loadSkills().find(s => s.id === id)
  }

  // ─── 获取内置Skill（不在"我的Skill"中的预设） ───
  function getPresetSkills(): SkillConfig[] {
    const myIds: string[] = JSON.parse(localStorage.getItem('jc_my_skills') || '[]')
    const presets = SKILL_PRESETS.filter(p => !myIds.includes(p.id))
    const supers = SUPERPOWER_SKILLS.filter(s => !myIds.includes(s.id))
    return [...presets, ...supers]
  }

  // ─── 启用/禁用仓库Skill（保留向后兼容） ───
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

  // ─── 获取第二列显示的Skill（向后兼容，现在等同 getMySkills） ───
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
    refreshLocalModels,
    // ─── Skill管理 ───
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
    isBuiltinSkill,
    getSkillById,
    incrementCallCount,
    getCallCount,
    getUserSkills,
    sortSkills,
    setSortMode,
    importFromText,
    importFromJSON,
    PRESETS: SKILL_PRESETS.concat(SUPERPOWER_SKILLS),
  }
})
