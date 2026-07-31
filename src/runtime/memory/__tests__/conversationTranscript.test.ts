import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendConversationTurn,
  createConversationTranscript,
  mergeConversationTranscriptContents,
  parseConversationTranscript,
  remapConversationAttachmentPaths,
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
      projectPath: '.raw/jc-media/图片/logo.png',
    }],
  })
  const parsed = parseConversationTranscript('.raw/对话记录/chat_attachment.md', withAttachment)

  assert.deepEqual(parsed?.turns[0]?.attachments, [{
    id: 'image-1', name: 'logo.png', mime: 'image/png', size: 12, kind: 'image',
    projectPath: '.raw/jc-media/图片/logo.png',
  }])
  assert.doesNotMatch(withAttachment, /data:image|base64/)
})

test('conversation transcript keeps document source and readable locators without embedding text', () => {
  const empty = createConversationTranscript('chat_document')
  const content = appendConversationTurn(empty, {
    id: 'turn_document', role: 'user', content: '请总结文档', createdAt: '2026-07-24T10:01:00.000Z',
    attachments: [{
      id: 'document-1', name: '方案.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1024, kind: 'file', projectPath: '.raw/jc-media/文档/方案.docx',
      readablePath: '.raw/jc-media/文档/方案.docx.md', characterCount: 83017,
    }],
  })

  assert.deepEqual(parseConversationTranscript('.raw/对话记录/chat_document.md', content)?.turns[0]?.attachments?.[0], {
    id: 'document-1', name: '方案.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 1024, kind: 'file', projectPath: '.raw/jc-media/文档/方案.docx',
    readablePath: '.raw/jc-media/文档/方案.docx.md', characterCount: 83017,
  })
  assert.doesNotMatch(content, /正文内容|base64|data:/)
})

test('conversation transcript preserves safe text sources and rejects Raw or binary readable paths', () => {
  const empty = createConversationTranscript('chat_text')
  const content = appendConversationTurn(empty, {
    id: 'turn_text', role: 'user', content: '查看文本', createdAt: '2026-07-24T10:01:00.000Z',
    attachments: [
      { id: 'text', name: '笔记.txt', mime: 'text/plain', size: 10, kind: 'file', readablePath: '.raw/jc-media/文档/笔记.txt' },
      { id: 'raw', name: 'raw.md', mime: 'text/markdown', size: 10, kind: 'file', readablePath: '.raw/对话记录/raw.md' },
      { id: 'binary', name: 'word.docx', mime: 'application/octet-stream', size: 10, kind: 'file', readablePath: '.raw/jc-media/文档/word.docx' },
    ],
  })
  const attachments = parseConversationTranscript('.raw/对话记录/chat_text.md', content)?.turns[0]?.attachments

  assert.equal(attachments?.[0]?.readablePath, '.raw/jc-media/文档/笔记.txt')
  assert.equal(attachments?.[1]?.readablePath, undefined)
  assert.equal(attachments?.[2]?.readablePath, undefined)
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

test('conversation transcript remaps legacy attachment paths without changing the turn pair', () => {
  const path = '.raw/对话记录/chat_migrate.md'
  let content = createConversationTranscript('chat_migrate', '迁移')
  content = appendConversationTurn(content, {
    id: 'turn_1', role: 'user', content: '总结资料', createdAt: '2026-07-24T10:01:00.000Z',
    attachments: [{
      id: 'doc', name: '资料.docx', mime: 'application/octet-stream', size: 10, kind: 'file',
      projectPath: 'jc-materials/originals/资料.docx', readablePath: 'jc-materials/markdown/资料.docx.md',
    }],
  })
  content = appendConversationTurn(content, {
    id: 'turn_2', role: 'assistant', content: '已总结', createdAt: '2026-07-24T10:01:01.000Z',
  })
  const remapped = remapConversationAttachmentPaths(path, content, new Map([
    ['jc-materials/originals/资料.docx', '.raw/jc-media/文档/资料.docx'],
    ['jc-materials/markdown/资料.docx.md', '.raw/jc-media/文档/资料.docx.md'],
  ]))
  const parsed = parseConversationTranscript(path, remapped)

  assert.deepEqual(parsed?.turns.map(turn => turn.role), ['user', 'assistant'])
  assert.equal(parsed?.turns[0]?.attachments?.[0]?.projectPath, '.raw/jc-media/文档/资料.docx')
  assert.equal(parsed?.turns[0]?.attachments?.[0]?.readablePath, '.raw/jc-media/文档/资料.docx.md')
})
