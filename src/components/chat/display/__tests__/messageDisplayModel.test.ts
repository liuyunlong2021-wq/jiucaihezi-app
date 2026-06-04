import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMessageDisplayModel } from '../messageDisplayModel'

test('buildMessageDisplayModel makes user messages lightweight and meta-free', () => {
  const model = buildMessageDisplayModel({
    id: 'u1',
    role: 'user',
    content: '帮我总结这段内容',
  })

  assert.equal(model.layout, 'user-bubble')
  assert.equal(model.showMeta, false)
  assert.equal(model.actionsMode, 'always')
  assert.equal(model.referenceMode, 'none')
})

test('buildMessageDisplayModel routes long assistant replies to prose longform', () => {
  const content = Array.from({ length: 6 }, (_, index) => `第 ${index + 1} 段内容，包含较长的正文说明。${'这是一句长文。'.repeat(30)}`).join('\n\n')
  const model = buildMessageDisplayModel({
    id: 'a1',
    role: 'assistant',
    content,
    agentName: '剧本 Skill',
  })

  assert.equal(model.layout, 'assistant-prose')
  assert.equal(model.contentKind, 'longform')
  assert.equal(model.showMeta, true)
  assert.equal(model.metaLabel, '剧本 Skill')
})

test('buildMessageDisplayModel detects code-heavy assistant replies', () => {
  const model = buildMessageDisplayModel({
    id: 'a2',
    role: 'assistant',
    content: '下面是代码：\n```ts\nconst value = 1\nconsole.log(value)\n```',
  })

  assert.equal(model.layout, 'assistant-prose')
  assert.equal(model.contentKind, 'code-heavy')
})

test('buildMessageDisplayModel collapses tool messages away from the main reading flow', () => {
  const model = buildMessageDisplayModel({
    id: 't1',
    role: 'tool',
    content: '{"ok":true}',
    toolName: 'office_create',
  })

  assert.equal(model.layout, 'tool-collapsed')
  assert.equal(model.metaLabel, '工具: office_create')
  assert.equal(model.actionsMode, 'always')
})

test('buildMessageDisplayModel summarizes references instead of expanding them by default', () => {
  const model = buildMessageDisplayModel({
    id: 'a3',
    role: 'assistant',
    content: '根据知识库，答案是这样。',
    searchResults: [{ title: '来源', url: 'https://example.com', snippet: '摘要' }],
    knowledgeHits: [{ id: 'k1' }],
  })

  assert.equal(model.referenceMode, 'collapsed-summary')
})

test('buildMessageDisplayModel carries high severity text warnings into the UI model', () => {
  const model = buildMessageDisplayModel({
    id: 'a4',
    role: 'assistant',
    content: '乱码 �',
  })

  assert.equal(model.hasTextWarning, true)
  assert.match(model.textWarning || '', /编码异常/)
})
