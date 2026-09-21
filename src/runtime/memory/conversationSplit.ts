/**
 * 对话拆分：把一条 Raw 对话按「每轮一段」拆成文档，落到 `.raw/jc-media/文档/对话-<短名>/`。
 *
 * 与故事拆分同构（`序号_短名.md` + `index.md` + `来源.md`、写入前冲突闸门、内容没变就跳过），
 * 区别只有一个：切点是确定的 —— 每个用户轮开头，不需要任何识别规则。
 * 原对话只读，本流程不写 `.raw/对话记录/`。
 */

import { MEMORY_MEDIA_DIRECTORIES } from '@/utils/memoryProjectPaths'
import { hashText } from './markdownSplit'
import { safeWikiSegment, withStoryWorkflowLock } from './storyImport'
import type { ConversationTranscript, ConversationTurn } from './conversationTranscript'
import type { ProjectFileService } from '@/services/projectFileService'

export const CONVERSATION_SPLIT_ROOT = `${MEMORY_MEDIA_DIRECTORIES.document}/对话`
const SPLIT_SOURCE_MARKER = '<!-- jc-conversation-split -->'
const INDEX_FILE_NAME = 'index.md'
const SOURCE_FILE_NAME = '来源.md'
const SHORT_NAME_LIMIT = 12
const SUMMARY_LIMIT = 24

export interface ConversationSplitNode {
  /** 第几轮（物理顺序，从 1 开始）。 */
  round: number
  /** `短名_0007.md` */
  fileName: string
  path: string
  content: string
}

export interface ConversationSplitPlan {
  id: string
  title: string
  shortName: string
  directory: string
  sourcePath: string
  sourceHash: string
  rounds: number
  writes: ConversationSplitNode[]
  indexPath: string
  indexContent: string
  sourceNotePath: string
  sourceNoteContent: string
}

export interface ConversationSplitResult {
  created: number
  updated: number
  skipped: number
  directory: string
}

/** 一行抓出可读短名：去掉 markdown 装饰、引用符号与换行。 */
function firstLine(value: string): string {
  const line = String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .find(item => item && !/^[>#\-*`|]+$/.test(item))
  return (line || '')
    .replace(/^[>#\-*\s]+/, '')
    .replace(/[*`_~]/g, '')
    .trim()
}

function cut(value: string, limit: number): string {
  const text = value.normalize('NFC').replace(/\s+/g, ' ')
  const chars = [...text]
  return chars.length > limit ? chars.slice(0, limit).join('') : text
}

/** 目录名与文件名前缀：对话标题的短名，没有标题时退回首轮内容。 */
export function conversationSplitShortName(transcript: ConversationTranscript): string {
  const title = firstLine(transcript.title)
  const fallback = firstLine(transcript.turns.find(turn => turn.role === 'user')?.content || '')
  const base = cut(title || fallback || '对话', SHORT_NAME_LIMIT).replace(/^[. -]+|[. -]+$/g, '')
  return safeWikiSegment(base || '对话').slice(0, SHORT_NAME_LIMIT)
}

/** 索引里每一轮的短标题与摘要只取原文，模型产出不进文件名。 */
function roundLabel(turns: ConversationTurn[]): string {
  const userTurn = turns.find(turn => turn.role === 'user')
  const assistantTurn = turns.find(turn => turn.role === 'assistant')
  const label = cut(firstLine(userTurn?.content || '') || firstLine(assistantTurn?.content || ''), SHORT_NAME_LIMIT)
  const summary = cut(firstLine(assistantTurn?.content || '') || '', SUMMARY_LIMIT)
  return `${label || '（无提问）'}${summary && summary !== label ? ` - ${summary}` : ''}`
}

interface ConversationRound {
  round: number
  turns: ConversationTurn[]
}

/**
 * 每遇一个用户轮开一段；助手轮跟随其后的那一段。
 * 磁盘上的对话本来就是用户/助手交替，这里只兜住「文首出现孤立助手轮」这一种偏差：
 * 它挂到后面第一段前面，不占轮次号。
 */
export function conversationRounds(turns: ConversationTurn[]): ConversationRound[] {
  const rounds: ConversationRound[] = []
  let leading: ConversationTurn[] = []
  for (const turn of turns) {
    if (turn.role !== 'user') {
      if (!rounds.length) leading.push(turn)
      else rounds.at(-1)!.turns.push(turn)
      continue
    }
    rounds.push({ round: rounds.length + 1, turns: [...leading, turn] })
    leading = []
  }
  // 整条对话只有助手轮（理论上不会出现）：当成一段，别丢内容
  if (!rounds.length && leading.length) rounds.push({ round: 1, turns: leading })
  return rounds
}

function attachmentLine(turn: ConversationTurn): string {
  const attachments = turn.attachments || []
  if (!attachments.length) return ''
  const items = attachments.map(attachment => {
    const path = attachment.projectPath || attachment.readablePath || ''
    return path ? `${attachment.name}（${path}）` : attachment.name
  })
  return `\n\n> 附件：${items.join('、')}`
}

function renderTurn(turn: ConversationTurn): string {
  return `## ${turn.role === 'user' ? '用户' : '助手'}\n\n${turn.content.trim()}${attachmentLine(turn)}`
}

function frontmatterValue(value: string): string {
  return JSON.stringify(value)
}

function renderRoundFile(input: {
  round: number
  title: string
  shortName: string
  turns: ConversationTurn[]
  sourceId: string
  sourcePath: string
}): string {
  const lead = input.turns[0]!
  const skills = [...new Set(input.turns.flatMap(turn => turn.skillNames || []))]
  const tools = [...new Set(input.turns.flatMap(turn => turn.toolChips || []))]
  const lines = [
    '---',
    `type: conversation-round`,
    `source_id: ${frontmatterValue(input.sourceId)}`,
    `source: ${frontmatterValue(input.sourcePath)}`,
    `round: ${input.round}`,
    `created: ${frontmatterValue(lead.createdAt)}`,
    `roles: ${frontmatterValue(input.turns.map(turn => turn.role).join(','))}`,
  ]
  if (skills.length) lines.push(`skills: ${frontmatterValue(skills.join(', '))}`)
  if (tools.length) lines.push(`tools: ${frontmatterValue(tools.join(', '))}`)
  lines.push('---', '', `# ${input.title} · 第${input.round}轮`, '', input.turns.map(renderTurn).join('\n\n'))
  return `${lines.join('\n').trimEnd()}\n`
}

function renderIndex(input: {
  id: string
  title: string
  entries: Array<{ fileName: string; round: number; label: string }>
}): string {
  return [
    `# ${input.title} · 对话拆分索引`,
    '',
    `<!-- jc-conversation-split-index source-id="${input.id}" -->`,
    '',
    ...input.entries.map(entry => `- [[${entry.fileName.replace(/\.md$/i, '')}|第${entry.round}轮：${entry.label}]]`),
    '',
  ].join('\n')
}

function renderSourceNote(input: {
  id: string
  title: string
  shortName: string
  sourcePath: string
  sourceHash: string
  rounds: number
}): string {
  return [
    '---',
    `type: conversation-split`,
    `id: ${frontmatterValue(input.id)}`,
    `title: ${frontmatterValue(input.title)}`,
    `source: ${frontmatterValue(input.sourcePath)}`,
    `source_hash: ${frontmatterValue(input.sourceHash)}`,
    `rounds: ${input.rounds}`,
    '---',
    '',
    SPLIT_SOURCE_MARKER,
    '',
    '# 来源',
    '',
    `- 对话：\`${input.sourcePath}\``,
    `- 标题：${input.title}`,
    `- 轮数：${input.rounds}`,
    '- 拆分规则：每轮（用户提问 + 随后的助手回复）一份文档',
    `- 产物：本目录 \`${input.shortName}_0001.md\` 起，共 ${input.rounds} 份`,
    '- 原对话只读；本目录里的内容由对话拆分流程生成，重拆按内容哈希更新或跳过。',
    '',
  ].join('\n')
}

export function conversationSplitSourceMarker(): string {
  return SPLIT_SOURCE_MARKER
}

/**
 * 比对护栏只看正文：frontmatter 里的 `source_hash`/`rounds` 本来就会随着对话变长而变，
 * 跟故事拆分的 `storyNodeBody()` 同一条口径。
 */
function splitBody(content: string): string {
  const text = String(content || '')
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---\n', 4)
  return end < 0 ? text : text.slice(end + 5)
}

/** 判断「来源.md 是本流程生成的」：用户自己建的同名文件不能被刷新覆盖。 */
export function isGeneratedConversationSplitNote(content: string): boolean {
  return /\ntype: conversation-split\n/.test(`\n${String(content || '')}\n`)
}

export async function buildConversationSplitPlan(input: {
  transcript: ConversationTranscript
  /** Raw 对话文件路径，如 `.raw/对话记录/conversation-xxx.md`。 */
  sourcePath: string
  /** 该文件的当前内容，用于哈希与「对话已变化」判断。 */
  sourceContent: string
}): Promise<ConversationSplitPlan> {
  const title = firstLine(input.transcript.title) || '对话'
  const shortName = conversationSplitShortName(input.transcript)
  const sourceHash = await hashText(input.sourceContent)
  // id 取对话自身 ID 而不是内容哈希：对话变长后重拆必须认得是同一条，否则整目录报冲突。
  const id = `conversation-split.${input.transcript.id}`
  const directory = `${CONVERSATION_SPLIT_ROOT}/${shortName}`
  const rounds = conversationRounds(input.transcript.turns)
  const writes = rounds.map(item => {
    const fileName = `${shortName}_${String(item.round).padStart(4, '0')}.md`
    return {
      round: item.round,
      fileName,
      path: `${directory}/${fileName}`,
      content: renderRoundFile({
        round: item.round,
        title,
        shortName,
        turns: item.turns,
        sourceId: id,
        sourcePath: input.sourcePath,
      }),
    }
  })
  return {
    id,
    title,
    shortName,
    directory,
    sourcePath: input.sourcePath,
    sourceHash,
    rounds: rounds.length,
    writes,
    indexPath: `${directory}/${INDEX_FILE_NAME}`,
    indexContent: renderIndex({
      id,
      title,
      entries: rounds.map(item => ({
        fileName: `${shortName}_${String(item.round).padStart(4, '0')}.md`,
        round: item.round,
        label: roundLabel(item.turns),
      })),
    }),
    sourceNotePath: `${directory}/${SOURCE_FILE_NAME}`,
    sourceNoteContent: renderSourceNote({
      id,
      title,
      shortName,
      sourcePath: input.sourcePath,
      sourceHash,
      rounds: rounds.length,
    }),
  }
}

/** 写入前的读数：文件不存在返回 null，读失败也返回 null（后续按新建处理）。 */
async function readOrNull(files: ProjectFileService, owner: string, path: string) {
  try {
    return await files.readTextAt(owner, path)
  } catch {
    return null
  }
}

/**
 * 落盘。护栏与故事拆分同一条口径：
 * - 对话内容变了 → 「请重新预览」；
 * - 同一目录同一序号出现不同文件名 → 一处都不写，直接报冲突；
 * - 已存在的段文件：内容相同跳过、新内容以旧内容开头则刷新、其余报冲突；
 * - 原对话只读，本流程不写 `.raw/对话记录/`。
 */
export async function applyConversationSplitPlan(
  plan: ConversationSplitPlan,
  currentSource: string,
  files: ProjectFileService,
  owner: string,
): Promise<ConversationSplitResult> {
  return await withStoryWorkflowLock(owner, async () => {
    if ((await hashText(currentSource)) !== plan.sourceHash)
      throw new Error('对话内容已变化，请重新预览拆分')

    const resources = await files.list(owner)
    const byPath = new Map(resources.map(resource => [resource.path, resource]))
    const plannedPaths = new Set(plan.writes.map(write => write.path))
    const plannedByOrdinal = new Map<string, string>()
    for (const write of plan.writes) {
      const ordinal = write.fileName.match(/^.*?_([0-9]+)\.md$/u)?.[1]
      if (ordinal) plannedByOrdinal.set(`${plan.directory}/${ordinal}`, write.path)
    }
    const renamed = resources.find(resource => {
      if (plannedPaths.has(resource.path) || !/\.md$/i.test(resource.path)) return false
      const ordinal = resource.path.slice(plan.directory.length + 1).match(/^.*?_([0-9]+)(?:_|\.md$)/u)?.[1]
      return Boolean(ordinal && plannedByOrdinal.has(`${plan.directory}/${ordinal}`))
    })
    if (renamed)
      throw new Error(`同一轮次已有不同名称的文档，未写入任何内容：${renamed.path}`)

    const reads = new Map<string, Awaited<ReturnType<typeof readOrNull>>>()
    const read = async (path: string) => {
      if (!reads.has(path)) reads.set(path, await readOrNull(files, owner, path))
      return reads.get(path) || null
    }

    for (const write of plan.writes) {
      const existing = await read(write.path)
      if (
        existing &&
        existing.content !== write.content &&
        !splitBody(write.content).startsWith(splitBody(existing.content))
      )
        throw new Error(`目标文件冲突，未写入任何内容：${write.path}`)
    }
    const existingIndex = await read(plan.indexPath)
    if (
      existingIndex &&
      existingIndex.content !== plan.indexContent &&
      !splitBody(plan.indexContent).startsWith(splitBody(existingIndex.content))
    )
      throw new Error(`目标文件冲突，未写入任何内容：${plan.indexPath}`)
    const existingNote = await read(plan.sourceNotePath)
    let sourceNoteContent = plan.sourceNoteContent
    if (existingNote && existingNote.content !== sourceNoteContent) {
      if (!isGeneratedConversationSplitNote(existingNote.content))
        throw new Error(`目标文件冲突，未写入任何内容：${plan.sourceNotePath}`)
      const at = existingNote.content.indexOf(SPLIT_SOURCE_MARKER)
      if (at >= 0) sourceNoteContent += existingNote.content.slice(at + SPLIT_SOURCE_MARKER.length).replace(/^\n+/, '')
    }

    let created = 0
    let updated = 0
    let skipped = 0
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
        if (result.status !== 'saved') throw new Error(`文件正在其他窗口更新，请重新执行：${path}`)
        updated += 1
      } else {
        await files.createText(owner, path, content)
        created += 1
      }
    }

    for (const write of plan.writes) await writeStatic(write.path, write.content)
    await writeStatic(plan.indexPath, plan.indexContent)
    await writeStatic(plan.sourceNotePath, sourceNoteContent)
    return { created, updated, skipped, directory: plan.directory }
  })
}
