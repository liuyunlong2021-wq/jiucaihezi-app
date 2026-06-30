/**
 * contextBreakdown.test.ts — 100% 搬运官方 session-context-breakdown.test.ts
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { estimateSessionContextBreakdown } from '../contextBreakdown'

const user = (id: string) => ({ id, role: 'user', time: { created: 1 } })
const assistant = (id: string) => ({ id, role: 'assistant', time: { created: 1 } })

describe('estimateSessionContextBreakdown', () => {
  test('估算 tokens 并将余量归入 other', () => {
    const messages = [user('u1'), assistant('a1')]
    const parts = {
      u1: [{ type: 'text', text: 'hello world' }],
      a1: [{ type: 'text', text: 'assistant response' }],
    }

    const output = estimateSessionContextBreakdown({
      messages,
      parts,
      input: 20,
      systemPrompt: 'system prompt',
    })

    const map = Object.fromEntries(output.map(seg => [seg.key, seg.tokens]))
    assert.equal(map.system, 4)
    assert.equal(map.user, 3)
    assert.equal(map.assistant, 5)
    assert.equal(map.other, 8)
  })

  test('估算超 input 时按比例缩放', () => {
    const messages = [user('u1'), assistant('a1')]
    const parts = {
      u1: [{ type: 'text', text: 'x'.repeat(400) }],
      a1: [{ type: 'text', text: 'y'.repeat(400) }],
    }

    const output = estimateSessionContextBreakdown({
      messages,
      parts,
      input: 10,
      systemPrompt: 'z'.repeat(200),
    })

    const total = output.reduce((sum, seg) => sum + seg.tokens, 0)
    assert.ok(total <= 10)
    assert.ok(output.every(seg => seg.width <= 100))
  })
})
