import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConversationContextEngine } from '../engine'
import { createConversationContextMemoryStorage } from '../storage'

test('long form stress uses chunks and bounded prompt evidence instead of full history', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const longUser = '用户输入关键决策：采用冷静克制风格。\n'.repeat(900)
  const longAssistant = 'assistant 输出长文内容。\n'.repeat(900)
  const currentMessages = Array.from({ length: 30 }, (_, index) => ({
    id: `m_${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: index % 2 === 0 ? longUser : longAssistant,
    timestamp: 1000 + index,
  }))
  const currentInput = '第 25 轮追问：请继续第 3 轮定下的冷静克制风格。\n'.repeat(2600)

  const result = await engine.build({
    userId: 'local',
    sessionId: 'stress_sess',
    userInput: currentInput,
    currentMessages: [
      ...currentMessages,
      { id: 'current_user', role: 'user', content: currentInput, timestamp: 9999 },
    ],
    selectedSkillId: 'skill_writer',
    primaryVaultId: 'vault_story',
    enabledToolNames: [],
    modelId: 'small-window',
    contextBudget: 32000,
    contextMode: 'balanced',
    now: 10000,
  })

  const fullHistorySize = currentMessages.reduce((sum, message) => sum + message.content.length, 0) + currentInput.length

  assert.equal(result.loadLevel, 'heavy')
  assert.ok(result.oversizedInput?.enabled)
  assert.ok(result.evidencePrompt.length < fullHistorySize * 0.5)
  assert.ok(!result.recentMessages.some(message => message.id === 'current_user'))
  assert.ok(result.trace.chunkRetrieval.mandatoryChunkCount > 0)
  assert.ok(result.tokenPlan.totalPlannedTokens <= 32000)
})
