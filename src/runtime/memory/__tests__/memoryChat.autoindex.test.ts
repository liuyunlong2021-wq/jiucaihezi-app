import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectFileService } from '@/services/projectFileService'
import { appendConversationTurn, createConversationTranscript } from '../conversationTranscript'
import { recordPersistedConversationAnswer } from '../memoryProject'
import { parseConversationMemoryIndex } from '../conversationMemoryIndex'
import { WIKI_ARTIFACT_RECEIPT_MARKER } from '../wikiArtifacts'

function fixture() {
  const path = '.raw/对话记录/c.md'
  const user = { id: 'u', role: 'user' as const, content: '王刚不要与初恋复合', createdAt: '2026-10-15' }
  const assistant = { id: 'a', role: 'assistant' as const, content: '两人在旧车站重逢，没有复合。', createdAt: '2026-10-15' }
  const raw = appendConversationTurn(appendConversationTurn(createConversationTranscript('c'), user), assistant)
  const data = new Map([[path, raw]])
  let fail = false
  const files = createProjectFileService({
    runtime: 'web',
    async list() { return [...data].map(([path, content]) => ({ path, content, isDirectory: false })) },
    async readText(_owner, path) { if (!data.has(path)) throw new Error('missing'); const content = data.get(path)!; return { content, size: content.length, truncated: false, revision: { value: content, size: content.length } } },
    async createFolder(_owner, path) { return { path, isDirectory: true } },
    async createText(_owner, path, content) { if (fail) throw new Error('disk full'); if (data.has(path)) throw new Error('exists'); data.set(path, content); return { path, content, isDirectory: false } },
    async writeText(_owner, path, content) { if (fail) throw new Error('disk full'); data.set(path, content); return { status: 'saved', revision: { value: content, size: content.length } } },
    async rename() { throw new Error('unused') }, async remove() { throw new Error('unused') },
  })
  const resource = { runtime: 'web' as const, owner: 'p', path, name: 'c.md', isDirectory: false, kind: 'document' as const }
  return { files, data, raw, resource, user, assistant, fail: (value: boolean) => { fail = value } }
}

test('indexing reads the persisted pair, not UI/current-project state; retry is idempotent', async () => {
  const f = fixture()
  let calls = 0
  const summarize = async (input: any) => {
    calls++
    assert.equal(input.userTurn.content, f.user.content)
    assert.equal(input.modelId, 'origin-model')
    return { summary: '重逢但不要复合', keywords: ['王刚', '初恋', '旧车站'] }
  }
  await recordPersistedConversationAnswer(f.resource, f.assistant, 'origin-model', f.files, summarize)
  await recordPersistedConversationAnswer(f.resource, f.assistant, 'origin-model', f.files, summarize)
  const index = parseConversationMemoryIndex(f.data.get('.raw/记忆索引/c.md')!)!
  assert.equal(index.entries.length, 1)
  assert.equal(calls, 1)
  assert.equal(f.data.get(f.resource.path), f.raw)
})

test('missing or changed Raw prevents indexing and incomplete output is not recorded', async () => {
  for (const kind of ['missing', 'changed', 'interrupted']) {
    const f = fixture()
    let calls = 0
    if (kind === 'missing') f.data.clear()
    if (kind === 'changed') f.data.set(f.resource.path, f.raw.replace(f.assistant.content, '人工改稿'))
    const turn = kind === 'interrupted' ? { ...f.assistant, content: '> 本轮因网络或上游服务中断，已保留当前结果。' } : f.assistant
    await assert.rejects(recordPersistedConversationAnswer(f.resource, turn, 'model', f.files, async () => { calls++; return { summary: 'x', keywords: ['x'] } }))
    assert.equal(calls, 0)
    assert.equal(f.data.has('.raw/记忆索引/c.md'), false)
  }
})

test('index failure preserves Raw and retry writes the same turn once', async () => {
  const f = fixture()
  const summary = async () => ({ summary: '不要复合', keywords: ['王刚'] })
  f.fail(true)
  await assert.rejects(recordPersistedConversationAnswer(f.resource, f.assistant, 'model', f.files, summary), /disk full/)
  assert.equal(f.data.get(f.resource.path), f.raw)
  f.fail(false)
  await recordPersistedConversationAnswer(f.resource, f.assistant, 'model', f.files, summary)
  assert.equal(parseConversationMemoryIndex(f.data.get('.raw/记忆索引/c.md')!)?.entries[0]?.assistantTurnId, 'a')
})

test('editing the answer during summarization cannot create a stale index', async () => {
  const f = fixture()
  await assert.rejects(recordPersistedConversationAnswer(f.resource, f.assistant, 'model', f.files, async () => {
    f.data.set(f.resource.path, f.raw.replace(f.assistant.content, '改稿'))
    return { summary: '旧稿', keywords: ['旧稿'] }
  }), /变化|编辑/)
  assert.equal(f.data.has('.raw/记忆索引/c.md'), false)
})

test('a save-only reply indexes actual saved Wiki text in the same summary request', async () => {
  const f = fixture()
  const path = 'wiki/创作/章节草稿/初恋/第001章.md'
  const content = '# 第001章\n李静在旧车站归还青玉佩，没有复合。'
  const answer = { ...f.assistant, content: `已保存草稿。${WIKI_ARTIFACT_RECEIPT_MARKER}- [[${path}|章节草稿]]` }
  f.data.set(f.resource.path, f.raw.replace(f.assistant.content, answer.content))
  f.data.set(path, content)
  let requests = 0
  await recordPersistedConversationAnswer(f.resource, answer, 'model', f.files, async input => {
    requests++
    assert.deepEqual(input.wikiArtifacts, [{ path, content }])
    return { summary: '草稿中李静归还玉佩，未复合', keywords: ['李静', '旧车站', '青玉佩'] }
  })
  assert.equal(requests, 1)
  assert.deepEqual(parseConversationMemoryIndex(f.data.get('.raw/记忆索引/c.md')!)!.entries[0]!.keywords, ['李静', '旧车站', '青玉佩', path])
})
