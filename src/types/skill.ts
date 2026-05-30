/**
 * types/skill.ts — SKILL.md 标准格式类型定义
 *
 * 对齐标准：
 *   - official Skill: skills/{name}/SKILL.md (frontmatter + body)
 *   - colleague-skill: .skill 格式 (persona + work)
 *   - karpathy-llm-wiki: raw/ + wiki/ 编译模型
 *   - darwin-skill: evaluate → improve → test → keep/revert
 */

/* ─── SKILL.md frontmatter ─── */
export interface SkillFrontmatter {
  name: string
  description: string      // 官方 Skill 标准：描述适用场景 + 职责
  triggers: string[]        // 用户可见的搜索/筛选关键词
}

/* ─── 进化日志（darwin-skill） ─── */
export interface EvolutionEntry {
  version: number
  timestamp: number
  previousSkillContent: string   // 旧版 SKILL.md body（回滚用）
  changesSummary: string         // 本次变更摘要
  source: 'brain' | 'manual' | 'import'  // 变更来源
}

/* ─── 知识库条目（karpathy-llm-wiki 完全体） ─── */
export interface BrainRawEntry {
  id: string
  skillId: string
  vaultId?: string
  sessionId?: string
  sourceMessageIds?: string[]
  content: string        // 对话原文（immutable source material）
  timestamp: number
  indexed: boolean       // 是否已编译进 wiki
  // karpathy-wiki 完全体字段
  sourceUrl?: string     // 来源 URL
  collectedAt: number    // 收集时间
  publishedAt?: number   // 发布时间（来源的原始发布日期）
  topic: string          // 主题分类（raw/<topic>/ 对应）
}

export interface BrainWikiPage {
  id: string
  skillId: string
  vaultId?: string
  title: string
  content: string        // 编译后的知识页
  sources: string[]      // 来源 raw entry IDs
  updatedAt: number
  // karpathy-wiki 完全体字段
  topic: string          // 主题分类（wiki/<topic>/ 对应）
  seeAlso: string[]      // 交叉引用的其他 wiki page IDs
  archived: boolean      // 是否为归档页（query 归档，不参与级联更新）
  conflicts: string[]    // 冲突标注（与哪些页面有事实分歧）
}

/* ─── wiki/index.md 虚拟结构 ─── */
export interface WikiIndexEntry {
  pageId: string
  title: string
  topic: string
  summary: string
  updatedAt: number
  missing?: boolean      // lint 标记: 文件缺失
}

/* ─── wiki/log.md 虚拟结构 ─── */
export interface WikiLogEntry {
  id: string
  timestamp: number
  operation: 'ingest' | 'query' | 'lint' | 'archive' | 'cascade'
  description: string
  affectedPages: string[] // 受影响的 wiki page IDs
}

/* ─── 完整 SkillConfig ─── */
export interface SkillConfig {
  // ─── SKILL.md frontmatter ───
  name: string
  description: string
  triggers: string[]

  // ─── SKILL.md body ───
  skillContent: string   // 完整的 SKILL.md body（角色定义/工作流程/输出格式/示例/参考资料）

  // ─── 知识库（karpathy-llm-wiki） ───
  references: string[]   // 参考资料 URL/文本
  examples: string[]     // 示例对话/标准答案

  // ─── 元信息 ───
  id: string
  version: number
  source: 'preset' | 'user' | 'github' | 'evolved' | 'superpower'
  githubUrl?: string
  createdAt: number
  updatedAt: number
  evolutionLog: EvolutionEntry[]

  // ─── 用户可见信息 ───
  oneLineDesc?: string   // 一句话功能介绍
  category?: SkillCategory // 搭子分类
  enabled?: boolean      // 是否在工作台中可用
  callCount?: number     // 调用次数
  contextCount?: number   // 上下文保留消息条数（默认 20）
  tier?: 'L1' | 'L2'      // 旧兼容字段；产品架构以 Skill + Connection 为准
  agentConfig?: {          // 旧兼容字段；组合关系由 Connection 承担
    skills: { skillId: string; role: string; phase: number }[]
    hardGate: boolean
    autoTrigger: boolean
  }
}

/* ─── 搭子分类 ─── */
export type SkillCategory =
  | 'writing'     // 写作文案
  | 'analysis'    // 分析研究
  | 'creative'    // 创意设计
  | 'coding'      // 编程开发
  | 'business'    // 商业办公
  | 'learning'    // 学习教育
  | 'lifestyle'   // 生活工具
  | 'other'       // 其他

export const SKILL_CATEGORIES: { id: SkillCategory; name: string; icon: string }[] = [
  { id: 'writing',   name: '写作文案', icon: 'edit_note' },
  { id: 'analysis',  name: '分析研究', icon: 'analytics' },
  { id: 'creative',  name: '创意设计', icon: 'palette' },
  { id: 'coding',    name: '编程开发', icon: 'code' },
  { id: 'business',  name: '商业办公', icon: 'business_center' },
  { id: 'learning',  name: '学习教育', icon: 'school' },
  { id: 'lifestyle', name: '生活工具', icon: 'home' },
  { id: 'other',     name: '其他',     icon: 'widgets' },
]

/* ─── 从旧 Agent 格式迁移 ─── */
export function migrateAgentToSkill(agent: {
  id: string
  name: string
  icon?: string
  systemPrompt?: string
  folder?: string
  source?: string
}): SkillConfig {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.systemPrompt
      ? agent.systemPrompt.slice(0, 120) + '...'
      : `${agent.name} 搭子`,
    triggers: [agent.name],
    skillContent: agent.systemPrompt || '',
    references: [],
    examples: [],
    version: 1,
    source: (agent.source as SkillConfig['source']) || 'preset',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    evolutionLog: [],
  }
}

/**
 * 将 SkillConfig 序列化为标准 SKILL.md 文本
 * 对齐 official Skill 的 skills/{name}/SKILL.md 格式
 */
export function serializeToSkillMd(skill: SkillConfig): string {
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `description: "${skill.description}"`,
    `triggers:`,
    ...skill.triggers.map(t => `  - ${t}`),
    '---',
  ].join('\n')

  return `${frontmatter}\n\n${skill.skillContent}`
}

/**
 * 从 SKILL.md 文本解析为 SkillConfig（GitHub 导入用）
 */
export function parseSkillMd(text: string, id?: string): Partial<SkillConfig> {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/)
  const body = text.replace(/^---\n[\s\S]*?\n---\n*/, '').trim()

  let name = ''
  let description = ''
  let triggers: string[] = []

  if (fmMatch) {
    const fm = fmMatch[1]
    const nameMatch = fm.match(/^name:\s*(.+)$/m)
    const descMatch = fm.match(/^description:\s*"?(.+?)"?\s*$/m)
    const triggerLines = fm.match(/^triggers:\n((?:\s+-\s+.+\n?)*)/m)

    if (nameMatch) name = nameMatch[1].trim()
    if (descMatch) description = descMatch[1].trim()
    if (triggerLines) {
      triggers = triggerLines[1]
        .split('\n')
        .map(l => l.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean)
    }
  }

  return {
    id: id || 'imported_' + Date.now().toString(36),
    name: name || 'Imported Skill',
    description,
    triggers,
    skillContent: body,
    references: [],
    examples: [],
    version: 1,
    source: 'github',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    evolutionLog: [],
  }
}
