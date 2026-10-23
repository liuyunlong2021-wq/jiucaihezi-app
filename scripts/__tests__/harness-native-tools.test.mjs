import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { apply } from '../../src-tauri/resources/deepseek-harness/plugins/creation-tools/index.mjs'
import { DeepSeekHarness } from '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js'
import { ensureProfilePluginLinks } from '../../src-tauri/resources/deepseek-harness/profile-plugins.mjs'

const root = mkdtempSync(join(tmpdir(), 'jc-native-bridge-'))
await build({ entryPoints: ['src/runtime/direct/creativeToolContract.ts'], bundle: true, alias: { '@': './src' }, platform: 'node', format: 'esm', outfile: join(root, 'contract.mjs') })
const { buildMemoryDesktopToolDefinitions } = await import(join(root, 'contract.mjs'))
await build({ entryPoints: ['scripts/jiucaihezi-creation-mcp/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'mcp.mjs') })
const { createCreationMcpServer } = await import(join(root, 'mcp.mjs'))
const names = ['create_3d_scene', 'inspect_3d_scene', 'edit_3d_scene', 'export_3d_scene_video']
const catalog = buildMemoryDesktopToolDefinitions().filter(t => names.includes(t.function.name))
  .map(t => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }))
let available = true
const requests = []
const http = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  assert.equal(req.headers.authorization, 'Bearer instance-owned-token')
  const body = JSON.parse(Buffer.concat(chunks).toString())
  requests.push(body)
  res.writeHead(available ? 200 : 503, { 'content-type': 'application/json' })
  res.end(JSON.stringify(available ? { result: { tools: catalog } } : { error: 'bridge unavailable' }))
})
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
const discovery = join(root, 'instance-bridge.json')
writeFileSync(discovery, JSON.stringify({ address: `http://127.0.0.1:${http.address().port}`, token: 'instance-owned-token' }), { mode: 0o600 })
const env = { JIUCAIHEZI_BRIDGE_DISCOVERY: discovery }
test.after(async () => { await new Promise(resolve => http.close(resolve)); rmSync(root, { recursive: true, force: true }) })

async function withEnvironment(fn) {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  try { return await fn() } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value }
}

test('native 3D tools bind to their own App without the shared discovery file', async () => {
  await withEnvironment(async () => {
    const registered = []
    await apply({ tools: { register: tool => registered.push(tool.name) } }, { creation: true, allowPaid: false, capabilities: ['3d'] })
    assert.ok(names.every(name => registered.includes(name)))
    assert.ok(!registered.includes('submit_creation_task'))
    assert.equal(requests.at(-1).operation, 'list_harness_tools')
  })
})

test('没有 mediaCatalog 时创作工具只留上下文与画布追加', async () => {
  // @Office / @3D 也会挂创作服务器（历史原因：只开 @Office 时
  // add_creation_result_to_canvas 曾是 unknown tool），但不能顺带看到影音目录。
  const registered = []
  await apply({ tools: { register: tool => registered.push(tool.name) } }, { creation: true, allowPaid: false, mediaCatalog: false, capabilities: [] })
  assert.deepEqual(registered, ['get_creation_context', 'add_creation_result_to_canvas'])
})

test('@影音 之外多注册的只有媒体目录与任务工具', async () => {
  const registered = []
  await apply({ tools: { register: tool => registered.push(tool.name) } }, { creation: true, allowPaid: false, mediaCatalog: true, capabilities: [] })
  assert.ok(registered.includes('list_creation_models'))
  assert.ok(registered.includes('add_creation_result_to_canvas'))
  assert.ok(!registered.includes('submit_creation_task'))
})

test('MCP child processes use the same instance-bound connection instead of global discovery', async () => {
  await withEnvironment(async () => {
    const server = createCreationMcpServer()
    const client = new Client({ name: 'bound-bridge-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({ name: 'get_creation_context', arguments: {} })
      assert.equal(result.isError, undefined)
      assert.equal(requests.at(-1).operation, 'get_creation_context')
    } finally { await Promise.all([client.close(), server.close()]) }
  })
})

test('native tool loading failure is an error instead of silent partial success', async () => {
  await withEnvironment(async () => {
    available = false
    try { await assert.rejects(apply({ tools: { register() {} } }, { creation: true, allowPaid: false, capabilities: ['3d'] }), /bridge unavailable/) }
    finally { available = true }
  })
})

test('real SDK registers the complete 3D schemas and reports missing required tools before model calls', { timeout: 30000 }, async () => {
  const home = join(root, 'home')
  ensureProfilePluginLinks(home, { packages: ['@jiucaihezi/dsh-tool-creation'] })
  const patch = join(root, 'tools.yml')
  writeFileSync(patch, `- insert:\n    - id: jc-tools\n      name: '@jiucaihezi/dsh-tool-creation'\n      config:\n        creation: true\n        allowPaid: false\n        capabilities: [3d]\n`)
  const harness = new DeepSeekHarness({ cwd: root, processCwd: root, dshHome: home, patches: [patch],
    env: { ...process.env, ...env, DSH_TELEMETRY_MODE: 'DISABLED' } })
  try {
    assert.deepEqual(await harness.client.request('session/check-tools', { names }), { ready: true })
    await assert.rejects(harness.client.request('session/check-tools', { names: ['missing_3d_tool'] }), /内置工具未就绪.*missing_3d_tool/)
  } finally { await harness.close() }
})
