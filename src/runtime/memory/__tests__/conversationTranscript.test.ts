import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendConversationTurn,
  createConversationTranscript,
  parseConversationTranscript,
  renameConversationTranscript,
} from '../conversationTranscript'

test('conversation transcript requires both the Raw path and metadata marker', () => {
  const content = createConversationTranscript('chat_fixed', '聊聊历史', '2026-07-24T10:00:00.000Z')

  assert.equal(parseConversationTranscript('.raw/对话记录/chat_fixed.md', content)?.title, '聊聊历史')
  assert.equal(parseConversationTranscript('wiki/chat_fixed.md', content), null)
  assert.equal(parseConversationTranscript('.raw/对话记录/plain.md', '# 普通文档\n'), null)
})

test('conversation transcript appends complete turns and renames only the H1 title', () => {
  const empty = createConversationTranscript('chat_fixed', '新对话', '2026-07-24T10:00:00.000Z')
  const withUser = appendConversationTurn(empty, {
    id: 'turn_user', role: 'user', content: '秦朝为什么灭亡得这么快？', createdAt: '2026-07-24T10:01:00.000Z',
  })
  const complete = appendConversationTurn(withUser, {
    id: 'turn_assistant', role: 'assistant', content: '主要原因包括制度压力。', createdAt: '2026-07-24T10:01:10.000Z',
  })
  const renamed = renameConversationTranscript(complete, '秦朝兴亡')
  const parsed = parseConversationTranscript('.raw/对话记录/chat_fixed.md', renamed)

  assert.equal(parsed?.id, 'chat_fixed')
  assert.equal(parsed?.title, '秦朝兴亡')
  assert.deepEqual(parsed?.turns.map(turn => [turn.role, turn.content]), [
    ['user', '秦朝为什么灭亡得这么快？'],
    ['assistant', '主要原因包括制度压力。'],
  ])
  assert.match(renamed, /jc:conversation id="chat_fixed"/)
})
