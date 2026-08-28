import type { WikiOperation } from '@/runtime/direct/wikiRuntime'

export interface WikiReadPlanItem {
  path: string
  reason: string
}

export interface WikiReadPlan {
  paths: WikiReadPlanItem[]
  missing: string[]
  sufficient: boolean
}

export interface WikiIndexChange {
  directory: string
  path: string
  title: string
  action: 'add' | 'remove'
}

export interface WikiChangePlan {
  reason: string
  basis: string[]
  operations: WikiOperation[]
  indexChanges: WikiIndexChange[]
}

export interface WikiSynthesisAndChangePlan {
  answer: string
  changePlan: WikiChangePlan | null
}

export const WIKI_READ_PLAN_SYSTEM_PROMPT = [
  '你是 WikiReadPlan 规划器。只输出合法 JSON，不要 Markdown 或解释。',
  '根据当前任务和 Wiki 根入口，选择完成任务所必需的最少 Markdown 页面。',
  '已选 Skill（如果有）只提供方法、格式和质量规则；不要把 Skill 规则当作 Wiki 事实，也不要要求 Wiki 采用某种领域结构。',
  '优先使用入口声明的直属路径；不得凭常识猜路径，不得请求整个目录或全库。',
  '路径必须唯一；资料不足时写入 missing，并将 sufficient 设为 false。',
  '输出格式：{"paths":[{"path":"相对路径.md","reason":"简短原因"}],"missing":[],"sufficient":true}',
].join('\n')

export const WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT = [
  '你是 WikiSynthesisAndChangePlan 规划器。只输出合法 JSON，不要 Markdown 或解释。',
  '只能依据实际读取的 Wiki 内容、用户任务和已选 Skill/MCP 结果回答，不得补造项目事实。',
  '已选 Skill（如果有）负责本任务的方法、格式和质量规则；Wiki 只负责事实、页面组织和确定性落盘。Skill 规则不是 Wiki 事实。',
  '只读任务将 changePlan 设为 null；任何 Wiki 写入、创建、更新、移动、整理或删除都必须给出完整 changePlan。',
  'changePlan 必须包含 reason、basis、operations、indexChanges；触及任何目录都必须声明对应 index.md 变化。',
  '输出格式：{"answer":"最终回答","changePlan":null或{"reason":"...","basis":["..."],"operations":[],"indexChanges":[]}}',
].join('\n')

export const WIKI_READ_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['paths', 'missing', 'sufficient'],
  properties: {
    paths: {
      type: 'array',
      minItems: 0,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'reason'],
        properties: { path: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    missing: { type: 'array', maxItems: 12, items: { type: 'string' } },
    sufficient: { type: 'boolean' },
  },
} as const

export const WIKI_SYNTHESIS_CHANGE_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'changePlan'],
  properties: {
    answer: { type: 'string' },
    changePlan: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['reason', 'basis', 'operations', 'indexChanges'],
          properties: {
            reason: { type: 'string' },
            basis: { type: 'array', items: { type: 'string' } },
            operations: { type: 'array', maxItems: 200, items: { type: 'object' } },
            indexChanges: { type: 'array', items: { type: 'object' } },
          },
        },
      ],
    },
  },
} as const

const PATH = /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0).+$/
const OPERATION_KINDS = new Set(['mkdir', 'create', 'replace', 'append', 'move', 'trash'])

function parseJsonObject(input: string, label: string): Record<string, unknown> {
  const text = String(input || '').trim()
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  let value: unknown
  try {
    value = JSON.parse(fenced?.[1] || text)
  } catch {
    throw new Error(`${label} 必须是合法 JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`)
  return value.trim()
}

function stringArray(value: unknown, field: string, max = 200): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim()))
    throw new Error(`${field} 必须是非空字符串数组`)
  return value.map(item => String(item).trim())
}

function validatePath(value: unknown, field: string): string {
  const path = text(value, field).replace(/\\/g, '/')
  if (!PATH.test(path)) throw new Error(`${field} 必须是项目内相对路径`)
  return path
}

export function parseWikiReadPlan(input: string): WikiReadPlan {
  const value = parseJsonObject(input, 'WikiReadPlan')
  if (!Array.isArray(value.paths) || value.paths.length > 12) throw new Error('ReadPlan paths 最多 12 项')
  if (typeof value.sufficient !== 'boolean') throw new Error('ReadPlan sufficient 必须是布尔值')
  const missing = stringArray(value.missing, 'ReadPlan missing', 12)
  const seen = new Set<string>()
  const paths = value.paths.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`ReadPlan paths[${index}] 无效`)
    const row = item as Record<string, unknown>
    const path = validatePath(row.path, `ReadPlan paths[${index}].path`)
    if (seen.has(path)) throw new Error(`ReadPlan 路径重复: ${path}`)
    seen.add(path)
    return { path, reason: text(row.reason, `ReadPlan paths[${index}].reason`) }
  })
  return { paths, missing, sufficient: value.sufficient }
}

function parseOperations(value: unknown): WikiOperation[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('changePlan operations 最多 200 项')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`operations[${index}] 无效`)
    const row = item as Record<string, unknown>
    const kind = text(row.kind, `operations[${index}].kind`)
    if (!OPERATION_KINDS.has(kind)) throw new Error(`不支持的 Wiki 操作: ${kind}`)
    validatePath(row.path, `operations[${index}].path`)
    if (kind === 'mkdir') text(row.purpose, `operations[${index}].purpose`)
    if (kind === 'create') {
      text(row.title, `operations[${index}].title`)
      if (typeof row.content !== 'string') throw new Error(`operations[${index}].content 必须是字符串`)
    }
    if (kind === 'replace') {
      text(row.oldText, `operations[${index}].oldText`)
      if (typeof row.newText !== 'string') throw new Error(`operations[${index}].newText 必须是字符串`)
    }
    if (kind === 'append') {
      if (typeof row.content !== 'string') throw new Error(`operations[${index}].content 必须是字符串`)
      text(row.idempotencyKey, `operations[${index}].idempotencyKey`)
    }
    if (kind === 'move') validatePath(row.destination, `operations[${index}].destination`)
    return row as WikiOperation
  })
}

function parseIndexChanges(value: unknown): WikiIndexChange[] {
  if (!Array.isArray(value)) throw new Error('changePlan indexChanges 必须是数组')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`indexChanges[${index}] 无效`)
    const row = item as Record<string, unknown>
    const action = text(row.action, `indexChanges[${index}].action`)
    if (action !== 'add' && action !== 'remove') throw new Error(`indexChanges[${index}].action 无效`)
    return {
      directory: validatePath(row.directory, `indexChanges[${index}].directory`),
      path: validatePath(row.path, `indexChanges[${index}].path`),
      title: text(row.title, `indexChanges[${index}].title`),
      action,
    }
  })
}

export function parseWikiSynthesisAndChangePlan(input: string): WikiSynthesisAndChangePlan {
  const value = parseJsonObject(input, 'WikiSynthesisAndChangePlan')
  const answer = text(value.answer, 'answer')
  if (value.changePlan == null) return { answer, changePlan: null }
  if (!value.changePlan || typeof value.changePlan !== 'object' || Array.isArray(value.changePlan))
    throw new Error('changePlan 必须是对象或 null')
  const plan = value.changePlan as Record<string, unknown>
  return {
    answer,
    changePlan: {
      reason: text(plan.reason, 'changePlan.reason'),
      basis: stringArray(plan.basis, 'changePlan.basis'),
      operations: parseOperations(plan.operations),
      indexChanges: parseIndexChanges(plan.indexChanges),
    },
  }
}
