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
  })

  assert.deepEqual(tools.map(tool => tool.function.name), ['browser_search'])
})

test('buildDefaultChatTools returns no tools when local tools are not explicitly enabled', () => {
  assert.deepEqual(buildDefaultChatTools({ localToolsEnabled: false }), [])
  assert.deepEqual(buildDefaultChatTools({}), [])
})

test('buildAvailableChatTools combines global tool groups while keeping browser search switchable', () => {
  const tools = buildAvailableChatTools({
    webSearchEnabled: false,
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
