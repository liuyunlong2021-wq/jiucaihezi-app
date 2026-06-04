import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createMcpBridgeExecutor,
  getMcpBridgeToolDefinitions,
  getMcpToolLabel,
} from '../mcpBridge'

const connectedTool = {
  name: 'mcp__docs__lookup',
  description: 'Lookup docs',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  serverId: 'docs',
  originalName: 'lookup',
}

function makeStore(overrides: Record<string, unknown> = {}) {
  const tools = [
    connectedTool,
    {
      name: 'mcp__offline__hidden',
      description: 'Offline tool',
      inputSchema: { type: 'object', properties: {} },
      serverId: 'offline',
      originalName: 'hidden',
    },
    {
      name: 'office_create',
      description: 'Collision with a core tool',
      inputSchema: { type: 'object', properties: {} },
      serverId: 'docs',
      originalName: 'office_create',
    },
  ]

  return {
    allMcpTools: tools,
    isServerEnabled: (serverId: string) => serverId !== 'disabled',
    isServerConnected: (serverId: string) => serverId === 'docs',
    getMcpToolByName: (toolName: string) => tools.find(tool => tool.name === toolName) || null,
    ...overrides,
  }
}

test('MCP bridge exposes only enabled connected tools and rejects core-name collisions', () => {
  const definitions = getMcpBridgeToolDefinitions({
    store: makeStore(),
    coreToolNames: new Set(['office_create']),
  })

  assert.deepEqual(definitions.map(tool => tool.function.name), ['mcp__docs__lookup'])
  assert.equal(definitions[0].function.description, 'Lookup docs')
  assert.deepEqual(definitions[0].function.parameters, connectedTool.inputSchema)
})

test('MCP bridge executor rejects forged or disconnected MCP tool calls immediately', async () => {
  let called = false
  const executor = createMcpBridgeExecutor({
    store: makeStore({
      isServerConnected: () => false,
    }),
    callMcpTool: async () => {
      called = true
      return 'should not run'
    },
  })

  const result = await executor({
    call: {
      id: 'call_mcp_1',
      function: {
        name: 'mcp__docs__lookup',
        arguments: '{"query":"x"}',
      },
    },
    args: { query: 'x' },
  })

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'MCP_NOT_CONNECTED')
  assert.equal(called, false)
})

test('MCP bridge labels tools as external add-ons for display', () => {
  assert.equal(getMcpToolLabel('mcp__docs__lookup'), '外挂工具 · docs / lookup')
})
