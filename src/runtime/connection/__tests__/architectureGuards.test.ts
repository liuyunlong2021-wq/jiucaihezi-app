import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function readTypeScriptSourcesUnder(path: string): Array<{ path: string; source: string }> {
  const root = join(process.cwd(), path)
  if (!existsSync(root)) return []
  const entries: Array<{ path: string; source: string }> = []

  function visit(relativeDir: string) {
    const dir = join(process.cwd(), relativeDir)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        visit(relativePath)
        continue
      }
      if (!entry.name.endsWith('.ts') || relativePath.includes('__tests__')) continue
      entries.push({ path: relativePath, source: readSource(relativePath) })
    }
  }

  visit(path)
  return entries
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

test('chat surface exposes manual Skill and Knowledge controls while OpenCode owns passive tools', () => {
  const chatSource = readSource('src/components/chat/ChatPanel.vue')
  assert.match(chatSource, /SkillPickerBar/)
  assert.match(chatSource, /VaultPickerBar/)
  assert.doesNotMatch(chatSource, /ToolPickerBar/)

  const skillPickerSource = readSource('src/components/chat/SkillPickerBar.vue')
  const vaultPickerSource = readSource('src/components/chat/VaultPickerBar.vue')
  const toolPickerSource = readSource('src/components/chat/ToolPickerBar.vue')
  assert.match(skillPickerSource, /未选择Skill/)
  assert.match(vaultPickerSource, /知识库关闭/)
  assert.equal(skillPickerSource.includes('display: none'), false)
  assert.equal(vaultPickerSource.includes('display: none'), false)
  assert.equal(toolPickerSource.includes('localToolsEnabled'), false)
  assert.match(toolPickerSource, /OpenCode 被动工具由官方 runtime/)
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

test('chat runtime does not bypass ConversationContextEngine for memory index access', () => {
  const useChatSource = readSource('src/composables/useChat.ts')
  const chatRuntimeSource = readSource('src/runtime/connection/chatRuntimeConnection.ts')

  assert.equal(useChatSource.includes('mem0IndexDriver'), false)
  assert.equal(useChatSource.includes('memoryIndex'), false)
  assert.equal(chatRuntimeSource.includes('mem0IndexDriver'), false)
  assert.equal(chatRuntimeSource.includes('memoryIndex'), false)
})

test('ConversationContext public index does not export concrete index drivers', () => {
  const source = readSource('src/runtime/conversationContext/index.ts')

  assert.match(source, /engine/)
  assert.equal(source.includes('mem0IndexDriver'), false)
})

test('tool runtime kernel stays below RuntimeConnection boundary', () => {
  const sources = readTypeScriptSourcesUnder('src/runtime/tools')
  assert.ok(sources.length > 0)

  const forbiddenImports = [
    'chatRuntimeConnection',
    'runtimeConnection',
    'skillConnectionAdapter',
    'knowledgeConnectionAdapter',
    'ConversationContextEngine',
    'vaultStore',
    'agentStore',
  ]

  for (const file of sources) {
    for (const forbidden of forbiddenImports) {
      assert.equal(
        file.source.includes(forbidden),
        false,
        `${file.path} must not import or use ${forbidden}`,
      )
    }
  }
})

test('useChat keeps RuntimeConnection as the source of exposed tools', () => {
  const source = readSource('src/composables/useChat.ts')

  assert.match(source, /buildChatRuntimeConnection/)
  assert.match(source, /_availableTools:\s*chatConnection\.tools/)
  assert.equal(source.includes('createToolRuntimeConnection'), false)
})

test('useChat delegates concrete tool execution through ToolRuntimeKernel', () => {
  const source = readSource('src/composables/useChat.ts')

  assert.match(source, /createToolRuntimeKernel/)
  assert.match(source, /exposedToolNames/)
  assert.equal(source.includes('async function executeToolCall('), false)
  assert.equal(source.includes('canExecuteToolCall('), false)
})
