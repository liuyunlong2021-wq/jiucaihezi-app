import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildToolRequestOptions,
  canExecuteToolCall,
  filterApprovalToolsForPolicy,
  filterUnavailableSourceToolsForPolicy,
  getToolExecutorMode,
  shouldEnableToolCalling,
  shouldExposeApprovalTools,
} from '../chatToolPolicy'

test('enables tools by default for plain chat through the default executor', () => {
  assert.equal(shouldEnableToolCalling({}), true)
  assert.equal(shouldEnableToolCalling({ agentId: '' }), true)
  assert.equal(shouldEnableToolCalling({ agentId: '   ' }), true)
  assert.equal(getToolExecutorMode({}), 'default')
})

test('uses agent executor when a concrete agent is selected', () => {
  assert.equal(shouldEnableToolCalling({ agentId: 'local-helper' }), true)
  assert.equal(getToolExecutorMode({ agentId: 'local-helper' }), 'agent')
})

test('only exposes approval tools to concrete agent executor', () => {
  assert.equal(shouldExposeApprovalTools({}), false)
  assert.equal(shouldExposeApprovalTools({ agentId: '   ' }), false)
  assert.equal(shouldExposeApprovalTools({ agentId: 'local-helper' }), true)
  assert.equal(shouldExposeApprovalTools({ agentId: 'local-helper', localToolsEnabled: false }), false)
})

test('filters approval tools from the hidden default executor', () => {
  const tools = [
    { type: 'function' as const, function: { name: 'document_to_markdown' } },
    { type: 'function' as const, function: { name: 'bash' } },
    { type: 'function' as const, function: { name: 'browser' } },
  ]
  const getRisk = (name: string) => (name === 'document_to_markdown' ? 'safe' : 'approval')

  assert.deepEqual(
    filterApprovalToolsForPolicy({}, tools, getRisk).map(tool => tool.function.name),
    ['document_to_markdown'],
  )
  assert.deepEqual(
    filterApprovalToolsForPolicy({ agentId: 'local-helper' }, tools, getRisk).map(tool => tool.function.name),
    ['document_to_markdown', 'bash', 'browser'],
  )
})

test('filters tools from unavailable first-party sources', () => {
  const tools = [
    { type: 'function' as const, function: { name: 'document_to_markdown' } },
    { type: 'function' as const, function: { name: 'document_to_markdown' } },
    { type: 'function' as const, function: { name: 'browser_search' } },
  ]
  const getSource = (_name: string) => 'local'

  assert.deepEqual(
    filterUnavailableSourceToolsForPolicy(tools, getSource, { local: false }).map(tool => tool.function.name),
    [],
  )
  assert.deepEqual(
    filterUnavailableSourceToolsForPolicy(tools, getSource, { local: true }).map(tool => tool.function.name),
    ['document_to_markdown', 'document_to_markdown', 'browser_search'],
  )
})

test('omits tool request options when local capability is disabled', () => {
  const tools = [{ type: 'function' as const, function: { name: 'document_to_markdown' } }]

  assert.equal(shouldEnableToolCalling({ localToolsEnabled: false }), false)
  assert.equal(getToolExecutorMode({ agentId: 'local-helper', localToolsEnabled: false }), 'disabled')
  assert.deepEqual(buildToolRequestOptions({ localToolsEnabled: false }, tools), {})
})

test('adds tool request options for plain and agent chats when local capability is enabled', () => {
  const tools = [{ type: 'function' as const, function: { name: 'document_to_markdown' } }]

  assert.deepEqual(buildToolRequestOptions({}, tools), {
    tools,
    tool_choice: 'auto',
  })
  assert.deepEqual(buildToolRequestOptions({ agentId: 'local-helper' }, tools), {
    tools,
    tool_choice: 'auto',
  })
})

test('tool calls execute only for members and exposed tool names', () => {
  const exposed = new Set(['document_to_markdown'])

  assert.equal(canExecuteToolCall('document_to_markdown', { isMember: true, exposedToolNames: exposed }), true)
  assert.equal(canExecuteToolCall('browser_search', { isMember: true, exposedToolNames: exposed }), false)
  assert.equal(canExecuteToolCall('document_to_markdown', { isMember: false, exposedToolNames: exposed }), false)
})
