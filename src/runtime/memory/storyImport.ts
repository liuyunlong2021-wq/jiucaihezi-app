import type { ProjectFileService } from '@/services/projectFileService'
import type { ProjectResource, ProjectTextRead } from '@/utils/projectResource'
import {
  buildMarkdownSplitPlan,
  hashText,
  isStoryChapterBoundary,
  isStoryNumberedBoundary,
  parseStoryOrdinal,
  type MarkdownSplitPlan,
  type MarkdownSplitStrategy,
} from './markdownSplit'

export { parseStoryOrdinal } from './markdownSplit'

export interface StoryImportPlan {
  id: string
  title: string
  originalName: string
  sourceEncoding: string
  wikiRoot: 'wiki' | 'docs/wiki'
  workDirectory: string
  sourcePath: string
  completionPath: string
  completionContent: string
  split: MarkdownSplitPlan
}

export interface StoryImportResult {
  created: number
  updated: number
  skipped: number
  paths: string[]
}

const storyImportQueues = new Map<string, Promise<void>>()

export function safeWikiSegment(value: string): string {
  const result = value
    .normalize('NFC')
    .replace(/\.(?:md|markdown|txt|docx?|pdf)$/i, '')
    .replace(/[\\/:*?"<>|#[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 80)
  if (!result) throw new Error('无法确定故事名称')
  return result
}

function matchLines(lines: string[], matcher: RegExp): number[] {
  return lines.flatMap((line, index) => (matcher.test(line) ? [index] : []))
}

function candidateScore(
  lines: string[],
  indexes: number[],
  strategy: MarkdownSplitStrategy,
): number {
  const ordinals = indexes
    .map(index => parseStoryOrdinal(lines[index]!))
    .filter(value => value !== null)
  if (ordinals.length < 2) return strategy === 'markdown_heading' ? 10 : 20
  const transitions = ordinals
    .slice(1)
    .filter((value, index) => value === ordinals[index]! + 1).length
  return ordinals.length * 100 + Math.round((transitions / (ordinals.length - 1)) * 50)
}

export function detectStorySplit(content: string): {
  strategy: MarkdownSplitStrategy
  headingLevel?: number
} {
  const lines = content.split(/\r?\n/)
  const candidates: Array<{
    result: { strategy: MarkdownSplitStrategy; headingLevel?: number }
    lines: number[]
    score: number
  }> = []
  const chapters = lines.flatMap((line, index) => (isStoryChapterBoundary(line) ? [index] : []))
  if (chapters.length)
    candidates.push({
      result: { strategy: 'story_chapter' },
      lines: chapters,
      score: candidateScore(lines, chapters, 'story_chapter'),
    })
  const numbered = lines.flatMap((line, index) => (isStoryNumberedBoundary(line) ? [index] : []))
  if (numbered.length >= 2)
    candidates.push({
      result: { strategy: 'story_numbered' },
      lines: numbered,
      score: candidateScore(lines, numbered, 'story_numbered'),
    })
  for (let level = 1; level <= 6; level += 1) {
    const headings = matchLines(lines, new RegExp(`^\\s*#{${level}}\\s+\\S`))
    if (headings.length)
      candidates.push({
        result: { strategy: 'markdown_heading', headingLevel: level },
        lines: headings,
        score: candidateScore(lines, headings, 'markdown_heading') - level,
      })
  }
  candidates.sort((left, right) => right.score - left.score)
  const selected = candidates[0]
  if (!selected) throw new Error('没有识别到故事边界，请先补充章节标题或独立数字段号')
  const competing = candidates.slice(1).find(candidate => {
    const similarScore = candidate.score / selected.score >= 0.8
    return similarScore && candidate.lines.join(',') !== selected.lines.join(',')
  })
  if (competing) throw new Error('检测到多种接近但切片位置不同的故事边界，请先明确拆分规则')
  return selected.result
}

export async function buildStoryImportPlan(input: {
  content: string
  title: string
  originalName: string
  sourceEncoding?: string
  wikiRoot?: 'wiki' | 'docs/wiki'
}): Promise<StoryImportPlan> {
  const title = safeWikiSegment(input.title)
  const originalName = String(input.originalName || '').trim() || `${title}.md`
  const sourceEncoding = String(input.sourceEncoding || 'unknown')
  const wikiRoot = input.wikiRoot || 'wiki'
  const workDirectory = `${wikiRoot}/原始材料/${title}`
  const sourcePath = `${workDirectory}/原文.md`
  const split = await buildMarkdownSplitPlan(input.content, {
    sourcePath,
    targetDirectory: `${workDirectory}/原文节点`,
    ...detectStorySplit(input.content),
  })
  const completionPath = `${workDirectory}/来源.md`
  const completionContent = [
    '---',
    'type: story-source',
    `id: ${JSON.stringify(`story.${split.sourceHash.slice(0, 16)}`)}`,
    `title: ${JSON.stringify(title)}`,
    `original_name: ${JSON.stringify(originalName)}`,
    `source_encoding: ${JSON.stringify(sourceEncoding)}`,
    `source_hash: ${JSON.stringify(split.sourceHash)}`,
    `split_plan: ${JSON.stringify(split.id)}`,
    `node_count: ${split.nodes.length}`,
    'import_status: complete',
    '---',
    '',
    `# ${title}来源`,
    '',
    `- 原始文件：${originalName}`,
    `- 原文：[[原文]]`,
    `- 原文节点：[[原文节点/index|${split.nodes.length} 个节点]]`,
    ...(split.warnings.length
      ? ['', '## 导入警告', '', ...split.warnings.map(item => `- ${item}`)]
      : []),
    '',
  ].join('\n')
  return {
    id: split.id,
    title,
    originalName,
    sourceEncoding,
    wikiRoot,
    workDirectory,
    sourcePath,
    completionPath,
    completionContent,
    split,
  }
}

function hasLink(content: string, target: string): boolean {
  return content.includes(`[[${target}]]`) || content.includes(`[[${target}|`)
}

export function upsertWikiIndex(
  content: string,
  title: string,
  purpose: string,
  directories: Array<{ target: string; label: string; summary: string }> = [],
  pages: Array<{ target: string; label: string; summary: string }> = [],
): string {
  let result = content.trim()
  if (!result) result = `# ${title}\n\n用途：${purpose}`
  const missingDirectories = directories.filter(item => !hasLink(result, item.target))
  const missingPages = pages.filter(item => !hasLink(result, item.target))
  const insert = (heading: string, lines: string[]) => {
    if (!lines.length) return
    const marker = `## ${heading}`
    const start = result.indexOf(marker)
    if (start < 0) {
      result += `\n\n${marker}\n\n${lines.join('\n')}`
      return
    }
    const next = result.indexOf('\n## ', start + marker.length)
    const position = next < 0 ? result.length : next
    result =
      `${result.slice(0, position).trimEnd()}\n${lines.join('\n')}\n\n${result.slice(position).trimStart()}`.trimEnd()
  }
  insert(
    '子目录',
    missingDirectories.map(item => `- [[${item.target}|${item.label}]] - ${item.summary}`),
  )
  insert(
    '页面',
    missingPages.map(item => `- [[${item.target}|${item.label}]] - ${item.summary}`),
  )
  return `${result.trimEnd()}\n`
}

// ponytail: this serializes one app process; move the lock into the storage adapter if multi-process writers become supported.
export async function withStoryWorkflowLock<T>(
  owner: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = storyImportQueues.get(owner) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => gate)
  storyImportQueues.set(owner, queued)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (storyImportQueues.get(owner) === queued) storyImportQueues.delete(owner)
  }
}

export async function applyStoryImportPlan(
  plan: StoryImportPlan,
  currentSource: string,
  files: ProjectFileService,
  owner: string,
  options: { acceptWarnings?: boolean } = {},
): Promise<StoryImportResult> {
  return await withStoryWorkflowLock(owner, async () => {
    if ((await hashText(currentSource)) !== plan.split.sourceHash)
      throw new Error('故事内容已变化，请重新预览')
    if (plan.split.requiresReview && !options.acceptWarnings)
      throw new Error('拆分预览存在需要确认的编号警告')
    const resources = await files.list(owner)
    const byPath = new Map(resources.map(resource => [resource.path, resource]))
    const reads = new Map<string, ProjectTextRead | null>()
    const read = async (path: string): Promise<ProjectTextRead | null> => {
      if (reads.has(path)) return reads.get(path) || null
      try {
        const value = await files.readTextAt(owner, path)
        reads.set(path, value)
        return value
      } catch {
        reads.set(path, null)
        return null
      }
    }

    const staticWrites = [{ path: plan.sourcePath, content: currentSource }, ...plan.split.writes]
    const existingCompletion = await read(plan.completionPath)
    if (existingCompletion && existingCompletion.content !== plan.completionContent) {
      throw new Error(`目标文件冲突，未写入任何内容：${plan.completionPath}`)
    }
    for (const write of staticWrites) {
      const existing = await read(write.path)
      if (existing && existing.content !== write.content) {
        throw new Error(`目标文件冲突，未写入任何内容：${write.path}`)
      }
    }

    const rootIndexPath = `${plan.wikiRoot}/index.md`
    const materialsIndexPath = `${plan.wikiRoot}/原始材料/index.md`
    const workIndexPath = `${plan.workDirectory}/index.md`
    const rootBefore = await read(rootIndexPath)
    const materialsBefore = await read(materialsIndexPath)
    const workBefore = await read(workIndexPath)
    const indexWrites = [
      {
        path: workIndexPath,
        before: workBefore,
        content: upsertWikiIndex(
          workBefore?.content || '',
          plan.title,
          '保存本作品的可追溯原文、无损节点和分析入口。',
          [
            {
              target: '原文节点/index',
              label: '原文节点',
              summary: '按原文物理顺序保存的无损切片。',
            },
          ],
          [
            { target: '来源', label: '来源', summary: '导入来源、哈希、识别规则与完成状态。' },
            { target: '原文', label: '原文', summary: '转换后的完整 Markdown 真源。' },
          ],
        ),
      },
      {
        path: materialsIndexPath,
        before: materialsBefore,
        content: upsertWikiIndex(
          materialsBefore?.content || '',
          '原始材料',
          '保存用户提供或授权使用的来源材料。',
          [
            {
              target: `${plan.title}/index`,
              label: plan.title,
              summary: '故事原文、无损节点与来源记录。',
            },
          ],
        ),
      },
      {
        path: rootIndexPath,
        before: rootBefore,
        content: upsertWikiIndex(
          rootBefore?.content || '',
          plan.wikiRoot === 'wiki' ? 'Wiki' : '文档 Wiki',
          '项目知识导航。',
          [
            {
              target: '原始材料/index',
              label: '原始材料',
              summary: '用户导入故事的原文与无损拆分节点。',
            },
          ],
        ),
      },
    ]

    let created = 0
    let updated = 0
    let skipped = 0
    const paths: string[] = []
    const createStatic = async (path: string, content: string) => {
      if ((await read(path))?.content === content) {
        skipped += 1
        return
      }
      await files.createText(owner, path, content)
      created += 1
      paths.push(path)
    }
    for (const write of staticWrites) await createStatic(write.path, write.content)
    for (const write of indexWrites) {
      if (write.before?.content === write.content) {
        skipped += 1
        continue
      }
      if (!write.before) {
        await files.createText(owner, write.path, write.content)
        created += 1
      } else {
        const resource = byPath.get(write.path) as ProjectResource | undefined
        if (!resource) throw new Error(`索引已变化，请重新执行：${write.path}`)
        const result = await files.writeText(resource, write.content, write.before.revision)
        if (result.status !== 'saved')
          throw new Error(`索引正在其他窗口更新，请重新执行：${write.path}`)
        updated += 1
      }
      paths.push(write.path)
    }
    await createStatic(plan.completionPath, plan.completionContent)
    return { created, updated, skipped, paths }
  })
}
