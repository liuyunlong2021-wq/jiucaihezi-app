import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSelectedSkillPrompt,
  hasExplicitMemoryCapability,
  memoryProgramKind,
  normalizeMemoryToolResult,
  normalizeSkillAllowedToolNames,
  resolveMemoryToolSearchDefinitions,
  selectMemoryTools,
  selectedSkillNamesForInput,
} from '../memoryChat'
import { parseSkillMd, type SkillConfig } from '@/types/skill'
import {
  TOOL_DESCRIBE_TOOL_DEFINITION,
  TOOL_SEARCH_TOOL_DEFINITION,
  CONVERSATION_MEMORY_QUERY_TOOL_DEFINITION,
} from '@/runtime/direct/creativeToolContract'

const tools = [
  'skill',
  'read',
  'glob',
  'grep',
  'write',
  'edit',
  'mkdir',
  'move',
  'delete',
  'terminal',
  'create_document',
  'create_3d_scene',
  'edit_3d_scene',
  'export_3d_scene_video',
  'mcp__github__run',
  'mcp__demo__run',
].map(name => ({ function: { name } }))

test('knowledge files use the ordinary file tool set', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], true).map(tool => tool.function.name),
    ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete'],
  )
})

test('conversation memory query is available only when its Skill is selected', () => {
  assert.deepEqual(
    selectMemoryTools([...tools, CONVERSATION_MEMORY_QUERY_TOOL_DEFINITION], ['jc-jiyi'])
      .map(tool => tool.function.name),
    ['conversation_memory_query'],
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

test('program status kind follows the selected tool family', () => {
  assert.equal(memoryProgramKind('write'), 'file')
  assert.equal(memoryProgramKind('create_document'), 'media')
  assert.equal(memoryProgramKind('edit_3d_scene'), '3d')
  assert.equal(memoryProgramKind('export_3d_scene_video'), '3d')
  assert.equal(memoryProgramKind('terminal'), 'terminal')
  assert.equal(memoryProgramKind('mcp__github__run'), 'mcp')
})

test('an attached document exposes only the required read tool', () => {
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
  assert.equal(hasExplicitMemoryCapability({ fileToolsSelected: true }), true)
  assert.equal(hasExplicitMemoryCapability({ selectedSkillNames: ['jc-film-style'] }), true)
  assert.equal(hasExplicitMemoryCapability({ avSelected: true }), true)
})

test('selecting a concrete Skill does not expose unrelated tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, ['jc-film-style']).map(tool => tool.function.name),
    [],
  )
})

test('a selected Skill cannot load another Skill implicitly', () => {
  assert.equal(
    selectMemoryTools(tools, ['jc-film-style']).some(tool => tool.function.name === 'skill'),
    false,
  )
})

test('Skill frontmatter accepts scalar and list tool declarations', () => {
  assert.deepEqual(parseSkillMd('---\nallowed-tools: terminal\n---\nbody').allowedTools, ['terminal'])
  assert.deepEqual(parseSkillMd('---\nallowed-tools:\n  - read\n  - mcp__demo__run\n---\nbody').allowedTools, ['read', 'mcp__demo__run'])
  assert.deepEqual(parseSkillMd('---\r\nallowed-tools: terminal\r\n---\r\nbody').allowedTools, ['terminal'])
})

test('Skill tool declarations expand to the real current tool names', () => {
  assert.deepEqual(
    normalizeSkillAllowedToolNames(['file', 'media', '3d', 'mcp__demo__run', 'terminal']),
    ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete', 'export_markdown_png', 'create_document', 'create_html', 'export_markdown_slides', 'create_3d_scene', 'edit_3d_scene', 'export_3d_scene_video', 'mcp__demo', 'terminal'],
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

test('Skill allowed-tools join the current tool authorization set', async () => {
  const skill = {
    id: 'writer',
    name: 'writer',
    skillContent: '必须修改文件',
    allowedTools: ['read', 'edit', 'mcp__demo__run'],
  } as SkillConfig
  const allowedTools = new Set<string>()
  await buildSelectedSkillPrompt(
    ['writer'],
    new Map([['writer', skill]]),
    undefined,
    allowedTools,
  )
  assert.deepEqual([...allowedTools], ['read', 'edit', 'mcp__demo__run'])
  assert.deepEqual(
    selectMemoryTools(tools, ['writer'], false, false, false, [], false, false, false, [...allowedTools])
      .map(tool => tool.function.name),
    ['read', 'edit', 'mcp__demo__run'],
  )
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

test('Skill and file selection combine without a special route', () => {
  assert.deepEqual(
    selectMemoryTools(tools, ['jc-film-style'], true).map(tool => tool.function.name),
    ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete'],
  )
})

test('file selection exposes the complete project file tool set', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, false, true).map(tool => tool.function.name),
    ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete'],
  )
})

test('3D selection exposes create, edit, and export tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, false, false, [], false, true).map(
      tool => tool.function.name,
    ),
    ['create_3d_scene', 'edit_3d_scene', 'export_3d_scene_video'],
  )
})

test('explicit MCP keeps only the selected MCP tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, false, false, ['mcp__github__run']).map(
      tool => tool.function.name,
    ),
    ['mcp__github__run'],
  )
})

test('selected MCP tools are not restricted by a special Agent allowlist', () => {
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

test('tool search exposes only core tools until an authorized tool is described', () => {
  assert.equal(TOOL_SEARCH_TOOL_DEFINITION.function.name, 'tool_search')
  assert.equal(TOOL_DESCRIBE_TOOL_DEFINITION.function.name, 'tool_describe')
  assert.deepEqual(
    resolveMemoryToolSearchDefinitions(tools, new Set()).map(tool => tool.function.name),
    ['tool_search', 'tool_describe'],
  )
  assert.deepEqual(
    resolveMemoryToolSearchDefinitions(tools, new Set(['terminal'])).map(tool => tool.function.name),
    ['tool_search', 'tool_describe', 'terminal'],
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
