import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildToolConnection } from '../toolConnection'
import {
  buildAvailableChatTools,
  buildDefaultChatTools,
  resolveToolConnection,
} from '../toolConnectionAdapter'

const searchTool = {
  type: 'function',
  function: {
    name: 'browser_search',
    description: 'Search the web',
    parameters: { type: 'object', properties: {} },
  },
}

const exportTool = {
  type: 'function',
  function: {
    name: 'office_create',
    description: 'Create a document',
    parameters: { type: 'object', properties: {} },
  },
}

test('buildToolConnection keeps tools global and records exposure source', () => {
  const connection = buildToolConnection({
    enabled: true,
    source: 'global',
    tools: [searchTool, exportTool],
  })

  assert.equal(connection.enabled, true)
  assert.equal(connection.source, 'global')
  assert.deepEqual(connection.availableToolNames, ['browser_search', 'office_create'])
})

test('buildToolConnection returns no tools when disabled', () => {
  const connection = buildToolConnection({
    enabled: false,
    source: 'user-requested',
    tools: [searchTool],
  })

  assert.equal(connection.enabled, false)
  assert.equal(connection.source, 'user-requested')
  assert.deepEqual(connection.availableToolNames, [])
})

test('resolveToolConnection wraps the current tool provider and dedupes names in the trace', () => {
  const result = resolveToolConnection({
    enabled: true,
    source: 'skill-suggested',
    getTools: () => [searchTool, exportTool, searchTool],
  })

  assert.equal(result.connection.enabled, true)
  assert.equal(result.connection.source, 'skill-suggested')
  assert.deepEqual(result.connection.availableToolNames, ['browser_search', 'office_create'])
  assert.equal(result.tools.length, 3)
})

test('resolveToolConnection does not request tool definitions when disabled', () => {
  let calls = 0
  const result = resolveToolConnection({
    enabled: false,
    source: 'global',
    getTools: () => {
      calls += 1
      return [searchTool]
    },
  })

  assert.equal(calls, 0)
  assert.deepEqual(result.tools, [])
  assert.deepEqual(result.connection.availableToolNames, [])
})

test('buildAvailableChatTools preserves the skill-creator special tool policy', () => {
  const tools = buildAvailableChatTools({
    agentId: 'preset_skill-creator',
    getSkillCreatorTools: () => [searchTool],
    getMcpTools: () => [{ function: { name: 'mcp__docs__lookup' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), ['browser_search'])
})

test('buildAvailableChatTools gives skill-builder the skill creation save tools', () => {
  const tools = buildAvailableChatTools({
    agentId: 'preset_skill-builder',
    getSkillCreatorTools: () => [searchTool],
    getMcpTools: () => [{ function: { name: 'mcp__docs__lookup' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), ['browser_search'])
})

test('buildAvailableChatTools keeps MCP tools as a separate add-on group', () => {
  const tools = buildAvailableChatTools({
    userInput: '帮我打开网页搜索一下官方资料',
    getBrowserTools: () => [{ function: { name: 'browser_search' } }],
    getMcpTools: () => [{ function: { name: 'mcp__docs__lookup' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), [
    'browser_search',
    'mcp__docs__lookup',
  ])
})

test('buildAvailableChatTools suppresses MCP add-ons for ordinary knowledge questions', () => {
  const tools = buildAvailableChatTools({
    userInput: '曾国藩为什么能取得这样的成就？',
    getMcpTools: () => [{ function: { name: 'mcp__docs__lookup' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), [])
})

test('buildDefaultChatTools gives text source builder only to 素材转Skill', () => {
  const builderTools = buildDefaultChatTools({
    agentId: 'preset_skill-builder',
    localToolsEnabled: true,
    skillMaterialRuntimeAvailable: true,
  }).map(tool => tool.function.name)
  const creatorTools = buildDefaultChatTools({
    agentId: 'preset_skill-creator',
    localToolsEnabled: true,
  }).map(tool => tool.function.name)

  assert.deepEqual(builderTools, [
    'build_skill_from_text',
    'local_extract_attachment',
    'document_to_markdown',
    'run_skill_tests',
    'save_skill',
    'compile_skill_materials',
  ])
  assert.deepEqual(creatorTools, [
    'skill_creator_validate',
    'run_skill_tests',
    'skill_creator_aggregate_benchmark',
    'skill_creator_open_eval_review',
    'skill_creator_improve_description',
    'skill_creator_package',
    'save_skill',
  ])
})

test('buildDefaultChatTools exposes compile_skill_materials only when 素材转Skill runtime is available', () => {
  const unavailableTools = buildDefaultChatTools({
    agentId: 'preset_skill-builder',
    localToolsEnabled: true,
    skillMaterialRuntimeAvailable: false,
  }).map(tool => tool.function.name)
  const availableTools = buildDefaultChatTools({
    agentId: 'preset_skill-builder',
    localToolsEnabled: true,
    skillMaterialRuntimeAvailable: true,
  }).map(tool => tool.function.name)

  assert.deepEqual(unavailableTools, [
    'build_skill_from_text',
    'local_extract_attachment',
    'document_to_markdown',
    'run_skill_tests',
    'save_skill',
  ])
  assert.equal(availableTools.includes('compile_skill_materials'), true)
})

test('buildDefaultChatTools returns no tools when local tools are not explicitly enabled', () => {
  assert.deepEqual(buildDefaultChatTools({ localToolsEnabled: false }), [])
  assert.deepEqual(buildDefaultChatTools({}), [])
})

test('buildAvailableChatTools combines global tool groups without web-search switch state', () => {
  const tools = buildAvailableChatTools({
    getTodoTools: () => [{ function: { name: 'todo_create' } }],
    getBrowserTools: () => [{ function: { name: 'browser_search' } }],
    getLocalContentTools: () => [{ function: { name: 'document_to_markdown' } }],
    getOfficeTools: () => [{ function: { name: 'office_create' } }],
    getDevTools: () => [{ function: { name: 'dev_read_file' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), [
    'todo_create',
    'browser_search',
    'document_to_markdown',
    'office_create',
    'dev_read_file',
  ])
})

test('buildAvailableChatTools suppresses tools for ordinary knowledge questions even when tools are permitted', () => {
  const tools = buildAvailableChatTools({
    userInput: '曾国藩为什么能取得这样的成就？',
    getBrowserTools: () => [{ function: { name: 'browser_search' } }],
    getLocalContentTools: () => [{ function: { name: 'document_to_markdown' } }],
    getOfficeTools: () => [{ function: { name: 'office_create' } }],
    getDevTools: () => [{ function: { name: 'dev_read_file' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), [])
})

test('buildAvailableChatTools exposes only relevant tools for explicit document export requests', () => {
  const tools = buildAvailableChatTools({
    userInput: '把上面的内容转成 Word 文档',
    getBrowserTools: () => [{ function: { name: 'browser_search' } }],
    getLocalContentTools: () => [{ function: { name: 'document_to_markdown' } }],
    getOfficeTools: () => [{ function: { name: 'office_create' } }],
    getDevTools: () => [{ function: { name: 'dev_read_file' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), ['office_create'])
})

test('buildAvailableChatTools exposes browser tools only for explicit browse or search intent', () => {
  const tools = buildAvailableChatTools({
    userInput: '帮我打开网页搜索一下曾国藩相关资料',
    getBrowserTools: () => [{ function: { name: 'browser_search' } }],
    getOfficeTools: () => [{ function: { name: 'office_create' } }],
  })

  assert.deepEqual(tools.map(tool => tool.function.name), ['browser_search'])
})
