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
  move?(path: string, destination: string): Promise<void>
  remove?(path: string): Promise<void>
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
  | 'context'
  | 'apply'

export interface WikiContextInput {
  action?: 'entry' | 'tree' | 'read' | 'search' | 'links'
  question?: string
  scope?: 'active' | 'all'
  entryPath?: string
  paths?: string[]
  query?: string[]
  maxPages?: number
  maxTokens?: number
}

export interface WikiContextResult {
  action: 'entry' | 'tree' | 'read' | 'search' | 'links'
  root: string
  entry?: { path: string; content: string; fingerprint: string }
  tree?: Array<{ path: string; type: 'file' | 'directory'; fingerprint?: string }>
  sources: Array<{
    path: string
    title: string
    reason: string
    sections: string[]
    content: string
    fingerprint: string
  }>
  searchResults?: Array<{ query: string; path: string; line: number; text: string }>
  links?: Array<{
    source: string
    target: string
    resolved?: string
    direction: 'out' | 'in'
    status: 'resolved' | 'missing' | 'ambiguous'
  }>
  matchedRoutes: string[]
  missingRoutes: string[]
  expandedPaths: string[]
  omittedPaths: string[]
  coverage: 'complete' | 'partial' | 'none'
}

export interface WikiActionInput {
  action: WikiAction
  type?: WikiProjectType
  plan?: WikiScaffoldPlan
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
  basis?: string | string[]
  apply?: boolean
  operations?: WikiOperation[]
  sources?: WikiSourceRecord[]
  confirmedPlanId?: string
}

export type WikiOperation =
  | { kind: 'mkdir'; path: string; purpose: string }
  | { kind: 'create'; path: string; content: string; title: string; summary?: string }
  | { kind: 'replace'; path: string; oldText: string; newText: string; replaceAll?: boolean }
  | { kind: 'append'; path: string; content: string; idempotencyKey: string }
  | { kind: 'move'; path: string; destination: string }
  | { kind: 'trash'; path: string }

export interface WikiSourceRecord {
  wikiPath: string
  wikiSection?: string
  sourceRole: string
  sourcePath: string
  processedScope: string
}

export function wikiPlanConfirmationId(input: Pick<WikiActionInput, 'reason' | 'basis' | 'operations'>): string {
  const basis = Array.isArray(input.basis) ? input.basis : [input.basis]
  return `plan:${JSON.stringify({
    reason: input.reason || '',
    basis: basis.filter(Boolean),
    operations: input.operations || [],
  })}`
}

export interface WikiScaffoldPlan {
  directories?: string[]
  files?: Array<{ path: string; content: string }>
}

interface Snapshot {
  entries: WikiWorkspaceEntry[]
  paths: Set<string>
  dirs: Set<string>
  files: Set<string>
}

function normalizePath(input: string, allowRoot = false): string {
  const raw = String(input || '').replace(/\\/g, '/')
  if (
    raw.startsWith('/') ||
    /^[A-Za-z]:\//.test(raw) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ||
    raw.includes('\0')
  ) {
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
  const files = new Set(
    entries.filter(entry => !entry.isDir).map(entry => normalizePath(entry.path)),
  )
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
  // Wiki domains are user-defined; directory names must not imply relevance.
  return 20
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
  if (state.files.has(`${wiki}/${normalized}.md`) || state.dirs.has(`${wiki}/${normalized}`))
    return true
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

async function ensureDirectory(
  workspace: WikiWorkspace,
  state: Snapshot,
  path: string,
  created: string[],
) {
  if (state.dirs.has(path)) return
  await workspace.createDirectory(path)
  state.dirs.add(path)
  state.paths.add(path)
  created.push(path)
}

async function ensureFile(
  workspace: WikiWorkspace,
  state: Snapshot,
  path: string,
  content: string,
  created: string[],
) {
  if (state.files.has(path)) return
  await workspace.write(path, content)
  state.files.add(path)
  state.paths.add(path)
  created.push(path)
}

function prepareScaffoldPlan(
  state: Snapshot,
  root: string,
  plan?: WikiScaffoldPlan,
): { directories: string[]; files: Array<{ path: string; content: string }> } {
  if (!plan) return { directories: [], files: [] }
  if (typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Wiki 创建计划格式无效')
  const rawDirectories = plan.directories ?? []
  const rawFiles = plan.files ?? []
  if (!Array.isArray(rawDirectories) || !Array.isArray(rawFiles))
    throw new Error('Wiki 创建计划格式无效')
  if (rawDirectories.length > 200 || rawFiles.length > 200)
    throw new Error('单次 Wiki 创建计划最多包含 200 个目录和 200 个文件')

  const resolvePlanPath = (value: unknown) => {
    const path = normalizePath(String(value || ''))
    if (path === root || path.startsWith(`${root}/`)) return path
    if (/^(?:docs\/wiki|wiki)(?:\/|$)/.test(path))
      throw new Error(`Wiki 创建计划路径必须位于 ${root}/`)
    return joinPath(root, path)
  }
  const directories = new Set<string>()
  const addDirectory = (path: string) => {
    let current = path
    while (current !== root && current.startsWith(`${root}/`)) {
      directories.add(current)
      current = current.slice(0, current.lastIndexOf('/'))
    }
  }
  for (const path of rawDirectories) addDirectory(resolvePlanPath(path))

  let totalChars = 0
  const seenFiles = new Set<string>()
  const files = rawFiles.map(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file))
      throw new Error('Wiki 创建计划文件格式无效')
    const path = resolvePlanPath(file.path)
    const content = String(file.content ?? '')
    if (!path.endsWith('.md')) throw new Error(`Wiki 创建计划只允许 Markdown 文件: ${path}`)
    if (seenFiles.has(path)) throw new Error(`Wiki 创建计划包含重复文件: ${path}`)
    seenFiles.add(path)
    totalChars += content.length
    addDirectory(path.slice(0, path.lastIndexOf('/')))
    return { path, content }
  })
  if (totalChars > 1_000_000) throw new Error('单次 Wiki 创建计划正文不能超过 100 万字符')

  for (const path of directories) {
    if (state.files.has(path) || seenFiles.has(path))
      throw new Error(`Wiki 创建计划路径冲突: ${path}`)
  }
  for (const { path } of files) {
    if (state.dirs.has(path)) throw new Error(`Wiki 创建计划路径冲突: ${path}`)
  }
  return {
    directories: [...directories].sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
    ),
    files,
  }
}

async function scaffold(
  workspace: WikiWorkspace,
  state: Snapshot,
  type: WikiProjectType,
  plan?: WikiScaffoldPlan,
): Promise<string> {
  const root = wikiPath(state, type)
  const preparedPlan = prepareScaffoldPlan(state, root, plan)
  const created: string[] = []
  const plannedCreated: string[] = []
  const plannedSkipped: string[] = []
  await ensureDirectory(workspace, state, root, created)
  for (const path of preparedPlan.directories)
    await ensureDirectory(workspace, state, path, created)
  for (const directory of [root, ...preparedPlan.directories]) {
    await ensureFile(
      workspace,
      state,
      joinPath(directory, 'index.md'),
      directory === root ? WIKI_TEMPLATES.index : `# ${directory.split('/').at(-1)}\n\n`,
      created,
    )
  }
  for (const file of preparedPlan.files) {
    if (!state.files.has(file.path)) {
      await ensureFile(workspace, state, file.path, file.content, created)
      plannedCreated.push(file.path)
    } else if (
      file.path === `${root}/index.md` &&
      (await workspace.read(file.path)) === WIKI_TEMPLATES.index
    ) {
      await workspace.write(file.path, file.content)
      plannedCreated.push(file.path)
    } else {
      plannedSkipped.push(file.path)
    }
  }
  if (plan)
    return [
      `created-or-completed: ${root}`,
      `type: ${type}`,
      `planned-created: ${plannedCreated.length}`,
      `planned-skipped: ${plannedSkipped.length}`,
      `created: ${created.length}`,
      ...created.map(path => `- ${path}`),
      ...plannedSkipped.map(path => `skipped-existing: ${path}`),
    ].join('\n')
  for (const [folder, files] of Object.entries(WIKI_STRUCTURES[type])) {
    const folderPath = joinPath(root, folder)
    await ensureDirectory(workspace, state, folderPath, created)
    await ensureFile(workspace, state, joinPath(folderPath, 'index.md'), `# ${folder}\n\n`, created)
    if (type !== 'dev_project') {
      await ensureFile(
        workspace,
        state,
        joinPath(folderPath, '_index.md'),
        `# ${folder}\n\n`,
        created,
      )
    }
    for (const filename of files) {
      await ensureFile(
        workspace,
        state,
        joinPath(folderPath, filename),
        `# ${filename.replace(/\.md$/, '')}\n\n`,
        created,
      )
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
  return [
    `created-or-completed: ${root}`,
    `type: ${type}`,
    ...(plan
      ? [`planned-created: ${plannedCreated.length}`, `planned-skipped: ${plannedSkipped.length}`]
      : []),
    `created: ${created.length}`,
    ...created.map(path => `- ${path}`),
    ...plannedSkipped.map(path => `skipped-existing: ${path}`),
  ].join('\n')
}

async function searchWiki(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const queries = wikiQueries(input.query)
  const scope = input.scope === 'all' ? 'all' : 'active'
  const results = queries.map(
    () => [] as Array<{ score: number; relative: string; matches: Array<[number, string]> }>,
  )
  for (const path of wikiMarkdownFiles(state, wiki)) {
    const relative = relativeToWiki(wiki, path)
    const name = relative.split('/').at(-1)
    if (
      name === 'index.md' ||
      name === 'log.md' ||
      (scope === 'active' && relative.startsWith('归档/'))
    )
      continue
    const lines = (await workspace.read(path)).split(/\r?\n/)
    for (const [queryIndex, query] of queries.entries()) {
      const normalizedQuery = query.toLowerCase()
      const matches: Array<[number, string]> = []
      for (const [lineIndex, line] of lines.entries()) {
        if (line.toLowerCase().includes(normalizedQuery))
          matches.push([lineIndex + 1, line.trim().slice(0, 120)])
      }
      if (matches.length) {
        const titleBonus = String(name).toLowerCase().includes(normalizedQuery) ? 50 : 0
        results[queryIndex]!.push({
          score: pagePriority(relative) + titleBonus + matches.length,
          relative,
          matches,
        })
      }
    }
  }
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 1000))
  return queries
    .map((query, queryIndex) => {
      const lines = [
        `查询：${query}`,
        `范围：${scope === 'active' ? '现行知识（默认排除 归档/ 与 log.md）' : '全部知识（包含归档）'}`,
        '[证据候选]',
      ]
      for (const result of results[queryIndex]!.sort(
        (a, b) => b.score - a.score || a.relative.localeCompare(b.relative),
      )) {
        for (const [line, text] of result.matches.slice(0, 3)) {
          if (lines.length - 3 >= limit) break
          lines.push(`${result.relative}:${line}: ${text}`)
        }
        if (lines.length - 3 >= limit) break
      }
      if (lines.length === 3) lines.push('未找到匹配内容。')
      return lines.join('\n')
    })
    .join('\n\n')
}

function contextTitle(path: string): string {
  return path.split('/').at(-1)!.replace(/\.md$/i, '')
}

function wikiEntryPath(state: Snapshot, wiki: string, requested?: string): string {
  const path = requested
    ? resolveWikiFile(state, wiki, requested)
    : state.files.has(`${wiki}/index.md`)
      ? `${wiki}/index.md`
      : `${wiki}/CLAUDE.md`
  if (!state.files.has(path)) throw new Error(`Wiki 入口不存在: ${path}`)
  return path
}

async function indexedWikiCandidates(
  workspace: WikiWorkspace,
  state: Snapshot,
  wiki: string,
  queries: string[],
): Promise<{ paths: string[]; navigation: string[]; omitted: string[] }> {
  const indexPaths = wikiMarkdownFiles(state, wiki).filter(path => {
    const relative = relativeToWiki(wiki, path)
    return (
      relative === 'index.md' || relative.endsWith('/index.md') || relative.endsWith('/_index.md')
    )
  })
  const navigation = new Set(indexPaths)
  const candidates = new Set<string>()
  const normalizedQueries = queries.map(query => query.toLowerCase())
  for (const indexPath of indexPaths) {
    const content = await workspace.read(indexPath)
    for (const line of content.split(/\r?\n/)) {
      const targets = extractWikiLinks(line)
      for (const target of targets) {
        if (
          normalizedQueries.length &&
          !normalizedQueries.some(
            query => line.toLowerCase().includes(query) || target.toLowerCase().includes(query),
          )
        )
          continue
        let resolved: string
        try {
          resolved = resolveWikiFile(state, wiki, target)
        } catch {
          continue
        }
        if (state.files.has(resolved)) candidates.add(resolved)
        else if (state.dirs.has(resolved)) {
          const childIndex = `${resolved}/index.md`
          if (state.files.has(childIndex)) {
            navigation.add(childIndex)
            for (const child of extractWikiLinks(await workspace.read(childIndex))) {
              try {
                const childPath = resolveWikiFile(state, wiki, child)
                if (state.files.has(childPath)) candidates.add(childPath)
              } catch {
                // Ignore malformed links; validate/audit reports them separately.
              }
            }
          }
        }
      }
    }
  }
  for (const path of wikiMarkdownFiles(state, wiki)) {
    const relative = relativeToWiki(wiki, path)
    const name = relative.split('/').at(-1)!.toLowerCase()
    if (normalizedQueries.some(query => name.includes(query))) candidates.add(path)
  }
  const paths = [...candidates]
    .filter(path => {
      const relative = relativeToWiki(wiki, path)
      return relative !== 'log.md' && !relative.endsWith('/log.md') && !relative.startsWith('归档/')
    })
    .sort()
  const omitted = wikiMarkdownFiles(state, wiki)
    .filter(path => !paths.includes(path))
    .map(path => relativeToWiki(wiki, path))
  return { paths, navigation: [...navigation].sort(), omitted }
}

function wikiPageAliases(state: Snapshot, wiki: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>()
  for (const path of wikiMarkdownFiles(state, wiki)) {
    const relative = relativeToWiki(wiki, path).replace(/\.md$/i, '')
    for (const alias of [relative, relative.split('/').at(-1)!])
      aliases.set(alias, [...(aliases.get(alias) || []), path])
  }
  return aliases
}

export async function buildWikiContext(
  workspace: WikiWorkspace,
  input: WikiContextInput,
): Promise<WikiContextResult> {
  const state = await snapshot(workspace)
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const action = input.action || 'entry'
  const base: WikiContextResult = {
    action,
    root: wiki,
    sources: [],
    matchedRoutes: [],
    missingRoutes: [],
    expandedPaths: [],
    omittedPaths: [],
    coverage: 'none',
  }

  if (action === 'entry') {
    const path = wikiEntryPath(state, wiki, input.entryPath)
    base.entry = {
      path: relativeToWiki(wiki, path),
      content: await workspace.read(path),
      fingerprint: await workspace.fingerprint(path),
    }
    base.coverage = 'complete'
    return base
  }

  if (action === 'tree') {
    base.tree = await Promise.all(
      state.entries
        .filter(entry => entry.path.startsWith(`${wiki}/`) && !entry.path.includes('/.trash/'))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(async entry => ({
          path: relativeToWiki(wiki, entry.path),
          type: entry.isDir ? ('directory' as const) : ('file' as const),
          ...(entry.isDir ? {} : { fingerprint: await workspace.fingerprint(entry.path) }),
        })),
    )
    base.coverage = 'complete'
    return base
  }

  if (action === 'read') {
    const requested = [...new Set(input.paths || [])]
    if (!requested.length) throw new Error('Wiki 精确读取必须提供 paths')
    const maxPages = Math.max(1, Math.min(input.maxPages || 12, 12))
    if (requested.length > maxPages) throw new Error(`Wiki 单次最多读取 ${maxPages} 个页面`)
    const paths = requested.map(path => resolveWikiFile(state, wiki, path))
    const contents = await Promise.all(
      paths.map(async path => ({
        path,
        content: await workspace.read(path),
        fingerprint: await workspace.fingerprint(path),
      })),
    )
    let remainingChars = Math.max(1000, input.maxTokens || 24_000) * 4
    for (const item of contents) {
      const content = item.content.slice(0, remainingChars)
      remainingChars -= content.length
      base.sources.push({
        path: relativeToWiki(wiki, item.path),
        title: contextTitle(item.path),
        reason: 'explicit-path',
        sections: [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => match[1]!.trim()),
        content,
        fingerprint: item.fingerprint,
      })
      if (remainingChars <= 0) break
    }
    base.omittedPaths = paths.slice(base.sources.length).map(path => relativeToWiki(wiki, path))
    base.coverage = base.omittedPaths.length ? 'partial' : 'complete'
    return base
  }

  if (action === 'search') {
    const queries = wikiQueries(input.query)
    const results: NonNullable<WikiContextResult['searchResults']> = []
    const scope = input.scope === 'all' ? 'all' : 'active'
    const limit = Math.max(1, Math.min(Number(input.maxPages) || 20, 100))
    const indexed = await indexedWikiCandidates(workspace, state, wiki, queries)
    // Search only a deterministic, bounded slice of index-derived candidates.
    // ponytail: bounded candidate reads keep large Wikis responsive; raise the multiplier when measured recall needs it.
    const candidateLimit = Math.min(indexed.paths.length, Math.max(limit * 4, 24))
    const candidates = indexed.paths
      .sort((a, b) => {
        const score = (path: string) => {
          const relative = relativeToWiki(wiki, path).toLowerCase()
          return queries.reduce(
            (total, query) => total + (relative.includes(query.toLowerCase()) ? 100 : 0),
            0,
          )
        }
        return score(b) - score(a) || a.localeCompare(b)
      })
      .slice(0, candidateLimit)
    base.expandedPaths = candidates.map(path => relativeToWiki(wiki, path))
    base.omittedPaths = [
      ...indexed.omitted,
      ...indexed.paths.slice(candidateLimit).map(path => relativeToWiki(wiki, path)),
    ]
    base.coverage = base.omittedPaths.length ? 'partial' : 'complete'
    const matchesByQuery = new Map(queries.map(query => [query, 0]))
    for (const path of candidates) {
      const relative = relativeToWiki(wiki, path)
      if (relative === 'log.md' || (scope === 'active' && relative.startsWith('归档/'))) continue
      const lines = (await workspace.read(path)).split(/\r?\n/)
      for (const query of queries) {
        if ((matchesByQuery.get(query) || 0) >= limit) continue
        for (const [index, line] of lines.entries()) {
          if (!line.toLowerCase().includes(query.toLowerCase())) continue
          results.push({ query, path: relative, line: index + 1, text: line.trim().slice(0, 120) })
          matchesByQuery.set(query, (matchesByQuery.get(query) || 0) + 1)
          if ((matchesByQuery.get(query) || 0) >= limit) break
        }
      }
      if (queries.every(query => (matchesByQuery.get(query) || 0) >= limit)) break
    }
    base.searchResults = results.sort(
      (a, b) => a.query.localeCompare(b.query) || a.path.localeCompare(b.path) || a.line - b.line,
    )
    if (!results.length) base.coverage = indexed.omitted.length ? 'partial' : 'none'
    return base
  }

  const requested = [...new Set(input.paths || [])]
  if (!requested.length) throw new Error('Wiki 链接读取必须提供 paths')
  const aliases = wikiPageAliases(state, wiki)
  const sourcePaths = requested.map(path => resolveWikiFile(state, wiki, path))
  const pageContents = new Map<string, string>()
  const indexed = await indexedWikiCandidates(workspace, state, wiki, [])
  for (const path of new Set([...sourcePaths, ...indexed.navigation]))
    pageContents.set(path, await workspace.read(path))
  const links: NonNullable<WikiContextResult['links']> = []
  for (const source of sourcePaths) {
    for (const target of extractWikiLinks(pageContents.get(source)!)) {
      const matches = aliases.get(normalizedLinkTarget(target)) || []
      links.push({
        source: relativeToWiki(wiki, source),
        target,
        ...(matches.length === 1 ? { resolved: relativeToWiki(wiki, matches[0]!) } : {}),
        direction: 'out',
        status: matches.length === 1 ? 'resolved' : matches.length ? 'ambiguous' : 'missing',
      })
    }
  }
  for (const [source, content] of pageContents) {
    if (sourcePaths.includes(source)) continue
    for (const target of extractWikiLinks(content)) {
      const matches = aliases.get(normalizedLinkTarget(target)) || []
      for (const requestedPath of sourcePaths)
        if (matches.length === 1 && matches[0] === requestedPath)
          links.push({
            source: relativeToWiki(wiki, source),
            target,
            resolved: relativeToWiki(wiki, requestedPath),
            direction: 'in',
            status: 'resolved',
          })
    }
  }
  base.links = links.sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  )
  base.expandedPaths = [...pageContents.keys()].map(path => relativeToWiki(wiki, path)).sort()
  base.omittedPaths = indexed.omitted.filter(path => !base.expandedPaths.includes(path))
  base.coverage = base.omittedPaths.length ? 'partial' : 'complete'
  return base
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
  let lastOperation = '无记录'
  if (state.files.has(`${wiki}/log.md`)) {
    lastOperation =
      (await workspace.read(`${wiki}/log.md`))
        .split(/\r?\n/)
        .reverse()
        .find(line => line.startsWith('## ['))
        ?.replace(/^#+\s*/, '') || lastOperation
  }
  const topLevelDirectories = [...state.dirs]
    .filter(path => path.startsWith(`${wiki}/`) && !path.slice(wiki.length + 1).includes('/'))
    .sort()
  const legacyDevelopmentLayout = ['架构', '开发', '运维', '排障'].some(name =>
    topLevelDirectories.includes(`${wiki}/${name}`),
  )
  return [
    '📊 类型：通用 Wiki',
    ...(legacyDevelopmentLayout ? ['类型：开发项目（兼容旧状态视图）'] : []),
    `文件总数：${files.length}`,
    ...topLevelDirectories.map(path => {
      const name = relativeToWiki(wiki, path)
      return `${name}：${files.filter(file => file.startsWith(`${path}/`)).length} 篇`
    }),
    `上次操作：${lastOperation}`,
  ].join('\n')
}

async function graph(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  if (!input.evidencePaths?.length) throw new Error('生成局部关系图必须提供至少一个种子页面')

  const depth = input.depth ?? 1
  if (!Number.isInteger(depth) || depth < 1 || depth > 2)
    throw new Error('局部关系图 depth 仅支持 1 或 2')
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
  const seeds = [
    ...new Set(
      input.evidencePaths.map(rawPath => {
        const candidate = resolveWikiFile(state, wiki, rawPath)
        const path = candidate.endsWith('.md') ? candidate : `${candidate}.md`
        if (!state.files.has(path)) throw new Error(`种子页面不存在：${path}`)
        return path
      }),
    ),
  ]

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
    const next = [...new Set(frontier.flatMap(path => [...(adjacency.get(path) || [])]))].filter(
      path => !selected.has(path),
    )
    next.forEach(path => selected.add(path))
    frontier = next
  }

  const rawOutput = String(input.path || '').trim()
  const defaultName = `${relativeToWiki(wiki, seeds[0]!).replace(/\.md$/, '').split('/').at(-1)}-关系图.canvas`
  const normalizedOutput = normalizePath(rawOutput || defaultName)
  const output =
    normalizedOutput.startsWith('wiki/') || normalizedOutput.startsWith('docs/wiki/')
      ? normalizedOutput
      : joinPath(wiki, normalizedOutput)
  if (!output.startsWith(`${wiki}/`) || !output.endsWith('.canvas'))
    throw new Error('关系图必须保存为当前 Wiki 内的 .canvas 文件')

  type CanvasNode = {
    id: string
    type: string
    x: number
    y: number
    width: number
    height: number
    file?: string
    [key: string]: unknown
  }
  type CanvasEdge = { id: string; fromNode: string; toNode: string; [key: string]: unknown }
  let existing: { nodes: CanvasNode[]; edges: CanvasEdge[] } = { nodes: [], edges: [] }
  if (state.files.has(output)) {
    try {
      const parsed = JSON.parse(await workspace.read(output)) as Partial<typeof existing>
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges))
        throw new Error('缺少 nodes 或 edges')
      existing = { nodes: parsed.nodes, edges: parsed.edges }
    } catch (error) {
      throw new Error(
        `现有 Canvas 无法安全更新：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!input.apply)
      return `关系图更新预览（未写盘，加 apply:true 才真正执行）：${output}\n局部页面: ${selected.size}`
  }

  const nodes = [...existing.nodes]
  const usedIds = new Set([...nodes.map(node => node.id), ...existing.edges.map(edge => edge.id)])
  const nodeByFile = new Map(
    nodes.filter(node => node.type === 'file' && node.file).map(node => [node.file!, node]),
  )
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
      id: nextId('wiki'),
      type: 'file',
      file: path,
      x: (index % 5) * 300 + 50,
      y: Math.floor(index / 5) * 150 + 50,
      width: 250,
      height: 80,
    }
    nodes.push(node)
    nodeIdByPath.set(path, node.id)
  }

  const selectedIds = new Set(nodeIdByPath.values())
  const edges = existing.edges.filter(
    edge => !(selectedIds.has(edge.fromNode) && selectedIds.has(edge.toNode)),
  )
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

async function validate(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('验证失败：未找到 docs/wiki/ 或 wiki/')
  const entry = wikiEntryPath(state, wiki)
  const navigationPaths = wikiMarkdownFiles(state, wiki).filter(path => {
    const relative = relativeToWiki(wiki, path)
    return (
      relative === relativeToWiki(wiki, entry) ||
      relative === 'index.md' ||
      relative.endsWith('/index.md') ||
      relative.endsWith('/_index.md') ||
      relative === 'CLAUDE.md'
    )
  })
  const broken: string[] = []
  for (const path of [...new Set(navigationPaths)]) {
    for (const target of extractWikiLinks(await workspace.read(path))) {
      if (!linkExists(state, wiki, target))
        broken.push(`${relativeToWiki(wiki, path)}: [[${target}]]`)
    }
  }
  if (broken.length)
    throw new Error(`验证失败：稳定入口存在断链\n${broken.map(item => `- ${item}`).join('\n')}`)
  return `验证通过：${relativeToWiki(wiki, entry)} 及分区入口存在且声明的链接可达`
}

async function evidence(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  if (!input.evidencePaths?.length) throw new Error('来源证据路径不能为空')
  const paths = [...new Set(input.evidencePaths.map(rawPath => normalizePath(rawPath)))]
  const lines = ['[来源证据]']
  for (const path of paths) {
    if (state.dirs.has(path)) throw new Error(`来源证据必须是文件: ${path}`)
    let fingerprint: string
    try {
      fingerprint = await workspace.fingerprint(path)
    } catch (error) {
      throw new Error(
        `来源证据文件无法读取: ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
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

const EVIDENCE_HEADERS = [
  'Wiki 位置',
  '来源角色',
  '原始来源',
  '已处理范围',
  '写入时指纹',
  '记录时间',
]

function tableCellText(cell: unknown): string {
  if (!cell || typeof cell !== 'object') return ''
  const tokens = (cell as { tokens?: Array<Record<string, unknown>> }).tokens || []
  return tokens
    .map(token => String(token.text || token.raw || ''))
    .join('')
    .trim()
}

function parseEvidenceRecords(markdown: string): { records: EvidenceRecord[]; problem?: string } {
  const tokens = marked.lexer(markdown) as Array<Record<string, any>>
  const tables: Array<Record<string, any>> = []
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading' || token.depth !== 2 || String(token.text).trim() !== '证据记录')
      continue
    const table = tokens.slice(index + 1).find(item => item.type !== 'space')
    if (table?.type === 'table') tables.push(table)
  }
  if (tables.length > 1)
    return { records: [], problem: '存在多个六列「证据记录」表，需要确认唯一现行表' }
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

function evidenceWikiTarget(
  state: Snapshot,
  wiki: string,
  location: string,
): { path?: string; label: string } {
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
    const matches = wikiMarkdownFiles(state, wiki).filter(
      item => item.slice(0, -3).split('/').at(-1) === stem,
    )
    if (matches.length !== 1) return { label }
    path = matches[0]!
  }
  if (!state.files.has(path)) return { label }
  return {
    path,
    label: heading
      ? `${relativeToWiki(wiki, path).replace(/\.md$/, '')}#${heading}`
      : relativeToWiki(wiki, path),
  }
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
    const required = [
      record.wikiLocation,
      record.sourceRole,
      record.sourcePath,
      record.processedRange,
      record.fingerprint,
      record.recordedAt,
    ]
    if (
      required.some(value => !value) ||
      !target.path ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        record.recordedAt,
      )
    ) {
      lines.push(`- [登记不完整] ${target.label || record.wikiLocation}: Wiki 位置或字段无效`)
      continue
    }
    const heading = target.label.includes('#') ? target.label.split('#').slice(1).join('#') : ''
    if (heading) {
      const headings = marked
        .lexer(await workspace.read(target.path))
        .filter(token => token.type === 'heading')
        .map(token => String((token as { text?: string }).text || '').trim())
      if (!headings.includes(heading)) {
        lines.push(`- [登记不完整] ${target.label}: Wiki 章节不存在`)
        continue
      }
    }
    if (
      /^https?:\/\//i.test(record.sourcePath) ||
      /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(record.sourcePath) ||
      record.fingerprint.startsWith('未计算')
    ) {
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
      lines.push(
        `- [${current === stored ? '当前一致' : '来源已变化'}] ${target.label} <- ${sourcePath}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lines.push(
        `- [${/不存在|not found|not exist|no such file/i.test(message) ? '来源不存在' : '无法验证'}] ${target.label} <- ${sourcePath}${message ? `: ${message}` : ''}`,
      )
    }
  }
  return lines.length ? lines : ['无已登记的新版来源记录。']
}

async function audit(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const files = wikiMarkdownFiles(state, wiki)
  const sources = input.evidencePaths?.length
    ? [
        ...new Set(
          input.evidencePaths.flatMap(rawPath => {
            const candidate = resolveWikiFile(state, wiki, rawPath)
            const file = candidate.endsWith('.md') ? candidate : `${candidate}.md`
            if (state.files.has(file)) return [file]
            if (state.dirs.has(candidate))
              return files.filter(path => path.startsWith(`${candidate}/`))
            throw new Error(`巡检范围不存在：${candidate}`)
          }),
        ),
      ]
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
  const isHistorical = (relative: string, text: string) =>
    relative === 'log.md' ||
    relative.startsWith('归档/') ||
    /^.{0,300}状态[：:]\s*(历史|已归档|已替代)/s.test(text.slice(0, 500))
  for (const path of sources) {
    const relative = relativeToWiki(wiki, path)
    const text = await workspace.read(path)
    const pageHistorical = isHistorical(relative, text)
    for (const target of extractWikiLinks(text)) {
      const resolved = resolveTarget(target)
      if (resolved.path) {
        if (state.files.has(resolved.path)) linkedTo.add(resolved.path)
      } else if (pageHistorical) {
        historical.push(
          `${relative}: [[${target}]] ${resolved.ambiguous ? '目标不唯一' : '指向的笔记不存在'}`,
        )
      } else if (resolved.ambiguous) {
        confirmed.push(
          `${relative}: 歧义链接 [[${target}]] 可指向 ${resolved.ambiguous.map(item => relativeToWiki(wiki, item)).join('、')}`,
        )
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
      if (isHistorical(relative, text) || navigation.has(name) || relative.startsWith('巡检报告/'))
        continue
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

async function closeout(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('收尾失败：未找到 docs/wiki/ 或 wiki/')
  const evidence = await Promise.all(
    (input.evidencePaths || []).map(async path => {
      const normalized = normalizePath(path)
      return { path: normalized, content: await workspace.read(normalized) }
    }),
  )
  const evidenceText = evidence
    .map(item => `${item.path}\n${item.content}`)
    .join('\n')
    .toLowerCase()
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
  for (const item of evidence)
    lines.push(`- ${item.path} sha256:${await shortSha256(item.content)}`)
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

async function replace(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
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
    throw new Error(
      `目标文件多处命中（${matches.length} 处，行 ${lineNumbers.join('、')}），需要明确 replaceAll:true`,
    )
  }
  const after =
    input.replaceAll === true
      ? before.split(oldText).join(newText)
      : before.replace(oldText, newText)
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
    lines.push(
      `- ${target} sha256:${await shortSha256(before)} -> sha256:${await shortSha256(verified)}`,
    )
    lines.push(
      `验证：内容一致=是，新值存在=${newText ? (verified.includes(newText) ? '是' : '否') : '空值替换'}，旧值剩余=${verified.split(oldText).length - 1}`,
    )
  }
  return lines.join('\n')
}

async function extend(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  requireRepairBasis(input)
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const category = normalizePath(String(input.category || ''))
  const description = String(input.description || '').trim()
  if (!description) throw new Error('新分类说明不能为空')
  const directory = joinPath(wiki, category)
  if (hasTree(state, directory)) throw new Error(`分类已存在: ${directory}`)
  const indexPath = joinPath(directory, 'index.md')
  if (input.apply) {
    await workspace.createDirectory(directory)
    await workspace.write(indexPath, `# ${category.split('/').at(-1)}\n\n> ${description}\n`)
    const parts = category.split('/')
    const parent = parts.slice(0, -1).join('/')
    const navigationIndex = parent ? joinPath(wiki, parent, 'index.md') : `${wiki}/index.md`
    if (parent && !state.files.has(navigationIndex)) {
      const legacy = joinPath(wiki, parent, '_index.md')
      await workspace.write(
        navigationIndex,
        state.files.has(legacy) ? await workspace.read(legacy) : `# ${parts.at(-2)}\n\n`,
      )
      state.files.add(navigationIndex)
    }
    if (state.files.has(navigationIndex)) {
      const before = await workspace.read(navigationIndex)
      await workspace.write(
        navigationIndex,
        `${before.replace(/\n*$/, '')}\n\n- [[${category}/index|${parts.at(-1)}]] — ${description}\n`,
      )
    }
    const legacyNavigationIndex = parent ? joinPath(wiki, parent, '_index.md') : ''
    if (legacyNavigationIndex && state.files.has(legacyNavigationIndex)) {
      const before = await workspace.read(legacyNavigationIndex)
      await workspace.write(
        legacyNavigationIndex,
        `${before.replace(/\n*$/, '')}\n\n- [[${category}/index|${parts.at(-1)}]] — ${description}\n`,
      )
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

function resolveWikiTarget(wiki: string, rawPath: string): string {
  const path = normalizePath(rawPath)
  if (path === wiki || path.startsWith(`${wiki}/`)) return path
  if (/^(?:docs\/wiki|wiki)(?:\/|$)/.test(path)) throw new Error(`Wiki 路径必须位于 ${wiki}/`)
  return joinPath(wiki, path)
}

function pageLink(wiki: string, path: string): string {
  return relativeToWiki(wiki, path).replace(/\.md$/i, '')
}

function appendUniqueLine(content: string, line: string): string {
  if (content.split(/\r?\n/).some(item => item.trim() === line.trim())) return content
  return `${content.replace(/\s*$/, '')}\n\n${line}\n`
}

function removeWikiLink(content: string, target: string): string {
  const normalized = normalizedLinkTarget(target)
  return content
    .split(/\r?\n/)
    .filter(line => !extractWikiLinks(line).some(link => normalizedLinkTarget(link) === normalized))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function rewriteLiveWikiLinks(content: string, replacements: Map<string, string>): string {
  let fenced = false
  let htmlComment = false
  return content
    .split(/\r?\n/)
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      let output = ''
      let cursor = 0
      while (cursor < line.length) {
        if (!htmlComment && line.startsWith('<!--', cursor)) htmlComment = true
        if (htmlComment) {
          const end = line.indexOf('-->', cursor)
          if (end < 0) return output + line.slice(cursor)
          output += line.slice(cursor, end + 3)
          cursor = end + 3
          htmlComment = false
          continue
        }
        if (line[cursor] === '`') {
          const end = line.indexOf('`', cursor + 1)
          if (end < 0) return output + line.slice(cursor)
          output += line.slice(cursor, end + 1)
          cursor = end + 1
          continue
        }
        const match = line.slice(cursor).match(/^\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/)
        if (match) {
          const target = normalizedLinkTarget(match[1]!.trim())
          const replacement = replacements.get(target)
          output += replacement ? `[[${replacement}${match[2] || ''}${match[3] || ''}]]` : match[0]
          cursor += match[0].length
          continue
        }
        output += line[cursor]
        cursor += 1
      }
      return output
    })
    .join('\n')
}

function closestNavigation(files: Map<string, string>, wiki: string, page: string): string | null {
  let parent = page.slice(0, page.lastIndexOf('/'))
  if (page.endsWith('/index.md') && parent !== wiki)
    parent = parent.slice(0, parent.lastIndexOf('/'))
  while (parent.startsWith(wiki)) {
    for (const name of ['index.md', '_index.md']) {
      const candidate = `${parent}/${name}`
      if (files.has(candidate) && candidate !== page) return candidate
    }
    if (parent === wiki) break
    parent = parent.slice(0, parent.lastIndexOf('/'))
  }
  return files.has(`${wiki}/index.md`)
    ? `${wiki}/index.md`
    : files.has(`${wiki}/CLAUDE.md`)
      ? `${wiki}/CLAUDE.md`
      : null
}

async function applyWiki(
  workspace: WikiWorkspace,
  state: Snapshot,
  input: WikiActionInput,
): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const basis = (Array.isArray(input.basis) ? input.basis : [input.basis]).filter(
    (value): value is string => Boolean(value?.trim()),
  )
  if (!input.reason?.trim() || !basis.length) throw new Error('Wiki apply 必须提供 reason 和 basis')
  const operations = input.operations || []
  if (!operations.length) throw new Error('Wiki apply 必须提供 operations')
  if (operations.length > 200) throw new Error('单次 Wiki apply 最多 200 个操作')
  if (
    operations.some(operation => ['move', 'trash'].includes(operation.kind)) &&
    !input.confirmedPlanId
  )
    throw new Error('移动、重命名或回收必须先确认完整预览')
  if (operations.some(operation => ['move', 'trash'].includes(operation.kind))) {
    const expectedPlanId = wikiPlanConfirmationId({ reason: input.reason, basis, operations })
    if (input.confirmedPlanId !== expectedPlanId) throw new Error('Wiki 确认计划已变化，请重新预览并确认')
  }
  if (!workspace.remove) throw new Error('当前平台不支持 Wiki 事务恢复')

  const allWikiFiles = wikiMarkdownFiles(state, wiki)
  const requiresGlobalScan = operations.some(
    operation => operation.kind === 'move' || operation.kind === 'trash',
  )
  const pathsToLoad = requiresGlobalScan
    ? allWikiFiles
    : [
        ...new Set([
          ...allWikiFiles.filter(path =>
            /(?:^|\/)(?:_?index|CLAUDE|hot|log|来源索引)\.md$/.test(path),
          ),
          ...operations
            .filter(operation => operation.kind === 'replace' || operation.kind === 'append')
            .map(operation => resolveWikiTarget(wiki, operation.path)),
        ]),
      ].filter(path => state.files.has(path))
  const loadedFiles = await Promise.all(
    pathsToLoad.map(async path => [path, await workspace.read(path)] as const),
  )
  const originalFiles = new Map(loadedFiles)
  const originalFingerprints = new Map<string, string>()
  for (const path of pathsToLoad) originalFingerprints.set(path, await workspace.fingerprint(path))
  const files = new Map(originalFiles)
  const dirs = new Set(state.dirs)
  const createdDirs = new Set<string>()
  const moves: Array<{ from: string; to: string }> = []
  const trashed: string[] = []
  const navigationAdds: Array<{ path: string; title: string }> = []
  const navigationRemoves: string[] = []
  const linkReplacements = new Map<string, string>()
  const affectedDirectories = new Set<string>()

  const affectDirectory = (directory: string) => {
    let current = directory
    while (current.startsWith(`${wiki}/`)) {
      affectedDirectories.add(current)
      current = current.slice(0, current.lastIndexOf('/'))
    }
  }

  const ensureVirtualParents = (path: string) => {
    let parent = path.slice(0, path.lastIndexOf('/'))
    while (parent.startsWith(`${wiki}/`) && !dirs.has(parent)) {
      dirs.add(parent)
      createdDirs.add(parent)
      parent = parent.slice(0, parent.lastIndexOf('/'))
    }
  }

  for (const operation of operations) {
    const path = resolveWikiTarget(wiki, operation.path)
    if (operation.kind === 'mkdir') {
      if (files.has(path)) throw new Error(`目录路径与文件冲突: ${path}`)
      ensureVirtualParents(`${path}/child`)
      dirs.add(path)
      createdDirs.add(path)
      affectDirectory(path)
      continue
    }
    if (!path.endsWith('.md') && operation.kind !== 'move' && operation.kind !== 'trash')
      throw new Error(`Wiki 内容操作只允许 Markdown 文件: ${path}`)
    if (operation.kind === 'create') {
      if (files.has(path) || dirs.has(path)) throw new Error(`Wiki 页面已存在: ${path}`)
      ensureVirtualParents(path)
      files.set(path, operation.content)
      affectDirectory(path.slice(0, path.lastIndexOf('/')))
      navigationAdds.push({ path, title: operation.title.trim() || contextTitle(path) })
      continue
    }
    if (operation.kind === 'replace') {
      const before = files.get(path)
      if (before == null) throw new Error(`Wiki 页面不存在: ${path}`)
      if (!operation.oldText || operation.oldText === operation.newText)
        throw new Error('replace 必须提供不同的唯一旧值和新值')
      const count = before.split(operation.oldText).length - 1
      if (!count) throw new Error(`旧值未命中: ${path}`)
      if (count > 1 && operation.replaceAll !== true)
        throw new Error(`目标文件多处命中（${count} 处），需要确认 replaceAll`)
      files.set(
        path,
        operation.replaceAll
          ? before.split(operation.oldText).join(operation.newText)
          : before.replace(operation.oldText, operation.newText),
      )
      affectDirectory(path.slice(0, path.lastIndexOf('/')))
      continue
    }
    if (operation.kind === 'append') {
      const before = files.get(path)
      if (before == null) throw new Error(`Wiki 页面不存在: ${path}`)
      const marker = `<!-- wiki-apply:${operation.idempotencyKey} -->`
      if (!before.includes(marker))
        files.set(path, `${before.replace(/\s*$/, '')}\n\n${operation.content}\n${marker}\n`)
      affectDirectory(path.slice(0, path.lastIndexOf('/')))
      continue
    }
    if (
      !state.paths.has(path) &&
      ![...state.paths].some(candidate => candidate.startsWith(`${path}/`))
    )
      throw new Error(`Wiki 路径不存在: ${path}`)
    if (operation.kind === 'move') {
      if (!workspace.move) throw new Error('当前平台不支持 Wiki 移动')
      const destination = resolveWikiTarget(wiki, operation.destination)
      if (state.paths.has(destination) || files.has(destination) || dirs.has(destination))
        throw new Error(`移动目标已存在: ${destination}`)
      if (destination.startsWith(`${path}/`)) throw new Error('不能把目录移动到自身内部')
      ensureVirtualParents(destination.includes('.') ? destination : `${destination}/child`)
      for (const [candidate, content] of [...files])
        if (candidate === path || candidate.startsWith(`${path}/`)) {
          const movedPath = `${destination}${candidate.slice(path.length)}`
          files.delete(candidate)
          files.set(movedPath, content)
          if (candidate.endsWith('.md'))
            linkReplacements.set(pageLink(wiki, candidate), pageLink(wiki, movedPath))
        }
      for (const candidate of [...dirs])
        if (candidate === path || candidate.startsWith(`${path}/`)) {
          dirs.delete(candidate)
          dirs.add(`${destination}${candidate.slice(path.length)}`)
        }
      moves.push({ from: path, to: destination })
      navigationRemoves.push(pageLink(wiki, path))
      if (destination.endsWith('.md'))
        navigationAdds.push({ path: destination, title: contextTitle(destination) })
      linkReplacements.set(pageLink(wiki, path), pageLink(wiki, destination))
      affectDirectory(path.slice(0, path.lastIndexOf('/')))
      affectDirectory(
        destination.endsWith('.md')
          ? destination.slice(0, destination.lastIndexOf('/'))
          : destination,
      )
      continue
    }
    const targetLink = pageLink(wiki, path)
    const inbound = [...files]
      .flatMap(([source, content]) =>
        source === path || source.startsWith(`${path}/`)
          ? []
          : extractWikiLinks(content).some(link => normalizedLinkTarget(link) === targetLink)
            ? [relativeToWiki(wiki, source)]
            : [],
      )
      .filter(source => !/(?:^|\/)(?:_?index|CLAUDE)\.md$/.test(source))
    if (inbound.length) throw new Error(`仍有现行入链，不能回收: ${inbound.join('、')}`)
    for (const candidate of [...files.keys()])
      if (candidate === path || candidate.startsWith(`${path}/`)) files.delete(candidate)
    for (const candidate of [...dirs])
      if (candidate === path || candidate.startsWith(`${path}/`)) dirs.delete(candidate)
    navigationRemoves.push(targetLink)
    trashed.push(path)
    affectDirectory(path.slice(0, path.lastIndexOf('/')))
  }

  if (!files.has(`${wiki}/index.md`)) files.set(`${wiki}/index.md`, '# Wiki\n')
  for (const directory of [...affectedDirectories].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  )) {
    const index = `${directory}/index.md`
    if (files.has(index)) continue
    const legacy = `${directory}/_index.md`
    files.set(index, files.get(legacy) || `# ${directory.split('/').at(-1)}\n`)
    navigationAdds.push({ path: index, title: directory.split('/').at(-1)! })
    if (files.has(legacy)) navigationRemoves.push(pageLink(wiki, legacy))
  }

  if (linkReplacements.size)
    for (const [path, content] of files)
      files.set(path, rewriteLiveWikiLinks(content, linkReplacements))
  for (const target of navigationRemoves)
    for (const [path, content] of files)
      if (/(?:^|\/)(?:_?index|CLAUDE)\.md$/.test(relativeToWiki(wiki, path)))
        files.set(path, removeWikiLink(content, target))
  for (const item of navigationAdds) {
    const nav = closestNavigation(files, wiki, item.path)
    if (nav)
      files.set(
        nav,
        appendUniqueLine(files.get(nav)!, `- [[${pageLink(wiki, item.path)}|${item.title}]]`),
      )
  }

  let sourceRegistration = input.sources?.length ? 'skipped (来源索引.md 未配置)' : 'not-requested'
  if (input.sources?.length && files.has(`${wiki}/来源索引.md`)) {
    let sourceIndex = files.get(`${wiki}/来源索引.md`)!
    const now = new Date().toISOString()
    for (const source of input.sources) {
      const resolvedWikiPath = resolveWikiTarget(wiki, source.wikiPath)
      if (!files.has(resolvedWikiPath)) throw new Error(`来源登记目标不存在: ${source.wikiPath}`)
      const wikiPath =
        pageLink(wiki, resolvedWikiPath) + (source.wikiSection ? `#${source.wikiSection}` : '')
      let fingerprint = `未计算（无法读取来源）`
      try {
        fingerprint = `sha256:${await workspace.fingerprint(normalizePath(source.sourcePath))}`
      } catch {}
      const row = `| [[${wikiPath}]] | ${source.sourceRole} | \`${source.sourcePath}\` | ${source.processedScope} | \`${fingerprint}\` | ${now} |`
      sourceIndex = appendUniqueLine(sourceIndex, row)
    }
    files.set(`${wiki}/来源索引.md`, sourceIndex)
    sourceRegistration = 'registered'
  }
  const hasPendingChanges =
    files.size !== originalFiles.size ||
    [...files].some(([path, content]) => originalFiles.get(path) !== content)
  if (hasPendingChanges && files.has(`${wiki}/log.md`)) {
    const targets = operations
      .map(operation =>
        operation.kind === 'move'
          ? `${operation.path} -> ${operation.destination}`
          : operation.path,
      )
      .join('、')
    files.set(
      `${wiki}/log.md`,
      `${files.get(`${wiki}/log.md`)!.replace(/\s*$/, '')}\n\n## [${new Date().toISOString()}] ${input.reason.trim()}\n\n依据：${basis.join('；')}\n操作：${targets}\n`,
    )
  }

  for (const [path, fingerprint] of originalFingerprints)
    if ((await workspace.fingerprint(path)) !== fingerprint)
      throw new Error(`Wiki 文件已被其他位置修改，整批未写入: ${path}`)

  const movedDestinations = new Map(moves.map(move => [move.to, move.from]))
  const changedFiles = [...files]
    .filter(([path, content]) => {
      const originalPath = [...movedDestinations].find(
        ([destination]) => path === destination || path.startsWith(`${destination}/`),
      )
      const baseline = originalPath
        ? originalFiles.get(`${originalPath[1]}${path.slice(originalPath[0].length)}`)
        : originalFiles.get(path)
      return baseline !== content
    })
    .sort(
      ([a], [b]) =>
        Number(/(?:_?index|CLAUDE|log)\.md$/.test(a)) -
          Number(/(?:_?index|CLAUDE|log)\.md$/.test(b)) || a.localeCompare(b),
    )
  const written: string[] = []
  const verifiedFingerprints = new Map<string, string>()
  const completedMoves: Array<{ from: string; to: string }> = []
  const completedTrash: Array<{ from: string; to: string }> = []
  try {
    for (const directory of [...createdDirs].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    ))
      if (!state.dirs.has(directory)) await workspace.createDirectory(directory)
    for (const move of moves) {
      await workspace.move!(move.from, move.to)
      completedMoves.push(move)
    }
    for (const path of trashed) {
      const recovery = `.jiucaihezi/wiki-trash/${Date.now()}/${relativeToWiki(wiki, path)}`
      if (!workspace.move) throw new Error('当前平台不支持可恢复回收')
      await workspace.move(path, recovery)
      completedTrash.push({ from: path, to: recovery })
    }
    for (const [path, content] of changedFiles) {
      await workspace.write(path, content)
      written.push(path)
    }
    const finalState = await snapshot(workspace)
    for (const path of files.keys()) {
      if (!finalState.files.has(path)) throw new Error(`Wiki apply 验证失败，文件不存在: ${path}`)
      if (written.includes(path)) verifiedFingerprints.set(path, await workspace.fingerprint(path))
    }
    for (const move of moves)
      if (finalState.paths.has(move.from))
        throw new Error(`Wiki apply 验证失败，旧路径仍存在: ${move.from}`)
  } catch (error) {
    for (const path of written.reverse()) {
      const moved = [...movedDestinations].find(
        ([destination]) => path === destination || path.startsWith(`${destination}/`),
      )
      const original = moved
        ? originalFiles.get(`${moved[1]}${path.slice(moved[0].length)}`)
        : originalFiles.get(path)
      if (original == null) await workspace.remove(path).catch(() => {})
      else await workspace.write(path, original).catch(() => {})
    }
    for (const move of completedTrash.reverse())
      await workspace.move?.(move.to, move.from).catch(() => {})
    for (const move of completedMoves.reverse())
      await workspace.move?.(move.to, move.from).catch(() => {})
    for (const directory of [...createdDirs].sort((a, b) => b.length - a.length))
      if (!state.dirs.has(directory)) await workspace.remove(directory).catch(() => {})
    throw error
  }

  return [
    'status: succeeded',
    `reason: ${input.reason.trim()}`,
    `operations: ${operations.length}`,
    `written: ${written.length}`,
    `source-registration: ${sourceRegistration}`,
    ...written.map(
      path =>
        `- ${path} sha256:${originalFingerprints.get(path) || 'new'} -> sha256:${verifiedFingerprints.get(path)}`,
    ),
    ...completedTrash.map(item => `recovery: ${item.to}`),
  ].join('\n')
}

export async function executeWikiAction(
  workspace: WikiWorkspace,
  input: WikiActionInput,
): Promise<string> {
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
    case 'scaffold':
      return await scaffold(workspace, state, input.type || 'generic', input.plan)
    case 'search':
      return await searchWiki(workspace, state, input)
    case 'context':
      return JSON.stringify(
        await buildWikiContext(workspace, input as unknown as WikiContextInput),
        null,
        2,
      )
    case 'status':
      return await status(workspace, state)
    case 'graph':
      return await graph(workspace, state, input)
    case 'validate':
      return await validate(workspace, state, input)
    case 'audit':
      return await audit(workspace, state, input)
    case 'evidence':
      return await evidence(workspace, state, input)
    case 'closeout':
      return await closeout(workspace, state, input)
    case 'replace':
      return await replace(workspace, state, input)
    case 'extend':
      return await extend(workspace, state, input)
    case 'apply':
      return await applyWiki(workspace, state, input)
    default:
      throw new Error(`不支持的 Wiki action: ${String(input.action)}`)
  }
}
