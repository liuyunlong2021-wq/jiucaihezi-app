import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSelectedSkillPrompt,
  hasWikiWriteIntent,
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
  MEMORY_STORY_TOOL_DEFINITIONS,
  parseCreativeToolArguments,
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
  'copy',
  'delete',
  'write_text_batch',
  'terminal',
  'skill_run_script',
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
    ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete', 'write_text_batch'],
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

test('the retired memory_search tool is never selected', () => {
  assert.deepEqual(selectMemoryTools([{ function: { name: 'memory_search' } }]), [])
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

test('selecting a concrete Skill always exposes read but no mutation tools', () => {
  assert.deepEqual(
    selectMemoryTools(tools, ['jc-film-style']).map(tool => tool.function.name),
    ['read'],
  )
})

test('a Skill without allowed-tools can read its declared package resources', async () => {
  const skill = {
    id: 'reader',
    name: 'reader',
    skillContent: '# Read the bundled reference first',
    assetIndex: [{ path: 'references/rules.md' }],
  } as SkillConfig
  const prompt = await buildSelectedSkillPrompt(['reader'], new Map([['reader', skill]]))
  assert.match(prompt, /references\/rules\.md/)
  assert.deepEqual(
    selectMemoryTools(tools, ['reader']).map(tool => tool.function.name),
    ['read'],
  )
})

test('a selected Skill cannot load another Skill implicitly', () => {
  assert.equal(
    selectMemoryTools(tools, ['jc-film-style']).some(tool => tool.function.name === 'skill'),
    false,
  )
})

test('Skill frontmatter accepts scalar and list tool declarations', () => {
  assert.deepEqual(parseSkillMd('---\nallowed-tools: terminal\n---\nbody').allowedTools, [
    'terminal',
  ])
  assert.deepEqual(
    parseSkillMd('---\nallowed-tools:\n  - read\n  - mcp__demo__run\n---\nbody').allowedTools,
    ['read', 'mcp__demo__run'],
  )
  assert.deepEqual(parseSkillMd('---\r\nallowed-tools: terminal\r\n---\r\nbody').allowedTools, [
    'terminal',
  ])
})

test('Skill frontmatter 剥掉 triggers 与 allowed-tools 的 YAML 包裹引号', () => {
  // 源文件常写成 - '看视频'（单引号）或 - "写短剧"（双引号）。不剥引号的话关键词带着引号，
  // 一条都匹配不上——@Jev 的路由判定全靠 triggers，曾因此全线失效。
  const parsed = parseSkillMd(
    '---\nname: s\ntriggers:\n  - \'看视频\'\n  - "写短剧"\nallowed-tools:\n  - \'read\'\n  - "edit"\n---\nbody',
  )
  assert.deepEqual(parsed.triggers, ['看视频', '写短剧'])
  assert.deepEqual(parsed.allowedTools, ['read', 'edit'])
})

test('Skill tool declarations expand to the real current tool names', () => {
  assert.deepEqual(
    normalizeSkillAllowedToolNames(['file', 'media', '3d', 'mcp__demo__run', 'terminal']),
    [
      'read',
      'glob',
      'grep',
      'write',
      'edit',
      'mkdir',
      'move',
      'delete',
      'write_text_batch',
      'export_markdown_png',
      'create_document',
      'create_html',
      'export_markdown_slides',
      'create_3d_scene',
      'edit_3d_scene',
      'export_3d_scene_video',
      'mcp__demo',
      'terminal',
    ],
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
  // 文件清单无论渲染成完整路径还是目录树，模型都必须拿得到可读的完整相对路径。
  assert.match(prompt, /references\/style\.md/)
  assert.match(prompt, /直接使用清单中的相对路径/)
})

test('Skill allowed-tools join the current tool authorization set', async () => {
  const skill = {
    id: 'writer',
    name: 'writer',
    skillContent: '必须修改文件',
    allowedTools: ['read', 'edit', 'mcp__demo__run'],
  } as SkillConfig
  const allowedTools = new Set<string>()
  await buildSelectedSkillPrompt(['writer'], new Map([['writer', skill]]), undefined, allowedTools)
  assert.deepEqual([...allowedTools], ['read', 'edit', 'mcp__demo__run'])
  assert.deepEqual(
    selectMemoryTools(tools, ['writer'], false, false, false, [], false, false, [
      ...allowedTools,
    ]).map(tool => tool.function.name),
    ['read', 'edit', 'mcp__demo__run'],
  )
})

test('Wiki Memory declares the file tool bundle for read/write tasks', () => {
  assert.deepEqual(normalizeSkillAllowedToolNames(['file']), [
    'read',
    'glob',
    'grep',
    'write',
    'edit',
    'mkdir',
    'move',
    'delete',
    'write_text_batch',
  ])
})

test('Wiki story distillation is treated as write intent', () => {
  assert.equal(hasWikiWriteIntent('把这部小说拆分并沉淀到 Wiki'), true)
  assert.equal(hasWikiWriteIntent('继续分析下一章'), true)
  assert.equal(hasWikiWriteIntent('同意'), true)
  assert.equal(hasWikiWriteIntent('查询这部小说有哪些人物'), false)
})

test('story analysis exposes one read operation and one structured commit operation', () => {
  assert.deepEqual(
    MEMORY_STORY_TOOL_DEFINITIONS.map(tool => tool.function.name),
    ['prepare_story_analysis', 'commit_story_analysis'],
  )
  assert.deepEqual(
    parseCreativeToolArguments({
      id: 'story',
      type: 'function',
      function: {
        name: 'prepare_story_analysis',
        arguments: '{"workDirectory":"wiki/原始材料/三结义","limit":2}',
      },
    } as any),
    { workDirectory: 'wiki/原始材料/三结义', limit: 2 },
  )
})

test('工具参数报错要列出本工具接受的参数，否则模型会原样重试', () => {
  // 用户实测报的错：做 PPT 时模型传了 filename，只收到「不支持 filename」于是原样重试，
  // 白烧 3 轮。报错里带上白名单，它才能一轮改用正确的形状。
  assert.throws(
    () =>
      parseCreativeToolArguments({
        id: 'slides',
        type: 'function',
        function: { name: 'export_markdown_slides', arguments: '{"filename":"a.png"}' },
      } as any),
    /工具参数不支持: filename。本工具只接受: title、content、format（export_markdown_slides）/,
  )
})

test('tool_describe 收下自然的 tool_name 写法，不为一个叫法空烧几轮', () => {
  // 用户实测：模型习惯写 tool_name，只认 name 时它连报三轮（两次不支持、一次缺参）。
  const args = parseCreativeToolArguments({
    id: 'describe',
    type: 'function',
    function: { name: 'tool_describe', arguments: '{"tool_name":"save_skill"}' },
  } as any)
  assert.deepEqual(args, { name: 'save_skill' })

  const named = parseCreativeToolArguments({
    id: 'describe2',
    type: 'function',
    function: { name: 'tool_describe', arguments: '{"name":"save_skill"}' },
  } as any)
  assert.deepEqual(named, { name: 'save_skill' })

  // 别名只在语义一致时生效：别的工具不接受 tool_name
  assert.throws(
    () =>
      parseCreativeToolArguments({
        id: 'read',
        type: 'function',
        function: { name: 'read', arguments: '{"tool_name":"a.md"}' },
      } as any),
    /工具参数不支持: tool_name/,
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
  assert.deepEqual(selectedSkillNamesForInput({ selectedSkillNames: [' writer ', 'writer'] }), [
    'writer',
  ])
  assert.throws(() => selectedSkillNamesForInput({ selectedSkillNames: [''] }), /名称不能为空/)
  assert.throws(() => selectedSkillNamesForInput({ selectedSkillNames: ['Skill'] }), /具体 Skill/)
})

test('Skill and file selection combine without a special route', () => {
  assert.deepEqual(
    selectMemoryTools(tools, ['jc-film-style'], true).map(tool => tool.function.name),
    ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete', 'write_text_batch'],
  )
})

test('file selection exposes the complete local tool set including terminal', () => {
  assert.deepEqual(
    selectMemoryTools(tools, [], false, false, true).map(tool => tool.function.name),
    [
      'read',
      'glob',
      'grep',
      'write',
      'edit',
      'mkdir',
      'move',
      'copy',
      'delete',
      'write_text_batch',
      'terminal',
      'skill_run_script',
      'export_3d_scene_video',
    ],
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
    resolveMemoryToolSearchDefinitions(tools, new Set(['terminal'])).map(
      tool => tool.function.name,
    ),
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
