import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildLongFormSystemInstruction, isLongFormRequest } from '../longFormPolicy'

test('detects long report requests', () => {
  assert.equal(isLongFormRequest('帮我写一篇2万字产品报告'), true)
  assert.equal(isLongFormRequest('继续写上一段方案'), true)
})

test('does not classify short chat as long-form work', () => {
  assert.equal(isLongFormRequest('你好，今天吃什么'), false)
  assert.equal(buildLongFormSystemInstruction('你好，今天吃什么'), '')
})

test('builds structured long-form instruction for long output', () => {
  const instruction = buildLongFormSystemInstruction('写一篇很长的技术路线方案')

  assert.match(instruction, /结构化长文生成链路/)
  assert.match(instruction, /继续写/)
  assert.match(instruction, /不要为了压缩篇幅省略后半部分/)
})
