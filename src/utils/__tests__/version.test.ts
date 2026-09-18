import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewerVersion } from '../version'

test('isNewerVersion 按数字段比较，不受字符串序干扰', () => {
  assert.equal(isNewerVersion('2.1.56', '2.1.55'), true)
  assert.equal(isNewerVersion('2.1.9', '2.1.55'), false) // 字符串比较会误判为 true
  assert.equal(isNewerVersion('2.1.56', '2.1.56'), false)
  assert.equal(isNewerVersion('2.2.0', '2.1.99'), true)
  assert.equal(isNewerVersion('2.1.56', '2.1'), true)
  assert.equal(isNewerVersion('0', '2.1.55'), false)
})
