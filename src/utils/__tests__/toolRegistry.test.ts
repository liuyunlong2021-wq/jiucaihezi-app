import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyToolInvocation } from '../toolActivity'
import { getToolCardByName, summarizeToolInvocation } from '../toolRegistry'

test('tool warehouse exposes only the MCP extension entry after local-card cleanup', () => {
  assert.equal(getToolCardByName('mcp')?.id, 'mcp_extensions')
  assert.equal(getToolCardByName('extension')?.id, 'mcp_extensions')
  assert.equal(getToolCardByName('browser_search'), null)
  assert.equal(getToolCardByName('bash'), null)
})

test('MCP extension card keeps the user-facing warehouse metadata', () => {
  const card = getToolCardByName('mcp_extensions')
  assert.equal(card?.name, '高级扩展')
  assert.deepEqual(card?.tags, ['MCP', '扩展'])
  assert.equal(card?.risk, 'safe')
})

test('tool summaries use the MCP card label and leave removed tools untouched', () => {
  assert.equal(summarizeToolInvocation('mcp', { server: 'docs' }), '高级扩展')
  assert.equal(summarizeToolInvocation('bash', { command: 'pnpm build' }), 'bash')
})

test('tool activity tracks the retained MCP extension card', () => {
  let state = applyToolInvocation({}, {
    callId: 'call-1',
    toolName: 'mcp',
    status: 'running',
    args: { server: 'docs' },
    at: 100,
  })

  assert.equal(state.mcp_extensions.active, true)
  assert.equal(state.mcp_extensions.status, 'running')
  assert.equal(state.mcp_extensions.callCount, 1)
  assert.equal(state.mcp_extensions.lastDetail, '高级扩展')

  state = applyToolInvocation(state, {
    callId: 'call-1',
    toolName: 'mcp',
    status: 'done',
    at: 150,
  })

  assert.equal(state.mcp_extensions.active, false)
  assert.equal(state.mcp_extensions.status, 'done')
  assert.equal(state.mcp_extensions.callCount, 1)
  assert.equal(state.mcp_extensions.lastFinishedAt, 150)
})

test('tool activity ignores removed local cards', () => {
  let state = applyToolInvocation({}, {
    callId: 'call-2',
    toolName: 'bash',
    status: 'running',
    args: { command: 'pnpm build' },
    at: 200,
  })
  state = applyToolInvocation(state, {
    callId: 'call-2',
    toolName: 'bash',
    status: 'error',
    error: '执行失败',
    at: 240,
  })

  assert.deepEqual(state, {})
})
