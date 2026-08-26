import { marked } from 'marked'
import { WIKI_STRUCTURES, WIKI_TEMPLATES, type WikiProjectType } from './wikiStructures'

export interface WikiWorkspaceEntry {
  path: string
  isDir: boolean
}

export interface WikiWorkspace {
  list(): Promise<WikiWorkspaceEntry[]>
  read(path: string): Promise<string>
  fingerprint(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  createDirectory(path: string): Promise<void>
  gitEvidence?(): Promise<{ status: string; diff: string } | null>
}

export type WikiAction =
  | 'inspect'
  | 'scaffold'
  | 'search'
  | 'status'
  | 'graph'
  | 'validate'
  | 'audit'
  | 'evidence'
  | 'closeout'
  | 'replace'
  | 'extend'

export interface WikiActionInput {
  action: WikiAction
  type?: WikiProjectType
  query?: string | string[]
  scope?: 'active' | 'all'
  limit?: number
  depth?: number
  evidencePaths?: string[]
  path?: string
  oldText?: string
  newText?: string
  replaceAll?: boolean
  category?: string
  description?: string
  reason?: string
  basis?: string
  apply?: boolean
}

interface Snapshot {
  entries: WikiWorkspaceEntry[]
  paths: Set<string>
  dirs: Set<string>
  files: Set<string>
}

function normalizePath(input: string, allowRoot = false): string {
  const raw = String(input || '').replace(/\\/g, '/')
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw) || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.includes('\0')) {
    throw new Error('Wiki 路径必须位于当前项目内')
  }
  const parts = raw.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part === '..')) throw new Error('Wiki 路径不能越过项目根目录')
  const path = parts.join('/')
  if (!path && !allowRoot) throw new Error('Wiki 路径不能为空')
  return path
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'))
}

async function snapshot(workspace: WikiWorkspace): Promise<Snapshot> {
  const entries = await workspace.list()
  const dirs = new Set(entries.filter(entry => entry.isDir).map(entry => normalizePath(entry.path)))
  const files = new Set(entries.filter(entry => !entry.isDir).map(entry => normalizePath(entry.path)))
  return { entries, dirs, files, paths: new Set([...dirs, ...files]) }
}

function hasTree(state: Snapshot, path: string): boolean {
  return state.paths.has(path) || [...state.paths].some(item => item.startsWith(`${path}/`))
}

function findWiki(state: Snapshot): string | null {
  const candidates = ['docs/wiki', 'wiki'].filter(path => hasTree(state, path))
  if (candidates.length > 1) throw new Error('同时发现 docs/wiki/ 与 wiki/，需要用户确认唯一 Wiki')
  return candidates[0] || null
}

function wikiPath(state: Snapshot, type: WikiProjectType): string {
  return findWiki(state) || (type === 'dev_project' ? 'docs/wiki' : 'wiki')
}

function wikiMarkdownFiles(state: Snapshot, wiki: string): string[] {
  return [...state.files].filter(path => path.startsWith(`${wiki}/`) && path.endsWith('.md')).sort()
}

function relativeToWiki(wiki: string, path: string): string {
  return path.slice(wiki.length + 1)
}

function pagePriority(relative: string): number {
  const name = relative.split('/').at(-1)
  if (name === 'hot.md' || name === 'CLAUDE.md') return 100
  return ({ '架构': 80, '开发': 70, '运维': 60, '排障': 50, '学习': 40, '巡检报告': 30, '归档': 0 } as Record<string, number>)[relative.split('/')[0]!] ?? 20
}

function collectMarkdownText(tokens: unknown, output: string[] = []): string[] {
  if (Array.isArray(tokens)) {
    for (const token of tokens) collectMarkdownText(token, output)
    return output
  }
  if (!tokens || typeof tokens !== 'object') return output
  const token = tokens as Record<string, unknown>
  if (['code', 'codespan', 'html', 'escape'].includes(String(token.type || ''))) return output
  if (token.type === 'text') {
    if (Array.isArray(token.tokens)) collectMarkdownText(token.tokens, output)
    else output.push(String(token.raw || token.text || ''))
    return output
  }
  for (const [key, value] of Object.entries(token)) {
    if (key !== 'raw' && key !== 'text') collectMarkdownText(value, output)
  }
  return output
}

function extractWikiLinks(markdown: string): string[] {
  const text = collectMarkdownText(marked.lexer(markdown)).join('\n')
  return [...text.matchAll(/\[\[([^\]|#]+)/g)].map(match => match[1]!.trim()).filter(Boolean)
}

function normalizedLinkTarget(target: string): string {
  return target.replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '')
}

function linkExists(state: Snapshot, wiki: string, target: string): boolean {
  const normalized = normalizedLinkTarget(target)
  if (!normalized) return false
  if (state.files.has(`${wiki}/${normalized}.md`) || state.dirs.has(`${wiki}/${normalized}`)) return true
  const name = normalized.split('/').at(-1)
  return wikiMarkdownFiles(state, wiki).some(path => path.slice(0, -3).split('/').at(-1) === name)
}

async function shortSha256(content: string): Promise<string> {
  return (await sha256Hex(new TextEncoder().encode(content))).slice(0, 12)
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function ensureDirectory(workspace: WikiWorkspace, state: Snapshot, path: string, created: string[]) {
  if (state.dirs.has(path)) return
  await workspace.createDirectory(path)
  state.dirs.add(path)
  state.paths.add(path)
  created.push(path)
}

async function ensureFile(workspace: WikiWorkspace, state: Snapshot, path: string, content: string, created: string[]) {
  if (state.files.has(path)) return
  await workspace.write(path, content)
  state.files.add(path)
  state.paths.add(path)
  created.push(path)
}

async function scaffold(workspace: WikiWorkspace, state: Snapshot, type: WikiProjectType): Promise<string> {
  const root = wikiPath(state, type)
  const created: string[] = []
  await ensureDirectory(workspace, state, root, created)
  for (const [folder, files] of Object.entries(WIKI_STRUCTURES[type])) {
    const folderPath = joinPath(root, folder)
    await ensureDirectory(workspace, state, folderPath, created)
    if (type !== 'dev_project') {
      await ensureFile(workspace, state, joinPath(folderPath, '_index.md'), `# ${folder}\n\n`, created)
    }
    for (const filename of files) {
      await ensureFile(workspace, state, joinPath(folderPath, filename), `# ${filename.replace(/\.md$/, '')}\n\n`, created)
    }
  }
  if (type === 'dev_project') {
    await ensureFile(workspace, state, joinPath(root, 'CLAUDE.md'), WIKI_TEMPLATES.claude, created)
    await ensureFile(workspace, state, joinPath(root, 'hot.md'), WIKI_TEMPLATES.hot, created)
    await ensureFile(workspace, state, joinPath(root, 'log.md'), WIKI_TEMPLATES.log, created)
  } else if (type === 'generic') {
    await ensureFile(workspace, state, joinPath(root, 'index.md'), WIKI_TEMPLATES.index, created)
    await ensureFile(workspace, state, joinPath(root, 'log.md'), WIKI_TEMPLATES.log, created)
    await ensureFile(workspace, state, joinPath(root, 'hot.md'), WIKI_TEMPLATES.hot, created)
  } else {
    await ensureFile(workspace, state, joinPath(root, 'index.md'), WIKI_TEMPLATES.index, created)
    await ensureFile(workspace, state, joinPath(root, '方向.md'), WIKI_TEMPLATES.direction, created)
    await ensureFile(workspace, state, joinPath(root, 'log.md'), WIKI_TEMPLATES.log, created)
    await ensureFile(workspace, state, joinPath(root, 'hot.md'), WIKI_TEMPLATES.hot, created)
  }
  await ensureFile(workspace, state, joinPath(root, '来源索引.md'), WIKI_TEMPLATES.sources, created)
  return [`created-or-completed: ${root}`, `type: ${type}`, `created: ${created.length}`, ...created.map(path => `- ${path}`)].join('\n')
}

async function searchWiki(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const queries = wikiQueries(input.query)
  const scope = input.scope === 'all' ? 'all' : 'active'
  const results = queries.map(() => [] as Array<{ score: number; relative: string; matches: Array<[number, string]> }>)
  for (const path of wikiMarkdownFiles(state, wiki)) {
    const relative = relativeToWiki(wiki, path)
    const name = relative.split('/').at(-1)
    if (name === 'index.md' || name === 'log.md' || (scope === 'active' && relative.startsWith('归档/'))) continue
    const lines = (await workspace.read(path)).split(/\r?\n/)
    for (const [queryIndex, query] of queries.entries()) {
      const normalizedQuery = query.toLowerCase()
      const matches: Array<[number, string]> = []
      for (const [lineIndex, line] of lines.entries()) {
        if (line.toLowerCase().includes(normalizedQuery)) matches.push([lineIndex + 1, line.trim().slice(0, 120)])
      }
      if (matches.length) {
        const titleBonus = String(name).toLowerCase().includes(normalizedQuery) ? 50 : 0
        results[queryIndex]!.push({ score: pagePriority(relative) + titleBonus + matches.length, relative, matches })
      }
    }
  }
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 1000))
  return queries.map((query, queryIndex) => {
    const lines = [`查询：${query}`, `范围：${scope === 'active' ? '现行知识（默认排除 归档/ 与 log.md）' : '全部知识（包含归档）'}`, '[证据候选]']
    for (const result of results[queryIndex]!.sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative))) {
      for (const [line, text] of result.matches.slice(0, 3)) {
        if (lines.length - 3 >= limit) break
        lines.push(`${result.relative}:${line}: ${text}`)
      }
      if (lines.length - 3 >= limit) break
    }
    if (lines.length === 3) lines.push('未找到匹配内容。')
    return lines.join('\n')
  }).join('\n\n')
}

function wikiQueries(value: WikiActionInput['query']): string[] {
  const queries = Array.isArray(value) ? value : [value]
  if (queries.length < 1 || queries.length > 3) throw new Error('Wiki 搜索只接受 1-3 个关键词')
  return queries.map(query => {
    if (typeof query !== 'string') throw new Error('Wiki 搜索关键词必须是字符串')
    const normalized = query.trim()
    if (!normalized) throw new Error('Wiki 搜索关键词不能为空')
    return normalized
  })
}

async function status(workspace: WikiWorkspace, state: Snapshot): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const files = wikiMarkdownFiles(state, wiki)
  const isDev = ['架构', '开发', '运维', '排障'].some(name => state.dirs.has(`${wiki}/${name}`))
  if (!isDev) return `📊 类型：通用 Wiki\n文件总数：${files.length}`
  let lastOperation = '无记录'
  if (state.files.has(`${wiki}/log.md`)) {
    lastOperation = (await workspace.read(`${wiki}/log.md`)).split(/\r?\n/).reverse().find(line => line.startsWith('## ['))?.replace(/^#+\s*/, '') || lastOperation
  }
  return [
    '📊 类型：开发项目',
    `文件总数：${files.length}`,
    ...['架构', '开发', '运维', '排障', '学习', '巡检报告', '归档'].filter(name => state.dirs.has(`${wiki}/${name}`)).map(name => `${name}：${files.filter(path => path.startsWith(`${wiki}/${name}/`)).length} 篇`),
    `上次操作：${lastOperation}`,
  ].join('\n')
}

async function graph(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  if (!input.evidencePaths?.length) throw new Error('生成局部关系图必须提供至少一个种子页面')

  const depth = input.depth ?? 1
  if (!Number.isInteger(depth) || depth < 1 || depth > 2) throw new Error('局部关系图 depth 仅支持 1 或 2')
  const pages = wikiMarkdownFiles(state, wiki)
  const aliases = new Map<string, string | null>()
  for (const path of pages) {
    const relative = relativeToWiki(wiki, path).replace(/\.md$/, '')
    for (const alias of [relative, relative.split('/').at(-1)!]) {
      aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== path ? null : path)
    }
  }
  const resolveTarget = (target: string) => {
    const normalized = normalizedLinkTarget(target)
    return aliases.get(normalized) || aliases.get(normalized.split('/').at(-1)!) || null
  }
  const seeds = [...new Set(input.evidencePaths.map(rawPath => {
    const candidate = resolveWikiFile(state, wiki, rawPath)
    const path = candidate.endsWith('.md') ? candidate : `${candidate}.md`
    if (!state.files.has(path)) throw new Error(`种子页面不存在：${path}`)
    return path
  }))]

  const adjacency = new Map(pages.map(path => [path, new Set<string>()]))
  const links: Array<[string, string]> = []
  for (const source of pages) {
    for (const target of extractWikiLinks(await workspace.read(source))) {
      const targetPath = resolveTarget(target)
      if (!targetPath || targetPath === source) continue
      adjacency.get(source)!.add(targetPath)
      adjacency.get(targetPath)!.add(source)
      links.push([source, targetPath])
    }
  }

  const selected = new Set(seeds)
  let frontier = seeds
  for (let level = 0; level < depth; level += 1) {
    const next = [...new Set(frontier.flatMap(path => [...(adjacency.get(path) || [])]))].filter(path => !selected.has(path))
    next.forEach(path => selected.add(path))
    frontier = next
  }

  const rawOutput = String(input.path || '').trim()
  const defaultName = `${relativeToWiki(wiki, seeds[0]!).replace(/\.md$/, '').split('/').at(-1)}-关系图.canvas`
  const normalizedOutput = normalizePath(rawOutput || defaultName)
  const output = normalizedOutput.startsWith('wiki/') || normalizedOutput.startsWith('docs/wiki/')
    ? normalizedOutput
    : joinPath(wiki, normalizedOutput)
  if (!output.startsWith(`${wiki}/`) || !output.endsWith('.canvas')) throw new Error('关系图必须保存为当前 Wiki 内的 .canvas 文件')

  type CanvasNode = { id: string; type: string; x: number; y: number; width: number; height: number; file?: string; [key: string]: unknown }
  type CanvasEdge = { id: string; fromNode: string; toNode: string; [key: string]: unknown }
  let existing: { nodes: CanvasNode[]; edges: CanvasEdge[] } = { nodes: [], edges: [] }
  if (state.files.has(output)) {
    try {
      const parsed = JSON.parse(await workspace.read(output)) as Partial<typeof existing>
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('缺少 nodes 或 edges')
      existing = { nodes: parsed.nodes, edges: parsed.edges }
    } catch (error) {
      throw new Error(`现有 Canvas 无法安全更新：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!input.apply) return `关系图更新预览（未写盘，加 apply:true 才真正执行）：${output}\n局部页面: ${selected.size}`
  }

  const nodes = [...existing.nodes]
  const usedIds = new Set([...nodes.map(node => node.id), ...existing.edges.map(edge => edge.id)])
  const nodeByFile = new Map(nodes.filter(node => node.type === 'file' && node.file).map(node => [node.file!, node]))
  let nextNode = 1
  const nextId = (prefix: string) => {
    while (usedIds.has(`${prefix}_${nextNode}`)) nextNode += 1
    const id = `${prefix}_${nextNode++}`
    usedIds.add(id)
    return id
  }
  const nodeIdByPath = new Map<string, string>()
  for (const [index, path] of [...selected].sort().entries()) {
    const found = nodeByFile.get(path)
    if (found) {
      nodeIdByPath.set(path, found.id)
      continue
    }
    const node: CanvasNode = {
      id: nextId('wiki'), type: 'file', file: path,
      x: (index % 5) * 300 + 50, y: Math.floor(index / 5) * 150 + 50,
      width: 250, height: 80,
    }
    nodes.push(node)
    nodeIdByPath.set(path, node.id)
  }

  const selectedIds = new Set(nodeIdByPath.values())
  const edges = existing.edges.filter(edge => !(selectedIds.has(edge.fromNode) && selectedIds.has(edge.toNode)))
  const edgePairs = new Set(edges.map(edge => `${edge.fromNode}\0${edge.toNode}`))
  for (const [source, target] of links) {
    const fromNode = nodeIdByPath.get(source)
    const toNode = nodeIdByPath.get(target)
    if (!fromNode || !toNode || edgePairs.has(`${fromNode}\0${toNode}`)) continue
    edges.push({ id: nextId('edge'), fromNode, toNode })
    edgePairs.add(`${fromNode}\0${toNode}`)
  }

  await workspace.write(output, JSON.stringify({ nodes, edges }, null, 2))
  return `✅ ${output}\n局部节点: ${selected.size}，总节点: ${nodes.length}，总边: ${edges.length}`
}

async function validate(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('验证失败：未找到 docs/wiki/ 或 wiki/')
  const isGeneric = input.type === 'generic'
  const isDev = !isGeneric && (input.type === 'dev_project' || state.dirs.has(`${wiki}/开发`))
  const required = isDev
    ? ['CLAUDE.md', 'hot.md', 'log.md', '来源索引.md', '开发', '架构', '运维', '排障', '学习', '巡检报告', '归档']
    : isGeneric
      ? ['index.md', 'hot.md', 'log.md', '来源索引.md']
      : ['index.md', '方向.md', 'hot.md', 'log.md', '来源索引.md']
  const missing = required.filter(name => !state.paths.has(`${wiki}/${name}`))
  if (missing.length) throw new Error(`验证失败：${wiki} 缺少 ${missing.join(', ')}`)
  const broken: string[] = []
  for (const name of ['hot.md', '来源索引.md']) {
    const path = `${wiki}/${name}`
    for (const target of extractWikiLinks(await workspace.read(path))) {
      if (!linkExists(state, wiki, target)) broken.push(`${name}: [[${target}]]`)
    }
  }
  if (broken.length) throw new Error(`验证失败：稳定入口存在断链\n${broken.map(item => `- ${item}`).join('\n')}`)
  return `验证通过：${wiki} 的稳定入口存在且链接可达`
}

async function evidence(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  if (!input.evidencePaths?.length) throw new Error('来源证据路径不能为空')
  const paths = [...new Set(input.evidencePaths.map(rawPath => normalizePath(rawPath)))]
  const lines = ['[来源证据]']
  for (const path of paths) {
    if (state.dirs.has(path)) throw new Error(`来源证据必须是文件: ${path}`)
    let fingerprint: string
    try {
      fingerprint = await workspace.fingerprint(path)
    } catch (error) {
      throw new Error(`来源证据文件无法读取: ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error(`来源证据指纹无效: ${path}`)
    lines.push(`- ${path} sha256:${fingerprint.toLowerCase()}`)
  }
  return lines.join('\n')
}

interface EvidenceRecord {
  wikiLocation: string
  sourceRole: string
  sourcePath: string
  processedRange: string
  fingerprint: string
  recordedAt: string
}

const EVIDENCE_HEADERS = ['Wiki 位置', '来源角色', '原始来源', '已处理范围', '写入时指纹', '记录时间']

function tableCellText(cell: unknown): string {
  if (!cell || typeof cell !== 'object') return ''
  const tokens = (cell as { tokens?: Array<Record<string, unknown>> }).tokens || []
  return tokens.map(token => String(token.text || token.raw || '')).join('').trim()
}

function parseEvidenceRecords(markdown: string): { records: EvidenceRecord[]; problem?: string } {
  const tokens = marked.lexer(markdown) as Array<Record<string, any>>
  const tables: Array<Record<string, any>> = []
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading' || token.depth !== 2 || String(token.text).trim() !== '证据记录') continue
    const table = tokens.slice(index + 1).find(item => item.type !== 'space')
    if (table?.type === 'table') tables.push(table)
  }
  if (tables.length > 1) return { records: [], problem: '存在多个六列「证据记录」表，需要确认唯一现行表' }
  if (!tables.length) {
    const hasLegacyTable = tokens.some(token => token.type === 'table')
    return { records: [], problem: hasLegacyTable ? '旧来源记录尚未迁移' : undefined }
  }
  const table = tables[0]!
  const headers = (table.header || []).map(tableCellText)
  if (headers.join('\0') !== EVIDENCE_HEADERS.join('\0')) {
    return { records: [], problem: '「证据记录」表头不完整' }
  }
  const records = (table.rows || []).map((row: unknown[]) => {
    const cells = row.map(tableCellText)
    return {
      wikiLocation: cells[0] || '',
      sourceRole: cells[1] || '',
      sourcePath: cells[2] || '',
      processedRange: cells[3] || '',
      fingerprint: cells[4] || '',
      recordedAt: cells[5] || '',
    }
  })
  return { records }
}

function evidenceWikiTarget(state: Snapshot, wiki: string, location: string): { path?: string; label: string } {
  const match = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(location.trim())
  const label = match?.[1]?.trim() || location.trim()
  if (!match) return { label }
  const [rawTarget, heading] = label.split('#', 2)
  let candidate: string
  try {
    candidate = resolveWikiFile(state, wiki, rawTarget!)
  } catch {
    return { label }
  }
  let path = candidate.endsWith('.md') ? candidate : `${candidate}.md`
  if (!state.files.has(path)) {
    const normalized = normalizedLinkTarget(rawTarget!)
    const stem = normalized.split('/').at(-1)!
    const matches = wikiMarkdownFiles(state, wiki).filter(item => item.slice(0, -3).split('/').at(-1) === stem)
    if (matches.length !== 1) return { label }
    path = matches[0]!
  }
  if (!state.files.has(path)) return { label }
  return { path, label: heading ? `${relativeToWiki(wiki, path).replace(/\.md$/, '')}#${heading}` : relativeToWiki(wiki, path) }
}

async function auditEvidence(
  workspace: WikiWorkspace,
  state: Snapshot,
  wiki: string,
  scopedWikiPaths?: Set<string>,
): Promise<string[]> {
  const sourceIndex = `${wiki}/来源索引.md`
  if (!state.files.has(sourceIndex)) return ['- [登记不完整] 来源索引.md 不存在']
  const parsed = parseEvidenceRecords(await workspace.read(sourceIndex))
  const lines: string[] = parsed.problem ? [`- [登记不完整] ${parsed.problem}`] : []
  for (const record of parsed.records) {
    const target = evidenceWikiTarget(state, wiki, record.wikiLocation)
    if (scopedWikiPaths && (!target.path || !scopedWikiPaths.has(target.path))) continue
    const required = [record.wikiLocation, record.sourceRole, record.sourcePath, record.processedRange, record.fingerprint, record.recordedAt]
    if (required.some(value => !value) || !target.path || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(record.recordedAt)) {
      lines.push(`- [登记不完整] ${target.label || record.wikiLocation}: Wiki 位置或字段无效`)
      continue
    }
    const heading = target.label.includes('#') ? target.label.split('#').slice(1).join('#') : ''
    if (heading) {
      const headings = marked.lexer(await workspace.read(target.path))
        .filter(token => token.type === 'heading')
        .map(token => String((token as { text?: string }).text || '').trim())
      if (!headings.includes(heading)) {
        lines.push(`- [登记不完整] ${target.label}: Wiki 章节不存在`)
        continue
      }
    }
    if (/^https?:\/\//i.test(record.sourcePath) || /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(record.sourcePath) || record.fingerprint.startsWith('未计算')) {
      lines.push(`- [无法验证] ${target.label} <- ${record.sourcePath}`)
      continue
    }
    let sourcePath: string
    try {
      sourcePath = normalizePath(record.sourcePath)
    } catch {
      lines.push(`- [无法验证] ${target.label} <- ${record.sourcePath}`)
      continue
    }
    if (sourcePath === wiki || sourcePath.startsWith(`${wiki}/`)) {
      lines.push(`- [登记不完整] ${target.label}: Wiki 页面不能作为原始来源`)
      continue
    }
    const stored = /^sha256:([a-f0-9]{64})$/i.exec(record.fingerprint)?.[1]?.toLowerCase()
    if (!stored) {
      lines.push(`- [登记不完整] ${target.label}: 写入时指纹无效`)
      continue
    }
    try {
      const current = (await workspace.fingerprint(sourcePath)).toLowerCase()
      lines.push(`- [${current === stored ? '当前一致' : '来源已变化'}] ${target.label} <- ${sourcePath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lines.push(`- [${/不存在|not found|not exist|no such file/i.test(message) ? '来源不存在' : '无法验证'}] ${target.label} <- ${sourcePath}${message ? `: ${message}` : ''}`)
    }
  }
  return lines.length ? lines : ['无已登记的新版来源记录。']
}

async function audit(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const files = wikiMarkdownFiles(state, wiki)
  const sources = input.evidencePaths?.length
    ? [...new Set(input.evidencePaths.flatMap(rawPath => {
        const candidate = resolveWikiFile(state, wiki, rawPath)
        const file = candidate.endsWith('.md') ? candidate : `${candidate}.md`
        if (state.files.has(file)) return [file]
        if (state.dirs.has(candidate)) return files.filter(path => path.startsWith(`${candidate}/`))
        throw new Error(`巡检范围不存在：${candidate}`)
      }))]
    : files
  const byStem = new Map<string, string[]>()
  for (const path of files) {
    const stem = path.split('/').at(-1)!.replace(/\.md$/, '')
    byStem.set(stem, [...(byStem.get(stem) || []), path])
  }
  const resolveTarget = (target: string): { path?: string; ambiguous?: string[] } => {
    const normalized = normalizedLinkTarget(target)
    const exact = `${wiki}/${normalized}.md`
    if (state.files.has(exact)) return { path: exact }
    if (state.dirs.has(`${wiki}/${normalized}`)) return { path: `${wiki}/${normalized}` }
    const matches = byStem.get(normalized.split('/').at(-1)!) || []
    if (matches.length === 1) return { path: matches[0] }
    return matches.length > 1 ? { ambiguous: matches } : {}
  }
  const linkedTo = new Set<string>()
  const confirmed: string[] = []
  const candidates: string[] = []
  const historical: string[] = []
  const navigation = new Set(['CLAUDE.md', 'index.md', '_index.md', 'hot.md', '来源索引.md'])
  const isHistorical = (relative: string, text: string) => relative === 'log.md'
    || relative.startsWith('归档/')
    || /^.{0,300}状态[：:]\s*(历史|已归档|已替代)/s.test(text.slice(0, 500))
  for (const path of sources) {
    const relative = relativeToWiki(wiki, path)
    const text = await workspace.read(path)
    const pageHistorical = isHistorical(relative, text)
    for (const target of extractWikiLinks(text)) {
      const resolved = resolveTarget(target)
      if (resolved.path) {
        if (state.files.has(resolved.path)) linkedTo.add(resolved.path)
      } else if (pageHistorical) {
        historical.push(`${relative}: [[${target}]] ${resolved.ambiguous ? '目标不唯一' : '指向的笔记不存在'}`)
      } else if (resolved.ambiguous) {
        confirmed.push(`${relative}: 歧义链接 [[${target}]] 可指向 ${resolved.ambiguous.map(item => relativeToWiki(wiki, item)).join('、')}`)
      } else if (navigation.has(relative.split('/').at(-1)!)) {
        confirmed.push(`${relative}: 导航断链 [[${target}]] 指向的笔记不存在`)
      } else {
        candidates.push(`${relative}: 普通未解析链接 [[${target}]]，需确认是否为待创建页面`)
      }
    }
  }
  if (!input.evidencePaths?.length) {
    for (const path of files) {
      const relative = relativeToWiki(wiki, path)
      const name = relative.split('/').at(-1)!
      const text = await workspace.read(path)
      if (isHistorical(relative, text) || navigation.has(name) || relative.startsWith('巡检报告/')) continue
      if (!linkedTo.has(path)) candidates.push(`${relative}: 孤儿候选，没有其他页面链入`)
    }
  }
  const sourceStatus = await auditEvidence(
    workspace,
    state,
    wiki,
    input.evidencePaths?.length ? new Set(sources) : undefined,
  )
  return [
    `检查范围：${input.evidencePaths?.length ? sources.map(path => relativeToWiki(wiki, path)).join('、') : '全部 Wiki Markdown'}`,
    `问题统计：明确风险 ${confirmed.length} / 待确认候选 ${candidates.length} / 历史卫生 ${historical.length}`,
    '[明确风险]',
    ...(confirmed.length ? confirmed.map(item => `- ${item}`) : ['无明确机械风险。']),
    '[待确认候选]',
    ...(candidates.length ? candidates.map(item => `- ${item}`) : ['无待确认候选。']),
    '[历史卫生]',
    ...(historical.length ? historical.map(item => `- ${item}`) : ['无历史链接卫生问题。']),
    '[来源状态]',
    ...sourceStatus,
  ].join('\n')
}

async function closeout(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('收尾失败：未找到 docs/wiki/ 或 wiki/')
  const evidence = await Promise.all((input.evidencePaths || []).map(async path => {
    const normalized = normalizePath(path)
    return { path: normalized, content: await workspace.read(normalized) }
  }))
  const evidenceText = evidence.map(item => `${item.path}\n${item.content}`).join('\n').toLowerCase()
  const git = workspace.gitEvidence ? await workspace.gitEvidence() : null
  const lines = [
    '开发阶段收尾编译预览（只读，不写 Wiki）',
    '[写入预览]',
    '- 开发结论：根据变更落入现有 开发/、架构/、运维/、排障/ 或 学习/ 页面',
    '- 来源导航：重要结论登记 来源索引.md',
    '- 当前状态：仅在状态真实变化时更新 hot.md，并向 log.md 追加事实',
    '[证据状态]',
    `- Git：${git ? '可用' : '不可用；当前平台不提供 Git 证据'}`,
    `- 测试：${/(pnpm run test|test result|tests passed|测试)/.test(evidenceText) ? '已提供' : '缺失，不得写成已通过'}`,
    `- 构建：${/(pnpm run build|vite build|构建)/.test(evidenceText) ? '已提供' : '缺失，不得写成已通过'}`,
    '[来源指纹]',
  ]
  if (git) {
    lines.push(`- git-status sha256:${await shortSha256(git.status)}`)
    lines.push(`- git-diff sha256:${await shortSha256(git.diff)}`)
  }
  for (const item of evidence) lines.push(`- ${item.path} sha256:${await shortSha256(item.content)}`)
  lines.push('[未验证项]')
  lines.push('- 证据指纹只证明所读内容未变，不替代模型对输出和平台覆盖面的判断。')
  return lines.join('\n')
}

function requireRepairBasis(input: WikiActionInput) {
  if (!String(input.reason || '').trim() || !String(input.basis || '').trim()) {
    throw new Error('Wiki 修正必须提供 reason 和 basis')
  }
}

function resolveWikiFile(state: Snapshot, wiki: string, rawPath: string): string {
  const path = normalizePath(rawPath)
  return path.startsWith(`${wiki}/`) ? path : joinPath(wiki, path)
}

async function replace(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  requireRepairBasis(input)
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const oldText = String(input.oldText || '')
  const newText = String(input.newText ?? '')
  if (!oldText || oldText === newText) throw new Error('Wiki 替换的新旧内容无效')
  if (!String(input.path || '').trim()) throw new Error('Wiki 修正必须提供目标 Markdown 文件路径')
  let target: string
  try {
    target = resolveWikiFile(state, wiki, input.path!)
  } catch {
    throw new Error('修正目标必须是当前 Wiki 内的 Markdown 文件')
  }
  if (!target.startsWith(`${wiki}/`) || !target.endsWith('.md') || !state.files.has(target)) {
    throw new Error('修正目标必须是当前 Wiki 内的 Markdown 文件')
  }
  const before = await workspace.read(target)
  const matches: number[] = []
  let cursor = 0
  while (true) {
    const index = before.indexOf(oldText, cursor)
    if (index < 0) break
    matches.push(index)
    cursor = index + oldText.length
  }
  if (!matches.length) throw new Error(`目标文件没有命中旧值: ${target}`)
  const lineNumbers = matches.map(index => before.slice(0, index).split(/\r?\n/).length)
  if (matches.length > 1 && input.apply && input.replaceAll !== true) {
    throw new Error(`目标文件多处命中（${matches.length} 处，行 ${lineNumbers.join('、')}），需要明确 replaceAll:true`)
  }
  const after = input.replaceAll === true ? before.split(oldText).join(newText) : before.replace(oldText, newText)
  const lines = [
    '[修前预览]',
    `问题：${input.reason}`,
    `依据：${input.basis}`,
    `目标：${target}`,
    `命中 ${matches.length} 处，命中行：${lineNumbers.join('、')}`,
    `旧值：「${oldText}」`,
    `新值：「${newText}」`,
    `模式：${input.apply ? '已执行' : '预览（未写盘，加 apply:true 才真正执行）'}`,
  ]
  if (input.apply) {
    await workspace.write(target, after)
    const verified = await workspace.read(target)
    if (verified !== after) throw new Error(`Wiki 修正写后验证失败: ${target}`)
    lines.push('[修复回执]')
    lines.push(`- ${target} sha256:${await shortSha256(before)} -> sha256:${await shortSha256(verified)}`)
    lines.push(`验证：内容一致=是，新值存在=${newText ? (verified.includes(newText) ? '是' : '否') : '空值替换'}，旧值剩余=${verified.split(oldText).length - 1}`)
  }
  return lines.join('\n')
}

async function extend(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  requireRepairBasis(input)
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const category = normalizePath(String(input.category || ''))
  const description = String(input.description || '').trim()
  if (!description) throw new Error('新分类说明不能为空')
  const directory = joinPath(wiki, category)
  if (hasTree(state, directory)) throw new Error(`分类已存在: ${directory}`)
  const indexPath = joinPath(directory, '_index.md')
  if (input.apply) {
    await workspace.createDirectory(directory)
    await workspace.write(indexPath, `# ${category.split('/').at(-1)}\n\n> ${description}\n`)
    const parts = category.split('/')
    const parent = parts.slice(0, -1).join('/')
    const navigationIndex = parent ? joinPath(wiki, parent, '_index.md') : `${wiki}/index.md`
    if (state.files.has(navigationIndex)) {
      const before = await workspace.read(navigationIndex)
      await workspace.write(navigationIndex, `${before.replace(/\n*$/, '')}\n\n- [[${category}/_index|${parts.at(-1)}]] — ${description}\n`)
    }
  }
  return [
    '[修前预览]',
    `问题：${input.reason}`,
    `依据：${input.basis}`,
    `架构扩展：${directory}/  模式：${input.apply ? '已执行' : '预览（未写盘，加 apply:true 才真正执行）'}`,
    `- ${indexPath}`,
    ...(input.apply ? ['[修复回执]', `验证：分类入口已创建：${indexPath}`] : []),
  ].join('\n')
}

export async function executeWikiAction(workspace: WikiWorkspace, input: WikiActionInput): Promise<string> {
  const state = await snapshot(workspace)
  switch (input.action) {
    case 'inspect': {
      const wiki = findWiki(state)
      const raw = hasTree(state, '.raw') ? '.raw' : hasTree(state, 'raw') ? 'raw' : null
      return [
        `state: ${wiki ? 'existing' : 'absent'}`,
        `path: ${wiki || 'none'}`,
        `raw-state: ${raw ? 'existing' : 'absent'}`,
        ...(raw ? [`raw-path: ${raw}`] : []),
      ].join('\n')
    }
    case 'scaffold': return await scaffold(workspace, state, input.type || 'generic')
    case 'search': return await searchWiki(workspace, state, input)
    case 'status': return await status(workspace, state)
    case 'graph': return await graph(workspace, state, input)
    case 'validate': return await validate(workspace, state, input)
    case 'audit': return await audit(workspace, state, input)
    case 'evidence': return await evidence(workspace, state, input)
    case 'closeout': return await closeout(workspace, state, input)
    case 'replace': return await replace(workspace, state, input)
    case 'extend': return await extend(workspace, state, input)
    default: throw new Error(`不支持的 Wiki action: ${String(input.action)}`)
  }
}
