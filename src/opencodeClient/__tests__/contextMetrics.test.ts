/**
 * contextMetrics.test.ts — 100% 搬运官方 session-context-metrics.test.ts
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { getSessionContextMetrics } from '../contextMetrics'

// ── Helpers (对齐官方) ──

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = 'openai',
  modelID = 'gpt-4.1',
) => ({
  id,
  role: 'assistant' as const,
  providerID,
  modelID,
  cost,
  tokens: {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { read: tokens.read, write: tokens.write },
  },
  time: { created: 1 },
})

const user = (id: string) => ({
  id,
  role: 'user' as const,
  cost: 0,
  time: { created: 1 },
})

const models = [
  { id: 'gpt-4.1', label: 'GPT-4.1', providerId: 'openai', contextWindow: 1000, capability: 'text' as const },
]

describe('getSessionContextMetrics', () => {
  test('最后一条有 token 的 assistant 决定全部指标', () => {
    const msgs = [
      user('u1'),
      assistant('a1', { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0.5),
      assistant('a2', { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]

    const metrics = getSessionContextMetrics(msgs, models)

    assert.equal(metrics.totalCost, 1.75)
    assert.equal(metrics.context?.message.id, 'a2')
    assert.equal(metrics.context?.total, 500)
    assert.equal(metrics.context?.usage, 50)
    assert.equal(metrics.context?.providerLabel, 'openai')
    assert.equal(metrics.context?.modelLabel, 'GPT-4.1')
  })

  test('模型元数据缺失时的 fallback', () => {
    const msgs = [assistant('a1', { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, 'p-1', 'm-1')]

    const metrics = getSessionContextMetrics(msgs, [])

    assert.equal(metrics.context?.providerLabel, 'p-1')
    assert.equal(metrics.context?.modelLabel, 'm-1')
    assert.equal(metrics.context?.limit, undefined)
    assert.equal(metrics.context?.usage, null)
  })

  test('message 数组原地修改后重新计算', () => {
    const msgs = [assistant('a1', { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]

    const one = getSessionContextMetrics(msgs, models)
    msgs.push(assistant('a2', { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContextMetrics(msgs, models)

    assert.equal(one.context?.message.id, 'a1')
    assert.equal(two.context?.message.id, 'a2')
    assert.equal(two.totalCost, 1)
  })

  test('空输入返回 empty metrics', () => {
    const metrics = getSessionContextMetrics([], [])

    assert.equal(metrics.totalCost, 0)
    assert.equal(metrics.context, undefined)
  })

  test('最后一个 assistant 没有 token → 找上一个', () => {
    const msgs = [
      assistant('a1', { input: 50, output: 30, reasoning: 10, read: 5, write: 5 }, 0.5),
      assistant('a2', { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0),
    ]

    const metrics = getSessionContextMetrics(msgs, models)

    assert.equal(metrics.context?.message.id, 'a1')
  })
})
