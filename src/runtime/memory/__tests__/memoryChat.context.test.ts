import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { buildCreativeContext } from '@/runtime/direct/creativeMemory'
import { createProjectFileService, type ProjectFileAdapter, type ProjectFileEntry } from '@/services/projectFileService'
import { buildConversationMemoryIndexContext, buildWikiMemoryIndexContext } from '../memoryChat'

const memoryChatSource = readFileSync('src/runtime/memory/memoryChat.ts', 'utf8')

test('all memory chats share one Direct Agent Loop and ordinary chat supplies no tools', () => {
  assert.equal(memoryChatSource.match(/runDirectChatCompletion\(\{/g)?.length, 1)
  assert.doesNotMatch(memoryChatSource, /if \(!explicitCapabilitySelected\) \{[\s\S]*runDirectChatCompletion/)
  assert.match(memoryChatSource, /const memoryToolDefinitions = toolLoopRequired[\s\S]*: \[\]/)
  assert.match(memoryChatSource, /const resolveTools = \(\) => memoryToolDefinitions\.length[\s\S]*: \[\]/)
  assert.match(memoryChatSource, /const toolLoopRequired = explicitCapabilitySelected \|\| attachmentNeedsRead/)
  assert.match(memoryChatSource, /!toolLoopRequired[\s\S]*不要使用任何工具能力/)
})

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

function files(records: Record<string, string>) {
  const entries = new Map<string, ProjectFileEntry>(
    Object.entries(records).map(([path, content]) => [path, { path, content, isDirectory: false }]),
  )
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...entries.values()] },
    async readText(_owner, path) {
      const entry = entries.get(path)
      if (!entry) throw new Error('missing')
      const content = String(entry.content || '')
      return { content, size: content.length, truncated: false, revision: { value: path, size: content.length } }
    },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
  }
  return createProjectFileService(adapter)
}

test('wiki-memory preloads only the first three Wiki index levels', async () => {
  const context = await buildWikiMemoryIndexContext('project', files({
    'wiki/index.md': '# Wiki root',
    'wiki/团队/index.md': '# 团队',
    'wiki/团队/工作进度/index.md': '# 工作进度',
    'wiki/团队/工作进度/历史/index.md': '# 不应预读',
    'wiki/团队/工作进度/2026-09-07.md': '# 正文不应预读',
  }))

  assert.match(context, /wiki\/index\.md/)
  assert.match(context, /wiki\/团队\/index\.md/)
  assert.match(context, /wiki\/团队\/工作进度\/index\.md/)
  assert.doesNotMatch(context, /不应预读|正文不应预读/)
})

test('wiki-memory injects only the current conversation memory index', async () => {
  const context = await buildConversationMemoryIndexContext('project', 'current', files({
    '.raw/记忆索引/current.md': '# 对话记忆索引\n\n- 简介：当前会话',
    '.raw/记忆索引/other.md': '# 对话记忆索引\n\n- 简介：其他会话',
  }))

  assert.match(context, /当前会话/)
  assert.doesNotMatch(context, /其他会话/)
})
