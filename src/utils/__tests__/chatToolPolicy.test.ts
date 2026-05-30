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

test('disables tools unless local capability is explicitly enabled', () => {
  assert.equal(shouldEnableToolCalling({}), false)
  assert.equal(shouldEnableToolCalling({ agentId: '' }), false)
  assert.equal(shouldEnableToolCalling({ agentId: '   ' }), false)
  assert.equal(shouldEnableToolCalling({ localToolsEnabled: true }), true)
  assert.equal(getToolExecutorMode({}), 'disabled')
})

test('uses agent executor when a concrete agent is selected', () => {
  assert.equal(shouldEnableToolCalling({ agentId: 'local-helper' }), false)
  assert.equal(shouldEnableToolCalling({ agentId: 'local-helper', localToolsEnabled: true }), true)
  assert.equal(getToolExecutorMode({ agentId: 'local-helper', localToolsEnabled: true }), 'agent')
})

test('does not expose approval tools without a dedicated approval boundary', () => {
  assert.equal(shouldExposeApprovalTools({}), false)
  assert.equal(shouldExposeApprovalTools({ agentId: '   ' }), false)
  assert.equal(shouldExposeApprovalTools({ agentId: 'local-helper', localToolsEnabled: true }), false)
  assert.equal(shouldExposeApprovalTools({ agentId: 'local-helper', localToolsEnabled: false }), false)
})

test('filters approval and write tools until explicit approval exists', () => {
  const tools = [
    { type: 'function' as const, function: { name: 'document_to_markdown' } },
    { type: 'function' as const, function: { name: 'bash' } },
    { type: 'function' as const, function: { name: 'browser' } },
  ]
  const getRisk = (name: string) => (
    name === 'document_to_markdown' ? 'safe' : name === 'bash' ? 'approval' : 'write'
  )

  assert.deepEqual(
    filterApprovalToolsForPolicy({}, tools, getRisk).map(tool => tool.function.name),
    ['document_to_markdown'],
  )
  assert.deepEqual(
    filterApprovalToolsForPolicy({ agentId: 'local-helper', localToolsEnabled: true }, tools, getRisk).map(tool => tool.function.name),
    ['document_to_markdown'],
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

test('adds tool request options for plain and agent chats only when local capability is enabled', () => {
  const tools = [{ type: 'function' as const, function: { name: 'document_to_markdown' } }]

  assert.deepEqual(buildToolRequestOptions({}, tools), {})
  assert.deepEqual(buildToolRequestOptions({ localToolsEnabled: true }, tools), {
    tools,
    tool_choice: 'auto',
  })
  assert.deepEqual(buildToolRequestOptions({ agentId: 'local-helper', localToolsEnabled: true }, tools), {
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
