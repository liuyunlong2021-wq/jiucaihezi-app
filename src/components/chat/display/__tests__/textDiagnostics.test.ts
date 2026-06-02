import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagnoseMessageText } from '../textDiagnostics'

test('diagnoseMessageText treats normal Chinese markdown as clean text', () => {
  const result = diagnoseMessageText('这是正常回答。\n\n- 第一条\n- 第二条')

  assert.equal(result.severity, 'none')
  assert.deepEqual(result.codes, [])
  assert.equal(result.userMessage, undefined)
})

test('diagnoseMessageText flags replacement characters as high severity encoding warnings', () => {
  const result = diagnoseMessageText('这段历史消息里出现了 � 字符。')

  assert.equal(result.severity, 'high')
  assert.deepEqual(result.codes, ['replacement-char'])
  assert.match(result.userMessage || '', /编码异常/)
})

test('diagnoseMessageText flags control characters without penalizing tabs and newlines', () => {
  const result = diagnoseMessageText('第一行\n第二行\t正常\u0007异常')

  assert.equal(result.severity, 'medium')
  assert.deepEqual(result.codes, ['control-char'])
})

test('diagnoseMessageText flags suspicious question mark runs without mutating content', () => {
  const text = '前面内容正常，后面突然出现 ????'
  const result = diagnoseMessageText(text)

  assert.equal(result.severity, 'medium')
  assert.deepEqual(result.codes, ['question-mark-run'])
  assert.equal(text, '前面内容正常，后面突然出现 ????')
})

test('diagnoseMessageText detects unclosed markdown fences as low severity display warnings', () => {
  const result = diagnoseMessageText('```ts\nconst x = 1')

  assert.equal(result.severity, 'low')
  assert.deepEqual(result.codes, ['unclosed-fence'])
})
