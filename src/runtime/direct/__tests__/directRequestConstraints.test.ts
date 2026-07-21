import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDirectRequestConstraints } from '../directRequestConstraints'

test('recognizes only explicit tool and model restrictions', () => {
  assert.deepEqual(resolveDirectRequestConstraints('请分析这个视频'), {
    toolsForbidden: false,
    modelLocked: false,
  })
  assert.deepEqual(resolveDirectRequestConstraints('不要使用任何工具，分析这个文件'), {
    toolsForbidden: true,
    modelLocked: false,
  })
  assert.deepEqual(resolveDirectRequestConstraints('只用当前模型，也不准使用工具'), {
    toolsForbidden: true,
    modelLocked: true,
  })
})
