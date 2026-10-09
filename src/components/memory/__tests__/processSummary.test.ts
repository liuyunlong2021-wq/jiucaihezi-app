import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeProcessSteps } from '../processSummary'

test('process summary counts tools, retries, narration, and failures from actual rows', () => {
  assert.deepEqual(summarizeProcessSteps([
    { id: 'tool-1', state: 'done' },
    { id: 'tool-2', state: 'failed' },
    { id: 'retry-1', kind: 'retry', state: 'done' },
    { id: 'say-1', kind: 'narration', state: 'done' },
  ]), { tools: 2, retries: 1, narration: 1, failed: 1 })
})

test('empty process has no invented counts', () => {
  assert.deepEqual(summarizeProcessSteps([]), { tools: 0, retries: 0, narration: 0, failed: 0 })
})
