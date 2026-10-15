import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendConversationTurn, createConversationTranscript, parseConversationTranscript } from '../conversationTranscript'
import { conversationMemoryIndexPath, createConversationMemoryIndex, parseConversationMemoryIndex, upsertConversationMemoryIndex } from '../conversationMemoryIndex'
import { createProjectFileService, type ProjectFileAdapter, type ProjectFileEntry } from '@/services/projectFileService'
import { queryConversationMemoryIndex } from '../conversationMemoryIndex'

test('conversation memory index links a turn and is idempotent by assistant id', () => {
  let raw = createConversationTranscript('chat-1', '测试')
  raw = appendConversationTurn(raw, { id: 'u1', role: 'user', content: '问题', createdAt: '2026-09-01T10:00:00.000Z' })
  raw = appendConversationTurn(raw, { id: 'a1', role: 'assistant', content: '回答', createdAt: '2026-09-01T10:00:01.000Z' })
  const transcript = parseConversationTranscript('.raw/对话记录/chat-1.md', raw)!
  const input = { conversationId: transcript.id, rawPath: '.raw/对话记录/chat-1.md', assistantTurnId: 'a1' }
  let index = upsertConversationMemoryIndex('', input, { summary: '简介', keywords: ['索引', '索引'] })
  index = upsertConversationMemoryIndex(index, input, { summary: '更新简介', keywords: ['记忆'] })
  const parsed = parseConversationMemoryIndex(index)!
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0]?.summary, '更新简介')
  assert.match(index, /#jc-turn-a1/)
  assert.equal(conversationMemoryIndexPath('chat-1'), '.raw/记忆索引/chat-1.md')
  assert.match(createConversationMemoryIndex(input), /version="2"/)
})

test('conversation memory query matches the index and returns the verified turn pair', async () => {
  const rawPath = '.raw/对话记录/chat-query.md'
  let raw = createConversationTranscript('chat-query')
  raw = appendConversationTurn(raw, { id: 'u1', role: 'user', content: '讨论苹果方案', createdAt: '2026-09-01T10:00:00.000Z' })
  raw = appendConversationTurn(raw, { id: 'a1', role: 'assistant', content: '确认采用苹果方案', createdAt: '2026-09-01T10:00:01.000Z' })
  const transcript = parseConversationTranscript(rawPath, raw)!
  const index = upsertConversationMemoryIndex('', { conversationId: transcript.id, rawPath, assistantTurnId: 'a1' }, { summary: '确认苹果方案', keywords: ['苹果'] })
  const records = new Map<string, ProjectFileEntry>([
    [rawPath, { path: rawPath, isDirectory: false, content: raw }],
    ['.raw/记忆索引/chat-query.md', { path: '.raw/记忆索引/chat-query.md', isDirectory: false, content: index }],
  ])
  let rawReads = 0
  const adapter: ProjectFileAdapter = {
    runtime: 'web', async list() { throw new Error('V2 query must not list files') },
    async readText(_owner, path) { const entry = records.get(path); if (!entry || entry.isDirectory) throw new Error('missing'); if (path === rawPath) rawReads += 1; const content = String(entry.content || ''); return { content, size: content.length, truncated: false, revision: { value: path, size: content.length } } },
    async createText() { throw new Error('not used') }, async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
  }
  const result = await queryConversationMemoryIndex('project', 'chat-query', '苹果', createProjectFileService(adapter))
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]?.assistantTurnId, 'a1')
  assert.equal(result.matches[0]?.content, '确认采用苹果方案')
  assert.equal(result.matches[0]?.userContent, '讨论苹果方案')
  assert.equal(rawReads, 1)
  const empty = await queryConversationMemoryIndex('project', 'chat-query', '不存在', createProjectFileService(adapter))
  assert.deepEqual(empty.matches, [])
  assert.equal(rawReads, 1)
})

test('names beyond twelve survive storage and match a natural Chinese creative request', async () => {
  const keywords = [...Array.from({ length: 18 }, (_, index) => `角色${index}`), '王刚', '初恋', '玉佩']
  const rawPath = '.raw/对话记录/names.md'
  let raw = createConversationTranscript('names')
  raw = appendConversationTurn(raw, { id: 'u', role: 'user', content: '不要让王刚与初恋复合', createdAt: '2026-10-15' })
  raw = appendConversationTurn(raw, { id: 'a', role: 'assistant', content: '王刚捡到初恋的玉佩，暂未复合。', createdAt: '2026-10-15' })
  const index = upsertConversationMemoryIndex('', { conversationId: 'names', rawPath, assistantTurnId: 'a' }, { summary: '候选重逢情节', keywords })
  assert.deepEqual(parseConversationMemoryIndex(index)?.entries[0]?.keywords, keywords)
  const files = createProjectFileService({
    runtime: 'web', async list() { throw new Error('must not scan project') },
    async readText(_owner, path) { const content = path === rawPath ? raw : index; return { content, size: content.length, truncated: false, revision: { value: path, size: content.length } } },
    async createText() { throw new Error('unused') }, async rename() { throw new Error('unused') }, async remove() { throw new Error('unused') },
  })
  const result = await queryConversationMemoryIndex('p', 'names', '给王刚的初恋安排一个重逢情节', files)
  assert.equal(result.matches[0]?.assistantTurnId, 'a')
  assert.match(result.matches[0]?.userContent || '', /不要.*复合/)
  assert.equal((await queryConversationMemoryIndex('p', 'names', '', files, 5, 'deleted-answer')).matches.length, 0)
})
