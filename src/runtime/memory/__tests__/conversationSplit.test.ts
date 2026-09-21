import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendConversationTurn, createConversationTranscript, parseConversationTranscript } from '../conversationTranscript'
import { applyConversationSplitPlan, buildConversationSplitPlan, conversationRounds } from '../conversationSplit'
import { createProjectFileService, type ProjectFileAdapter, type ProjectFileEntry } from '@/services/projectFileService'

/** 造一条 n 轮的对话 Raw，第 i 轮内容带序号，避免被「重复提问」归一化吃掉。 */
function conversationRaw(rounds: number): string {
  let raw = createConversationTranscript('chat-split', '高息陷阱')
  for (let index = 1; index <= rounds; index += 1) {
    raw = appendConversationTurn(raw, {
      id: `u${index}`,
      role: 'user',
      content: `第${index}个问题：继续推进`,
      createdAt: `2026-09-${String((index % 3) + 1).padStart(2, '0')}T0${index % 9}:00:00.000Z`,
    })
    raw = appendConversationTurn(raw, {
      id: `a${index}`,
      role: 'assistant',
      content: `第${index}个回答：已完成`,
      createdAt: `2026-09-${String((index % 3) + 1).padStart(2, '0')}T0${index % 9}:00:01.000Z`,
    })
  }
  return raw
}

/** 内存文件服务：够 apply 用（list / readText / createText / writeText / deleteFile）。 */
function createMemoryFiles(seed: Record<string, string> = {}) {
  const files = new Map<string, { content: string; revision: number }>(
    Object.entries(seed).map(([path, content]) => [path, { content, revision: 1 }]),
  )
  const entries = (): ProjectFileEntry[] =>
    [...files.keys()].map(path => ({ path, isDirectory: false, content: files.get(path)!.content }))
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() {
      return entries()
    },
    async readText(_owner, path) {
      const entry = files.get(path)
      if (!entry) throw new Error(`missing: ${path}`)
      return {
        content: entry.content,
        size: entry.content.length,
        truncated: false,
        revision: { value: String(entry.revision), size: entry.content.length },
      }
    },
    async createText(_owner, path, content) {
      if (files.has(path)) throw new Error(`exists: ${path}`)
      files.set(path, { content, revision: 1 })
      return { path, isDirectory: false }
    },
    async writeText(_owner, path, content, expectedRevision) {
      const entry = files.get(path)
      if (!entry) return { status: 'missing' } as const
      if (String(entry.revision) !== String(expectedRevision.value)) return { status: 'conflict' } as const
      entry.content = content
      entry.revision += 1
      return { status: 'saved', revision: { value: String(entry.revision), size: content.length } } as const
    },
    async deleteFile(_owner, path) {
      files.delete(path)
    },
    async rename() {
      throw new Error('not used')
    },
    async remove() {
      throw new Error('not used')
    },
  }
  return { files, service: createProjectFileService(adapter) }
}

test('每轮一段：120 轮拆成 120 份文档，命名与内容都可核对', async () => {
  const raw = conversationRaw(120)
  const transcript = parseConversationTranscript('.raw/对话记录/chat-split.md', raw)!
  const plan = await buildConversationSplitPlan({
    transcript,
    sourcePath: '.raw/对话记录/chat-split.md',
    sourceContent: raw,
  })

  assert.equal(plan.rounds, 120)
  assert.equal(plan.writes.length, 120)
  assert.equal(plan.directory, '.raw/jc-media/文档/对话/高息陷阱')
  assert.equal(plan.writes[0]?.fileName, '高息陷阱_0001.md')
  assert.equal(plan.writes[119]?.fileName, '高息陷阱_0120.md')
  assert.equal(plan.writes[0]?.path, '.raw/jc-media/文档/对话/高息陷阱/高息陷阱_0001.md')
  assert.match(plan.writes[6]!.content, /^---\ntype: conversation-round\n/m)
  assert.match(plan.writes[6]!.content, /round: 7\n/)
  assert.match(plan.writes[6]!.content, /# 高息陷阱 · 第7轮/)
  assert.match(plan.writes[6]!.content, /## 用户\n\n第7个问题：继续推进/)
  assert.match(plan.writes[6]!.content, /## 助手\n\n第7个回答：已完成/)
  assert.equal(plan.indexPath, '.raw/jc-media/文档/对话/高息陷阱/index.md')
  assert.equal(plan.writes[6]!.content.match(/## 用户/g)?.length, 1)
  assert.equal(plan.sourceNotePath, '.raw/jc-media/文档/对话/高息陷阱/来源.md')
  assert.match(plan.indexContent, /- \[\[高息陷阱_0120\|第120轮：第120个问题：继续推进/)
  assert.match(plan.sourceNoteContent, /type: conversation-split/)
  assert.match(plan.sourceNoteContent, /rounds: 120/)
})

test('孤立助手轮不新开一段，跟在它后面那一段里', () => {
  const rounds = conversationRounds([
    { id: 'a0', role: 'assistant', content: '开场白', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'u1', role: 'user', content: '问题', createdAt: '2026-09-01T00:00:01.000Z' },
    { id: 'a1', role: 'assistant', content: '回答', createdAt: '2026-09-01T00:00:02.000Z' },
    { id: 'u2', role: 'user', content: '追问', createdAt: '2026-09-01T00:00:03.000Z' },
  ])
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0]?.turns.length, 3)
  assert.equal(rounds[0]?.turns[0]?.id, 'a0')
  assert.equal(rounds[1]?.turns.length, 1)
})

test('落盘幂等：首次全新建，同一条对话重拆全部跳过', async () => {
  const raw = conversationRaw(5)
  const transcript = parseConversationTranscript('.raw/对话记录/chat-split.md', raw)!
  const sourcePath = '.raw/对话记录/chat-split.md'
  const { service } = createMemoryFiles()
  const plan = await buildConversationSplitPlan({ transcript, sourcePath, sourceContent: raw })

  const first = await applyConversationSplitPlan(plan, raw, service, 'project')
  // 5 段 + index + 来源
  assert.equal(first.created, 7)
  assert.equal(first.updated, 0)
  assert.equal(first.skipped, 0)

  const second = await applyConversationSplitPlan(
    await buildConversationSplitPlan({ transcript, sourcePath, sourceContent: raw }),
    raw,
    service,
    'project',
  )
  assert.equal(second.created, 0)
  assert.equal(second.updated, 0)
  assert.equal(second.skipped, 7)
})

test('对话往后加了一轮：老段跳过、新段新建、索引与来源刷新', async () => {
  const sourcePath = '.raw/对话记录/chat-split.md'
  const before = conversationRaw(5)
  const transcriptBefore = parseConversationTranscript(sourcePath, before)!
  const { service } = createMemoryFiles()
  await applyConversationSplitPlan(
    await buildConversationSplitPlan({ transcript: transcriptBefore, sourcePath, sourceContent: before }),
    before,
    service,
    'project',
  )

  const after = conversationRaw(6)
  const transcriptAfter = parseConversationTranscript(sourcePath, after)!
  const result = await applyConversationSplitPlan(
    await buildConversationSplitPlan({ transcript: transcriptAfter, sourcePath, sourceContent: after }),
    after,
    service,
    'project',
  )
  assert.equal(result.created, 1) // 第 6 段
  assert.equal(result.updated, 2) // index + 来源
  assert.equal(result.skipped, 5)
})

test('护栏：会话内容已变化、同轮次不同名、段文件被改过，都一处不写地报错', async () => {
  const sourcePath = '.raw/对话记录/chat-split.md'
  const raw = conversationRaw(3)
  const transcript = parseConversationTranscript(sourcePath, raw)!
  const { files, service } = createMemoryFiles()
  const plan = await buildConversationSplitPlan({ transcript, sourcePath, sourceContent: raw })
  await applyConversationSplitPlan(plan, raw, service, 'project')

  await assert.rejects(
    () => applyConversationSplitPlan(plan, `${raw}\n<!-- 后来改过 -->`, service, 'project'),
    /对话内容已变化/,
  )

  const tampered = new Map(files)
  files.set(`${plan.directory}/高息陷阱_0002.md`, { content: '# 用户手改过', revision: 9 })
  await assert.rejects(
    () => applyConversationSplitPlan(plan, raw, service, 'project'),
    /目标文件冲突/,
  )

  files.clear()
  for (const [path, entry] of tampered) files.set(path, entry)
  files.set(`${plan.directory}/高息陷阱_0002_旧名.md`, { content: '旧产物', revision: 1 })
  files.delete(`${plan.directory}/高息陷阱_0002.md`)
  await assert.rejects(
    () => applyConversationSplitPlan(plan, raw, service, 'project'),
    /同一轮次已有不同名称的文档/,
  )
})
