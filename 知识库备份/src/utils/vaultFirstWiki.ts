import type { VaultSeedPageSpec } from './vaultScaffold'
import { buildFirstWikiPageJobs, pageJobToSeedPage } from './vaultWikiGeneration'

export interface RawMarkdownForWiki {
  name: string
  path: string
  content: string
}

export interface FirstWikiDraftInput {
  vaultName: string
  rawMarkdownFiles: RawMarkdownForWiki[]
  maxPages?: number
}

export interface FirstWikiDraft {
  wikiFolders: string[]
  seedPages: VaultSeedPageSpec[]
  sourceFiles: string[]
  mode: 'structured' | 'fallback' | 'empty'
}

interface Section {
  title: string
  content: string
  sourcePath: string
}

const DEFAULT_TOOLBOOK_FOLDERS = ['基础概念', '操作流程', '方法模型', '对比分析', '模板', 'FAQ']

function cleanTitle(value: string): string {
  return String(value || '未命名')
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60) || '未命名'
}

function summarize(text: string, max = 90): string {
  return String(text || '')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || '待补充'
}

function isMeaningfulSourceContent(text: string): boolean {
  const cleaned = String(text || '')
    .replace(/\[第\d+页\]/g, '')
    .replace(/\[Page\s*\d+\]/gi, '')
    .replace(/#+\s*/g, '')
    .replace(/[-_*`>[\]().,，。:：;；\s]/g, '')
    .trim()
  return /[\p{L}\p{N}]/u.test(cleaned) && cleaned.length >= 2
}

function extractSections(file: RawMarkdownForWiki): Section[] {
  const lines = String(file.content || '').split(/\r?\n/)
  const sections: Section[] = []
  let currentTitle = ''
  let buffer: string[] = []

  function push() {
    const title = cleanTitle(currentTitle)
    const content = buffer.join('\n').trim()
    if (title && content) {
      sections.push({ title, content, sourcePath: file.path })
    }
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/)
    if (heading) {
      if (currentTitle) push()
      currentTitle = heading[2]
      buffer = []
      continue
    }
    if (currentTitle) buffer.push(line)
  }
  if (currentTitle) push()
  return sections
}

function classifySection(title: string, content: string): string {
  const text = `${title}\n${content}`
  if (/为什么|怎么办|如何|常见问题|问题|FAQ|没有|失败/.test(text)) return 'FAQ'
  if (/流程|步骤|冷启动|发布|复盘|操作|执行|阶段|第一步|第二步/.test(text)) return '操作流程'
  if (/模型|公式|原则|方法|框架|策略/.test(text)) return '方法模型'
  if (/对比|区别| vs |VS|优劣|差异/.test(text)) return '对比分析'
  if (/模板|表格|清单|示例/.test(text)) return '模板'
  return '基础概念'
}

function buildPage(section: Section): VaultSeedPageSpec {
  const folder = classifySection(section.title, section.content)
  const title = cleanTitle(section.title)
  const content = [
    `## 摘要`,
    summarize(section.content, 160),
    '',
    '## 要点',
    section.content.trim(),
    '',
    '## 适用场景',
    '- 适合在相关问题、资料检索和后续生成任务中引用。',
    '',
    '## 相关页面',
    '- 待整理',
  ].join('\n')

  return {
    path: `${folder}/${title}.md`,
    title,
    summary: summarize(section.content),
    content,
    sources: [`${section.sourcePath}#${title}`],
    tags: [folder],
    confidence: 'medium',
  }
}

function fallbackPage(input: FirstWikiDraftInput): VaultSeedPageSpec {
  const body = input.rawMarkdownFiles
    .map(file => `## ${file.name}\n\n${String(file.content || '').trim().slice(0, 1600)}`)
    .join('\n\n---\n\n')
  return {
    path: '沉淀内容/资料概览.md',
    title: '资料概览',
    summary: '资料结构较弱，先生成总览页，后续通过整理逐步拆分。',
    content: body,
    sources: input.rawMarkdownFiles.map(file => file.path),
    tags: ['沉淀内容'],
    confidence: 'low',
  }
}

function normalizeSeedPagePath(path: string): string {
  const normalized = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^wiki\//, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .trim()
  if (!normalized) return ''
  return /\.(md|markdown)$/i.test(normalized) ? normalized : `${normalized}.md`
}

function seedPageHasMeaningfulContent(page: VaultSeedPageSpec): boolean {
  return isMeaningfulSourceContent(`${page.summary || ''}\n${page.content || ''}`)
}

export function mergeFirstWikiDraftSeedPages(
  existingPages: VaultSeedPageSpec[] = [],
  draft?: FirstWikiDraft | null,
): VaultSeedPageSpec[] {
  if (!draft?.seedPages?.length) return existingPages.filter(page => normalizeSeedPagePath(page.path))

  const result: VaultSeedPageSpec[] = []
  const indexByPath = new Map<string, number>()

  function pushOrReplace(page: VaultSeedPageSpec, preferWhenExistingEmpty: boolean) {
    const path = normalizeSeedPagePath(page.path)
    if (!path) return
    const normalizedPage = { ...page, path }
    const existingIndex = indexByPath.get(path)
    if (existingIndex === undefined) {
      indexByPath.set(path, result.length)
      result.push(normalizedPage)
      return
    }
    if (preferWhenExistingEmpty && !seedPageHasMeaningfulContent(result[existingIndex]) && seedPageHasMeaningfulContent(normalizedPage)) {
      result[existingIndex] = normalizedPage
    }
  }

  for (const page of existingPages) pushOrReplace(page, false)
  for (const page of draft.seedPages) pushOrReplace(page, true)
  return result
}

export function buildFirstWikiDraft(input: FirstWikiDraftInput): FirstWikiDraft {
  const maxPages = Math.max(1, Math.min(15, input.maxPages || 12))
  const meaningfulFiles = input.rawMarkdownFiles.filter(file => isMeaningfulSourceContent(file.content))
  if (meaningfulFiles.length === 0) {
    return {
      wikiFolders: [],
      seedPages: [],
      sourceFiles: input.rawMarkdownFiles.map(file => file.path),
      mode: 'empty',
    }
  }

  const sections = meaningfulFiles.flatMap(extractSections)
  const usableSections = sections
    .filter(section => section.content.replace(/\s+/g, '').length >= 8)
    .slice(0, maxPages)

  if (usableSections.length === 0) {
    return {
      wikiFolders: ['沉淀内容'],
      seedPages: [fallbackPage(input)],
      sourceFiles: meaningfulFiles.map(file => file.path),
      mode: 'fallback',
    }
  }

  const jobs = buildFirstWikiPageJobs({
    rawMarkdownFiles: meaningfulFiles,
    wikiFolders: DEFAULT_TOOLBOOK_FOLDERS,
    maxPages,
  })

  if (jobs.length === 0) {
    return {
      wikiFolders: ['沉淀内容'],
      seedPages: [fallbackPage(input)],
      sourceFiles: meaningfulFiles.map(file => file.path),
      mode: 'fallback',
    }
  }

  const seedPages = jobs.map(job => pageJobToSeedPage(job))
  const folders = Array.from(new Set([
    ...DEFAULT_TOOLBOOK_FOLDERS.filter(folder => seedPages.some(page => page.path.startsWith(`${folder}/`))),
    ...seedPages.map(page => page.path.split('/')[0]).filter(Boolean),
  ]))

  return {
    wikiFolders: folders,
    seedPages,
    sourceFiles: meaningfulFiles.map(file => file.path),
    mode: 'structured',
  }
}

export function buildFirstWikiReport(vaultName: string, draft: FirstWikiDraft): string {
  return [
    `# ${vaultName || '知识库'} 首版 Wiki 生成报告`,
    '',
    `- 时间：${new Date().toLocaleString('zh-CN')}`,
    `- 模式：${draft.mode === 'structured' ? '结构化资料' : draft.mode === 'fallback' ? '弱结构资料' : '没有可用正文'}`,
    `- 读取来源：${draft.sourceFiles.length}`,
    `- 生成栏目：${draft.wikiFolders.length}`,
    `- 生成页面：${draft.seedPages.length}`,
    '',
    '## 来源文件',
    ...(draft.sourceFiles.length ? draft.sourceFiles.map(file => `- ${file}`) : ['- 无']),
    '',
    '## 生成栏目',
    ...(draft.wikiFolders.length ? draft.wikiFolders.map(folder => `- ${folder}`) : ['- 无']),
    '',
    '## 生成页面',
    ...(draft.seedPages.length ? draft.seedPages.map(page => `- ${page.path}`) : ['- 无']),
  ].join('\n')
}
