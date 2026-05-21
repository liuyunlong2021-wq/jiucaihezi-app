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
  category: '未整理资料' | '失效链接' | '缺失引用' | '重复页面' | '孤立页面' | '热记忆过期' | '冲突内容'
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
    duplicatePages: number
    orphanPages: number
    staleHotCache: number
    conflicts: number
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

function hasConflictSignal(content: string): boolean {
  return /(冲突|矛盾|不一致|待确认|contradict|conflict)/i.test(content || '')
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

  for (const file of wikiFiles) {
    const title = stripMdExt(file.name)
    const path = fullWikiPath(file)
    wikiTitles.set(title, [...(wikiTitles.get(title) || []), path])
    wikiPathCounts.set(path, (wikiPathCounts.get(path) || 0) + 1)
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

    if (isWiki(file)) {
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

      if (!['index.md', 'overview.md', 'hot.md', 'log.md'].includes(file.name) && !hasSourceReference(file)) {
        issues.push(issue({
          category: '缺失引用',
          severity: 'info',
          fileId: file.id,
          fileName: file.name,
          description: `「${file.name}」没有来源引用，后续回答可能难以追溯。`,
        }))
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
    if (['index.md', 'overview.md', 'hot.md', 'log.md'].includes(file.name)) continue
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
      duplicatePages: issues.filter(item => item.category === '重复页面').length,
      orphanPages: issues.filter(item => item.category === '孤立页面').length,
      staleHotCache: issues.filter(item => item.category === '热记忆过期').length,
      conflicts: issues.filter(item => item.category === '冲突内容').length,
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
    `- 重复页面：${result.stats.duplicatePages}`,
    `- 孤立页面：${result.stats.orphanPages}`,
    `- 热记忆过期：${result.stats.staleHotCache}`,
    `- 冲突内容：${result.stats.conflicts}`,
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
