import assert from 'node:assert/strict'
import { test } from 'node:test'

import { allocateConversationPromptBudget } from '../promptBudget'

test('prompt budget reserves output and allocates sections for standard mode', () => {
  const plan = allocateConversationPromptBudget({
    loadLevel: 'standard',
    modelContextBudget: 128000,
    currentUserInputTokens: 2000,
    systemSkillToolTokens: 3000,
  })

  assert.equal(plan.loadLevel, 'standard')
  assert.ok(plan.outputReserveTokens >= Math.floor(128000 * 0.2))
  assert.ok(plan.sections.conversationMemory.maxTokens >= 1200)
  assert.equal(plan.sections.webSearch.maxTokens, 0)
  assert.ok(plan.totalPlannedTokens <= 128000)
})

test('prompt budget forces oversized path when current input exceeds 55 percent of input budget', () => {
  const plan = allocateConversationPromptBudget({
    loadLevel: 'heavy',
    modelContextBudget: 128000,
    currentUserInputTokens: 62000,
    systemSkillToolTokens: 5000,
  })

  assert.equal(plan.oversizedInputRequired, true)
  assert.ok(plan.sections.mandatoryChunks.minTokens > 0)
  assert.ok(plan.sections.mandatoryChunks.minTokens >= Math.floor(plan.availableInputBudget * 0.12))
  assert.ok(plan.sections.mandatoryChunks.minTokens <= Math.ceil(plan.availableInputBudget * 0.18))
})

test('prompt budget scales source chunk room for huge model windows without removing output reserve', () => {
  const plan = allocateConversationPromptBudget({
    loadLevel: 'heavy',
    modelContextBudget: 800000,
    currentUserInputTokens: 4000,
    systemSkillToolTokens: 6000,
  })

  assert.equal(plan.windowClass, 'huge')
  assert.ok(plan.sections.recentRawMessages.maxTokens > 12000)
  assert.ok(plan.outputReserveTokens >= Math.floor(800000 * 0.25))
})
