import { buildVaultChunks } from './vaultChunking'
import { buildVaultWikiPlan } from './vaultWikiPlanner'

export interface RawFileForOrganize {
  id: string
  name: string
  content: string
  metadata?: Record<string, unknown>
}

export interface WikiAction {
  type: 'create' | 'update' | 'create_folder'
  path: string
  content?: string
  append?: string
  sources?: string[]
  sourceChunkIds?: string[]
  rawId?: string
  chunkHash?: string
}

export interface LocalWikiActionsResult {
  rawCount: number
  actions: WikiAction[]
  newFolders: string[]
  skippedRawIds: string[]
}

export interface MergeExistingWikiPageContentInput {
  existingContent: string
  incomingContent: string
  now?: number
}

export interface MergeWikiActionTraceMetadataInput {
  existingMetadata?: Record<string, unknown>
  action: Pick<WikiAction, 'sources' | 'sourceChunkIds' | 'rawId'>
}

export interface WikiMergeConflict {
  path: string
  heading: string
  existingExcerpt: string
  incomingExcerpt: string
  sources: string[]
  description: string
}

export interface DetectWikiMergeConflictsInput {
  path: string
  existingContent: string
  incomingContent: string
  sources?: string[]
}

interface RawSection {
  raw: RawFileForOrganize
  title: string
  content: string
}

function cleanName(value: string, fallback = '未命名'): string {
  return String(value || fallback)
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60) || fallback
}

function summarize(text: string, max = 140): string {
  return String(text || '')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || '待补充'
}

function chunkHash(section: Pick<RawSection, 'title' | 'content'>): string {
  const text = `${section.title}\n${section.content}`.replace(/\s+/g, ' ').trim()
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function organizedChunkHashes(raw: RawFileForOrganize): Set<string> {
  const value = raw.metadata?.organizedChunkHashes
  return new Set(Array.isArray(value) ? value.map(item => String(item)) : [])
}

function extractSections(raw: RawFileForOrganize): RawSection[] {
  const lines = String(raw.content || '').split(/\r?\n/)
  const sections: RawSection[] = []
  let title = ''
  let buffer: string[] = []

  function push() {
    const body = buffer.join('\n').trim()
    if (title && /[\p{L}\p{N}]/u.test(body) && body.replace(/\s+/g, '').length >= 2) {
      sections.push({ raw, title: cleanName(title), content: body })
    }
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/)
    if (heading) {
      if (title) push()
      title = heading[2]
      buffer = []
      continue
    }
    if (title) buffer.push(line)
  }
  if (title) push()

  if (sections.length === 0 && /[\p{L}\p{N}]/u.test(raw.content) && raw.content.trim().replace(/\s+/g, '').length >= 2) {
    sections.push({
      raw,
      title: cleanName(raw.name.replace(/\.[^.]+$/, ''), '资料概览'),
      content: raw.content.trim(),
    })
  }
  return sections
}

function inferFolder(section: RawSection, wikiFolders: string[]): string {
  const text = `${section.title}\n${section.content}`
  const candidates: Array<[RegExp, string]> = [
    [/角色|男主|女主|人物|主角|配角/, '角色'],
    [/文风|风格|语气|表达|写法/, '风格'],
    [/道具|物品|武器|钥匙|装备/, '道具'],
    [/世界观|势力|地理|历史|规则|设定/, '世界观'],
    [/流程|步骤|操作|执行|复盘|阶段|第一步|第二步/, '流程'],
    [/模板|公式|清单|表格|范例|示例/, '模板'],
    [/案例|项目|复盘|样例/, '案例'],
    [/问题|为什么|怎么办|FAQ|失败|原因/, 'FAQ'],
    [/概念|定义|是什么|基础/, '基础概念'],
  ]
  const matched = candidates.find(([regex]) => regex.test(text))?.[1] || '沉淀内容'
  const existing = wikiFolders.find(folder => folder === matched || folder.startsWith(`${matched}/`) || folder.includes(matched))
  return existing ? existing.split('/')[0] : matched
}

function buildWikiPage(section: RawSection, folder: string): WikiAction {
  const title = cleanName(section.title)
  const source = `raw/${section.raw.name}#${title}`
  const body = [
    '---',
    'pageType: wiki',
    'status: active',
    'confidence: medium',
    `tags: ["${folder.replace(/"/g, '\\"')}"]`,
    `sources: ["${source.replace(/"/g, '\\"')}"]`,
    `updatedAt: ${Date.now()}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## 摘要',
    summarize(section.content),
    '',
    '## 关键内容',
    section.content.trim(),
    '',
    '## 适用场景',
    '- 适合在相关问题、资料检索和后续生成任务中引用。',
    '',
    '## 来源',
    `- ${source}`,
  ].join('\n')

  return {
    type: 'create',
    path: `wiki/${folder}/${title}.md`,
    content: body,
    sources: [source],
    rawId: section.raw.id,
    chunkHash: chunkHash(section),
  }
}

function stripFrontmatter(content: string): string {
  return String(content || '').replace(/^---[\s\S]*?---\s*/, '').trim()
}

function normalizeConflictText(text: string): string {
  return String(text || '')
    .replace(/^[-*]\s*/gm, '')
    .replace(/\s+/g, '')
    .trim()
}

function extractMarkdownSections(content: string): Map<string, string> {
  const text = stripFrontmatter(content)
  const matches = Array.from(text.matchAll(/^##\s+(.+?)\s*$/gm))
  const sections = new Map<string, string>()
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    const title = String(match[1] || '').trim()
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index || text.length) : text.length
    sections.set(title, text.slice(start, end).trim())
  }
  return sections
}

function excerpt(text: string, max = 120): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function detectWikiMergeConflicts(input: DetectWikiMergeConflictsInput): WikiMergeConflict[] {
  const watchHeadings = ['当前状态', '状态', '最近状态', '处理结果', '结果', '结论']
  const existingSections = extractMarkdownSections(input.existingContent)
  const incomingSections = extractMarkdownSections(input.incomingContent)
  const conflicts: WikiMergeConflict[] = []

  for (const heading of watchHeadings) {
    const existing = existingSections.get(heading)
    const incoming = incomingSections.get(heading)
    if (!existing || !incoming) continue
    if (normalizeConflictText(existing) === normalizeConflictText(incoming)) continue
    conflicts.push({
      path: input.path,
      heading,
      existingExcerpt: excerpt(existing),
      incomingExcerpt: excerpt(incoming),
      sources: input.sources || [],
      description: `「${input.path}」的「${heading}」出现增量资料差异，需要人工确认。`,
    })
  }

  if (/(冲突|矛盾|不一致|待确认|contradict|conflict)/i.test(input.incomingContent || '')) {
    conflicts.push({
      path: input.path,
      heading: '冲突信号',
      existingExcerpt: excerpt(input.existingContent),
      incomingExcerpt: excerpt(input.incomingContent),
      sources: input.sources || [],
      description: `「${input.path}」的新资料包含冲突或待确认信号。`,
    })
  }

  return conflicts
}

export function mergeExistingWikiPageContent(input: MergeExistingWikiPageContentInput): string {
  const existing = String(input.existingContent || '').trim()
  const incoming = stripFrontmatter(input.incomingContent)
  if (!existing) return incoming
  if (!incoming) return existing
  return [
    existing,
    '',
    '---',
    `## 整理补充（${new Date(input.now || Date.now()).toLocaleString('zh-CN')}）`,
    '',
    incoming,
  ].join('\n')
}

export function mergeWikiActionTraceMetadata(input: MergeWikiActionTraceMetadataInput): {
  sources: string[]
  sourceChunks: string[]
  rawId: string
} {
  const existingSources = Array.isArray(input.existingMetadata?.sources)
    ? input.existingMetadata!.sources.map(String)
    : []
  const existingSourceChunks = Array.isArray(input.existingMetadata?.sourceChunks)
    ? input.existingMetadata!.sourceChunks.map(String)
    : []
  return {
    sources: Array.from(new Set([
      ...existingSources,
      ...(input.action.sources || []),
    ].map(String).filter(Boolean))),
    sourceChunks: Array.from(new Set([
      ...existingSourceChunks,
      ...(input.action.sourceChunkIds || []),
    ].map(String).filter(Boolean))),
    rawId: input.action.rawId || String(input.existingMetadata?.rawId || ''),
  }
}

function actionSources(action: WikiAction): Set<string> {
  return new Set((action.sources || []).map(String).filter(Boolean))
}

function findReferenceAction(action: WikiAction, referenceActions: WikiAction[]): WikiAction | undefined {
  const sources = actionSources(action)
  if (sources.size > 0) {
    const bySource = referenceActions.find(reference =>
      (reference.sources || []).some(source => sources.has(String(source)))
    )
    if (bySource) return bySource
  }
  return referenceActions.find(reference => reference.path === action.path)
}

export function attachMissingWikiActionTrace(input: {
  actions: WikiAction[]
  referenceActions: WikiAction[]
}): WikiAction[] {
  return (input.actions || []).map(action => {
    if (action.rawId && action.chunkHash && action.sourceChunkIds?.length) return action
    const reference = findReferenceAction(action, input.referenceActions || [])
    if (!reference) return action
    return {
      ...action,
      sources: action.sources?.length ? action.sources : reference.sources,
      sourceChunkIds: action.sourceChunkIds?.length ? action.sourceChunkIds : reference.sourceChunkIds,
      rawId: action.rawId || reference.rawId,
      chunkHash: action.chunkHash || reference.chunkHash,
    }
  })
}

export function buildLocalWikiActions(input: {
  rawFiles: RawFileForOrganize[]
  wikiFolders: string[]
  maxActions?: number
}): LocalWikiActionsResult {
  const chunks = buildVaultChunks({
    vaultId: 'local',
    rawFiles: (input.rawFiles || []).map(raw => ({
      id: raw.id,
      name: raw.name,
      content: raw.content,
      metadata: raw.metadata,
    })),
  })
  const plan = buildVaultWikiPlan({
    chunks,
    wikiFolders: input.wikiFolders || [],
    maxActions: input.maxActions,
  })
  return {
    rawCount: (input.rawFiles || []).length,
    actions: plan.actions,
    newFolders: plan.newFolders,
    skippedRawIds: plan.skippedRawIds,
  }
}
