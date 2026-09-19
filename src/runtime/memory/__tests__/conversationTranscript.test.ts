import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendConversationTurn,
  conversationDocumentSources,
  createConversationTranscript,
  mergeConversationTranscriptContents,
  parseConversationTranscript,
  remapConversationAttachmentPaths,
  renameConversationTranscript,
  replaceConversationTurnAndTruncate,
} from '../conversationTranscript'

test('conversation document sources keep only unique readable document locators', () => {
  assert.deepEqual(conversationDocumentSources([
    {
      id: 'turn-1', role: 'user', content: '看文档', createdAt: '2026-08-03T10:00:00.000Z',
      attachments: [
        { id: 'doc-1', name: '剧情.docx', mime: 'application/octet-stream', size: 10, kind: 'file', readablePath: '.raw/jc-media/文档/剧情.docx.md' },
        { id: 'image-1', name: '人物.png', mime: 'image/png', size: 10, kind: 'image', projectPath: '.raw/jc-media/图片/人物.png' },
      ],
    },
    {
      id: 'turn-2', role: 'assistant', content: '读完了', createdAt: '2026-08-03T10:00:01.000Z',
      attachments: [{ id: 'doc-2', name: '忽略.md', mime: 'text/markdown', size: 10, kind: 'file', readablePath: '.raw/jc-media/文档/忽略.md' }],
    },
    {
      id: 'turn-3', role: 'user', content: '继续', createdAt: '2026-08-03T10:00:02.000Z',
      attachments: [{ id: 'doc-3', name: '剧情.docx', mime: 'application/octet-stream', size: 10, kind: 'file', readablePath: '.raw/jc-media/文档/剧情.docx.md' }],
    },
  ]), [{ name: '剧情.docx', path: '.raw/jc-media/文档/剧情.docx.md' }])
})

test('conversation transcript requires both the Raw path and metadata marker', () => {
  const content = createConversationTranscript('chat_fixed', '聊聊历史', '2026-07-24T10:00:00.000Z')

  assert.equal(parseConversationTranscript('.raw/对话记录/chat_fixed.md', content)?.title, '聊聊历史')
  assert.equal(parseConversationTranscript('wiki/chat_fixed.md', content), null)
  assert.equal(parseConversationTranscript('.raw/对话记录/plain.md', '# 普通文档\n'), null)
})

test('conversation transcript stores independent memory settings and keeps legacy defaults', () => {
  const disabled = createConversationTranscript('chat-settings', '设置', '2026-07-24T10:00:00.000Z', {
    memoryEnabled: false,
    memoryQueryEnabled: true,
  })
  assert.deepEqual(
    ((parseConversationTranscript('.raw/对话记录/chat-settings.md', disabled) || {}) as any),
    {
      id: 'chat-settings',
      title: '设置',
      createdAt: '2026-07-24T10:00:00.000Z',
      memoryEnabled: false,
      memoryQueryEnabled: true,
      turns: [],
    },
  )
  const legacy = '<!-- jc:conversation id="legacy" created-at="2026-07-24T10:00:00.000Z" -->'
  assert.equal(parseConversationTranscript('.raw/对话记录/legacy.md', legacy)?.memoryEnabled, true)
  assert.equal(parseConversationTranscript('.raw/对话记录/legacy.md', legacy)?.memoryQueryEnabled, true)
})

test('conversation transcript keeps persistent project references in its Raw header', () => {
  const content = createConversationTranscript('chat-references', '持续引用', '2026-09-16T00:00:00.000Z', {
    memoryEnabled: true,
    memoryQueryEnabled: true,
    persistentAttachments: [{
      id: 'doc-1', name: '剧本.md', mime: 'text/markdown', size: 12, kind: 'file',
      projectPath: 'jc-materials/剧本.md', readablePath: 'jc-materials/剧本.md', characterCount: 12,
    }],
  })

  assert.deepEqual(parseConversationTranscript('.raw/对话记录/chat-references.md', content)?.persistentAttachments, [{
    id: 'doc-1', name: '剧本.md', mime: 'text/markdown', size: 12, kind: 'file',
    projectPath: 'jc-materials/剧本.md', readablePath: 'jc-materials/剧本.md', characterCount: 12,
  }])
  assert.doesNotMatch(content, /base64|data:/)
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

test('editing a user turn replaces it and truncates later context', () => {
  let content = createConversationTranscript('chat_edit', '编辑测试')
  content = appendConversationTurn(content, { id: 'u1', role: 'user', content: '旧问题', createdAt: '2026-08-26T00:00:00.000Z' })
  content = appendConversationTurn(content, { id: 'a1', role: 'assistant', content: '旧回答', createdAt: '2026-08-26T00:00:01.000Z' })
  content = appendConversationTurn(content, { id: 'u2', role: 'user', content: '后续问题', createdAt: '2026-08-26T00:00:02.000Z' })
  const next = replaceConversationTurnAndTruncate(content, 'u1', {
    id: 'u1-new', role: 'user', content: '新问题', createdAt: '2026-08-26T00:01:00.000Z',
  }, {
    id: 'a2', role: 'assistant', content: '新回答', createdAt: '2026-08-26T00:01:01.000Z',
  })
  assert.deepEqual(parseConversationTranscript('.raw/对话记录/chat_edit.md', next)?.turns.map(turn => turn.content), ['新问题', '新回答'])
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

test('conversation transcript keeps one mode and reads legacy mode attributes', () => {
  const empty = createConversationTranscript('chat_mode')
  const content = appendConversationTurn(empty, {
    id: 'turn_memory',
    role: 'user',
    content: '直接回答',
    createdAt: '2026-07-24T10:01:00.000Z',
  })
  const legacy = content.replace(
    'created-at="2026-07-24T10:01:00.000Z"',
    'created-at="2026-07-24T10:01:00.000Z" mode="quick"',
  )
  const parsed = parseConversationTranscript('.raw/对话记录/chat_mode.md', legacy)

  assert.equal(parsed?.turns[0]?.content, '直接回答')
  assert.doesNotMatch(content, /mode=/)
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
  let content = createConversationTranscript('chat_migrate', '迁移', undefined, {
    memoryEnabled: true,
    memoryQueryEnabled: true,
    persistentAttachments: [{
      id: 'persistent-doc', name: '资料.docx', mime: 'application/octet-stream', size: 10, kind: 'file',
      projectPath: 'jc-materials/originals/资料.docx', readablePath: 'jc-materials/markdown/资料.docx.md',
    }],
  })
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
  assert.equal(parsed?.persistentAttachments?.[0]?.projectPath, '.raw/jc-media/文档/资料.docx')
  assert.equal(parsed?.persistentAttachments?.[0]?.readablePath, '.raw/jc-media/文档/资料.docx.md')
})

test('conversation turns keep the capability chips that were on when the turn was sent', () => {
  const path = '.raw/对话记录/chat_tools.md'
  let content = createConversationTranscript('chat_tools', '带开关', '2026-09-18T10:00:00.000Z')
  content = appendConversationTurn(content, {
    id: 'turn_tools_1', role: 'user', content: '改这个 Skill', createdAt: '2026-09-18T10:00:01.000Z',
    skillNames: ['skill-creator'],
    toolChips: ['file', 'media', 'mcp__github'],
  })
  content = appendConversationTurn(content, {
    id: 'turn_tools_2', role: 'assistant', content: '好', createdAt: '2026-09-18T10:00:02.000Z',
  })
  const parsed = parseConversationTranscript(path, content)

  assert.deepEqual(parsed?.turns[0]?.toolChips, ['file', 'media', 'mcp__github'])
  assert.deepEqual(parsed?.turns[0]?.skillNames, ['skill-creator'])
  assert.equal(parsed?.turns[0]?.content, '改这个 Skill')
  assert.equal(parsed?.turns[1]?.toolChips, undefined)
  assert.equal(parsed?.turns[1]?.content, '好')
})

test('turns written before the tools attribute existed still parse their content', () => {
  let content = createConversationTranscript('chat_legacy_tools', '老对话', '2026-09-18T10:00:00.000Z')
  content = appendConversationTurn(content, {
    id: 'turn_legacy', role: 'user', content: '旧格式正文', createdAt: '2026-09-18T10:00:01.000Z',
    skillNames: ['jc-duanju'],
  })
  content = appendConversationTurn(content, {
    id: 'turn_legacy_reply', role: 'assistant', content: '好', createdAt: '2026-09-18T10:00:02.000Z',
  })
  // 没有开关的轮次不写 tools 属性——与开关功能上线前写下的旧文件同形。
  assert.doesNotMatch(content, /tools="/)

  const parsed = parseConversationTranscript('.raw/对话记录/chat_legacy_tools.md', content)

  assert.equal(parsed?.turns[0]?.content, '旧格式正文')
  assert.deepEqual(parsed?.turns[0]?.skillNames, ['jc-duanju'])
  assert.equal(parsed?.turns[0]?.toolChips, undefined)
  assert.equal(parsed?.turns[1]?.content, '好')
})
