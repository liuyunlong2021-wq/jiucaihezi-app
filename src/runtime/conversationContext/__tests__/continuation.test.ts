import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildContinuationPrompt,
  createContinuationState,
  extractTailExcerpt,
} from '../continuation'

test('continuation state reuses context plan and tracks parts', () => {
  const state = createContinuationState({
    runId: 'run_1',
    parentAssistantMessageId: 'a1',
    reusedContextPlanId: 'ctx_1',
  })

  assert.equal(state.runId, 'run_1')
  assert.equal(state.reusedContextPlanId, 'ctx_1')
  assert.deepEqual(state.partIds, [])
})

test('continuation prompt carries structure summary completed pointers and tail excerpt', () => {
  const tail = extractTailExcerpt('甲'.repeat(5000), 900)
  const prompt = buildContinuationPrompt({
    reusedContextPlanId: 'ctx_1',
    outputStructureSummary: '一、背景\n二、方案',
    completedSectionPointers: ['一、背景'],
    lastDecisionSummary: '已经确定采用冷静克制风格。',
    tailExcerpt: tail,
    nextInstruction: '从二、方案继续。',
  })

  assert.ok(tail.length > 0)
  assert.match(prompt, /ctx_1/)
  assert.match(prompt, /一、背景/)
  assert.match(prompt, /从二、方案继续/)
})
