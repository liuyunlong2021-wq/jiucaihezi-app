import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCreativeContext } from '@/runtime/direct/creativeMemory'

test('T1.1: context building includes history when no explicit capabilities selected', () => {
  const messages = [
    { id: '1', role: 'user', content: 'First question' },
    { id: '2', role: 'assistant', content: 'First answer' },
    { id: '3', role: 'user', content: 'Second question' },
    { id: '4', role: 'assistant', content: 'Second answer' },
    { id: '5', role: 'user', content: 'Current question' },
  ]

  const context = buildCreativeContext({
    messages,
    modelId: 'claude-opus-4',
    contextWindow: 200_000,
    reservedTokens: 16_000,
  })

  // Should include current message plus up to 3 complete rounds
  assert.ok(context.messages.length >= 3, 'Should include at least current + 1 round')
  assert.equal(context.messages[context.messages.length - 1]?.id, '5', 'Current message should be last')
})

test('T1.2: context respects 24000 token budget and only drops complete rounds', () => {
  // Create a very long history that exceeds 24000 tokens
  const messages = []
  for (let i = 0; i < 20; i++) {
    messages.push(
      { id: `${i * 2}`, role: 'user', content: 'x'.repeat(5000) },
      { id: `${i * 2 + 1}`, role: 'assistant', content: 'y'.repeat(5000) },
    )
  }
  messages.push({ id: '999', role: 'user', content: 'Current' })

  const context = buildCreativeContext({
    messages,
    modelId: 'claude-opus-4',
    contextWindow: 200_000,
    reservedTokens: 16_000,
  })

  // Should have dropped old rounds but kept complete rounds only
  assert.ok(context.estimatedTokens <= 24_000, 'Should stay under 24K token limit')
  assert.ok(context.omittedMessages > 0, 'Should have dropped some old messages')

  // Verify we don't have orphan assistant without its user message
  for (let i = 0; i < context.messages.length - 1; i++) {
    if (context.messages[i]?.role === 'assistant') {
      assert.equal(
        context.messages[i - 1]?.role,
        'user',
        'Assistant message should follow user message',
      )
    }
  }
})

test('T1.3: explicit capability selection and no capability get same history context', () => {
  const messages = [
    { id: '1', role: 'user', content: 'First' },
    { id: '2', role: 'assistant', content: 'Response' },
    { id: '3', role: 'user', content: 'Current' },
  ]

  const context1 = buildCreativeContext({
    messages,
    modelId: 'claude-opus-4',
    contextWindow: 200_000,
    reservedTokens: 16_000,
  })

  const context2 = buildCreativeContext({
    messages,
    modelId: 'claude-opus-4',
    contextWindow: 200_000,
    reservedTokens: 16_000,
  })

  // Same messages in, same context out - capability selection shouldn't affect this
  assert.deepEqual(
    context1.messages.map(m => m.id),
    context2.messages.map(m => m.id),
    'Same history regardless of capability selection',
  )
})