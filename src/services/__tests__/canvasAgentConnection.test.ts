import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { canvasAgentConnection, createCanvasAgentConnection, canvasToolDescription, isCanvasAgentServer, CANVAS_AGENT_PACKAGE } from '../canvasAgentConnection'
import { callMcpTool, connectMcpServer, disconnectMcpServer, restoreMcpServers } from '../mcpClient'

test('only the preset or a matching stdio package is a canvas connection', () => {
  assert.equal(CANVAS_AGENT_PACKAGE, '@basketikun/canvas-agent@0.6.0')
  assert.equal(isCanvasAgentServer({ id: 'infinite-canvas', transport: 'stdio' }), true)
  assert.equal(isCanvasAgentServer({ id: 'custom', transport: 'stdio', command: 'npx', args: ['-y', `${CANVAS_AGENT_PACKAGE}`, 'mcp'] }), true)
  assert.equal(isCanvasAgentServer({ id: 'custom', transport: 'stdio', command: 'npx', args: ['-y', 'unrelated', 'mcp'] }), false)
  assert.equal(isCanvasAgentServer({ id: 'infinite-canvas', transport: 'sse' }), false)
})

test('prepare is shared and reconnect never implicitly opens a browser', async () => {
  const calls: string[] = []
  const service = createCanvasAgentConnection(async (command) => {
    calls.push(command)
    return { ready: false, projectTitle: '' } as any
  }, 'realm')
  await Promise.all([service.prepare('canvas'), service.prepare('canvas')])
  assert.deepEqual(calls, ['canvas_agent_connect'])
  assert.equal(service.statuses.canvas.ready, false)
  await service.open('canvas')
  assert.equal(calls.at(-1), 'canvas_agent_open')
  await service.release('canvas')
  assert.equal(calls.at(-1), 'canvas_agent_release')
  assert.equal(service.statuses.canvas, undefined)
})

test('cancel during startup releases the eventual native lease and cannot reopen a page', async () => {
  let finish!: (value: any) => void
  const calls: string[] = []
  const service = createCanvasAgentConnection(async (command) => {
    calls.push(command)
    if (command === 'canvas_agent_connect') return await new Promise(resolve => { finish = resolve }) as any
    return {} as any
  }, 'realm')
  const preparing = service.prepare('canvas')
  await service.release('canvas')
  finish({ ready: true, projectTitle: 'test' })
  await assert.rejects(preparing, /取消/)
  assert.equal(calls.filter(c => c === 'canvas_agent_release').length, 2)
  await assert.rejects(service.open('canvas'), /未连接/)
  assert.equal(calls.includes('canvas_agent_open'), false)
})

test('failure permits an explicit retry and does not leave connected state', async () => {
  let attempts = 0
  const service = createCanvasAgentConnection(async command => {
    if (command === 'canvas_agent_connect' && ++attempts === 1) throw Error('协议不匹配')
    return { ready: true, projectTitle: 'test' } as any
  }, 'realm')
  await assert.rejects(service.prepare('canvas'), /协议/)
  assert.equal(service.statuses.canvas, undefined)
  await service.prepare('canvas')
  assert.equal(service.statuses.canvas.projectTitle, 'test')
})

test('canvas tool instructions distinguish submit from success without changing original descriptions', () => {
  const text = canvasToolDescription('canvas_generate_image', 'original')
  assert.ok(text.startsWith('original'))
  assert.match(text, /canvas_generate_image/)
  assert.match(text, /generation_get_status/)
  assert.match(text, /uv/)
  assert.match(text, /不.*换/)
})

test('restore, SDK discovery, tool errors and disconnect share the canvas lifecycle without changing custom IDs', async () => {
  const original = { connect: Client.prototype.connect, listTools: Client.prototype.listTools, callTool: Client.prototype.callTool, close: Client.prototype.close }
  const native = { prepare: canvasAgentConnection.prepare, release: canvasAgentConnection.release, refresh: canvasAgentConnection.refresh }
  const events: string[] = []
  const schema = { type: 'object', properties: { prompt: { type: 'string' } } }
  const server = { id: 'my-existing-canvas', name: '自定义画布', transport: 'stdio' as const, command: 'npx', args: ['-y', CANVAS_AGENT_PACKAGE, 'mcp'], enabled: true, status: 'disconnected' as const }
  Client.prototype.connect = (async () => { events.push('sdk-connect') }) as any
  Client.prototype.listTools = (async () => ({ tools: [{ name: 'canvas_generate_image', description: 'original', inputSchema: schema }] })) as any
  Client.prototype.callTool = (async () => ({ isError: true, content: [{ type: 'text', text: '指定模型不可用' }] })) as any
  Client.prototype.close = async () => { events.push('sdk-close') }
  canvasAgentConnection.prepare = async () => { events.push('prepare') }
  canvasAgentConnection.release = async () => { events.push('release') }
  canvasAgentConnection.refresh = async () => ({ ready: true, projectTitle: 'test' })
  try {
    await restoreMcpServers({
      servers: [server],
      setServerStatus: (_, status) => events.push(status),
      setServerTools: (_, tools) => {
        assert.equal(tools[0].name, 'mcp__my-existing-canvas__canvas_generate_image')
        assert.match(tools[0].description, /original[\s\S]*generation_get_status/)
        assert.deepEqual(tools[0].inputSchema, schema)
      },
    })
    assert.ok(events.indexOf('prepare') < events.indexOf('sdk-connect'))
    assert.equal(events.at(-1), 'connected')
    await assert.rejects(callMcpTool(server.id, `mcp__${server.id}__canvas_generate_image`, {}), /指定模型不可用/)
    assert.equal(events.includes('sdk-close'), false, 'tool rejection must not disconnect or silently retry')
    await disconnectMcpServer(server.id)
    assert.deepEqual(events.slice(-2), ['sdk-close', 'release'])
    Client.prototype.connect = (async () => { throw Error('MCP handshake failed') }) as any
    await assert.rejects(connectMcpServer(server), /handshake failed/)
    assert.equal(events.at(-1), 'release')
  } finally {
    Object.assign(Client.prototype, original)
    Object.assign(canvasAgentConnection, native)
  }
})
