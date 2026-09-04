import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectFileService, type ProjectFileAdapter, type ProjectFileEntry } from '@/services/projectFileService'
import { appendConversationTurn, createConversationTranscript } from '../conversationTranscript'
import { queryConversationMemoryIndex, upsertConversationMemoryIndex } from '../conversationMemoryIndex'
import { selectMemoryTools } from '../memoryChat'

function service(records: Map<string, ProjectFileEntry>, reads: { raw: number }) {
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { throw new Error('query must not list files') },
    async readText(_owner, path) {
      const entry = records.get(path)
      if (!entry || entry.isDirectory) throw new Error('missing')
      if (path.startsWith('.raw/对话记录/')) reads.raw += 1
      const content = String(entry.content || '')
      return { content, size: content.length, truncated: false, revision: { value: path, size: content.length } }
    },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
  }
  return createProjectFileService(adapter)
}

function transcript(id: string, answer: string) {
  let raw = createConversationTranscript(id)
  raw = appendConversationTurn(raw, { id: id + '-u', role: 'user', content: '问题', createdAt: '2026-09-01T10:00:00.000Z' })
  return appendConversationTurn(raw, { id: id + '-a', role: 'assistant', content: answer, createdAt: '2026-09-01T10:00:01.000Z' })
}

test('memory_search is only selected when query is enabled', () => {
  const tools = [{ function: { name: 'memory_search' } }, { function: { name: 'read' } }]
  assert.deepEqual(selectMemoryTools(tools, [], false, false, false, [], false, false, false, [], false), [])
  assert.deepEqual(selectMemoryTools(tools, [], false, false, false, [], false, false, false, [], true), [tools[0]])
})

test('memory search stays in the current conversation and reads only valid linked raws', async () => {
  const currentPath = '.raw/对话记录/chat-query.md'
  const otherPath = '.raw/对话记录/other-chat.md'
  const currentRaw = transcript('chat-query', '当前回答')
  const otherRaw = transcript('other-chat', '其他回答')
  const currentIndex = upsertConversationMemoryIndex('', { conversationId: 'chat-query', rawPath: currentPath, assistantTurnId: 'chat-query-a' }, { summary: '当前方案', keywords: ['方案'] })
  const otherEntry = upsertConversationMemoryIndex('', { conversationId: 'chat-query', rawPath: otherPath, assistantTurnId: 'other-chat-a' }, { summary: '其他方案', keywords: ['方案'] })
  const index = currentIndex + '\n\n' + otherEntry.split('\n\n').slice(1).join('\n\n') + '\n\n- 简介：越界\n  - 关键词：方案\n  - 正链：[坏链接](../外部/secret.md#jc-turn-bad)\n\n- 简介：非 Raw\n  - 关键词：方案\n  - 正链：[坏链接](../项目/secret.md#jc-turn-bad)\n\n- 简介：孤链\n  - 关键词：方案\n  - 正链：[坏链接](../对话记录/chat-query.md#jc-turn-missing)'
  const records = new Map<string, ProjectFileEntry>([
    [currentPath, { path: currentPath, isDirectory: false, content: currentRaw }],
    [otherPath, { path: otherPath, isDirectory: false, content: otherRaw }],
    ['.raw/记忆索引/chat-query.md', { path: '.raw/记忆索引/chat-query.md', isDirectory: false, content: index }],
  ])
  const reads = { raw: 0 }
  const result = await queryConversationMemoryIndex('project', 'chat-query', '方案', service(records, reads))
  assert.deepEqual(result.matches.map(match => match.content), ['当前回答'])
  assert.equal(reads.raw, 1)
})

test('invalid conversation ids are rejected instead of silently normalized', async () => {
  await assert.rejects(() => queryConversationMemoryIndex('project', 'chat/other', 'x', service(new Map(), { raw: 0 })), /会话 ID 无效/)
})
