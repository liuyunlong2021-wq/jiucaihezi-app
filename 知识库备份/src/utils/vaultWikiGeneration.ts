import type { RawMarkdownForWiki } from './vaultFirstWiki'
import type { VaultSeedPageSpec } from './vaultScaffold'
import { scanMarkdownCorpus, type CorpusChunk } from './vaultCorpus'

export interface FirstWikiPageJob {
  id: string
  title: string
  folder: string
  targetPath: string
  sourceAnchors: string[]
  sourceExcerpt: string
  prompt: string
}

function cleanTitle(value: string, fallback = '知识页'): string {
  return String(value || fallback)
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || fallback
}

function excerpt(text: string, max = 1800): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function uniqueFolders(folders: string[]): string[] {
  return Array.from(new Set((folders || []).map(folder =>
    String(folder || '').replace(/^wiki\//, '').replace(/^\/+|\/+$/g, '').trim()
  ).filter(Boolean)))
}

function chooseFolder(chunk: CorpusChunk, wikiFolders: string[]): string {
  const title = chunk.title
  const text = `${chunk.title}\n${chunk.content}`
  const rules: Array<[RegExp, string]> = [
    [/角色|人物|男主|女主|主角|配角|动机/, '角色'],
    [/世界观|势力|地理|历史|规则|设定/, '世界观'],
    [/道具|物品|装备|武器/, '道具'],
    [/结构|模型|原则|方法|框架|公式|策略/, '方法模型'],
    [/流程|步骤|操作|执行|阶段|第一步|第二步/, '操作流程'],
    [/对比|区别|差异|优劣| vs |VS/, '对比分析'],
    [/模板|清单|表格|示例|范例/, '模板'],
    [/问题|为什么|怎么办|失败|FAQ/, 'FAQ'],
    [/概念|定义|基础|是什么|定位|目标用户|用户画像/, '基础概念'],
  ]
  const desired = rules.find(([regex]) => regex.test(text) || regex.test(title))?.[1] || '沉淀内容'
  const normalizedFolders = uniqueFolders(wikiFolders)
  const exact = normalizedFolders.find(folder => folder === desired)
  if (exact) return exact.split('/')[0]
  const related = normalizedFolders.find(folder => folder.includes(desired) || desired.includes(folder.split('/')[0]))
  return related ? related.split('/')[0] : desired
}

function buildJobPrompt(input: {
  title: string
  folder: string
  sourceAnchors: string[]
  sourceExcerpt: string
}): string {
  return [
    '你是韭菜盒子知识库 Wiki 页面生成器。',
    '只输出单个 Markdown Wiki 页面，不要输出 JSON，不要解释。',
    '',
    `目标栏目：wiki/${input.folder}`,
    `页面标题：${input.title}`,
    '',
    '页面必须包含：',
    '1. 摘要',
    '2. 核心要点',
    '3. 适用场景',
    '4. 相关页面',
    '5. 来源引用',
    '',
    '来源引用必须保留以下路径：',
    ...input.sourceAnchors.map(anchor => `- ${anchor}`),
    '',
    '原文片段：',
    input.sourceExcerpt,
  ].join('\n')
}

export function buildFirstWikiPageJobs(input: {
  rawMarkdownFiles: RawMarkdownForWiki[]
  wikiFolders: string[]
  maxPages?: number
}): FirstWikiPageJob[] {
  const maxPages = Math.max(1, Math.min(15, input.maxPages || 12))
  const scan = scanMarkdownCorpus({ files: input.rawMarkdownFiles })
  const seen = new Set<string>()
  const jobs: FirstWikiPageJob[] = []

  for (const chunk of scan.chunks) {
    if (jobs.length >= maxPages) break
    if (chunk.content.replace(/\s+/g, '').length < 8) continue
    const title = cleanTitle(chunk.title)
    const folder = chooseFolder(chunk, input.wikiFolders)
    const targetPath = `${folder}/${title}.md`
    if (seen.has(targetPath)) continue
    seen.add(targetPath)
    const sourceAnchors = [chunk.sourceAnchor]
    const sourceExcerpt = excerpt(chunk.content)
    jobs.push({
      id: `firstwiki_${jobs.length + 1}`,
      title,
      folder,
      targetPath,
      sourceAnchors,
      sourceExcerpt,
      prompt: buildJobPrompt({ title, folder, sourceAnchors, sourceExcerpt }),
    })
  }

  return jobs
}

export function pageJobToSeedPage(job: FirstWikiPageJob, modelMarkdown?: string): VaultSeedPageSpec {
  const fallbackContent = [
    '## 摘要',
    excerpt(job.sourceExcerpt, 180),
    '',
    '## 核心要点',
    job.sourceExcerpt,
    '',
    '## 适用场景',
    '- 适合在相关问题、资料检索和后续生成任务中引用。',
    '',
    '## 相关页面',
    '- 待整理',
    '',
    '## 来源引用',
    ...job.sourceAnchors.map(anchor => `- ${anchor}`),
  ].join('\n')

  return {
    path: job.targetPath,
    title: job.title,
    summary: excerpt(job.sourceExcerpt, 120),
    content: String(modelMarkdown || fallbackContent).trim(),
    sources: job.sourceAnchors,
    tags: [job.folder],
    confidence: modelMarkdown ? 'high' : 'medium',
  }
}
