import assert from 'node:assert/strict'
import test from 'node:test'
import { comfyMcpConfig, isComfyMcpServer, runComfyWorkflow, resumeComfyWorkflow, type ComfyWorkflowIO } from '../comfyMcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { callMcpTool, callMcpToolResult, connectMcpServer, disconnectMcpServer } from '../mcpClient'
import { getMcpServerBridgeToolDefinitions } from '@/runtime/tools/mcpBridge'

test('official configuration preserves the target and rejects unsupported targets without downgrade', () => {
  assert.equal(comfyMcpConfig('http://127.0.0.1:8000').env?.COMFY_LOCAL_URL, 'http://127.0.0.1:8000')
  assert.equal(comfyMcpConfig('http://192.168.1.25:8188').env?.COMFY_LOCAL_URL, 'http://192.168.1.25:8188')
  assert.equal(comfyMcpConfig().env?.COMFYUI_URL, '', 'inherited remote target must not override the saved address')
  assert.equal(comfyMcpConfig().env?.COMFYUI_HOST, '')
  assert.equal(comfyMcpConfig().env?.COMFYUI_PORT, '')
  for (const url of ['https://example.test', 'http://localhost:8188/comfy', 'file:///tmp/x', 'http://user:pass@localhost:8188', 'http://localhost:8188/?token=x']) {
    assert.throws(() => comfyMcpConfig(url))
  }
  assert.equal(isComfyMcpServer({ transport: 'stdio', command: 'C:\\Python\\Scripts\\comfy-mcp.exe' }), true)
  assert.equal(isComfyMcpServer({ transport: 'stdio', command: '/tmp/not-comfy-mcp' }), false)
})

function fixture() {
  const calls: Array<[string, Record<string, unknown>]> = []
  const writes: string[] = []
  let waits = 0
  const io: ComfyWorkflowIO = {
    serverId: 'comfyui', target: 'http://127.0.0.1:8000',
    async call(name, args) {
      calls.push([name, args])
      if (name === 'upload_file') return { uploads: [{ cloud_name: 'deduplicated.png', subfolder: 'input' }] }
      if (name === 'run_workflow') return { prompt_id: 'job-1' }
      if (name === 'job') return ++waits === 1 ? { timed_out: true, status: 'running' } : { status: 'completed' }
      if (name === 'fetch_outputs') return { files: [{ path: '/private/output/result.png' }] }
      throw Error(name)
    },
    async write(_id, name) { writes.push(name); return `/private/${name}` },
    async read() { return 'data:image/png;base64,aGVsbG8=' },
    async removeWorkflow() { writes.push('removed') },
  }
  return { io, calls, writes }
}

test('workflow uses official upload, submit, wait and download once; persists recovery before waiting', async () => {
  const { io, calls, writes } = fixture()
  let recovery = ''
  const result = await runComfyWorkflow({ type: 'image', references: ['data:image/png;base64,aA=='], buildWorkflow(names) {
    assert.deepEqual(names, ['input/deduplicated.png']); return { node: { inputs: { text: 'hello' } } }
  }, onSubmitted: async submitted => { recovery = submitted.pollUrl; assert.equal(calls.some(([name]) => name === 'job'), false) } }, io)
  assert.equal(result.taskId, 'job-1')
  assert.match(recovery, /^comfy-mcp:/)
  assert.equal(calls.filter(([name]) => name === 'run_workflow').length, 1)
  assert.equal(calls.filter(([name]) => name === 'job').length, 2)
  assert.ok(writes.includes('removed'))
  assert.equal(result.url, 'data:image/png;base64,aGVsbG8=')
})

test('resume never submits again and refuses a changed target', async () => {
  const { io, calls } = fixture()
  let recovery = ''
  await runComfyWorkflow({ type: 'image', buildWorkflow: () => ({}), onSubmitted: async s => { recovery = s.pollUrl } }, io)
  calls.length = 0
  await resumeComfyWorkflow(recovery, 'job-1', 'image', undefined, undefined, io)
  assert.equal(calls.some(([name]) => name === 'run_workflow'), false)
  await assert.rejects(resumeComfyWorkflow(recovery, 'job-1', 'image', undefined, undefined, { ...io, target: 'http://localhost:9999' }), /地址/)
})

test('cancellation cancels the exact official task and never resubmits', async () => {
  const { io, calls } = fixture()
  const controller = new AbortController()
  await assert.rejects(runComfyWorkflow({ type: 'image', signal: controller.signal, buildWorkflow: () => ({}), onSubmitted: async () => { controller.abort() } }, io), /取消/)
  assert.equal(calls.filter(([name, args]) => name === 'job' && args.action === 'cancel' && args.prompt_id === 'job-1').length, 1)
  assert.equal(calls.filter(([name]) => name === 'run_workflow').length, 1)
})

test('legacy history resumes through official tools at the original target', async () => {
  const { io, calls } = fixture()
  await resumeComfyWorkflow('http://127.0.0.1:8000/history/job-1', 'job-1', 'image', undefined, undefined, io)
  assert.equal(calls.some(([name]) => name === 'run_workflow'), false)
  await assert.rejects(resumeComfyWorkflow('http://127.0.0.1:9000/history/job-1', 'job-1', 'image', undefined, undefined, io), /地址/)
})

test('official text_outputs preserves a custom workflow CDN video result', async () => {
  const { io, calls } = fixture()
  const original = io.call
  io.call = async (name, args) => name === 'job' ? { status: 'completed', text_outputs: { '18': ['https://cdn.example.test/result.mp4?token=test'] } } : original(name, args)
  const result = await runComfyWorkflow({ type: 'video', buildWorkflow: () => ({}) }, io)
  assert.equal(result.url, 'https://cdn.example.test/result.mp4?token=test')
  assert.equal(calls.some(([name]) => name === 'fetch_outputs'), false)
})

test('upstream rejection and unknown status never cause a second submit; private workflow is removed', async () => {
  const { io, calls, writes } = fixture()
  const original = io.call
  io.call = async (name, args) => name === 'job' ? { status: 'unknown' } : original(name, args)
  await assert.rejects(runComfyWorkflow({ type: 'image', buildWorkflow: () => ({}) }, io), /终态/)
  assert.equal(calls.filter(([name]) => name === 'run_workflow').length, 1)
  assert.ok(writes.includes('removed'))
})

test('an explicit upstream failure is terminal rather than queued for recovery', async () => {
  const { io } = fixture()
  const original = io.call
  io.call = async (name, args) => name === 'job' ? { status: 'failed', error: { message: 'missing model' } } : original(name, args)
  await assert.rejects(runComfyWorkflow({ type: 'image', buildWorkflow: () => ({}) }, io), error => {
    assert.equal((error as any).terminalCreationTask, true)
    assert.match((error as Error).message, /missing model/)
    return true
  })
})

test('SDK bridge preserves official schemas, mixed content and tool errors without reconnecting', async () => {
  const original = { connect: Client.prototype.connect, listTools: Client.prototype.listTools, callTool: Client.prototype.callTool, close: Client.prototype.close, getInstructions: Client.prototype.getInstructions }
  const schema = { type: 'object', properties: { workflow_path: { type: 'string' } }, required: ['workflow_path'] }
  let closes = 0
  Client.prototype.connect = (async () => {}) as any
  Client.prototype.close = async () => { closes++ }
  Client.prototype.listTools = (async () => ({ tools: [{ name: 'run_workflow', description: 'official description', inputSchema: schema }] })) as any
  Client.prototype.getInstructions = () => 'Official session instructions: call server_info first.'
  const content = [{ type: 'text', text: '{"prompt_id":"job-1"}' }, { type: 'image', mimeType: 'image/png', data: 'aA==' }]
  Client.prototype.callTool = (async () => ({ content })) as any
  try {
    const config = { ...comfyMcpConfig(), enabled: true, status: 'disconnected' as const }
    const tools = await connectMcpServer(config)
    assert.deepEqual(tools[0].inputSchema, schema)
    assert.equal(tools[0].description, 'official description')
    assert.match(getMcpServerBridgeToolDefinitions({ store: { allMcpTools: tools, isServerEnabled: () => true, isServerConnected: () => true } })[0].function.description!, /Official session instructions/)
    assert.deepEqual((await callMcpToolResult(config.id, 'run_workflow', {})).content, content)
    assert.deepEqual(JSON.parse(await callMcpTool(config.id, 'run_workflow', {})), content)
    Client.prototype.callTool = (async () => ({ isError: true, content: [{ type: 'text', text: 'missing node' }] })) as any
    await assert.rejects(callMcpToolResult(config.id, 'run_workflow', {}), /missing node/)
    assert.equal(closes, 0)
    await disconnectMcpServer(config.id)
    assert.equal(closes, 1)
  } finally { Object.assign(Client.prototype, original) }
})
