export interface VaultChunkRawFile {
  id: string
  name: string
  content: string
  metadata?: Record<string, unknown>
}

export interface VaultSourceChunk {
  id: string
  rawId: string
  vaultId: string
  sourcePath: string
  anchor: string
  headingPath: string[]
  title: string
  text: string
  chunkHash: string
  charStart: number
  charEnd: number
  metadata: Record<string, unknown>
}

interface HeadingSection {
  level: number
  title: string
  bodyStart: number
  bodyEnd: number
  headingStart: number
  headingPath: string[]
}

function normalizePath(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

function sourcePathFor(raw: VaultChunkRawFile): string {
  const folderPath = normalizePath(String(raw.metadata?.folderPath || 'raw/转换后的MD'))
  return normalizePath(`${folderPath}/${raw.name}`)
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function anchorFor(title: string): string {
  const clean = String(title || 'chunk')
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
  return `#${clean || 'chunk'}`
}

function detectChapterNumber(text: string): number | undefined {
  const match = String(text || '').match(/第\s*([0-9０-９一二三四五六七八九十百千]+)\s*[章节回]/)
  if (!match) return undefined
  const value = match[1].replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  const ten = value.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (ten) return (ten[1] ? digits[ten[1]] : 1) * 10 + (ten[2] ? digits[ten[2]] : 0)
  return undefined
}

function detectCaseNumber(text: string): string | undefined {
  return String(text || '').match(/（\d{4}）[^\s，。；;]*?号/)?.[0]
}

function detectCaseCause(text: string): string | undefined {
  return String(text || '').match(/案由\s*[:：]\s*([^。\n；;]+)/)?.[1]?.trim()
}

function detectDocumentType(text: string): string | undefined {
  const types = ['起诉状', '答辩状', '代理词', '辩护词', '判决书', '裁定书', '合同', '证据清单']
  return types.find(type => String(text || '').includes(type))
}

function detectMetadata(title: string, text: string): Record<string, unknown> {
  const joined = `${title}\n${text}`
  const metadata: Record<string, unknown> = {}
  const chapterNumber = detectChapterNumber(joined)
  const caseNumber = detectCaseNumber(joined)
  const caseCause = detectCaseCause(joined)
  const documentType = detectDocumentType(joined)
  if (chapterNumber !== undefined) metadata.chapterNumber = chapterNumber
  if (caseNumber) metadata.caseNumber = caseNumber
  if (caseCause) metadata.caseCause = caseCause
  if (documentType) metadata.documentType = documentType
  return metadata
}

function headingSections(content: string): HeadingSection[] {
  const matches = Array.from(content.matchAll(/^(#{1,3})\s+(.+?)\s*$/gm))
  if (matches.length === 0) {
    const title = '全文'
    return [{
      level: 1,
      title,
      bodyStart: 0,
      bodyEnd: content.length,
      headingStart: 0,
      headingPath: [title],
    }]
  }

  const stack: Array<{ level: number; title: string }> = []
  return matches.map((match, index) => {
    const level = match[1].length
    const title = match[2].trim()
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, title })
    const headingStart = match.index || 0
    const bodyStart = headingStart + match[0].length
    const bodyEnd = index + 1 < matches.length ? (matches[index + 1].index || content.length) : content.length
    return {
      level,
      title,
      bodyStart,
      bodyEnd,
      headingStart,
      headingPath: stack.map(item => item.title),
    }
  })
}

export function buildVaultChunks(input: {
  vaultId: string
  rawFiles: VaultChunkRawFile[]
}): VaultSourceChunk[] {
  const chunks: VaultSourceChunk[] = []

  for (const raw of input.rawFiles || []) {
    const content = String(raw.content || '')
    const sourcePath = sourcePathFor(raw)
    for (const section of headingSections(content)) {
      const body = content.slice(section.bodyStart, section.bodyEnd).trim()
      const text = body || section.title
      const chunkHash = hashText(`${sourcePath}\n${section.title}\n${text}`)
      chunks.push({
        id: `chunk_${raw.id}_${chunkHash}`,
        rawId: raw.id,
        vaultId: input.vaultId,
        sourcePath,
        anchor: anchorFor(section.title),
        headingPath: section.headingPath,
        title: section.title,
        text,
        chunkHash,
        charStart: section.headingStart,
        charEnd: section.bodyEnd,
        metadata: {
          ...(raw.metadata || {}),
          ...detectMetadata(section.title, text),
        },
      })
    }
  }

  return chunks
}
