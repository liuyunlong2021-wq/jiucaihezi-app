import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveConversationLoadStrategy } from '../loadStrategy'

test('load strategy uses light for short conversations without memory intent', () => {
  const result = resolveConversationLoadStrategy({
    messageCount: 6,
    estimatedSessionTokens: 3200,
    currentUserInputTokens: 220,
    modelContextBudget: 128000,
    availableInputBudget: 90000,
    userInput: '帮我写一个标题',
  })

  assert.equal(result.loadLevel, 'light')
  assert.equal(result.oversizedInput, false)
  assert.equal(result.historicalLongContext, false)
})

test('load strategy promotes memory-intent conversations to standard', () => {
  const result = resolveConversationLoadStrategy({
    messageCount: 8,
    estimatedSessionTokens: 5000,
    currentUserInputTokens: 300,
    modelContextBudget: 128000,
    availableInputBudget: 90000,
    userInput: '继续上次我们定的风格和结论',
  })

  assert.equal(result.loadLevel, 'standard')
  assert.equal(result.isMemoryIntentQuery, true)
})

test('load strategy enters heavy for historical long context', () => {
  const result = resolveConversationLoadStrategy({
    messageCount: 96,
    estimatedSessionTokens: 70000,
    currentUserInputTokens: 1200,
    modelContextBudget: 128000,
    availableInputBudget: 90000,
    userInput: '总结这个项目到目前为止的关键决策',
  })

  assert.equal(result.loadLevel, 'heavy')
  assert.equal(result.historicalLongContext, true)
})

test('load strategy marks oversized input when current input dominates available budget', () => {
  const result = resolveConversationLoadStrategy({
    messageCount: 10,
    estimatedSessionTokens: 12000,
    currentUserInputTokens: 56000,
    modelContextBudget: 128000,
    availableInputBudget: 100000,
    userInput: '以下是一篇超长文章，请完整改写',
  })

  assert.equal(result.oversizedInput, true)
  assert.equal(result.oversizedReason, 'current_input_dominates_budget')
  assert.equal(result.loadLevel, 'heavy')
})
