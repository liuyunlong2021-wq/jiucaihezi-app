export interface CorpusMarkdownFile {
  name: string
  path: string
  content: string
  metadata?: Record<string, unknown>
}

export interface CorpusSourceSummary {
  name: string
  path: string
  charCount: number
  headingCount: number
  chunkCount: number
  sourceHash?: string
}

export interface CorpusHeading {
  title: string
  level: number
  sourcePath: string
  anchor: string
}

export interface CorpusChunk {
  id: string
  title: string
  sourcePath: string
  sourceAnchor: string
  content: string
  charCount: number
}

export interface CorpusScan {
  sources: CorpusSourceSummary[]
  headings: CorpusHeading[]
  chunks: CorpusChunk[]
  candidateEntities: string[]
  candidateConcepts: string[]
  candidateProcesses: string[]
  stats: {
    sourceCount: number
    totalChars: number
    headingCount: number
    chunkCount: number
  }
}

export interface CorpusMapMarkdownOptions {
  maxSources?: number
  maxHeadings?: number
  maxChunks?: number
  perChunkChars?: number
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}

function cleanTitle(value: unknown, fallback = '未命名'): string {
  return String(value || fallback)
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback
}

function anchorFor(path: string, title: string): string {
  return `${path}#${cleanTitle(title)}`
}

function shortHash(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function uniquePush(target: Set<string>, value: string) {
  const cleaned = cleanTitle(value, '')
  if (!cleaned || cleaned.length < 2) return
  target.add(cleaned)
}

function classifyHeading(title: string, body: string, buckets: {
  entities: Set<string>
  concepts: Set<string>
  processes: Set<string>
}) {
  const text = `${title}\n${body}`
  if (/流程|步骤|操作|执行|阶段|路径|链路|第一步|第二步|第三步/.test(text)) {
    uniquePush(buckets.processes, title)
  }
  if (/概念|定义|原则|模型|公式|方法|框架|理论|规则/.test(text)) {
    uniquePush(buckets.concepts, title)
  }
  if (/角色|人物|男主|女主|客户|用户|产品|项目|道具|地点|组织|公司|竞品|对象/.test(text)) {
    uniquePush(buckets.entities, title)
  }
}

function extractFileSections(file: CorpusMarkdownFile): {
  headings: CorpusHeading[]
  chunks: CorpusChunk[]
  charCount: number
} {
  const content = normalizeText(file.content)
  const lines = content.split('\n')
  const headings: CorpusHeading[] = []
  const chunks: CorpusChunk[] = []
  let current: { title: string; level: number; body: string[] } | null = null

  function pushCurrent() {
    if (!current) return
    const body = current.body.join('\n').trim()
    if (!body) return
    const title = cleanTitle(current.title)
    chunks.push({
      id: `${shortHash(file.path)}_${chunks.length + 1}`,
      title,
      sourcePath: file.path,
      sourceAnchor: anchorFor(file.path, title),
      content: body,
      charCount: body.length,
    })
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+?)\s*$/)
    if (match) {
      pushCurrent()
      const level = match[1].length
      const title = cleanTitle(match[2])
      headings.push({
        title,
        level,
        sourcePath: file.path,
        anchor: anchorFor(file.path, title),
      })
      current = { title, level, body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  pushCurrent()

  if (chunks.length === 0 && content) {
    const title = cleanTitle(file.name.replace(/\.[^.]+$/, ''), '资料概览')
    chunks.push({
      id: `${shortHash(file.path)}_1`,
      title,
      sourcePath: file.path,
      sourceAnchor: anchorFor(file.path, title),
      content,
      charCount: content.length,
    })
  }

  return { headings, chunks, charCount: content.length }
}

export function scanMarkdownCorpus(input: { files: CorpusMarkdownFile[] }): CorpusScan {
  const sources: CorpusSourceSummary[] = []
  const headings: CorpusHeading[] = []
  const chunks: CorpusChunk[] = []
  const entities = new Set<string>()
  const concepts = new Set<string>()
  const processes = new Set<string>()

  for (const file of input.files || []) {
    const parsed = extractFileSections(file)
    headings.push(...parsed.headings)
    chunks.push(...parsed.chunks)
    for (const chunk of parsed.chunks) {
      classifyHeading(chunk.title, chunk.content, { entities, concepts, processes })
    }
    sources.push({
      name: file.name,
      path: file.path,
      charCount: parsed.charCount,
      headingCount: parsed.headings.length,
      chunkCount: parsed.chunks.length,
      sourceHash: String(file.metadata?.sourceHash || shortHash(`${file.path}\n${file.content}`)),
    })
  }

  return {
    sources,
    headings,
    chunks,
    candidateEntities: Array.from(entities).slice(0, 40),
    candidateConcepts: Array.from(concepts).slice(0, 40),
    candidateProcesses: Array.from(processes).slice(0, 40),
    stats: {
      sourceCount: sources.length,
      totalChars: sources.reduce((sum, source) => sum + source.charCount, 0),
      headingCount: headings.length,
      chunkCount: chunks.length,
    },
  }
}

function excerpt(text: string, max: number): string {
  return normalizeText(text).replace(/\s+/g, ' ').slice(0, max)
}

export function buildCorpusMapMarkdown(scan: CorpusScan, options: CorpusMapMarkdownOptions = {}): string {
  const maxSources = Math.max(1, options.maxSources || 12)
  const maxHeadings = Math.max(1, options.maxHeadings || 40)
  const maxChunks = Math.max(1, options.maxChunks || 12)
  const perChunkChars = Math.max(80, Math.min(options.perChunkChars || 220, 600))

  return [
    '# 资料扫描图谱',
    '',
    '## 总计',
    `- 资料数：${scan.stats.sourceCount}`,
    `- 总字数：${scan.stats.totalChars}`,
    `- 标题数：${scan.stats.headingCount}`,
    `- 可整理片段：${scan.stats.chunkCount}`,
    '',
    '## 来源资料',
    ...(scan.sources.slice(0, maxSources).map(source =>
      `- ${source.path}（${source.charCount} 字，${source.headingCount} 个标题，${source.chunkCount} 个片段）`
    )),
    '',
    '## 标题结构',
    ...(scan.headings.slice(0, maxHeadings).map(heading =>
      `- ${'#'.repeat(heading.level)} ${heading.title} -> ${heading.anchor}`
    )),
    '',
    '## 候选主题',
    `- 实体/对象：${scan.candidateEntities.join('、') || '待模型判断'}`,
    `- 概念/方法：${scan.candidateConcepts.join('、') || '待模型判断'}`,
    `- 流程/步骤：${scan.candidateProcesses.join('、') || '待模型判断'}`,
    '',
    '## 代表片段',
    ...(scan.chunks.slice(0, maxChunks).map(chunk =>
      `### ${chunk.title}\n来源：${chunk.sourceAnchor}\n\n${excerpt(chunk.content, perChunkChars)}`
    )),
  ].join('\n')
}
