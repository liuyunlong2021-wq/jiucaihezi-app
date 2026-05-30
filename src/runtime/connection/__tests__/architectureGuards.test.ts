import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('chat UI does not own Superpower prompt assembly', () => {
  const source = readSource('src/components/chat/ChatPanel.vue')

  assert.equal(source.includes('buildSuperpowersPrompt'), false)
  assert.match(source, /buildConnectionSuperpowerSystemPrompt/)
})

test('useChat delegates Skill Knowledge Tool assembly to RuntimeConnection', () => {
  const source = readSource('src/composables/useChat.ts')

  assert.match(source, /buildChatRuntimeConnection/)
  assert.equal(source.includes('function resolveSelectedSkillPrompt'), false)
  assert.equal(source.includes('function buildAvailableTools'), false)
})

test('Connection index exports the public runtime boundary', () => {
  const source = readSource('src/runtime/connection/index.ts')

  assert.match(source, /chatRuntimeConnection/)
  assert.match(source, /superpowerConnection/)
  assert.match(source, /knowledgeConnectionAdapter/)
  assert.match(source, /toolConnectionAdapter/)
  assert.match(source, /skillConnectionAdapter/)
})

test('canvas LLM runtime attaches Vault evidence through KnowledgeConnection', () => {
  const source = readSource('src/components/canvas/runtime/canvasLlmRuntime.ts')

  assert.match(source, /resolveKnowledgeConnection/)
  assert.equal(source.includes('recallKnowledge('), false)
})
