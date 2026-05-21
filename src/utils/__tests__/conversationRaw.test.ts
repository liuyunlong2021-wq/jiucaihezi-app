import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildConversationRawMarkdown,
  buildConversationRawFileName,
  collectConversationRawMessageIds,
  shouldSyncConversationRaw,
} from '../conversationRaw'

const messages = [
  { id: 'u1', role: 'user' as const, content: '帮我生成一份方案', timestamp: 100 },
  { id: 'a1', role: 'assistant' as const, content: '已生成方案正文', timestamp: 200 },
  { id: 'tool1', role: 'tool' as const, content: '工具返回内容', timestamp: 300 },
  { id: 's1', role: 'system' as const, content: '系统提示', timestamp: 400 },
]

test('requires an explicit vault before syncing conversation raw', () => {
  assert.equal(shouldSyncConversationRaw({ vaultId: null, sessionId: 'sess_1', messages }), false)
  assert.equal(shouldSyncConversationRaw({ vaultId: '', sessionId: 'sess_1', messages }), false)
  assert.equal(shouldSyncConversationRaw({ vaultId: 'vault_1', sessionId: '', messages }), false)
  assert.equal(shouldSyncConversationRaw({ vaultId: 'vault_1', sessionId: 'sess_1', messages: [] }), false)
  assert.equal(shouldSyncConversationRaw({ vaultId: 'vault_1', sessionId: 'sess_1', messages }), true)
})

test('uses one stable raw file per session', () => {
  assert.equal(buildConversationRawFileName('sess_abc-123'), '会话_sess_abc-123.md')
  assert.equal(buildConversationRawFileName('sess / weird'), '会话_sess_weird.md')
})

test('stores only user and assistant messages in raw markdown', () => {
  const markdown = buildConversationRawMarkdown({
    sessionId: 'sess_1',
    title: '测试会话',
    messages,
    updatedAt: new Date('2026-05-18T10:00:00+08:00').getTime(),
  })

  assert.match(markdown, /^# 测试会话/)
  assert.match(markdown, /我：\n帮我生成一份方案/)
  assert.match(markdown, /AI：\n已生成方案正文/)
  assert.doesNotMatch(markdown, /工具返回内容/)
  assert.doesNotMatch(markdown, /系统提示/)
})

test('collects only synced message ids', () => {
  assert.deepEqual(collectConversationRawMessageIds(messages), ['u1', 'a1'])
})
