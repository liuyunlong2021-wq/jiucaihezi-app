import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { build } from 'esbuild'

const outfile = '/tmp/jiucaihezi-creation-mcp-test.mjs'
await build({ entryPoints: ['scripts/jiucaihezi-creation-mcp/index.ts'], outfile, bundle: true, platform: 'node', format: 'esm' })
const { createCreationMcpServer } = await import(`${outfile}?${Date.now()}`)

test('creation MCP exposes the fixed tool contract and forwards structured calls', async () => {
  const calls = []
  const server = createCreationMcpServer(async (operation, params) => {
    calls.push({ operation, params })
    return { ready: true }
  })
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const tools = await client.listTools()
  assert.deepEqual(tools.tools.map(tool => tool.name), [
    'get_creation_context', 'list_creation_models', 'get_creation_task', 'list_creation_history',
    'submit_creation_task', 'cancel_creation_task', 'retry_media_persistence', 'add_creation_result_to_canvas',
  ])
  assert.equal(tools.tools.find(tool => tool.name === 'submit_creation_task').annotations.idempotentHint, true)
  assert.equal(tools.tools.find(tool => tool.name === 'submit_creation_task').annotations.readOnlyHint, false)
  assert.equal(tools.tools.find(tool => tool.name === 'submit_creation_task').inputSchema.properties.directory.type, 'string')
  const result = await client.callTool({ name: 'get_creation_context', arguments: {} })
  assert.deepEqual(result.structuredContent, { result: { ready: true } })
  assert.deepEqual(calls, [{ operation: 'get_creation_context', params: {} }])
  await Promise.all([client.close(), server.close()])
})

test('creation MCP schemas forbid unknown fields', async () => {
  const server = createCreationMcpServer(async () => ({ ok: true }))
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const tool = (await client.listTools()).tools.find(item => item.name === 'get_creation_context')
  assert.equal(tool.inputSchema.additionalProperties, false)
  assert.deepEqual(tool.inputSchema.properties, {})
  await Promise.all([client.close(), server.close()])
})
