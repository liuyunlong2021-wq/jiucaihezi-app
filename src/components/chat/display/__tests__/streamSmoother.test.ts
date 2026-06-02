import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStreamSmoother } from '../streamSmoother'

test('createStreamSmoother batches rapid updates without changing final text', () => {
  const emitted: string[] = []
  let now = 0
  const smoother = createStreamSmoother({
    intervalMs: 20,
    now: () => now,
    emit: (text) => emitted.push(text),
  })

  smoother.push('你')
  smoother.push('你好')
  smoother.push('你好，世')
  assert.deepEqual(emitted, ['你'])

  now = 10
  smoother.push('你好，世界')
  assert.deepEqual(emitted, ['你'])

  now = 21
  smoother.push('你好，世界。')
  assert.deepEqual(emitted, ['你', '你好，世界。'])
})

test('createStreamSmoother flushes immediately on newline and punctuation boundaries', () => {
  const emitted: string[] = []
  let now = 0
  const smoother = createStreamSmoother({
    intervalMs: 100,
    now: () => now,
    emit: (text) => emitted.push(text),
  })

  smoother.push('第一段')
  smoother.push('第一段\n')
  smoother.push('第一段\n第二句。')

  assert.deepEqual(emitted, ['第一段', '第一段\n', '第一段\n第二句。'])
})

test('createStreamSmoother force flushes the latest text on finish or abort', () => {
  const emitted: string[] = []
  let now = 0
  const smoother = createStreamSmoother({
    intervalMs: 1000,
    now: () => now,
    emit: (text) => emitted.push(text),
  })

  smoother.push('草稿')
  smoother.push('最终内容')
  smoother.flush()
  smoother.flush()

  assert.deepEqual(emitted, ['草稿', '最终内容'])
})
