export interface HotCacheFileLike {
  id: string
  name: string
  content: string
  updatedAt?: number
  metadata?: Record<string, unknown>
}

const HOT_CACHE_EXCLUDED_KINDS = new Set([
  'vault-index',
  'vault-overview',
  'vault-hot-cache',
  'vault-log',
  'vault-log-entry',
  'vault-lint-report',
  'vault-compile-log',
  'vault-organize-report',
  'writeback-candidate',
  'writeback-candidate-report',
  'organize-candidate',
])

export function isHotCacheWikiPage(file: HotCacheFileLike): boolean {
  const metadata = file.metadata || {}
  const vaultFolder = String(metadata.vaultFolder || '')
  const folderPath = String(metadata.folderPath || '')
  const kind = String(metadata.kind || '')
  const status = String(metadata.status || '')
  return (
    (vaultFolder === 'wiki' || folderPath === 'wiki' || folderPath.startsWith('wiki/')) &&
    status !== 'pending' &&
    !HOT_CACHE_EXCLUDED_KINDS.has(kind)
  )
}

function cleanText(text: string): string {
  return String(text || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function summaryOf(file: HotCacheFileLike): string {
  const metadataSummary = String(file.metadata?.summary || '').trim()
  if (metadataSummary) return metadataSummary.slice(0, 180)
  const summarySection = file.content.match(/##\s*摘要\s+([\s\S]*?)(?:\n##\s+|$)/)
  if (summarySection?.[1]?.trim()) return cleanText(summarySection[1]).slice(0, 180)
  return cleanText(file.content).slice(0, 180)
}

function readCount(file: HotCacheFileLike): number {
  const value = Number(file.metadata?.readCount || 0)
  return Number.isFinite(value) ? value : 0
}

function lastReadAt(file: HotCacheFileLike): number {
  const value = Number(file.metadata?.lastReadAt || 0)
  return Number.isFinite(value) ? value : 0
}

export function buildHotCacheMarkdown(input: {
  vaultName: string
  wikiPages: HotCacheFileLike[]
  rawFallback?: HotCacheFileLike[]
  maxItems?: number
}): string {
  const maxItems = input.maxItems || 3
  const hotPages = [...input.wikiPages]
    .filter(file => summaryOf(file))
    .sort((a, b) =>
      readCount(b) - readCount(a) ||
      lastReadAt(b) - lastReadAt(a) ||
      Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    )
    .slice(0, maxItems)

  if (hotPages.length > 0) {
    return [
      `# ${input.vaultName} 热记忆`,
      '',
      ...hotPages.map(file => `- [[${file.name}]]：${summaryOf(file)}（读取 ${readCount(file)} 次）`),
    ].join('\n')
  }

  return [
    `# ${input.vaultName} 热记忆`,
    '',
    '暂无高频知识页。',
  ].join('\n')
}
