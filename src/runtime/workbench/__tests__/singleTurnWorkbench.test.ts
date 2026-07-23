import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSingleTurnWorkbenchRequest,
  extractSingleTurnWorkbenchResult,
} from '../singleTurnWorkbench'

test('single-turn workbench request contains only the declared input, attachment, skill, and output contract', () => {
  const request = buildSingleTurnWorkbenchRequest({
    modelId: 'gpt-5.6-terra',
    skill: { id: 'JC-反推图片提示词', content: '只分析当前图片。' },
    input: {
      fields: { goal: '商品图中文提示词' },
      attachments: [{ id: 'image-1', name: 'reference.png', mime: 'image/png', value: 'data:image/png;base64,abc' }],
    },
    output: { heading: '② 中文生图提示词', format: 'text' },
  })

  assert.equal(request.model, 'gpt-5.6-terra')
  assert.deepEqual(request.tools, [])
  assert.equal(request.messages.length, 2)
  assert.match(String(request.messages[0].content), /只分析当前图片。/)
  assert.match(String(request.messages[0].content), /② 中文生图提示词/)
  assert.match(JSON.stringify(request.messages[1].content), /商品图中文提示词/)
  assert.match(JSON.stringify(request.messages[1].content), /data:image\/png;base64,abc/)
  assert.doesNotMatch(JSON.stringify(request), /Chat 历史|wiki\/hot\.md|MCP|工具定义/)
})

test('single-turn workbench preserves the final response when its heading is missing', () => {
  assert.equal(
    extractSingleTurnWorkbenchResult('模型未按格式输出', '② 中文生图提示词'),
    '模型未按格式输出',
  )
})

test('single-turn workbench supports a plain prompt output contract without a heading', () => {
  const request = buildSingleTurnWorkbenchRequest({
    modelId: 'gpt-5.6-terra',
    skill: { id: 'jc-gpt-image', content: '只输出提示词。' },
    input: { fields: { goal: '商品图' }, attachments: [] },
    output: { heading: '', format: 'text' },
  })

  assert.match(String(request.messages[0].content), /只给出面向用户的结果，不添加标题。/)
  assert.doesNotMatch(String(request.messages[0].content), /以「」为标题/)
})
