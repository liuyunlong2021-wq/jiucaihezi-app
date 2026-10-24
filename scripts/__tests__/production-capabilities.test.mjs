import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { DeepSeekHarness } from '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js'
import { ensureProfilePluginLinks } from '../../src-tauri/resources/deepseek-harness/profile-plugins.mjs'
import { runHarnessTask } from '../../src-tauri/resources/deepseek-harness/run-task.mjs'

const skills = resolve('public/skills')
const core = ['edit', 'glob', 'grep', 'present', 'read', 'skill', 'wiki_read_guidance', 'wiki_save_artifact', 'write']
const groups = JSON.parse(readFileSync(join(skills, 'production-skills.json'), 'utf8'))

async function fixture(t, { image = false, extraPatch = '', extras = false, ownTool = false, assemblyFailure = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jc-production-scope-'))
  const requests = []
  const bridgeCalls = []
  let calls = []
  let gate
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (req.url === '/v1/invoke') {
      bridgeCalls.push(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ result: { content: 'ordinary bridge result', tools: [] } }))
      return
    }
    requests.push(body)
    const pending = gate
    gate = undefined
    if (pending) { pending.arrived.resolve(); await pending.release.promise }
    const call = calls.shift()
    const delta = call ? { role: 'assistant', content: null, tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: 'assistant', content: 'OK' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [value, finish_reason] of [[delta, null], [{}, call ? 'tool_calls' : 'stop']])
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const discovery = join(root, 'bridge.json')
  writeFileSync(discovery, JSON.stringify({ address: `http://127.0.0.1:${server.address().port}`, token: 'local-bridge-token' }))
  if (extras) {
    ensureProfilePluginLinks(join(root, 'home'), { packages: ['@jiucaihezi/dsh-tool-creation', 'dsh-computer-use', 'dsh-experimental-computer-use-cua-driver-native'] })
    const mcp = join(root, 'mcp.mjs')
    writeFileSync(mcp, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
    : message.method === 'tools/list' ? { tools: [{ name: 'fixture_echo', description: 'local fixture', inputSchema: { type: 'object', properties: {} } }] }
    : { content: [{ type: 'text', text: 'local mcp result' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});`)
    extraPatch += `- insert:
    - id: jc-tools
      name: '@jiucaihezi/dsh-tool-creation'
      config:
        creation: true
        allowPaid: true
        mediaCatalog: true
    - id: computer-use
      name: '@deepseek-ai/dsh-computer-use'
    - id: computer-use-cua-driver-native
      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
    - id: fixture-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fixture
        transport: stdio
        command: ${JSON.stringify(process.execPath)}
        args: [${JSON.stringify(mcp)}]
`
  }
  if (ownTool || assemblyFailure) {
    const plugin = join(root, 'own-tool.mjs')
    const toolsModule = new URL('../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-tools/lib/index.js', import.meta.url).href
    writeFileSync(plugin, `import { defineTool } from ${JSON.stringify(toolsModule)};
export const inject = ['tools'];
export function apply(ctx) { ctx.on('agent/created', ({agent}) => {
  const register = () => agent.ctx.tools.register(defineTool({ name: 'unexpected_private_tool', description: 'test own contribution', parameters: {}, output: { schema: { type: 'string' }, render: (_args,value) => [{type:'text',text:value}] }, execute() { throw new Error('must never execute') } }));
  ${assemblyFailure ? `agent.ctx.on('system-prompt/assemble', async () => { throw new Error('fixture assembly unavailable'); });` : 'register();'}
}); }`)
    extraPatch += `- insert:\n    - id: own-tool-fixture\n      name: ${JSON.stringify(pathToFileURL(plugin).href)}\n`
  }
  const patch = join(root, 'route.yml')
  writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      jiucaihezi:\n        apiKeyEnv: JIUCAIHEZI_DH_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models:\n          - id: test\n            name: test\n            contextWindow: 262144\n            maxTokens: 1024\n            input: ${image ? '[text, image]' : '[text]'}\n${extraPatch}`)
  const options = { cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch], provider: 'jiucaihezi', model: 'test', initializeTimeoutMs: 15000,
    env: { ...process.env, DSH_AGENTS_HOME: join(root, 'agents'), DSH_PRIMARY_RUNTIME: '', DSH_TELEMETRY_DISABLED: '1', DSH_BUNDLED_SKILL_DIR: skills, JIUCAIHEZI_DH_API_KEY: 'local-test', JIUCAIHEZI_BRIDGE_DISCOVERY: discovery } }
  const harnesses = []
  const create = () => { const h = new DeepSeekHarness(options); harnesses.push(h); return h }
  const h = create()
  await h.start()
  t.after(async () => {
    await Promise.allSettled(harnesses.map(h => h.close()))
    gate?.release.resolve()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  return { root, requests, bridgeCalls, h, create, pause() {
      const pending = { arrived: Promise.withResolvers(), release: Promise.withResolvers() }
      gate = pending
      t.after(() => pending.release.resolve())
      return { arrived: pending.arrived.promise, release: () => pending.release.resolve() }
    }, plan(value) { calls = [...value] },
    async run(route, { mode = route, sessionId = 'scope', harness = h } = {}) {
      return runHarnessTask(harness, [{ type: 'text', text: '本地工具范围回归，完成后回复 OK。' }], { sessionId, productionMode: mode, productionRoute: route, onNotification() {} })
    },
    tools() { return requests.at(-1).tools.map(t => t.function.name).sort() },
    results() { return requests.at(-1).messages.filter(m => m.role === 'tool').map(m => m.content) },
  }
}

test('three production routes expose only nine text tools under every permission preset', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  for (const route of Object.keys(groups)) for (const preset of ['read-only', 'workspace-write', 'danger-full-access']) {
    const sessionId = `${route}-${preset}`
    await f.h.client.request('session/permission', { sessionId, preset })
    await f.run(route, { sessionId })
    assert.deepEqual(f.tools(), core, `${route}/${preset}`)
    t.diagnostic(`${route}/${preset}: ${JSON.stringify(f.requests.at(-1).tools).length} schema characters`)
  }
})

test('vision adds only read_image and the actual schema stays below the audited budget', { timeout: 30000 }, async t => {
  const f = await fixture(t, { image: true })
  await f.run('manju')
  assert.deepEqual(f.tools(), [...core, 'read_image'].sort())
  assert.ok(JSON.stringify(f.requests[0].tools).length <= 8272)
  const system = f.requests[0].messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
  assert.doesNotMatch(system, /every bash result|background job id|create_goal may infer|Use the workflow tool/)
  t.diagnostic(`manju/vision: ${JSON.stringify(f.requests[0].tools).length} schema characters`)
  for (const route of ['short-drama', 'novel']) {
    await f.run(route)
    assert.deepEqual(f.tools(), [...core, 'read_image'].sort())
    assert.ok(JSON.stringify(f.requests.at(-1).tools).length <= 8272)
    t.diagnostic(`${route}/vision: ${JSON.stringify(f.requests.at(-1).tools).length} schema characters`)
  }
  if (process.env.JC_SCOPE_AUDIT) writeFileSync(process.env.JC_SCOPE_AUDIT, JSON.stringify(f.requests[0], null, 2))
})

test('production scopes deny foreign Skill resources and cross-route artifacts before side effects', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  f.plan([{ name: 'read', args: { file_path: join(skills, 'jc-novel/SKILL.md') } },
    { name: 'wiki_save_artifact', args: { artifact_kind: 'novel_idea', content: '# forbidden novel' } }])
  await f.run('manju')
  assert.match(f.results()[0], /Error:/)
  assert.doesNotMatch(f.results()[0], /小说世界模型/)
  assert.match(f.results()[1], /Error:/)
  const schema = f.requests[0].tools.find(t => t.function.name === 'wiki_save_artifact').function.parameters
  assert.equal(schema.properties.artifact_kind.enum.length, 20)
  assert.equal(schema.properties.chapter_number, undefined)
  assert.equal(schema.properties.user_confirmed, undefined)
})

test('resource discovery excludes foreign project skills and rejects symlink aliases', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const directory = join(f.root, '.agents/skills/foreign')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), '---\nname: foreign\ndescription: foreign capability\n---\nSECRET_FOREIGN_SKILL\n')
  symlinkSync(directory, join(f.root, 'skill-alias'), 'junction')
  writeFileSync(join(f.root, '合法原文.md'), '合法原文保持不变')
  symlinkSync(join(f.root, '合法原文.md'), join(directory, 'escape.md'))
  f.plan([{ name: 'read', args: { file_path: join(f.root, 'skill-alias/SKILL.md') } },
    { name: 'grep', args: { pattern: 'SECRET_FOREIGN_SKILL', path: f.root } },
    { name: 'glob', args: { pattern: '**/SKILL.md', path: f.root } },
    { name: 'read', args: { file_path: join(directory, 'escape.md') } },
    { name: 'write', args: { file_path: join(directory, 'escape.md'), content: 'SHOULD_NOT_WRITE' } }])
  await f.run('manju')
  assert.match(f.results()[0], /Error:/)
  assert.doesNotMatch(f.results().slice(1, 3).join('\n'), /SECRET_FOREIGN_SKILL|foreign[/\\]SKILL\.md/)
  for (const result of f.results().slice(3)) assert.match(result, /Error:/)
  assert.equal(readFileSync(join(f.root, '合法原文.md'), 'utf8'), '合法原文保持不变')
})

test('legal tools still load business methods, save notes and archive the engineering script', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  f.plan([{ name: 'skill', args: { name: 'jc-gongchengjuben' } },
    { name: 'read', args: { file_path: join(skills, 'jc-gongchengjuben/references/shot-visibility.md'), limit: 10 } },
    { name: 'write', args: { file_path: '创作记录.md', content: '暂定草稿\n' } },
    { name: 'edit', args: { file_path: '创作记录.md', old_string: '暂定', new_string: '已选' } },
    { name: 'wiki_save_artifact', args: { artifact_kind: 'engineering_script', episode_number: 1, content: '# 工程台本\n\n镜头1：人物进入房间。\n' } },
    { name: 'present', args: { files: [{ path: 'wiki/剧本/第001集/工程剧本.md' }] } }])
  await f.run('manju')
  assert.equal(f.results().length, 6)
  for (const result of f.results()) assert.doesNotMatch(result, /^Error:/)
  assert.equal(readFileSync(join(f.root, '创作记录.md'), 'utf8'), '已选草稿\n')
  assert.match(f.results()[4], /"status":"saved"/)
  assert.match(f.results()[5], /Presented /)
})

test('single-Skill production keeps its route and cold-resumes it without restricting ordinary peers', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  await f.run('manju', { mode: 'skills:jc-xiangmuziliao' })
  assert.deepEqual(f.tools(), core)
  let snapshot = await f.h.client.request('session/read', { sessionId: 'scope' })
  assert.equal(snapshot.events.findLast(e => e.type === 'user/message' && e.data.source.kind === 'user').data.source.productionRoute, 'manju')
  await f.run('none', { sessionId: 'ordinary' })
  assert.ok(f.tools().includes('bash'))
  await f.h.close()
  const recovered = f.create()
  await recovered.start()
  await recovered.client.prompt('scope', [{ type: 'text', text: '恢复原范围' }])
  await recovered.client.request('session/wait', { sessionId: 'scope' })
  assert.deepEqual(f.tools(), core)
  const resumed = await recovered.client.request('session/read', { sessionId: 'scope' })
  assert.equal(resumed.events.findLast(e => e.type === 'user/message' && e.data.source.kind === 'user').data.source.productionRoute, 'manju')
  await f.run('short-drama', { mode: 'skills:jc-xiangmuziliao', harness: recovered })
  assert.deepEqual(f.tools(), core)
  const kinds = f.requests.at(-1).tools.find(t => t.function.name === 'wiki_save_artifact').function.parameters.properties.artifact_kind.enum
  assert.equal(kinds.length, 14)
  assert.ok(kinds.includes('screenplay'))
  assert.ok(!kinds.includes('engineering_script'))
  await f.run('none', { harness: recovered })
  assert.ok(f.tools().includes('bash'))
})

test('forbidden tool calls never execute and novel confirmation fields remain route-specific', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  f.plan([{ name: 'bash', args: { command: 'printf SHOULD_NOT_EXECUTE' } }])
  await f.run('novel')
  assert.match(f.results()[0], /Error:/)
  assert.doesNotMatch(f.results()[0], /^SHOULD_NOT_EXECUTE/)
  const schema = f.requests[0].tools.find(t => t.function.name === 'wiki_save_artifact').function.parameters
  assert.equal(schema.properties.artifact_kind.enum.length, 16)
  assert.ok(schema.properties.user_confirmed)
  assert.equal(schema.properties.video_model, undefined)
})


test('queued production scope is frozen across edits and cannot steer an ordinary running turn', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const gate = f.pause()
  const running = f.run('none')
  await gate.arrived
  const queued = await f.h.client.request('session/prompt', { sessionId: 'scope', contentBlocks: [{ type: 'text', text: '排队漫剧' }], productionMode: 'skills:jc-xiangmuziliao', productionRoute: 'manju' })
  await f.h.client.request('session/update-queue', { sessionId: 'scope', itemId: queued.messageId, action: { kind: 'edit', content: [{ type: 'text', text: '编辑后的漫剧' }] } })
  await assert.rejects(f.h.client.request('session/update-queue', { sessionId: 'scope', itemId: queued.messageId, action: { kind: 'steer' } }), /不同的创作能力范围/)
  gate.release()
  await running
  await f.h.client.request('session/wait', { sessionId: 'scope' })
  assert.ok(f.requests[0].tools.some(tool => tool.function.name === 'bash'))
  assert.deepEqual(f.tools(), core)
  const snapshot = await f.h.client.request('session/read', { sessionId: 'scope' })
  const source = snapshot.events.findLast(e => e.type === 'user/message' && e.data.source.kind === 'user').data
  assert.equal(source.source.productionRoute, 'manju')
  assert.match(JSON.stringify(source.content), /编辑后的漫剧/)
  await assert.rejects(f.h.client.request('session/prompt', { sessionId: 'scope', contentBlocks: [{ type: 'text', text: '非法组合' }], productionMode: 'skills:jc-novel', productionRoute: 'manju' }), /不属于当前创作路线/)
})

test('entering production pauses an existing goal and stops automatic rounds, retaining ordinary goal tools', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const gate = f.pause()
  f.plan([{ name: 'create_goal', args: { objective: '保留目标测试', max_goal_rounds: 2 } }])
  const running = f.run('none')
  await gate.arrived
  await f.h.client.request('session/prompt', { sessionId: 'scope', contentBlocks: [{ type: 'text', text: '进入小说创作' }], productionMode: 'novel', productionRoute: 'novel' })
  gate.release()
  await running
  await f.h.client.request('session/wait', { sessionId: 'scope' })
  assert.deepEqual(f.tools(), core)
  assert.equal(f.requests.some(request => request.messages.some(message => typeof message.content === 'string' && message.content.includes('<goal_round>'))), false)
  f.plan([{ name: 'get_goal', args: {} }])
  await f.run('none')
  assert.ok(f.tools().includes('create_goal'))
  assert.match(f.results().at(-1), /保留目标测试/)
  assert.match(f.results().at(-1), /paused/)
})

test('ordinary single business Skill selection retains general capabilities and project inputs remain readable', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  writeFileSync(join(f.root, '小说原文.md'), '跨创作路线的合法改编输入')
  f.plan([{ name: 'read', args: { file_path: '小说原文.md' } }])
  await f.run('manju')
  assert.match(f.results()[0], /合法改编输入/)
  await f.run('none', { mode: 'skills:jc-novel', sessionId: 'personal-skill' })
  assert.ok(f.tools().includes('bash'))
  assert.equal(f.requests.at(-1).tools.find(t => t.function.name === 'wiki_save_artifact').function.parameters.properties.artifact_kind.enum.length, 36)
})

test('old capability handshake fails before a prompt is sent', async () => {
  let prompted = false
  const harness = { async start() {}, client: { async request(method) { assert.equal(method, 'session/production-scope'); return { version: 1 } }, subscribeSessionTree() { prompted = true } } }
  await assert.rejects(runHarnessTask(harness, [], { sessionId: 'old', productionMode: 'manju', productionRoute: 'manju', onNotification() {} }), /创作能力隔离/)
  assert.equal(prompted, false)
})


test('an existing runtime with real native creation and MCP tools isolates production and preserves ordinary tools', { timeout: 30000 }, async t => {
  const f = await fixture(t, { extras: true })
  await f.run('none', { sessionId: 'ordinary-with-extras' })
  assert.ok(f.tools().includes('submit_creation_task'))
  assert.ok(f.tools().some(name => name.startsWith('cua_driver_native__')), 'the real computer provider must be loaded')
  assert.ok(f.tools().some(name => name.includes('fixture_echo')), 'the actual MCP provider must be loaded')
  f.plan([{ name: 'get_creation_context', args: {} }])
  await f.run('manju')
  assert.deepEqual(f.tools(), core)
  assert.match(f.results()[0], /Error:/)
  assert.equal(f.bridgeCalls.filter(call => call.operation === 'get_creation_context').length, 0)
  f.plan([{ name: 'get_creation_context', args: {} }])
  await f.run('none', { sessionId: 'ordinary-with-extras' })
  assert.ok(f.tools().includes('submit_creation_task'))
  assert.match(f.results().at(-1), /ordinary bridge result/)
  assert.equal(f.bridgeCalls.filter(call => call.operation === 'get_creation_context').length, 1)
})


test('every bundled Manju package file and shared Wiki guidance remains readable', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])
  }
  const paths = groups.manju.flatMap(name => files(join(skills, name)))
  assert.ok(paths.length >= 49)
  f.plan([...paths.map(file_path => ({ name: 'read', args: { file_path, limit: 1 } })), { name: 'wiki_read_guidance', args: { topic: 'overview' } }])
  await f.run('manju')
  assert.equal(f.results().length, paths.length + 1)
  for (const result of f.results()) assert.doesNotMatch(result, /^Error:/)
})


test('an unexpected Agent-owned tool fails closed before any model request', { timeout: 30000 }, async t => {
  const f = await fixture(t, { ownTool: true })
  await f.run('manju')
  const snapshot = await f.h.client.request('session/read', { sessionId: 'scope' })
  assert.match(JSON.stringify(snapshot.events.filter(e => e.type === 'turn/end')), /未授权工具|工具目录/)
  assert.equal(f.requests.length, 0)
})


for (const outside of [false, true]) test(`changing directory ${outside ? 'outside' : 'inside'} the initial project cannot bypass production Skill guards`, { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const base = outside ? mkdtempSync(join(tmpdir(), 'jc-other-skill-root-')) : f.root
  if (outside) t.after(() => rmSync(base, { recursive: true, force: true }))
  await f.h.client.request('session/permission', { sessionId: 'scope', preset: 'danger-full-access' })
  const foreign = join(base, '.agents/skills/foreign')
  mkdirSync(foreign, { recursive: true })
  const original = '---\nname: foreign\ndescription: private capability\n---\nSECRET_CWD_BYPASS'
  writeFileSync(join(foreign, 'SKILL.md'), original)
  f.plan([{ name: 'working_directory', args: { cd: foreign } }])
  await f.run('none')
  f.plan([{ name: 'read', args: { file_path: 'SKILL.md' } },
    { name: 'write', args: { file_path: 'SKILL.md', content: 'OVERWROTE_FOREIGN_SKILL' } },
    { name: 'glob', args: { pattern: '**/*' } }])
  await f.run('manju')
  const results = f.results().slice(-3)
  for (const result of results) assert.match(result, /Error:/)
  assert.doesNotMatch(results.join('\n'), /SECRET_CWD_BYPASS/)
  assert.equal(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), original)
})

for (const late of [false, true]) test(`failed capability ${late ? 'assembly' : 'preparation'} retains accepted input through cold recovery`, { timeout: 30000 }, async t => {
  const f = await fixture(t, late ? { assemblyFailure: true } : { ownTool: true })
  const accepted = await f.h.client.request('session/prompt', { sessionId: 'retry-scope', productionMode: 'manju', productionRoute: 'manju', contentBlocks: [{ type: 'text', text: 'ACCEPTED_ORIGINAL_ONCE' }] })
  await f.h.client.request('session/wait', { sessionId: 'retry-scope' })
  assert.equal(f.requests.length, 0)
  const pending = snapshot => {
    const inbox = { 'next-turn': [], 'next-step': [] }
    for (const e of snapshot.events) if (e.type === 'agent/inbox/spliced') inbox[e.data.target].splice(e.data.start, e.data.removedCount || 0, ...e.data.inserted)
    return [...inbox['next-step'], ...inbox['next-turn']]
  }
  const first = await f.h.client.request('session/read', { sessionId: 'retry-scope' })
  assert.deepEqual(pending(first).map(m => m.id), [accepted.messageId])
  assert.equal(pending(first)[0].source.productionRoute, 'manju')
  await f.h.close()
  const patch = join(f.root, 'route.yml')
  writeFileSync(patch, readFileSync(patch, 'utf8').split('- insert:')[0])
  const cold = f.create(); await cold.start()
  const restored = await cold.client.request('session/read', { sessionId: 'retry-scope' })
  assert.deepEqual(pending(restored).map(m => m.id), [accepted.messageId])
  await cold.client.prompt('retry-scope', [{ type: 'text', text: 'CONTINUE_AFTER_REPAIR' }])
  await cold.client.request('session/wait', { sessionId: 'retry-scope' })
  const after = await cold.client.request('session/read', { sessionId: 'retry-scope' })
  assert.equal(after.events.filter(e => e.type === 'user/message' && e.data.id === accepted.messageId).length, 1)
  assert.deepEqual(pending(after), [])
  assert.equal(f.requests.filter(r => r.messages.some(m => m.role === 'user' && m.content === 'ACCEPTED_ORIGINAL_ONCE')).length >= 1, true)
})

test('explicit ordinary same-name personal Skills load their own bodies without opening a production group', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  for (const name of ['jc-novel', 'jc-duanju']) {
    const directory = join(f.root, '.agents/skills', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: personally selected capability\n---\nPERSONAL_BODY_${name}`)
    f.plan([{ name: 'skill', args: { name } }])
    await f.run('none', { mode: `skills:${name}`, sessionId: `personal-${name}` })
    assert.ok(f.tools().includes('bash'))
    assert.match(f.results().at(-1), new RegExp(`PERSONAL_BODY_${name}`))
  }
})
