import type { ProjectFileService } from '@/services/projectFileService'
import type { ProjectResource, ProjectTextRead } from '@/utils/projectResource'
import {
  buildMarkdownSplitPlan,
  hashText,
  isStoryChapterBoundary,
  isStoryNumberedBoundary,
  normalizeStoryMarker,
  parseStoryOrdinal,
  probeStoryMarker,
  type MarkdownSplitPlan,
  type MarkdownSplitStrategy,
  type StoryMarkerShape,
} from './markdownSplit'

export { parseStoryOrdinal } from './markdownSplit'

export interface StoryImportPlan {
  id: string
  title: string
  author: string
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

/**
 * 下载器把作者写进文件名的三种常见写法：`书名(作者)`、`《书名》作者：作者`、`书名 - 作者`。
 * 认不出来就留空让用户手填；卷册后缀（`- 第1卷`）不给作者，避免把卷名当人名。
 */
function splitFileNameAuthor(fileName: string): { title: string; author: string } {
  const stem = String(fileName || '').replace(/\.[^.]+$/, '').trim()
  const named = stem.match(/^(.*?)\s*(?:作者|著)\s*[:：]\s*(.{1,40})$/u)
  if (named) return { title: unwrapTitle(named[1]!), author: named[2]!.trim() }
  const bracketed = stem.match(/^(.*?)\s*[（(]([^（()）]{1,40})[）)]\s*$/u)
  if (bracketed) return { title: unwrapTitle(bracketed[1]!), author: bracketed[2]!.trim() }
  const dashed = stem.match(/^(.{1,60}?)\s+[-–—]\s+(\S{1,20})$/u)
  if (dashed && !/[卷章册部集场幕上下全完版篇季]/u.test(dashed[2]!))
    return { title: unwrapTitle(dashed[1]!), author: dashed[2]!.trim() }
  return { title: unwrapTitle(stem), author: '' }
}

/** 书名的《》是包装，不是名字的一部分。 */
function unwrapTitle(value: string): string {
  return value.trim().replace(/^《(.*)》$/u, '$1').trim()
}

/**
 * 书名优先取转换产物里的第一个一级标题（书自己的标题），否则退回文件名；
 * 作者只能从文件名里拿——AnyDoc 的文档模型不带元数据。
 * 两项都可以在导入预览里由用户改写，所以猜错不致命。
 */
export function inferStoryIdentity(
  content: string,
  fileName: string,
): { title: string; author: string } {
  const fromFile = splitFileNameAuthor(fileName)
  const heading = content.match(/^#\s+(\S.*)$/mu)?.[1]?.trim()
  return { title: heading || fromFile.title, author: fromFile.author }
}

/** 来源.md 是生成物：这一行之后的内容不由本流程产出，刷新时必须原样保留。 */
export const STORY_SOURCE_MARKER = '<!-- jc-story-source -->'

/** 节点文件的正文（去掉 frontmatter）：比较切片是否只是被延长时用。 */
function storyNodeBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  return match ? content.slice(match[0].length) : content
}

/** 判据：这份记录看起来是本流程生成的（而不是用户自己建的 来源.md）。 */
function isGeneratedStorySourceRecord(content: string): boolean {
  return content.startsWith('---\n') && /\ntype: story-source\n/u.test(content)
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

export function detectStorySplit(
  content: string,
  options: { marker?: string } = {},
): {
  strategy: MarkdownSplitStrategy
  headingLevel?: number
  marker?: string
  markerShape?: StoryMarkerShape
} {
  // 填了标记词就不参与候选打分：剧本里常把 `SC01` 分场和 `1.` 分镜号混排，
  // 让自定义规则去比分数很容易被 story_numbered 挤掉。
  const marker = normalizeStoryMarker(options.marker || '')
  if (marker) {
    const probe = probeStoryMarker(content, marker)
    if (!probe)
      throw new Error(`没有识别到「${marker}」的拆分边界：至少要有 2 处匹配，换一个标记词试试`)
    return { strategy: 'story_custom', marker: probe.marker, markerShape: probe.shape }
  }
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
  author?: string
  originalName: string
  sourceEncoding?: string
  wikiRoot?: 'wiki' | 'docs/wiki'
  marker?: string
}): Promise<StoryImportPlan> {
  const title = safeWikiSegment(input.title)
  const author = String(input.author || '').trim()
  const originalName = String(input.originalName || '').trim() || `${title}.md`
  const sourceEncoding = String(input.sourceEncoding || 'unknown')
  const wikiRoot = input.wikiRoot || 'wiki'
  const workDirectory = `${wikiRoot}/原始材料/${title}`
  const sourcePath = `${workDirectory}/原文.md`
  const split = await buildMarkdownSplitPlan(input.content, {
    sourcePath,
    targetDirectory: `${workDirectory}/原文节点`,
    ...detectStorySplit(input.content, { marker: input.marker }),
  })
  const completionPath = `${workDirectory}/来源.md`
  const completionContent = [
    '---',
    'type: story-source',
    `id: ${JSON.stringify(`story.${split.sourceHash.slice(0, 16)}`)}`,
    `title: ${JSON.stringify(title)}`,
    ...(author ? [`author: ${JSON.stringify(author)}`] : []),
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
    ...(author ? [`- 作者：${author}`] : []),
    `- 原文：[[原文]]`,
    `- 原文节点：[[原文节点/index|${split.nodes.length} 个节点]]`,
    ...(split.warnings.length
      ? ['', '## 导入警告', '', ...split.warnings.map(item => `- ${item}`)]
      : []),
    '',
    STORY_SOURCE_MARKER,
    '',
  ].join('\n')
  return {
    id: split.id,
    title,
    author,
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
    // 节点文件名带原文派生的短名：同一序号出现不同名字说明原文已改稿或来自旧版命名，
    // 直接写入会留下两套节点，所以在任何写入前停下。
    const plannedPaths = new Set(plan.split.nodes.map(node => node.path))
    const plannedByNumber = new Map<string, string>()
    for (const node of plan.split.nodes) {
      const directory = node.path.slice(0, node.path.lastIndexOf('/'))
      const number = node.path.slice(directory.length + 1).match(/^([0-9]+)/u)?.[1]
      if (number) plannedByNumber.set(`${directory}/${number}`, node.path)
    }
    const renamedNode = resources.find(resource => {
      if (plannedPaths.has(resource.path) || !/\.md$/i.test(resource.path)) return false
      const directory = resource.path.slice(0, resource.path.lastIndexOf('/'))
      const number = resource.path.slice(directory.length + 1).match(/^([0-9]+)(?:_|\.md$)/u)?.[1]
      return Boolean(number && plannedByNumber.has(`${directory}/${number}`))
    })
    if (renamedNode)
      throw new Error(`同一序号已有不同名称的节点文件，未写入任何内容：${renamedNode.path}`)
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
    const existingSource = await read(plan.sourcePath)
    // 原文.md 允许「追加后重导」：新内容以旧内容开头说明只是往后加了章节，
    // 节点侧仍按内容哈希跳过/新建。真正危险的改稿（覆盖、换书）继续停下。
    if (existingSource && existingSource.content !== currentSource) {
      if (!currentSource.startsWith(existingSource.content))
        throw new Error(`目标文件冲突，未写入任何内容：${plan.sourcePath}`)
    }
    const existingCompletion = await read(plan.completionPath)
    let completionContent = plan.completionContent
    if (existingCompletion && existingCompletion.content !== completionContent) {
      // 来源.md 是本流程自己生成的导入记录，允许刷新（元数据升级、追加章节后重导）；
      // 用户自己建的 来源.md 不碰，用户写在生成块之后的笔记跟着原样保留。
      if (!isGeneratedStorySourceRecord(existingCompletion.content))
        throw new Error(`目标文件冲突，未写入任何内容：${plan.completionPath}`)
      const at = existingCompletion.content.indexOf(STORY_SOURCE_MARKER)
      if (at >= 0)
        completionContent += existingCompletion.content.slice(at + STORY_SOURCE_MARKER.length)
    }
    for (const write of plan.split.writes) {
      const existing = await read(write.path)
      // 节点是原文的派生切片，不是用户内容：内容没变就跳过；只在「正文是旧正文的
      // 延长」（往后加了东西，切片的末端跟着挪，frontmatter 的 source_range 与
      // source_hash 随之更新）时刷新；其余改动一律停下。
      if (
        existing &&
        existing.content !== write.content &&
        !storyNodeBody(write.content).startsWith(storyNodeBody(existing.content))
      ) {
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
    // 同一个写入器同时负责新建与刷新：追加章节后重导需要更新 原文.md 与 来源.md，
    // 老代码只走 createText，会在文件已存在时失败。
    const writeStatic = async (path: string, content: string) => {
      const existing = await read(path)
      if (existing?.content === content) {
        skipped += 1
        return
      }
      if (existing) {
        const resource = byPath.get(path)
        if (!resource) throw new Error(`文件已变化，请重新执行：${path}`)
        const result = await files.writeText(resource, content, existing.revision)
        if (result.status !== 'saved')
          throw new Error(`文件正在其他窗口更新，请重新执行：${path}`)
        updated += 1
      } else {
        await files.createText(owner, path, content)
        created += 1
      }
      paths.push(path)
    }
    for (const write of staticWrites) await writeStatic(write.path, write.content)
    // 索引与正文走同一个写入器：新建、刷新、跳过三种结果一致，不再各写一套。
    for (const write of indexWrites) await writeStatic(write.path, write.content)
    await writeStatic(plan.completionPath, completionContent)
    return { created, updated, skipped, paths }
  })
}
