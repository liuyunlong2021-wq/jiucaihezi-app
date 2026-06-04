export interface VaultHealthFile {
  id: string
  name: string
  content: string
  kind?: string
  indexed?: boolean
  updatedAt?: number
  metadata?: Record<string, unknown>
}

export interface VaultHealthIssue {
  id: string
  category: '未整理资料' | '失效链接' | '缺失引用' | '缺少来源Chunk' | 'Chunk未入Wiki' | '重复页面' | '孤立页面' | '热记忆过期' | '冲突内容' | '缺少Chunk索引'
  severity: 'info' | 'warning' | 'critical'
  fileId?: string
  fileName?: string
  description: string
}

export interface VaultHealthResult {
  issues: VaultHealthIssue[]
  suggestions: string[]
  stats: {
    unprocessedRaw: number
    brokenLinks: number
    missingSourceRefs: number
    missingSourceChunks: number
    uncoveredSourceChunks: number
    duplicatePages: number
    orphanPages: number
    staleHotCache: number
    conflicts: number
    missingChunkIndex: number
    rawChunkCoveragePercent: number
    wikiSourceTraceCoveragePercent: number
  }
}

export interface VaultHealthReportFile {
  name: string
  content: string
  mimeType: 'text/markdown'
  size: number
  kind: 'summary'
  indexed: true
  metadata: {
    vaultFolder: 'reports'
    folderPath: '_reports/健康检查'
    kind: 'vault-health-report'
    stats: VaultHealthResult['stats']
    issueCount: number
    suggestions: string[]
    createdAt: number
  }
}

function normalizePath(file: VaultHealthFile): string {
  return String(file.metadata?.folderPath || file.metadata?.targetPath || file.name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

function isRaw(file: VaultHealthFile): boolean {
  const path = normalizePath(file)
  return file.kind === 'raw' || file.metadata?.vaultFolder === 'raw' || path.startsWith('raw/')
}

function isWiki(file: VaultHealthFile): boolean {
  const path = normalizePath(file)
  return file.metadata?.vaultFolder === 'wiki' || path.startsWith('wiki/') || file.kind === 'page' || file.kind === 'entity'
}

function stripMdExt(name: string): string {
  return String(name || '').replace(/\.md$/i, '').trim()
}

function normalizeWikiSegment(input: string): string {
  return stripMdExt(input)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^wiki\/?/i, '')
}

function fullWikiPath(file: VaultHealthFile): string {
  const folderPath = normalizeWikiSegment(String(file.metadata?.folderPath || file.metadata?.targetPath || ''))
  const title = stripMdExt(file.name)
  return [folderPath, title].filter(Boolean).join('/')
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = []
  const re = /\[\[([^\]\|#]+)(?:[|#][^\]]*)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content || ''))) {
    links.push(stripMdExt(match[1]))
  }
  return links
}

function hasSourceReference(file: VaultHealthFile): boolean {
  if (Array.isArray(file.metadata?.sources) && file.metadata.sources.length > 0) return true
  return /(^|\n)\s*(来源|source|sources|引用|references?)\s*[:：]/i.test(file.content || '')
}

function hasSourceChunkReference(file: VaultHealthFile): boolean {
  if (Array.isArray(file.metadata?.sourceChunks) && file.metadata.sourceChunks.length > 0) return true
  return /(^|\n)\s*sourceChunks\s*[:：]\s*(\n\s*-\s*\S+|\S+)/i.test(file.content || '')
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function extractSourceChunkRefs(file: VaultHealthFile): string[] {
  const refs = stringArray(file.metadata?.sourceChunks)
  const content = String(file.content || '')
  const block = content.match(/(^|\n)\s*sourceChunks\s*[:：]\s*((?:\n\s*-\s*\S+)+|\S+)/i)
  if (!block) return refs
  const body = block[2] || ''
  const listItems = Array.from(body.matchAll(/-\s*(\S+)/g)).map(match => match[1])
  if (listItems.length) return [...refs, ...listItems]
  return [...refs, body.trim()].filter(Boolean)
}

function sourceChunkLookupTokens(ref: string): string[] {
  const value = String(ref || '').trim()
  if (!value) return []
  const parts = value.split('_')
  const tail = parts.length > 1 ? parts[parts.length - 1] : ''
  return Array.from(new Set([value, tail].filter(Boolean)))
}

function hasConflictSignal(content: string): boolean {
  return /(冲突|矛盾|不一致|待确认|contradict|conflict)/i.test(content || '')
}

function isStructuralWikiPage(file: VaultHealthFile): boolean {
  return ['index.md', 'overview.md', 'hot.md', 'log.md'].includes(file.name)
}

function percent(covered: number, total: number): number {
  if (total <= 0) return 100
  return Math.round((covered / total) * 100)
}

function issue(input: Omit<VaultHealthIssue, 'id'>): VaultHealthIssue {
  return {
    id: `vh_${input.category}_${input.fileId || input.fileName || Math.random().toString(36).slice(2, 8)}`,
    ...input,
  }
}

export function inspectVaultHealth(
  files: VaultHealthFile[],
  options: { now?: number; hotCacheMaxAgeDays?: number } = {},
): VaultHealthResult {
  const now = options.now || Date.now()
  const hotCacheMaxAgeMs = (options.hotCacheMaxAgeDays || 7) * 24 * 60 * 60 * 1000
  const issues: VaultHealthIssue[] = []
  const suggestions = new Set<string>()
  const wikiFiles = files.filter(file => isWiki(file) && file.content)
  const wikiTitles = new Map<string, string[]>()
  const wikiPaths = new Set(wikiFiles.map(file => fullWikiPath(file)))
  const wikiPathCounts = new Map<string, number>()
  const referencedWikiPaths = new Set<string>()
  const wikiSourceChunkTokens = new Set<string>()
  let uncoveredSourceChunkCount = 0
  let totalSourceChunkCount = 0
  let coveredSourceChunkCount = 0
  let traceableWikiPageCount = 0
  const wikiTracePageCount = wikiFiles.filter(file => !isStructuralWikiPage(file)).length

  for (const file of wikiFiles) {
    const title = stripMdExt(file.name)
    const path = fullWikiPath(file)
    wikiTitles.set(title, [...(wikiTitles.get(title) || []), path])
    wikiPathCounts.set(path, (wikiPathCounts.get(path) || 0) + 1)
    for (const ref of extractSourceChunkRefs(file)) {
      for (const token of sourceChunkLookupTokens(ref)) wikiSourceChunkTokens.add(token)
    }
  }

  for (const file of files) {
    const path = normalizePath(file)
    if (isRaw(file) && file.indexed === false) {
      issues.push(issue({
        category: '未整理资料',
        severity: 'warning',
        fileId: file.id,
        fileName: file.name,
        description: `raw 中的「${file.name}」还没有整理进 wiki。`,
      }))
      if (/对话记录|conversation/.test(path)) suggestions.add('对话记录')
      if (/上传资料|转换后的MD|原始文件/.test(path)) suggestions.add('资料沉淀')
    }
    if (
      isRaw(file) &&
      file.metadata?.kind === 'converted-markdown' &&
      Number(file.metadata?.sourceChunkCount || 0) <= 0
    ) {
      issues.push(issue({
        category: '缺少Chunk索引',
        severity: 'warning',
        fileId: file.id,
        fileName: file.name,
        description: `raw/转换后的MD 中的「${file.name}」还没有建立 chunk 索引，后续无法稳定回查来源片段。`,
      }))
      suggestions.add('资料切块索引')
    }
    const sourceChunkHashes = stringArray(file.metadata?.sourceChunkHashes)
    if (isRaw(file) && sourceChunkHashes.length > 0) {
      totalSourceChunkCount += sourceChunkHashes.length
      const missingHashes = sourceChunkHashes.filter(hash => {
        const chunkId = `chunk_${file.id}_${hash}`
        return !wikiSourceChunkTokens.has(hash) && !wikiSourceChunkTokens.has(chunkId)
      })
      coveredSourceChunkCount += sourceChunkHashes.length - missingHashes.length
      if (missingHashes.length > 0) {
        uncoveredSourceChunkCount += missingHashes.length
        issues.push(issue({
          category: 'Chunk未入Wiki',
          severity: 'warning',
          fileId: file.id,
          fileName: file.name,
          description: `raw 中的「${file.name}」有 ${missingHashes.length} 个 chunk 尚未被任何 wiki 页的 sourceChunks 承接。`,
        }))
        suggestions.add('Chunk 到 Wiki 覆盖率')
      }
    }

    if (isWiki(file)) {
      if (!isStructuralWikiPage(file) && hasSourceReference(file) && hasSourceChunkReference(file)) {
        traceableWikiPageCount++
      }
      for (const link of extractWikiLinks(file.content)) {
        const normalizedLink = normalizeWikiSegment(link)
        const matchedPaths = normalizedLink.includes('/')
          ? (wikiPaths.has(normalizedLink) ? [normalizedLink] : [])
          : (wikiTitles.get(normalizedLink) || [])

        if (matchedPaths.length === 0) {
          issues.push(issue({
            category: '失效链接',
            severity: 'warning',
            fileId: file.id,
            fileName: file.name,
            description: `「${file.name}」链接到尚不存在的「${link}」。`,
          }))
        } else {
          for (const matchedPath of matchedPaths) referencedWikiPaths.add(matchedPath)
        }
      }

      if (!isStructuralWikiPage(file) && !hasSourceReference(file)) {
        issues.push(issue({
          category: '缺失引用',
          severity: 'info',
          fileId: file.id,
          fileName: file.name,
          description: `「${file.name}」没有来源引用，后续回答可能难以追溯。`,
        }))
      }
      if (!isStructuralWikiPage(file) && !hasSourceChunkReference(file)) {
        issues.push(issue({
          category: '缺少来源Chunk',
          severity: 'info',
          fileId: file.id,
          fileName: file.name,
          description: `「${file.name}」没有 sourceChunks，后续难以从 Wiki 精确回查原文片段。`,
        }))
        suggestions.add('Wiki 来源追踪')
      }

      if (file.metadata?.kind === 'vault-hot-cache' && now - Number(file.updatedAt || 0) > hotCacheMaxAgeMs) {
        issues.push(issue({
          category: '热记忆过期',
          severity: 'info',
          fileId: file.id,
          fileName: file.name,
          description: `hot.md 已超过 ${options.hotCacheMaxAgeDays || 7} 天未更新，建议在整理后刷新近期上下文。`,
        }))
      }

      if (hasConflictSignal(file.content)) {
        issues.push(issue({
          category: '冲突内容',
          severity: 'warning',
          fileId: file.id,
          fileName: file.name,
          description: `「${file.name}」包含冲突或待确认信号。`,
        }))
      }
    }
  }

  for (const [path, count] of wikiPathCounts.entries()) {
    if (count <= 1) continue
    issues.push(issue({
      category: '重复页面',
      severity: 'warning',
      fileName: path,
      description: `wiki 中存在 ${count} 个「${path}」页面，建议合并或重命名。`,
    }))
    suggestions.add(path)
  }

  for (const file of wikiFiles) {
    if (isStructuralWikiPage(file)) continue
    const path = fullWikiPath(file)
    if (referencedWikiPaths.has(path)) continue
    issues.push(issue({
      category: '孤立页面',
      severity: 'info',
      fileId: file.id,
      fileName: file.name,
      description: `「${file.name}」没有被其他 wiki 页面链接。`,
    }))
  }

  if (suggestions.size === 0) suggestions.add('继续整理 raw 中高频主题')

  return {
    issues,
    suggestions: Array.from(suggestions),
    stats: {
      unprocessedRaw: issues.filter(item => item.category === '未整理资料').length,
      brokenLinks: issues.filter(item => item.category === '失效链接').length,
      missingSourceRefs: issues.filter(item => item.category === '缺失引用').length,
      missingSourceChunks: issues.filter(item => item.category === '缺少来源Chunk').length,
      uncoveredSourceChunks: uncoveredSourceChunkCount,
      duplicatePages: issues.filter(item => item.category === '重复页面').length,
      orphanPages: issues.filter(item => item.category === '孤立页面').length,
      staleHotCache: issues.filter(item => item.category === '热记忆过期').length,
      conflicts: issues.filter(item => item.category === '冲突内容').length,
      missingChunkIndex: issues.filter(item => item.category === '缺少Chunk索引').length,
      rawChunkCoveragePercent: percent(coveredSourceChunkCount, totalSourceChunkCount),
      wikiSourceTraceCoveragePercent: percent(traceableWikiPageCount, wikiTracePageCount),
    },
  }
}

export function buildVaultHealthReport(vaultName: string, result: VaultHealthResult, now = Date.now()): string {
  const time = new Date(now).toLocaleString('zh-CN')
  const issueLines = result.issues.length
    ? result.issues.map(item => `- **${item.category}**：${item.description}`).join('\n')
    : '- 未发现明显问题。'

  return [
    `# ${vaultName || '知识库'} 健康检查`,
    '',
    `检查时间：${time}`,
    '',
    '## 摘要',
    '',
    `- 未整理资料：${result.stats.unprocessedRaw}`,
    `- 失效链接：${result.stats.brokenLinks}`,
    `- 缺失引用：${result.stats.missingSourceRefs}`,
    `- 缺少来源Chunk：${result.stats.missingSourceChunks}`,
    `- Chunk未入Wiki：${result.stats.uncoveredSourceChunks}`,
    `- 重复页面：${result.stats.duplicatePages}`,
    `- 孤立页面：${result.stats.orphanPages}`,
    `- 热记忆过期：${result.stats.staleHotCache}`,
    `- 冲突内容：${result.stats.conflicts}`,
    `- 缺少Chunk索引：${result.stats.missingChunkIndex}`,
    `- Chunk 覆盖率：${result.stats.rawChunkCoveragePercent}%`,
    `- Wiki 来源追踪率：${result.stats.wikiSourceTraceCoveragePercent}%`,
    '',
    '## 问题明细',
    '',
    issueLines,
    '',
    '## 建议新增栏目',
    '',
    result.suggestions.map(item => `- ${item}`).join('\n'),
  ].join('\n')
}

function timestampForReportName(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function buildVaultHealthReportFile(
  vaultName: string,
  result: VaultHealthResult,
  now = Date.now(),
): VaultHealthReportFile {
  const content = buildVaultHealthReport(vaultName, result, now)
  return {
    name: `健康检查_${timestampForReportName(now)}.md`,
    content,
    mimeType: 'text/markdown',
    size: new TextEncoder().encode(content).length,
    kind: 'summary',
    indexed: true,
    metadata: {
      vaultFolder: 'reports',
      folderPath: '_reports/健康检查',
      kind: 'vault-health-report',
      stats: result.stats,
      issueCount: result.issues.length,
      suggestions: result.suggestions,
      createdAt: now,
    },
  }
}
