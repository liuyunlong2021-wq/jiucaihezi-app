import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSelectedSkillPrompt,
  hasExplicitMemoryCapability,
  normalizeMemoryToolResult,
  selectMemoryTools,
  selectedSkillNamesForInput,
  shouldUseWikiTwoPhase,
} from '../memoryChat'
import type { SkillConfig } from '@/types/skill'

const tools = [
  'skill',
  'wiki_context',
  'wiki_search',
  'wiki',
  'read',
  'glob',
  'grep',
  'write',
  'edit',
  'mkdir',
  'terminal',
  'create_document',
  'create_3d_scene',
  'mcp__demo__run',
].map(name => ({ function: { name } }))

test('Wiki exposes the complete native Wiki tool set', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], true).map(tool => tool.function.name),
    ['wiki_context', 'wiki'],
  )
})

test('project tool results default to success without masking explicit failures', () => {
  assert.equal(normalizeMemoryToolResult({ content: 'ok' }).status, 'succeeded')
  assert.equal(normalizeMemoryToolResult({ content: 'failed', status: 'failed' }).status, 'failed')
  assert.equal(
    normalizeMemoryToolResult({ content: 'cancelled', status: 'cancelled' }).status,
    'cancelled',
  )
})

test('Wiki writing keeps generic file, media, and terminal tools closed', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], true).map(tool => tool.function.name),
    ['wiki_context', 'wiki'],
  )
})

test('creating a Wiki from an inline document exposes one native Wiki batch tool', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, true).map(tool => tool.function.name),
    ['read'],
  )
})

test('creating a Wiki from a long document adds only the required read tool', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, true).map(tool => tool.function.name),
    ['read'],
  )
})

test('ordinary conversation exposes no project tools', () => {
  assert.deepEqual(selectMemoryTools(tools), [])
})

test('ordinary conversation has no explicit capability connection', () => {
  assert.equal(hasExplicitMemoryCapability({}), false)
})

test('an attached document does not activate history or project capabilities', () => {
  assert.equal(hasExplicitMemoryCapability({ attachments: [{ kind: 'file' } as any] }), false)
})

test('a selected capability connects the task explicitly', () => {
  assert.equal(hasExplicitMemoryCapability({ wikiSelected: true }), true)
  assert.equal(hasExplicitMemoryCapability({ selectedSkillNames: ['jc-film-style'] }), true)
})

test('Wiki-only uses the Wiki protocol, but Skill plus Wiki uses the unified loop', () => {
  assert.equal(shouldUseWikiTwoPhase({ wikiSelected: true }), true)
  assert.equal(shouldUseWikiTwoPhase({ wikiSelected: true, selectedSkillNames: ['writer'] }), false)
  assert.equal(shouldUseWikiTwoPhase({ wikiSelected: true, mediaSelected: true }), false)
})

test('selecting a concrete Skill exposes all currently available product tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, ['jc-film-style']).map(tool => tool.function.name),
    tools.map(tool => tool.function.name).filter(name => name !== 'skill'),
  )
})

test('a selected Skill cannot load another Skill implicitly', () => {
  assert.equal(
    selectMemoryTools(tools, ['jc-film-style']).some(tool => tool.function.name === 'skill'),
    false,
  )
})

test('selected Skill rules are injected as a mandatory contract', async () => {
  const skill = {
    id: 'writer',
    name: 'writer',
    skillContent: '# 必须遵守\n输出三段正文',
    assetIndex: [{ path: 'references/style.md' }],
  } as SkillConfig
  const prompt = await buildSelectedSkillPrompt(['writer'], new Map([['writer', skill]]))
  assert.match(prompt, /本轮必须遵守的执行合同/)
  assert.match(prompt, /# 必须遵守/)
  assert.match(prompt, /references\/style\.md/)
  assert.match(prompt, /skill:\/\/local\/writer/)
})

test('selected Skill load failures remain visible to the model contract', async () => {
  const prompt = await buildSelectedSkillPrompt(['missing-skill'], new Map(), async () => {
    throw new Error('测试加载失败')
  })
  assert.match(prompt, /Skill 规则加载失败/)
  assert.match(prompt, /测试加载失败/)
})

test('Skill binding normalizes names and rejects non-concrete selections', () => {
  assert.deepEqual(
    selectedSkillNamesForInput({ selectedSkillNames: [' writer ', 'writer'] }),
    ['writer'],
  )
  assert.throws(() => selectedSkillNamesForInput({ selectedSkillNames: [''] }), /名称不能为空/)
  assert.throws(() => selectedSkillNamesForInput({ selectedSkillNames: ['Skill'] }), /具体 Skill/)
})

test('explicit MCP keeps only the selected MCP tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, false, false, ['mcp__demo__run']).map(
      tool => tool.function.name,
    ),
    ['mcp__demo__run'],
  )
})

test('MCP selection without a concrete tool exposes nothing', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, false, false, []).map(tool => tool.function.name),
    [],
  )
})

test('attached document plus an add-to-scope instruction exposes write tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, true).map(tool => tool.function.name),
    ['read'],
  )
})

test('attached document that needs reading exposes read without keyword guessing', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, true).map(tool => tool.function.name),
    ['read'],
  )
})
