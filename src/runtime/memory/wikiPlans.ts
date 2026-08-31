import type { WikiOperation } from '@/runtime/direct/wikiRuntime'

export interface WikiReadPlanItem {
  path: string
  reason: string
}

export interface WikiReadPlan {
  paths: WikiReadPlanItem[]
  missing: string[]
  sufficient: boolean
  status?: 'need_more' | 'complete'
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

export type WikiAgentStep =
  | { kind: 'read'; plan: WikiReadPlan }
  | { kind: 'final'; plan: WikiSynthesisAndChangePlan }

export const WIKI_READ_PLAN_SYSTEM_PROMPT = [
  '你正在按用户已选 Skill 完成任务。只输出一个最小 JSON 对象，不要 Markdown、思考过程或解释。',
  '当前输入已经包含任务、必要对话、完整 Skill、Wiki 根 index 和已读取的真实资料。Skill 是业务规则核心，Wiki 只提供事实。',
  '如果还缺 Wiki 资料，只输出 {"paths":["直属路径.md"]}；程序会读取后再次交给你。',
  '如果现有资料已经足够，直接完成任务并输出 {"answer":"给用户的最终结果","actions":[]}。需要修改 Wiki 时，actions 只写最小语义动作，例如 {"kind":"write","path":"日记/2026/0830.md","content":"正文"}。',
  '程序负责把 actions 补成完整事务，维护 title、reason、basis、幂等键、索引、双链、来源、日志、验证和 Receipt；不要输出这些程序字段。',
  '默认每轮只选择当前已读 index.md 声明的直属路径；但已选 Skill 或用户明确给出的 Wiki 根内路径属于直接读取授权，可以直接读取，不受 index 链接层级限制。不得请求整个目录或全库，路径越过 Wiki 根目录必须拒绝。',
  '程序会如实返回页面内容、空内容、不存在、读取失败或缺少 index.md；这些都是观察结果，不是任务失败。',
  '不要输出空 paths；资料足够或没有合法下一层时必须直接输出 answer 和 actions。',
].join('\n')

export const WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT = [
  '你正在按用户已选 Skill 完成任务。只输出一个最小 JSON 对象，不要 Markdown、思考过程或解释。',
  '只能依据实际读取的 Wiki 内容、用户任务和已选 Skill/MCP 结果回答，不得补造项目事实。',
  '如果资料中出现“目录包含文件但缺少 index.md”或路径不存在/读取失败，必须在回答中明确告知用户本次未读取的真实范围。',
  '已选 Skill（如果有）负责本任务的方法、格式和质量规则；Wiki 只负责事实、页面组织和确定性落盘。Skill 规则不是 Wiki 事实。',
  '当用户说“上面/以上/上一条回答/前文”并要求填入、记录、沉淀、保存或归档 Wiki 时，最近一条 assistant 消息就是待整理正文；必须直接整理该正文并输出可执行 changePlan，不要仅索要用户再次粘贴内容。只有对话中确实没有可用正文时，才说明缺少内容。',
  'Wiki 为空、资料缺失、读取失败或达到读取熔断都不能阻止回答；需要写入时仍按用户任务输出合法 changePlan，不要根据资料覆盖率自行取消操作。',
  '输出 {"answer":"给用户的最终结果","actions":[]}；需要写入时 actions 只描述实际变更，不要输出 changePlan、reason、basis、indexChanges、双链、日志或目录维护计划，这些由程序自动补齐。',
  '不要对任何 index.md 或 _index.md 提交 replace、append、move 或 trash；入口导航、重复链接、双链、日志和来源由程序自动维护。',
  '每个动作使用最小格式：write 需要 path/content；edit 需要 path/oldText/newText；append 需要 path/content；move 需要 path/destination；delete 需要 path。',
].join('\n')

export const WIKI_READ_PLAN_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['paths'],
      properties: { paths: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'actions'],
      properties: {
        answer: { type: 'string' },
        actions: { type: 'array', maxItems: 200, items: { type: 'object' } },
      },
    },
  ],
} as const

export const WIKI_SYNTHESIS_CHANGE_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'actions'],
  properties: {
    answer: { type: 'string' },
    actions: { type: 'array', maxItems: 200, items: { type: 'object' } },
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
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} 必须是 JSON 对象`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`)
  return value.trim()
}

function stringArray(value: unknown, field: string, max = 200): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some(item => typeof item !== 'string' || !item.trim())
  )
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
  if (!Array.isArray(value.paths) || value.paths.length > 12)
    throw new Error('ReadPlan paths 最多 12 项')
  const simplePaths = value.paths.every(item => typeof item === 'string')
  if (
    !simplePaths &&
    typeof value.sufficient !== 'boolean' &&
    value.status !== 'need_more' &&
    value.status !== 'complete'
  )
    throw new Error('ReadPlan sufficient/status 无效')
  const status = value.status === 'need_more' || value.status === 'complete'
    ? value.status
    : value.sufficient || value.done ? 'complete' : 'need_more'
  const missing = value.missing == null ? [] : stringArray(value.missing, 'ReadPlan missing', 12)
  const seen = new Set<string>()
  const paths = value.paths.map((item, index) => {
    if (typeof item === 'string') {
      const path = validatePath(item, `ReadPlan paths[${index}]`)
      if (seen.has(path)) throw new Error(`ReadPlan 路径重复: ${path}`)
      seen.add(path)
      return { path, reason: '完成任务所需资料' }
    }
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`ReadPlan paths[${index}] 无效`)
    const row = item as Record<string, unknown>
    const path = validatePath(row.path, `ReadPlan paths[${index}].path`)
    if (seen.has(path)) throw new Error(`ReadPlan 路径重复: ${path}`)
    seen.add(path)
    return { path, reason: text(row.reason, `ReadPlan paths[${index}].reason`) }
  })
  return { paths, missing, sufficient: status === 'complete', status }
}

function parseOperations(value: unknown): WikiOperation[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error('changePlan operations 最多 200 项')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`operations[${index}] 无效`)
    const row = item as Record<string, unknown>
    const requestedKind = row.kind || row.action
    const inferredKind =
      requestedKind === 'write'
        ? row.oldText || row.oldString
          ? 'replace'
          : 'create'
        : requestedKind === 'edit'
          ? 'replace'
          : requestedKind === 'delete'
            ? 'trash'
        : requestedKind ||
          (typeof row.content === 'string' && !row.oldText && !row.destination
            ? 'create'
            : undefined)
    const kind = text(inferredKind, `operations[${index}].kind`)
    if (!OPERATION_KINDS.has(kind)) throw new Error(`不支持的 Wiki 操作: ${kind}`)
    const path = validatePath(row.path, `operations[${index}].path`)
    if (kind === 'mkdir') text(row.purpose, `operations[${index}].purpose`)
    if (kind === 'create') {
      row.title = typeof row.title === 'string' && row.title.trim()
        ? row.title.trim()
        : path.split('/').at(-1)!.replace(/\.md$/i, '')
      if (typeof row.content !== 'string')
        throw new Error(`operations[${index}].content 必须是字符串`)
    }
    if (kind === 'replace') {
      row.oldText ??= row.oldString
      row.newText ??= row.newString
      text(row.oldText, `operations[${index}].oldText`)
      if (typeof row.newText !== 'string')
        throw new Error(`operations[${index}].newText 必须是字符串`)
    }
    if (kind === 'append') {
      if (typeof row.content !== 'string')
        throw new Error(`operations[${index}].content 必须是字符串`)
      row.idempotencyKey = typeof row.idempotencyKey === 'string' && row.idempotencyKey.trim()
        ? row.idempotencyKey.trim()
        : `wiki-action-${index + 1}-${path}`
    }
    if (kind === 'move') validatePath(row.destination, `operations[${index}].destination`)
    return { ...row, kind } as WikiOperation
  })
}

function parseIndexChanges(value: unknown): WikiIndexChange[] {
  if (!Array.isArray(value)) throw new Error('changePlan indexChanges 必须是数组')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`indexChanges[${index}] 无效`)
    const row = item as Record<string, unknown>
    const action = text(row.action, `indexChanges[${index}].action`)
    if (action !== 'add' && action !== 'remove')
      throw new Error(`indexChanges[${index}].action 无效`)
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
  if (Array.isArray(value.actions)) {
    const operations = parseOperations(value.actions)
    return {
      answer,
      changePlan: operations.length
        ? { reason: '', basis: [], operations, indexChanges: [] }
        : null,
    }
  }
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
      // Index/navigation/link/log maintenance is derived by applyWiki.
      indexChanges: Array.isArray(plan.indexChanges) ? parseIndexChanges(plan.indexChanges) : [],
    },
  }
}

export function parseWikiAgentStep(input: string): WikiAgentStep {
  const value = parseJsonObject(input, 'WikiAgentStep')
  if (typeof value.answer === 'string') {
    return { kind: 'final', plan: parseWikiSynthesisAndChangePlan(input) }
  }
  if (Array.isArray(value.paths)) {
    return { kind: 'read', plan: parseWikiReadPlan(input) }
  }
  throw new Error('WikiAgentStep 必须包含 paths 或 answer')
}
