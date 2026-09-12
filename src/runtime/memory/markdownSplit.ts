export type MarkdownSplitStrategy = 'story_chapter' | 'story_numbered' | 'markdown_heading'

export interface MarkdownSplitOptions {
  sourcePath: string
  targetDirectory: string
  strategy: MarkdownSplitStrategy
  headingLevel?: number
  groupSize?: number
}

export interface MarkdownSplitNode {
  order: number
  title: string
  sourceLabel: string
  shortName: string
  summary: string
  source: string
  startLine: number
  endLine: number
  path: string
  hash: string
}

export interface MarkdownSplitWrite {
  path: string
  content: string
}

export interface MarkdownSplitPlan {
  id: string
  sourcePath: string
  sourceHash: string
  targetDirectory: string
  strategy: MarkdownSplitStrategy
  nodes: MarkdownSplitNode[]
  writes: MarkdownSplitWrite[]
  warnings: string[]
  requiresReview: boolean
}

export interface MarkdownSplitWriter {
  read(path: string): Promise<string | null>
  create(path: string, content: string): Promise<void>
}

function normalizePath(input: string): string {
  const inputPath = String(input || '')
  if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(inputPath)) throw new Error('拆分路径必须位于当前项目内')
  const raw = inputPath.replace(/\\/g, '/').replace(/\/+$/g, '')
  const parts = raw.split('/').filter(part => part && part !== '.')
  if (!parts.length || raw.includes('\0') || parts.some(part => part === '..')) {
    throw new Error('拆分路径无效')
  }
  return parts.join('/')
}

export async function hashText(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function sourceLines(
  content: string,
): Array<{ start: number; end: number; line: number; text: string }> {
  const lines: Array<{ start: number; end: number; line: number; text: string }> = []
  let start = 0
  let line = 1
  while (start < content.length) {
    const newline = content.indexOf('\n', start)
    const end = newline < 0 ? content.length : newline + 1
    lines.push({
      start,
      end,
      line,
      text: content.slice(start, newline < 0 ? end : newline).replace(/\r$/, ''),
    })
    start = end
    line += 1
  }
  return lines
}

function titleFromBoundary(line: string): string {
  return line.replace(/^\s*#{1,6}\s*/, '').trim()
}

// 名称与摘要预算：文件树与侧栏都要单行读完。短名只允许来自原文本身
// （标题名称、标题括注、章内小标题、首个正文句子），模型产出永不进入路径——
// 否则同一份原文两次导入会得到不同文件名。
const SHORT_NAME_LIMIT = 12
const SUMMARY_LIMIT = 24
const MIN_SUBHEADING_NAME = 2
const MIN_SENTENCE_NAME = 4

function plainText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function truncate(value: string, limit: number): string {
  const chars = [...value]
  return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join('')}…`
}

function pathSegment(value: string, limit: number): string {
  const cleaned = plainText(value)
    .replace(/[\\/:*?"<>|#[\]{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\-_ ·、。，,]+|[.\-_ ·、。，,]+$/gu, '')
  return [...cleaned].slice(0, limit).join('')
}

function unwrapBookMarks(value: string): string {
  return value.replace(/^[《〈「『【[]+/u, '').replace(/[》〉」』】\]]+$/u, '')
}

function splitTitleNote(title: string): { name: string; note: string } {
  const match = plainText(title).match(/^(.*?)\s*[（(]([^（()）]*)[）)]\s*$/u)
  if (!match) return { name: title, note: '' }
  return { name: match[1]!.trim(), note: plainText(match[2]!) }
}

/** 剥掉标题里的编号前缀，剩下的就是作者自己给的名称；剥不出名称时返回空串。 */
function nameFromTitle(title: string): string {
  // 名称要匹配全角编号，所以只在这里做 NFKC；摘要保留原文用字，不做兼容归一。
  const normalized = plainText(title).normalize('NFKC')
  const patterns = [
    new RegExp(`^第\\s*${ORDINAL_TOKEN}\\s*${CHAPTER_UNIT}\\s*`, 'iu'),
    // 编号后面必须跟空白、行尾或分隔符，否则 `Episode` 会被当成“ep + 罗马数字 I”。
    new RegExp(
      `^${ENGLISH_CHAPTER}\\.?\\s*${ORDINAL_TOKEN}(?=\\s|$|[.、:：\\-–—])`,
      'iu',
    ),
    new RegExp(`^${ORDINAL_TOKEN}\\s*[.、)）:：\\-–—]\\s*`, 'iu'),
    new RegExp(`^${NUMERIC_TOKEN}\\s+`, 'u'),
    new RegExp(`^${ORDINAL_TOKEN}\\s*[.、．]?$`, 'iu'),
  ]
  for (const pattern of patterns) {
    if (!pattern.test(normalized)) continue
    const rest = normalized.replace(pattern, '').replace(/^[\s.、,，:：\-–—]+/u, '')
    return unwrapBookMarks(rest)
  }
  return unwrapBookMarks(normalized)
}

function bodyLines(source: string, title: string): string[] {
  const lines = source.split(/\r?\n/)
  if (lines.length && titleFromBoundary(lines[0]!) === title) lines.shift()
  return lines
}

function inlineText(line: string): string {
  return plainText(
    line
      .replace(/^\s*[-*>+]\s+/u, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
      .replace(/\[\[([^\]]+)\]\]/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/[*_`~]/gu, ''),
  )
}

function firstSubheading(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^\s*#{1,6}\s+(\S.*)$/u)
    if (match) return inlineText(match[1]!)
  }
  return ''
}

function firstSentence(lines: string[]): string {
  for (const line of lines) {
    if (/^\s*#{1,6}\s/u.test(line)) continue
    const text = inlineText(line)
    if (!text || /^[-=_*~·—]{3,}$/u.test(text)) continue
    return plainText(text.match(/^[^。！？!?；;…]*[。！？!?；;…]?/u)?.[0] || text)
  }
  return ''
}

function firstClause(sentence: string): string {
  return plainText(sentence.match(/^[^，,、；;：:。！？!?…]+/u)?.[0] || sentence)
}

function deriveNodeNaming(title: string, source: string): { shortName: string; summary: string } {
  const lines = bodyLines(source, title)
  const { name, note } = splitTitleNote(title)
  const titled = pathSegment(nameFromTitle(name), SHORT_NAME_LIMIT)
  const heading = firstSubheading(lines)
  const sentence = firstSentence(lines)
  const clause = firstClause(sentence)
  const shortName =
    titled ||
    (heading.length >= MIN_SUBHEADING_NAME ? pathSegment(heading, SHORT_NAME_LIMIT) : '') ||
    (clause.length >= MIN_SENTENCE_NAME ? pathSegment(clause, SHORT_NAME_LIMIT) : '')
  const candidate = [note, heading, sentence].map(plainText).find(value => {
    if (!value) return false
    if (value === heading && heading.length < MIN_SUBHEADING_NAME) return false
    if (value === sentence && sentence.length < MIN_SENTENCE_NAME) return false
    return truncate(value, SUMMARY_LIMIT) !== shortName
  })
  return { shortName, summary: candidate ? truncate(candidate, SUMMARY_LIMIT) : '' }
}

const CHINESE_NUMBER =
  '零〇○一壹壱二贰貳弐两兩三叁參参四肆五伍六陆陸七柒八捌九玖十拾什百佰陌千仟阡万萬'
const ORDINAL_TOKEN = `(?:[0-9]+|[${CHINESE_NUMBER}]+|[IVXLCDM]+)`
const CHAPTER_UNIT = '(?:章|回|节|節|集|幕|卷|巻|话|話|篇|部)'
const ENGLISH_CHAPTER = '(?:chapter|chap|ch|part|book|episode|ep|section|scene|act|volume|vol)'
const NUMERIC_TOKEN = `(?:[0-9]+|[${CHINESE_NUMBER}]+)`

function parseChineseNumber(token: string): number | null {
  const normalized = token
    .replace(/[〇○]/g, '零')
    .replace(/[壹壱]/g, '一')
    .replace(/[贰貳弐]/g, '二')
    .replace(/[两兩]/g, '二')
    .replace(/[叁參参]/g, '三')
    .replace(/肆/g, '四')
    .replace(/伍/g, '五')
    .replace(/[陆陸]/g, '六')
    .replace(/柒/g, '七')
    .replace(/捌/g, '八')
    .replace(/玖/g, '九')
    .replace(/[拾什]/g, '十')
    .replace(/[佰陌]/g, '百')
    .replace(/[仟阡]/g, '千')
    .replace(/萬/g, '万')
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (![...normalized].some(char => '十百千万'.includes(char))) {
    const value = [...normalized].map(char => digits[char]).join('')
    return value && !value.includes('undefined') ? Number(value) : null
  }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let section = 0
  let digit = 0
  for (const char of normalized) {
    if (char in digits) {
      digit = digits[char]!
    } else if (char === '万') {
      total += (section + digit || 1) * 10_000
      section = 0
      digit = 0
    } else if (char in units) {
      section += (digit || 1) * units[char]!
      digit = 0
    } else {
      return null
    }
  }
  return total + section + digit
}

function parseRomanNumber(token: string): number | null {
  const roman = token.toUpperCase()
  if (!/^(?=[MDCLXVI]+$)M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(roman))
    return null
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  return [...roman].reduceRight(
    (state, char) => {
      const value = values[char]!
      return { total: state.total + (value < state.previous ? -value : value), previous: value }
    },
    { total: 0, previous: 0 },
  ).total
}

function parseOrdinalToken(token: string): number | null {
  const normalized = token.normalize('NFKC')
  if (/^[0-9]+$/.test(normalized)) return Number(normalized)
  if (new RegExp(`^[${CHINESE_NUMBER}]+$`, 'u').test(normalized))
    return parseChineseNumber(normalized)
  return parseRomanNumber(normalized)
}

export function parseStoryOrdinal(line: string): number | null {
  const title = titleFromBoundary(line).normalize('NFKC').trim()
  const suffix = '(?:\\s*[（(].*[）)])?\\s*$'
  const patterns = [
    new RegExp(`^第\\s*(${ORDINAL_TOKEN})\\s*${CHAPTER_UNIT}`, 'iu'),
    new RegExp(`^${ENGLISH_CHAPTER}\\.?\\s*(${ORDINAL_TOKEN})(?:\\s|$|[.、:：-])`, 'iu'),
    new RegExp(`^(${ORDINAL_TOKEN})(?:[.、)）:：-]\\s*|\\s+)(?=\\S)`, 'iu'),
    new RegExp(`^(${ORDINAL_TOKEN})(?:[.、．])?$`, 'iu'),
    new RegExp(`([0-9]+)${suffix}`, 'u'),
    new RegExp(`([${CHINESE_NUMBER}]+)${suffix}`, 'u'),
    new RegExp(`(?:^|\\s)([IVXLCDM]+)${suffix}`, 'iu'),
  ]
  for (const pattern of patterns) {
    const token = title.match(pattern)?.[1]
    if (token) return parseOrdinalToken(token)
  }
  return null
}

export function isStoryChapterBoundary(line: string): boolean {
  const title = titleFromBoundary(line).normalize('NFKC').trim()
  return (
    new RegExp(`^第\\s*${ORDINAL_TOKEN}\\s*${CHAPTER_UNIT}`, 'iu').test(title) ||
    new RegExp(`^${ENGLISH_CHAPTER}\\.?\\s*${ORDINAL_TOKEN}(?:\\s|$|[.、:：-])`, 'iu').test(title)
  )
}

export function isStoryNumberedBoundary(line: string): boolean {
  if (/^\s*#{1,6}\s+/.test(line)) return false
  const title = titleFromBoundary(line).normalize('NFKC').trim()
  return new RegExp(`^(?:${ORDINAL_TOKEN})(?:(?:[.、)）:：-]\\s*|\\s+)\\S+|[.、．]?)$`, 'iu').test(
    title,
  )
}

function withoutMarkdownExtension(path: string): string {
  return path.replace(/\.(?:md|markdown)$/i, '')
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function pageContent(node: MarkdownSplitNode, sourcePath: string, targetDirectory: string): string {
  const idBase = withoutMarkdownExtension(sourcePath).replace(/\//g, '.')
  const kind = node.order === 0 ? 'preface-source' : 'story-source-node'
  const suffix = String(node.order).padStart(4, '0')
  return [
    '---',
    `type: ${kind}`,
    `id: ${yamlString(`${idBase}.${node.order === 0 ? 'preface' : `chapter.${suffix}`}`)}`,
    `title: ${yamlString(node.title)}`,
    `order: ${node.order}`,
    `source_label: ${yamlString(node.sourceLabel)}`,
    `parent: ${yamlString(`[[${targetDirectory}/index|章节]]`)}`,
    `source: ${yamlString(`[[${withoutMarkdownExtension(sourcePath)}]]`)}`,
    `source_range: ${yamlString(`lines ${node.startLine}-${node.endLine}`)}`,
    `source_hash: ${yamlString(node.hash)}`,
    '---',
    '',
    node.source,
  ].join('\n')
}

function indexEntry(node: MarkdownSplitNode): string {
  const stem = withoutMarkdownExtension(node.path.split('/').pop()!)
  const label =
    node.shortName && !node.title.includes(node.shortName)
      ? `${node.title} ${node.shortName}`
      : node.title
  return `- [[${stem}|${label}]]${node.summary ? ` - ${node.summary}` : ''}`
}

function pageIndex(title: string, nodes: MarkdownSplitNode[]): string {
  return [
    `# ${title}`,
    '',
    '用途：按原始顺序导航无损拆分的故事节点；不保存资产事实。',
    '',
    '## 页面',
    '',
    ...nodes.map(indexEntry),
    '',
  ].join('\n')
}

export async function buildMarkdownSplitPlan(
  content: string,
  options: MarkdownSplitOptions,
): Promise<MarkdownSplitPlan> {
  if (!content.trim()) throw new Error('源文件没有可拆分内容')
  if (!['story_chapter', 'story_numbered', 'markdown_heading'].includes(options.strategy))
    throw new Error('不支持的拆分策略')
  const sourcePath = normalizePath(options.sourcePath)
  const targetDirectory = normalizePath(options.targetDirectory)
  if (!/\.(?:md|markdown)$/i.test(sourcePath)) throw new Error('源文件必须是 Markdown')
  if (
    sourcePath === `${targetDirectory}/index.md` ||
    sourcePath.startsWith(`${targetDirectory}/`)
  ) {
    throw new Error('拆分目标不能包含源文件')
  }
  const groupSize = Math.max(2, Math.min(Math.floor(options.groupSize || 100), 500))
  const headingLevel = Math.max(1, Math.min(Math.floor(options.headingLevel || 1), 6))
  const matcher =
    options.strategy === 'story_chapter'
      ? isStoryChapterBoundary
      : options.strategy === 'story_numbered'
        ? isStoryNumberedBoundary
        : (line: string) => new RegExp(`^\\s*#{${headingLevel}}\\s+\\S`).test(line)
  const lines = sourceLines(content)
  const boundaries = lines.filter(line => matcher(line.text))
  if (!boundaries.length) throw new Error('没有识别到拆分边界，请检查拆分策略或标题层级')

  const drafts: Array<{
    order: number
    title: string
    sourceLabel: string
    source: string
    startLine: number
    endLine: number
  }> = []
  const first = boundaries[0]!
  if (content.slice(0, first.start).trim()) {
    drafts.push({
      order: 0,
      title: '前置内容',
      sourceLabel: '',
      source: content.slice(0, first.start),
      startLine: 1,
      endLine: first.line - 1,
    })
  }
  boundaries.forEach((boundary, index) => {
    const next = boundaries[index + 1]
    const end = next?.start ?? content.length
    drafts.push({
      order: index + 1,
      title: titleFromBoundary(boundary.text),
      sourceLabel: titleFromBoundary(boundary.text),
      source: content.slice(boundary.start, end),
      startLine: boundary.line,
      endLine: (next?.line ?? lines.length + 1) - 1,
    })
  })

  const warnings: string[] = []
  if (drafts[0]?.order === 0) warnings.push('已把首个边界前的内容保留为“前置内容”')
  const duplicates = drafts.filter(
    (node, index) =>
      node.order > 0 && drafts.findIndex(item => item.sourceLabel === node.sourceLabel) !== index,
  )
  const ordinals = boundaries
    .map(item => parseStoryOrdinal(item.text))
    .filter(value => value !== null)
  const repeatedOrdinals = [
    ...new Set(ordinals.filter((value, index) => ordinals.indexOf(value) !== index)),
  ]
  const missingOrdinals: number[] = []
  let outOfOrder = false
  for (let index = 1; index < ordinals.length; index += 1) {
    const previous = ordinals[index - 1]!
    const current = ordinals[index]!
    if (current <= previous) outOfOrder = true
    for (let value = previous + 1; value < current && missingOrdinals.length < 100; value += 1)
      missingOrdinals.push(value)
  }
  if (repeatedOrdinals.length) warnings.push(`发现重复编号：${repeatedOrdinals.join('、')}`)
  else if (duplicates.length)
    warnings.push(
      `发现重复标题：${[...new Set(duplicates.map(node => node.sourceLabel))].join('、')}`,
    )
  if (missingOrdinals.length) warnings.push(`缺少编号：${missingOrdinals.join('、')}`)
  if (outOfOrder) warnings.push('章节序号存在倒序')

  const width = Math.max(4, String(boundaries.length).length)
  const grouped = boundaries.length > groupSize
  const nodes: MarkdownSplitNode[] = []
  for (const draft of drafts) {
    const number = String(draft.order).padStart(width, '0')
    const groupStart = Math.floor((Math.max(1, draft.order) - 1) / groupSize) * groupSize + 1
    const groupEnd = Math.min(groupStart + groupSize - 1, boundaries.length)
    const group =
      grouped && draft.order > 0
        ? `${String(groupStart).padStart(width, '0')}-${String(groupEnd).padStart(width, '0')}/`
        : ''
    const naming = deriveNodeNaming(draft.title, draft.source)
    // 序号前缀不可省：重复标题就靠它避免撞路径。前置内容固定为 0000.md，便于续跑识别。
    const shortName = draft.order > 0 ? naming.shortName : ''
    const stem = shortName ? `${number}_${shortName}` : number
    nodes.push({
      ...draft,
      shortName,
      summary: naming.summary,
      path: `${targetDirectory}/${group}${stem}.md`,
      hash: await hashText(draft.source),
    })
  }

  const writes: MarkdownSplitWrite[] = nodes.map(node => ({
    path: node.path,
    content: pageContent(node, sourcePath, targetDirectory),
  }))
  const rootLines = ['# 章节', '', '用途：按原始顺序导航无损拆分的故事节点；不保存资产事实。', '']
  const preface = nodes.filter(node => node.order === 0)
  if (preface.length) rootLines.push('## 页面', '', ...preface.map(indexEntry), '')
  if (grouped) {
    const groups = new Map<string, MarkdownSplitNode[]>()
    for (const node of nodes.filter(item => item.order > 0)) {
      const directory = node.path.slice(targetDirectory.length + 1).split('/')[0]!
      groups.set(directory, [...(groups.get(directory) || []), node])
    }
    rootLines.push('## 子目录', '')
    for (const [directory, groupNodes] of groups) {
      rootLines.push(
        `- [[${directory}/index|${directory}]] - ${groupNodes[0]!.title} 至 ${groupNodes.at(-1)!.title}`,
      )
      writes.push({
        path: `${targetDirectory}/${directory}/index.md`,
        content: pageIndex(directory, groupNodes),
      })
    }
    rootLines.push('')
  } else {
    const chapters = nodes.filter(node => node.order > 0)
    if (chapters.length) rootLines.push('## 页面', '', ...chapters.map(indexEntry), '')
  }
  writes.push({ path: `${targetDirectory}/index.md`, content: rootLines.join('\n') })

  const sourceHash = await hashText(content)
  const optionKey = JSON.stringify({
    sourcePath,
    targetDirectory,
    strategy: options.strategy,
    headingLevel,
    groupSize,
  })
  return {
    id: `markdown_split_${(await hashText(`${sourceHash}:${optionKey}`)).slice(0, 16)}`,
    sourcePath,
    sourceHash,
    targetDirectory,
    strategy: options.strategy,
    nodes,
    writes,
    warnings,
    requiresReview:
      duplicates.length > 0 ||
      repeatedOrdinals.length > 0 ||
      missingOrdinals.length > 0 ||
      outOfOrder,
  }
}

export async function applyMarkdownSplitPlan(
  plan: MarkdownSplitPlan,
  currentSource: string,
  writer: MarkdownSplitWriter,
  options: { acceptWarnings?: boolean; signal?: AbortSignal } = {},
): Promise<{ created: number; skipped: number }> {
  if ((await hashText(currentSource)) !== plan.sourceHash)
    throw new Error('源文件已变化，请重新预览拆分')
  if (plan.requiresReview && !options.acceptWarnings)
    throw new Error('拆分预览存在需要确认的警告；确认后设置 acceptWarnings=true')

  const existing = new Map<string, string | null>()
  for (const write of plan.writes) {
    options.signal?.throwIfAborted()
    existing.set(write.path, await writer.read(write.path))
  }
  const conflicts = plan.writes.filter(write => {
    const current = existing.get(write.path)
    return current !== null && current !== write.content
  })
  if (conflicts.length) {
    throw new Error(
      `目标文件冲突，未写入任何内容：${conflicts
        .slice(0, 5)
        .map(item => item.path)
        .join('、')}`,
    )
  }

  let created = 0
  let skipped = 0
  for (const write of plan.writes) {
    options.signal?.throwIfAborted()
    if (existing.get(write.path) === write.content) {
      skipped += 1
      continue
    }
    try {
      await writer.create(write.path, write.content)
      created += 1
    } catch (error) {
      if ((await writer.read(write.path)) === write.content) {
        skipped += 1
        continue
      }
      throw error
    }
  }
  return { created, skipped }
}
