import { scanMarkdownCorpus } from './vaultCorpus'

export interface VaultIngestionSourceFile {
  name: string
  mimeType?: string
  size?: number
  sourceType?: string
  extractedText?: string
  remoteUrl?: string
  originalDataUrl?: string
  status?: 'ready' | 'error'
  error?: string
}

export interface VaultIngestionFileEntry {
  name: string
  content: string
  mimeType: string
  folderPath: string
  kind: 'original' | 'converted-markdown'
  indexed: boolean
  metadata: Record<string, unknown>
}

export interface VaultIngestionItem {
  source: VaultIngestionSourceFile
  original?: VaultIngestionFileEntry
  markdown: VaultIngestionFileEntry
  meta: VaultIngestionFileEntry
}

export interface VaultIngestionFailure {
  name: string
  error: string
  sourceType?: string
}

export interface VaultIngestionPlan {
  items: VaultIngestionItem[]
  failures: VaultIngestionFailure[]
  summary: {
    total: number
    ready: number
    failed: number
    originals: number
    markdown: number
    meta: number
  }
}

export interface VaultIngestionWriteEntry extends Omit<VaultIngestionFileEntry, 'kind'> {
  kind: 'raw'
}

function safeFilename(name: string, fallback = '资料'): string {
  const clean = String(name || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || fallback
}

function sourceHash(file: VaultIngestionSourceFile): string {
  const text = [
    file.name,
    file.mimeType,
    file.size,
    file.sourceType,
    file.remoteUrl,
    file.extractedText,
    file.originalDataUrl,
  ].map(value => String(value || '')).join('\n')
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function normalizeMarkdownFilename(filename: string): string {
  const base = safeFilename(filename, '资料')
    .replace(/\.(md|markdown)$/i, '')
    .replace(/\.[^.]+$/i, '')
  return `${base || '资料'}.md`
}

function dedupeFilename(name: string, used: Set<string>): string {
  const safe = safeFilename(name)
  if (!used.has(safe)) {
    used.add(safe)
    return safe
  }

  const dot = safe.lastIndexOf('.')
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  let index = 2
  while (used.has(`${base}_${index}${ext}`)) index++
  const unique = `${base}_${index}${ext}`
  used.add(unique)
  return unique
}

export function isMeaningfulExtractedText(text: string): boolean {
  const cleaned = String(text || '')
    .replace(/\[第\d+页\]/g, '')
    .replace(/\[Page\s*\d+\]/gi, '')
    .replace(/#+\s*/g, '')
    .replace(/[-_*`>[\]().,，。:：;；\s]/g, '')
    .trim()
  return /[\p{L}\p{N}]/u.test(cleaned) && cleaned.length >= 2
}

function markdownFrontmatter(file: VaultIngestionSourceFile, convertedAt = Date.now()): string {
  const hash = sourceHash(file)
  return `${[
    '---',
    `sourceName: "${String(file.name || '').replace(/"/g, '\\"')}"`,
    `sourceType: "${String(file.sourceType || 'unknown').replace(/"/g, '\\"')}"`,
    `mimeType: "${String(file.mimeType || '').replace(/"/g, '\\"')}"`,
    `size: ${Number(file.size || 0)}`,
    `sourceHash: "${hash}"`,
    file.remoteUrl ? `remoteUrl: "${String(file.remoteUrl).replace(/"/g, '\\"')}"` : '',
    `convertedAt: ${convertedAt}`,
    '---',
  ].filter(line => line !== '').join('\n')}\n\n`
}

function buildMarkdownContent(file: VaultIngestionSourceFile, convertedAt = Date.now()): string {
  const text = String(file.extractedText || '').trim()
  const body = text || `> 此文件已导入，但当前没有提取到可用文本。`
  return `${markdownFrontmatter(file, convertedAt)}${body}\n`
}

function buildMetaFilename(markdownFilename: string): string {
  return markdownFilename.replace(/\.md$/i, '.meta.json')
}

function buildMarkdownMetaContent(file: VaultIngestionSourceFile, markdown: VaultIngestionFileEntry): string {
  const scan = scanMarkdownCorpus({
    files: [{
      name: markdown.name,
      path: `${markdown.folderPath}/${markdown.name}`,
      content: markdown.content,
      metadata: markdown.metadata,
    }],
  })
  const metadata = {
    sourceName: file.name,
    sourceType: file.sourceType || 'unknown',
    mimeType: file.mimeType || '',
    size: file.size || 0,
    sourceHash: markdown.metadata.sourceHash,
    markdownPath: `${markdown.folderPath}/${markdown.name}`,
    convertedAt: markdown.metadata.convertedAt,
    conversionEngine: markdown.metadata.conversionEngine,
    sourceAnchors: scan.headings.map(heading => ({
      title: heading.title,
      level: heading.level,
      anchor: heading.anchor,
    })),
    chunks: scan.chunks.map(chunk => ({
      title: chunk.title,
      anchor: chunk.sourceAnchor,
      charCount: chunk.charCount,
    })),
    stats: scan.stats,
  }
  return `${JSON.stringify(metadata, null, 2)}\n`
}

function shouldPreserveOriginal(file: VaultIngestionSourceFile): boolean {
  return Boolean(file.originalDataUrl)
}

export function buildVaultIngestionPlan(input: { files: VaultIngestionSourceFile[] }): VaultIngestionPlan {
  const items: VaultIngestionItem[] = []
  const failures: VaultIngestionFailure[] = []
  const usedMarkdownNames = new Set<string>()
  const usedMetaNames = new Set<string>()
  const usedOriginalNames = new Set<string>()

  for (const file of input.files || []) {
    if (file.status === 'error') {
      failures.push({
        name: safeFilename(file.name),
        error: file.error || '文件处理失败',
        sourceType: file.sourceType,
      })
      continue
    }

    if (!isMeaningfulExtractedText(file.extractedText || '')) {
      failures.push({
        name: safeFilename(file.name),
        error: '没有提取到有效正文，请换用可复制文字的文件或先转成 Markdown/TXT',
        sourceType: file.sourceType,
      })
      continue
    }

    const hash = sourceHash(file)
    const convertedAt = Date.now()
    const markdownName = dedupeFilename(normalizeMarkdownFilename(file.name), usedMarkdownNames)
    const metaName = dedupeFilename(buildMetaFilename(markdownName), usedMetaNames)
    const originalName = shouldPreserveOriginal(file)
      ? dedupeFilename(safeFilename(file.name), usedOriginalNames)
      : ''
    const markdown: VaultIngestionFileEntry = {
      name: markdownName,
      content: buildMarkdownContent(file, convertedAt),
      mimeType: 'text/markdown',
      folderPath: 'raw/转换后的MD',
      kind: 'converted-markdown',
      indexed: false,
      metadata: {
        vaultFolder: 'raw',
        kind: 'converted-markdown',
        folderPath: 'raw/转换后的MD',
        originalName: file.name,
        sourceType: file.sourceType || 'unknown',
        conversionEngine: file.sourceType || 'unknown',
        mimeType: file.mimeType || '',
        sourceSize: file.size || 0,
        sourceHash: hash,
        remoteUrl: file.remoteUrl || '',
        convertedAt,
      },
    }

    const meta: VaultIngestionFileEntry = {
      name: metaName,
      content: metaName,
      mimeType: 'application/json',
      folderPath: 'raw/转换后的MD',
      kind: 'converted-markdown',
      indexed: true,
      metadata: {
        vaultFolder: 'raw',
        kind: 'converted-markdown-meta',
        folderPath: 'raw/转换后的MD',
        originalName: file.name,
        sourceType: file.sourceType || 'unknown',
        sourceHash: hash,
        markdownName: markdown.name,
      },
    }
    meta.content = buildMarkdownMetaContent(file, markdown)

    const original: VaultIngestionFileEntry | undefined = shouldPreserveOriginal(file)
      ? {
          name: originalName,
          content: file.originalDataUrl || '',
          mimeType: file.mimeType || 'application/octet-stream',
          folderPath: 'raw/原始文件',
          kind: 'original',
          indexed: false,
          metadata: {
            vaultFolder: 'raw',
            kind: 'original-file',
            folderPath: 'raw/原始文件',
            originalName: file.name,
            sourceType: file.sourceType || 'unknown',
            sourceSize: file.size || 0,
            sourceHash: hash,
            remoteUrl: file.remoteUrl || '',
            storage: 'data-url',
          },
        }
      : undefined

    items.push({ source: file, original, markdown, meta })
  }

  return {
    items,
    failures,
    summary: {
      total: (input.files || []).length,
      ready: items.length,
      failed: failures.length,
      originals: items.filter(item => item.original).length,
      markdown: items.length,
      meta: items.length,
    },
  }
}

export function flattenVaultIngestionPlanEntries(plan: VaultIngestionPlan): VaultIngestionWriteEntry[] {
  return (plan.items || []).flatMap(item => {
    const entries = [
      item.original,
      item.markdown,
      item.meta,
    ].filter((entry): entry is VaultIngestionFileEntry => Boolean(entry))

    return entries.map(entry => ({
      ...entry,
      kind: 'raw' as const,
    }))
  })
}

export function isVaultIngestionCompileTarget(entry: VaultIngestionWriteEntry): boolean {
  return entry.metadata?.kind === 'converted-markdown'
}

export function isConvertedMarkdownRawFile(file: {
  category?: string
  mimeType?: string
  kind?: string
  metadata?: Record<string, unknown>
}): boolean {
  return file.category === 'knowledge' &&
    file.mimeType !== 'folder' &&
    file.kind === 'raw' &&
    file.metadata?.vaultFolder === 'raw' &&
    file.metadata?.kind === 'converted-markdown'
}

export function buildVaultIngestionReport(vaultName: string, plan: VaultIngestionPlan): string {
  const now = new Date().toLocaleString('zh-CN')
  const successLines = plan.items.length
    ? plan.items.map(item => `- ${item.source.name} -> ${item.markdown.folderPath}/${item.markdown.name}（${item.source.sourceType || 'unknown'}）`)
    : ['- 无']
  const failureLines = plan.failures.length
    ? plan.failures.map(failure => `- ${failure.name}：${failure.error}`)
    : ['- 无']

  return [
    `# ${vaultName || '知识库'} 资料导入报告`,
    '',
    `- 时间：${now}`,
    `- 导入文件：${plan.summary.total}`,
    `- 成功转换：${plan.summary.ready}`,
    `- 保留原文件：${plan.summary.originals}`,
    `- 元数据文件：${plan.summary.meta}`,
    `- 失败：${plan.summary.failed}`,
    '',
    '## 转换结果',
    ...successLines,
    '',
    '## 失败记录',
    ...failureLines,
  ].join('\n')
}
