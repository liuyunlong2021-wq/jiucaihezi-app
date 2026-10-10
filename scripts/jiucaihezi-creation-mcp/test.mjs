import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { build } from 'esbuild'

const outfile = '/tmp/jiucaihezi-creation-mcp-test.mjs'
await build({ entryPoints: ['scripts/jiucaihezi-creation-mcp/index.ts'], outfile, bundle: true, platform: 'node', format: 'esm' })
const { createCreationMcpServer, createProxyMcpServer } = await import(`${outfile}?${Date.now()}`)

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
    'get_creation_context', 'list_creation_models', 'get_creation_model', 'get_creation_task', 'list_creation_history',
    'submit_creation_task', 'cancel_creation_task', 'retry_media_persistence', 'add_creation_result_to_canvas',
  ])
  assert.equal(tools.tools.find(tool => tool.name === 'submit_creation_task').annotations.idempotentHint, true)
  assert.equal(tools.tools.find(tool => tool.name === 'submit_creation_task').annotations.readOnlyHint, false)
  assert.match(tools.tools.find(tool => tool.name === 'submit_creation_task').description, /本机绝对路径/)
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

test('proxy MCP publishes the app-owned tool catalog and forwards exact calls', async () => {
  const calls = []
  const bridge = async (operation, params) => {
    calls.push({ operation, params })
    if (operation === 'list_harness_tools') return { tools: [{
      name: 'create_3d_scene', description: '创建场景',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    }] }
    return { content: '已创建' }
  }
  const server = await createProxyMcpServer(bridge, { capabilities: ['3d'] })
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['create_3d_scene'])
  const result = await client.callTool({ name: 'create_3d_scene', arguments: { title: '街道' } })
  assert.equal(result.content[0].text, '已创建')
  assert.deepEqual(calls, [
    { operation: 'list_harness_tools', params: { capabilities: ['3d'] } },
    { operation: 'call_harness_tool', params: { capabilities: ['3d'], name: 'create_3d_scene', arguments: { title: '街道' } } },
  ])
  await Promise.all([client.close(), server.close()])
})

test('creation MCP hides the paid tool unless the mount allows spending', async () => {
  const server = createCreationMcpServer(async () => ({ ok: true }), { allowPaid: false })
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const names = (await client.listTools()).tools.map(tool => tool.name)
  // @排版/@3D 要「把已生成的图放进画布」、要查上下文，但不能拿到会花钱的 submit：
  // 曾经它只挂在 @影音 下，于是只开 @排版 时 add_creation_result_to_canvas 变成
  // unknown tool，模型只能自己找 CLI 硬做。
  assert.ok(names.includes('add_creation_result_to_canvas'))
  assert.ok(names.includes('get_creation_context'))
  assert.ok(!names.includes('submit_creation_task'))
  assert.equal(names.length, 8)
  await Promise.all([client.close(), server.close()])
})
