import { marked } from 'marked'
import { WIKI_STRUCTURES, WIKI_TEMPLATES, type WikiProjectType } from './wikiStructures'

export interface WikiWorkspaceEntry {
  path: string
  isDir: boolean
}

export interface WikiWorkspace {
  list(): Promise<WikiWorkspaceEntry[]>
  read(path: string): Promise<string>
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
  | 'closeout'
  | 'replace'
  | 'link'
  | 'extend'

export interface WikiActionInput {
  action: WikiAction
  type?: WikiProjectType
  query?: string
  scope?: 'active' | 'all'
  limit?: number
  evidencePaths?: string[]
  path?: string
  oldText?: string
  newText?: string
  target?: string
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
  if (raw.startsWith('/') || raw.includes('\0')) throw new Error('Wiki 路径必须位于当前项目内')
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
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)
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
    await ensureFile(workspace, state, joinPath(root, 'CLAUDE.md'), WIKI_TEMPLATES.genericClaude, created)
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
  const query = String(input.query || '').trim()
  if (!query) throw new Error('Wiki 搜索关键词不能为空')
  const scope = input.scope === 'all' ? 'all' : 'active'
  const results: Array<{ score: number; relative: string; matches: Array<[number, string]> }> = []
  for (const path of wikiMarkdownFiles(state, wiki)) {
    const relative = relativeToWiki(wiki, path)
    const name = relative.split('/').at(-1)
    if (name === 'index.md' || name === 'log.md' || (scope === 'active' && relative.startsWith('归档/'))) continue
    const matches: Array<[number, string]> = []
    for (const [index, line] of (await workspace.read(path)).split(/\r?\n/).entries()) {
      if (line.toLowerCase().includes(query.toLowerCase())) matches.push([index + 1, line.trim().slice(0, 120)])
    }
    if (matches.length) {
      const titleBonus = String(name).toLowerCase().includes(query.toLowerCase()) ? 50 : 0
      results.push({ score: pagePriority(relative) + titleBonus + matches.length, relative, matches })
    }
  }
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 1000))
  const lines = [`查询：${query}`, `范围：${scope === 'active' ? '现行知识（默认排除 归档/ 与 log.md）' : '全部知识（包含归档）'}`, '[证据候选]']
  for (const result of results.sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative))) {
    for (const [line, text] of result.matches.slice(0, 3)) {
      if (lines.length - 3 >= limit) break
      lines.push(`${result.relative}:${line}: ${text}`)
    }
    if (lines.length - 3 >= limit) break
  }
  if (lines.length === 3) lines.push('未找到匹配内容。')
  return lines.join('\n')
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

async function graph(workspace: WikiWorkspace, state: Snapshot): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const pages = wikiMarkdownFiles(state, wiki).filter(path => !['index.md', 'log.md', 'hot.md', '_index.md'].includes(path.split('/').at(-1)!))
  const pageByTarget = new Map<string, string>()
  const nodes = pages.map((path, index) => {
    const relative = relativeToWiki(wiki, path).replace(/\.md$/, '')
    const id = `wiki_${index + 1}`
    pageByTarget.set(relative, id)
    if (!pageByTarget.has(relative.split('/').at(-1)!)) pageByTarget.set(relative.split('/').at(-1)!, id)
    return { id, type: 'text', x: (index % 5) * 300 + 50, y: Math.floor(index / 5) * 150 + 50, width: 250, height: 60, text: `**${relative.split('/').at(-1)}**` }
  })
  const edges: Array<{ id: string; fromNode: string; toNode: string }> = []
  for (const [index, path] of pages.entries()) {
    for (const target of extractWikiLinks(await workspace.read(path))) {
      const toNode = pageByTarget.get(normalizedLinkTarget(target)) || pageByTarget.get(normalizedLinkTarget(target).split('/').at(-1)!)
      if (toNode) edges.push({ id: `edge_${edges.length + 1}`, fromNode: `wiki_${index + 1}`, toNode })
    }
  }
  const output = `${wiki}/关系图.canvas`
  await workspace.write(output, JSON.stringify({ nodes, edges }, null, 2))
  return `✅ ${output}\n节点: ${nodes.length}，边: ${edges.length}`
}

async function validate(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('验证失败：未找到 docs/wiki/ 或 wiki/')
  const isGeneric = input.type === 'generic'
  const isDev = !isGeneric && (input.type === 'dev_project' || state.dirs.has(`${wiki}/开发`))
  const required = isDev
    ? ['CLAUDE.md', 'hot.md', 'log.md', '来源索引.md', '开发', '架构', '运维', '排障', '学习', '巡检报告', '归档']
    : isGeneric
      ? ['CLAUDE.md', 'index.md', 'hot.md', 'log.md', '来源索引.md']
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

async function audit(workspace: WikiWorkspace, state: Snapshot): Promise<string> {
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const files = wikiMarkdownFiles(state, wiki)
  const linkedTo = new Set<string>()
  const active: string[] = []
  const archive: string[] = []
  const hasOutlink = new Map<string, boolean>()
  for (const path of files) {
    const relative = relativeToWiki(wiki, path)
    const text = await workspace.read(path)
    const pageArchive = relative.startsWith('归档/') || /^.{0,300}状态[：:]\s*(历史|已归档|已替代)/s.test(text.slice(0, 500))
    const links = extractWikiLinks(text)
    hasOutlink.set(path, links.length > 0)
    for (const target of links) {
      linkedTo.add(normalizedLinkTarget(target).split('/').at(-1)!)
      if (!linkExists(state, wiki, target)) (pageArchive ? archive : active).push(`${relative}: [[${target}]] 指向的笔记不存在`)
    }
  }
  const ignored = new Set(['hot', 'index', 'log', 'overview', 'CLAUDE', '映射表', '伏笔账本', '悬念账本', '来源索引'])
  for (const path of files) {
    const relative = relativeToWiki(wiki, path)
    const stem = path.split('/').at(-1)!.replace(/\.md$/, '')
    if (relative.startsWith('归档/') || ignored.has(stem)) continue
    if (!linkedTo.has(stem) && !hasOutlink.get(path)) active.push(`${relative}: 没有任何笔记链入，自身也无 [[双链]]`)
  }
  const categoryCounts = [...state.dirs]
    .filter(path => path.startsWith(`${wiki}/`) && !path.slice(wiki.length + 1).includes('/'))
    .map(path => ({ name: relativeToWiki(wiki, path), count: files.filter(file => file.startsWith(`${path}/`)).length }))
    .filter(item => item.count > 0)
  for (const item of categoryCounts) {
    const others = categoryCounts.filter(other => other !== item).map(other => other.count)
    if (!others.length) continue
    const average = others.reduce((sum, count) => sum + count, 0) / others.length
    if (item.count >= Math.max(8, average * 3)) active.push(`${item.name}/: ${item.count} 篇笔记，明显多于其他分类，建议检查是否需要拆分`)
  }
  return [
    `问题统计：现行 ${active.length} / 归档卫生 ${archive.length}`,
    `归档卫生：${archive.length} 条（不阻断现行巡检）`,
    '[现行风险]',
    ...(active.length ? active.map(item => `- ${item}`) : ['✅ 无机械风险']),
    '[归档卫生]',
    ...(archive.length ? archive.map(item => `- ${item}`) : ['无归档链接卫生问题。']),
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
  const target = input.path ? resolveWikiFile(state, wiki, input.path) : ''
  const files = target ? [target] : wikiMarkdownFiles(state, wiki)
  const touched: Array<{ path: string; before: string; after: string; count: number }> = []
  for (const path of files) {
    if (!state.files.has(path)) throw new Error(`文件不存在: ${path}`)
    const before = await workspace.read(path)
    const count = before.split(oldText).length - 1
    if (count) touched.push({ path, before, after: before.split(oldText).join(newText), count })
  }
  if (!touched.length) throw new Error('没有任何文件命中')
  if (input.apply) for (const item of touched) await workspace.write(item.path, item.after)
  const lines = [
    '[修前预览]',
    `问题：${input.reason}`,
    `依据：${input.basis}`,
    `替换：「${oldText}」→「${newText}」  模式：${input.apply ? '已执行' : '预览（未写盘，加 apply:true 才真正执行）'}`,
    ...touched.map(item => `- ${item.path} (${item.count} 处)`),
  ]
  if (input.apply) {
    lines.push('[修复回执]')
    for (const item of touched) lines.push(`- ${item.path} sha256:${await shortSha256(item.before)} -> sha256:${await shortSha256(item.after)}`)
  }
  return lines.join('\n')
}

async function link(workspace: WikiWorkspace, state: Snapshot, input: WikiActionInput): Promise<string> {
  requireRepairBasis(input)
  const wiki = findWiki(state)
  if (!wiki) throw new Error('未找到 docs/wiki/ 或 wiki/')
  const path = resolveWikiFile(state, wiki, String(input.path || ''))
  if (!state.files.has(path)) throw new Error(`文件不存在: ${path}`)
  const target = String(input.target || '').trim().replace(/^\[\[|\]\]$/g, '')
  if (!target) throw new Error('补链目标不能为空')
  const before = await workspace.read(path)
  const wikiLink = `[[${target}]]`
  if (before.includes(wikiLink)) return `${path} 已包含 ${wikiLink}，无需重复添加。`
  const after = `${before.replace(/\n*$/, '')}\n\n${wikiLink}\n`
  if (input.apply) await workspace.write(path, after)
  return [
    '[修前预览]',
    `问题：${input.reason}`,
    `依据：${input.basis}`,
    `补链：${path} 追加 ${wikiLink}  模式：${input.apply ? '已执行' : '预览（未写盘，加 apply:true 才真正执行）'}`,
    ...(input.apply ? ['[修复回执]', `- ${path} sha256:${await shortSha256(before)} -> sha256:${await shortSha256(after)}`] : []),
  ].join('\n')
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
    const rootIndex = `${wiki}/index.md`
    if (state.files.has(rootIndex)) {
      const before = await workspace.read(rootIndex)
      await workspace.write(rootIndex, `${before.replace(/\n*$/, '')}\n\n- [[${category}/_index|${category.split('/').at(-1)}]] — ${description}\n`)
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
    case 'graph': return await graph(workspace, state)
    case 'validate': return await validate(workspace, state, input)
    case 'audit': return await audit(workspace, state)
    case 'closeout': return await closeout(workspace, state, input)
    case 'replace': return await replace(workspace, state, input)
    case 'link': return await link(workspace, state, input)
    case 'extend': return await extend(workspace, state, input)
    default: throw new Error(`不支持的 Wiki action: ${String(input.action)}`)
  }
}
