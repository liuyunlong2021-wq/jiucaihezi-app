import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildToolRequestOptions,
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
  assert.equal(shouldEnableToolCalling({ agentId: 'office-writer' }), true)
  assert.equal(getToolExecutorMode({ agentId: 'office-writer' }), 'agent')
})

test('only exposes approval tools to concrete agent executor', () => {
  assert.equal(shouldExposeApprovalTools({}), false)
  assert.equal(shouldExposeApprovalTools({ agentId: '   ' }), false)
  assert.equal(shouldExposeApprovalTools({ agentId: 'office-writer' }), true)
  assert.equal(shouldExposeApprovalTools({ agentId: 'office-writer', localToolsEnabled: false }), false)
})

test('filters approval tools from the hidden default executor', () => {
  const tools = [
    { type: 'function' as const, function: { name: 'office_create' } },
    { type: 'function' as const, function: { name: 'bash' } },
    { type: 'function' as const, function: { name: 'browser' } },
  ]
  const getRisk = (name: string) => (name === 'office_create' ? 'write' : 'approval')

  assert.deepEqual(
    filterApprovalToolsForPolicy({}, tools, getRisk).map(tool => tool.function.name),
    ['office_create'],
  )
  assert.deepEqual(
    filterApprovalToolsForPolicy({ agentId: 'office-writer' }, tools, getRisk).map(tool => tool.function.name),
    ['office_create', 'bash', 'browser'],
  )
})

test('filters gateway-backed tools until their source is explicitly available', () => {
  const tools = [
    { type: 'function' as const, function: { name: 'office_create' } },
    { type: 'function' as const, function: { name: 'file_write' } },
    { type: 'function' as const, function: { name: 'bash' } },
  ]
  const getSource = (name: string) => (name === 'office_create' ? 'cloud' : 'openclaw')

  assert.deepEqual(
    filterUnavailableSourceToolsForPolicy(tools, getSource, { openclaw: false }).map(tool => tool.function.name),
    ['office_create'],
  )
  assert.deepEqual(
    filterUnavailableSourceToolsForPolicy(tools, getSource, { openclaw: true }).map(tool => tool.function.name),
    ['office_create', 'file_write', 'bash'],
  )
})

test('omits tool request options when local capability is disabled', () => {
  const tools = [{ type: 'function' as const, function: { name: 'office_create' } }]

  assert.equal(shouldEnableToolCalling({ localToolsEnabled: false }), false)
  assert.equal(getToolExecutorMode({ agentId: 'office-writer', localToolsEnabled: false }), 'disabled')
  assert.deepEqual(buildToolRequestOptions({ localToolsEnabled: false }, tools), {})
})

test('adds tool request options for plain and agent chats when local capability is enabled', () => {
  const tools = [{ type: 'function' as const, function: { name: 'office_create' } }]

  assert.deepEqual(buildToolRequestOptions({}, tools), {
    tools,
    tool_choice: 'auto',
  })
  assert.deepEqual(buildToolRequestOptions({ agentId: 'office-writer' }, tools), {
    tools,
    tool_choice: 'auto',
  })
})
