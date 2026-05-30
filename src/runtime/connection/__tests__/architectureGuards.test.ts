import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('chat UI has no Superpower execution path', () => {
  const source = readSource('src/components/chat/ChatPanel.vue')

  assert.equal(source.includes('buildSuperpowersPrompt'), false)
  assert.equal(source.includes('buildConnectionSuperpowerSystemPrompt'), false)
  assert.equal(source.includes('buildSuperpowerSystemPrompt'), false)
  assert.equal(source.includes('routeMessage('), false)
  assert.equal(source.includes('processChainInvoke'), false)
  assert.equal(source.includes('handleConfirmChain'), false)
  assert.equal(source.includes('pipelineActive'), false)
  assert.equal(source.includes('pendingInvoke'), false)
})

test('legacy Superpower router execution code is removed', () => {
  assert.equal(existsSync(join(process.cwd(), 'src/composables/useSkillRouter.ts')), false)

  const superpowerSource = readSource('src/data/superpowerSkills.ts')
  assert.equal(superpowerSource.includes('buildSessionHookPrompt'), false)
  assert.equal(superpowerSource.includes('detectChainInvoke'), false)
  assert.equal(superpowerSource.includes('[INVOKE:'), false)
  assert.equal(superpowerSource.includes('超能模式'), false)
  assert.equal(superpowerSource.includes('调度Skill执行'), false)
})

test('chat surface exposes manual Skill Knowledge and Tool controls', () => {
  const chatSource = readSource('src/components/chat/ChatPanel.vue')
  assert.match(chatSource, /SkillPickerBar/)
  assert.match(chatSource, /VaultPickerBar/)
  assert.match(chatSource, /ToolPickerBar/)

  const skillPickerSource = readSource('src/components/chat/SkillPickerBar.vue')
  const vaultPickerSource = readSource('src/components/chat/VaultPickerBar.vue')
  const toolPickerSource = readSource('src/components/chat/ToolPickerBar.vue')
  assert.match(skillPickerSource, /未选择Skill/)
  assert.match(vaultPickerSource, /知识库关闭/)
  assert.equal(skillPickerSource.includes('display: none'), false)
  assert.equal(vaultPickerSource.includes('display: none'), false)
  assert.equal(toolPickerSource.includes('localToolsEnabled'), true)
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
