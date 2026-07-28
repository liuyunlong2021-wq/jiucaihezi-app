import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendConversationTurn,
  createConversationTranscript,
  mergeConversationTranscriptContents,
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

test('conversation transcript keeps a project attachment locator without embedding binary values', () => {
  const empty = createConversationTranscript('chat_attachment')
  const withAttachment = appendConversationTurn(empty, {
    id: 'turn_image',
    role: 'user',
    content: '请看这张图',
    createdAt: '2026-07-24T10:01:00.000Z',
    attachments: [{
      id: 'image-1', name: 'logo.png', mime: 'image/png', size: 12, kind: 'image',
      projectPath: 'jc-media/uploads/image-1-logo.png',
    }],
  })
  const parsed = parseConversationTranscript('.raw/对话记录/chat_attachment.md', withAttachment)

  assert.deepEqual(parsed?.turns[0]?.attachments, [{
    id: 'image-1', name: 'logo.png', mime: 'image/png', size: 12, kind: 'image',
    projectPath: 'jc-media/uploads/image-1-logo.png',
  }])
  assert.doesNotMatch(withAttachment, /data:image|base64/)
})

test('conversation transcript records the execution mode on user turns', () => {
  const empty = createConversationTranscript('chat_mode')
  const content = appendConversationTurn(empty, {
    id: 'turn_quick',
    role: 'user',
    content: '直接回答',
    createdAt: '2026-07-24T10:01:00.000Z',
    mode: 'quick',
  })
  const parsed = parseConversationTranscript('.raw/对话记录/chat_mode.md', content)

  assert.equal(parsed?.turns[0]?.mode, 'quick')
  assert.match(content, /mode="quick"/)
})

test('conversation transcript hides only the legacy rapid duplicate user turns', () => {
  const empty = createConversationTranscript('chat_duplicate')
  const first = appendConversationTurn(empty, {
    id: 'turn_1', role: 'user', content: '同一条消息', createdAt: '2026-07-24T10:01:00.000Z',
  })
  const duplicate = appendConversationTurn(first, {
    id: 'turn_2', role: 'user', content: '同一条消息', createdAt: '2026-07-24T10:01:03.000Z',
  })
  const legitimate = appendConversationTurn(duplicate, {
    id: 'turn_3', role: 'user', content: '同一条消息', createdAt: '2026-07-24T10:01:10.000Z',
  })
  assert.deepEqual(parseConversationTranscript('.raw/对话记录/chat_duplicate.md', legitimate)?.turns.map(turn => turn.id), ['turn_1', 'turn_3'])
})

test('conversation transcript merges concurrent append-only turns by id', () => {
  const path = '.raw/对话记录/chat_merge.md'
  const empty = createConversationTranscript('chat_merge', '连续对话', '2026-07-24T10:00:00.000Z')
  const first = appendConversationTurn(empty, {
    id: 'turn_1', role: 'user', content: '第一问', createdAt: '2026-07-24T10:01:00.000Z',
  })
  const remote = appendConversationTurn(first, {
    id: 'turn_2', role: 'assistant', content: '第一答', createdAt: '2026-07-24T10:01:10.000Z',
  })
  const local = appendConversationTurn(first, {
    id: 'turn_3', role: 'user', content: '第二问', createdAt: '2026-07-24T10:01:20.000Z',
  })
  const merged = mergeConversationTranscriptContents(path, remote, local)

  assert.deepEqual(parseConversationTranscript(path, merged || '')?.turns.map(turn => turn.content), [
    '第一问', '第一答', '第二问',
  ])
})
