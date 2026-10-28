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
    async run(route, { mode = route, sessionId = 'scope', harness = h, text = '本地工具范围回归，完成后回复 OK。' } = {}) {
      return runHarnessTask(harness, [{ type: 'text', text }], { sessionId, productionMode: mode, productionRoute: route, onNotification() {} })
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

test('actual SDK saves and replaces creative artifacts, restores autosave scope, and leaves ordinary chat manual', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const cases = [
    ['manju', { artifact_kind: 'engineering_script', episode_number: 1 }, 'wiki/剧本/工程剧本/第1集工程剧本.md'],
    ['short-drama', { artifact_kind: 'story_summary', research_version: 'original' }, 'wiki/项目资料/原作/故事梗概.md'],
    ['novel', { artifact_kind: 'novel_outline' }, 'wiki/创作/大纲.md'],
  ]
  for (const [route, artifact, path] of cases) {
    await f.h.client.request('session/permission', { sessionId: route, preset: 'workspace-write' })
    f.plan([{ name: 'wiki_save_artifact', args: { ...artifact, content: '# 初稿' } }])
    await f.run(route, { sessionId: route })
    assert.equal(readFileSync(join(f.root, path), 'utf8').trim(), '# 初稿')
    const system = f.requests.at(-1).messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
    assert.match(system, /完整创作产物必须调用 wiki_save_artifact 自动保存/)
    f.plan([...(route === 'short-drama' ? [{ name: 'read', args: { file_path: join(f.root, path) } }] : []), { name: 'wiki_save_artifact', args: { ...artifact, content: '# 修改稿' } }])
    await f.run(route, { sessionId: route })
    assert.equal(readFileSync(join(f.root, path), 'utf8').trim(), '# 修改稿')
    assert.match(f.results().at(-1), /"operation":"updated"/)
    assert.deepEqual(f.tools(), core)
  }
  await f.h.close()
  const restored = f.create()
  f.plan([{ name: 'wiki_save_artifact', args: { artifact_kind: 'novel_outline', content: '# 冷恢复修订' } }])
  await f.run('novel', { sessionId: 'novel', harness: restored })
  assert.match(readFileSync(join(f.root, 'wiki/创作/大纲.md'), 'utf8'), /冷恢复修订/)
  await f.run('none', { mode: 'none', sessionId: 'ordinary', harness: restored })
  assert.match(f.requests.at(-1).messages.filter(message => message.role === 'system').map(message => message.content).join('\n'), /普通模式不自动归档/)
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
  assert.equal(schema.properties.artifact_kind.enum.length, 27)
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
    { name: 'present', args: { files: [{ path: 'wiki/剧本/工程剧本/第1集工程剧本.md' }] } }])
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
  assert.equal(kinds.length, 20)
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
  assert.equal(f.requests.at(-1).tools.find(t => t.function.name === 'wiki_save_artifact').function.parameters.properties.artifact_kind.enum.length, 48)
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
  for (const name of groups.manju) assert.ok(paths.includes(join(skills, name, 'SKILL.md')))
  assert.ok(paths.length > groups.manju.length)
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

test('actual SDK resumes a stopped pipeline until verified completion for both models', { timeout: 60000 }, async t => {
  const f = await fixture(t)
  writeFileSync(join(f.root, '剧本.md'), '# 来源剧本\n主角归来')
  for (const model of ['H3', 'Seedance']) {
    const calls = [{ name: 'skill', args: { name: 'jc-manju-pipeline' } }, null]
    const save = (args, content) => calls.push({ name: 'wiki_save_artifact', args: { ...args, content } })
    const checkpoint = data => save({ artifact_kind: 'pipeline_checkpoint', video_model: model, episode_number: 1 }, JSON.stringify(data))
    checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] })
    save({ artifact_kind: 'story_summary' }, '# 故事梗概\n主角归来')
    save({ artifact_kind: 'scene_research', entity_name: '山门' }, '# 山门说明')
    checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/故事梗概.md', 'wiki/项目资料/场景说明/山门.md'] })
    calls.push(null) // A model final answer must not end an unfinished pipeline.
    calls.push({ name: 'read', args: { file_path: join(f.root, 'wiki/项目资料/故事梗概.md') } })
    save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n比例：9:16\n风格：二维动画')
    checkpoint({ stage: 'style', outputs: ['wiki/项目风格/影片比例与风格.md'] })
    calls.push(...['wiki/项目风格/影片比例与风格.md', 'wiki/项目资料/场景说明/山门.md'].map(path => ({ name: 'read', args: { file_path: join(f.root, path) } })))
    save({ artifact_kind: 'scene_asset', entity_name: '山门' }, '# 山门提示词')
    checkpoint({ stage: 'assets', outputs: ['wiki/资产/场景/山门/场景生图提示词.md'] })
    calls.push({ name: 'read', args: { file_path: join(f.root, '剧本.md') } })
    save({ artifact_kind: 'engineering_script', episode_number: 1 }, '# 工程剧本\n比例：9:16\n风格：二维动画\n资产清单：山门\n镜头1')
    checkpoint({ stage: 'engineering', outputs: ['wiki/剧本/工程剧本/第1集工程剧本.md'], duration_seconds: 10 })
    calls.push({ name: 'read', args: { file_path: join(f.root, 'wiki/剧本/工程剧本/第1集工程剧本.md') } })
    calls.push({ name: 'read', args: { file_path: join(f.root, 'wiki/资产/场景/山门/场景生图提示词.md') } })
    const path = `wiki/剧本/视频提示词/${model}/第1集001视频提示词.md`
    if (model === 'Seedance') save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: model, segment: '001' }, '# 第一段\n没有参考图，省略图号')
    save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: model, segment: '001' }, model === 'H3' ? 'subject_definitions\n<Picture 1> is the 山门 environment, blue-gray stone gate above clouds.\nsummary\nA still establishing shot of <Picture 1>.' : '古装宗门云海中的电影片段。\n@图1：山门，青灰石门与云海。\n山门位于画面中央，@图1石台通向门内。\n【全局设定】\n日间，9:16二维动画，左上日光。\n【时间戳剧本分镜】\n镜头1【0—10秒】：【建立】 ｜ 全景，固定 ｜ @图1山门空镜。\n【全局补充】\n保持光向一致，无字幕和BGM。')
    checkpoint({ stage: 'prompts', outputs: [path], segments: [{ path, start_seconds: 0, end_seconds: 10, refs: ['场景/山门'] }] })
    checkpoint({ stage: 'complete', outputs: [] })
    f.plan(calls)
    await f.run('manju', { sessionId: 'pipeline-both-models' })
    const progress = JSON.parse(readFileSync(join(f.root, `wiki/制作流水线/${model}/第1集进度.json`), 'utf8'))
    assert.equal(progress.stage, 'complete')
    assert.equal(progress.status, 'completed')
    // 纯文生段可以没有 @图 行（2026-10-26），但仍须五模块交付。
    if (model === 'Seedance') assert.ok(f.results().some(result => /五模块/.test(String(result))))
    assert.ok(f.requests.some(request => JSON.stringify(request.messages).includes('流水线尚未完成')))
    assert.ok(f.results().every(result => !String(result).includes('前置阶段')))
  }
})

test('pipeline resumes saved stage after SDK restart and respects a blocked checkpoint', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  writeFileSync(join(f.root, '剧本.md'), '# 来源')
  const checkpoint = data => ({ name: 'wiki_save_artifact', args: { artifact_kind: 'pipeline_checkpoint', video_model: 'Seedance', episode_number: 1, content: JSON.stringify(data) } })
  f.plan([checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [], status: 'blocked', reason: '等待确认风格' })])
  await f.run('manju', { sessionId: 'recover-pipeline' })
  const progressPath = join(f.root, 'wiki/制作流水线/Seedance/第1集进度.json')
  assert.equal(JSON.parse(readFileSync(progressPath, 'utf8')).status, 'blocked')
  await f.h.close()
  const restored = f.create()
  await restored.start()
  f.plan([
    { name: 'read', args: { file_path: progressPath } },
    { name: 'wiki_save_artifact', args: { artifact_kind: 'story_summary', content: '# 故事梗概\n主角归来' } },
    checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/故事梗概.md'], status: 'blocked', reason: '等待用户提供已确认比例' }),
  ])
  await f.run('manju', { sessionId: 'recover-pipeline', harness: restored })
  const saved = JSON.parse(readFileSync(progressPath, 'utf8'))
  assert.equal(saved.stage, 'materials')
  assert.equal(saved.status, 'blocked')
  assert.equal(saved.reason, '等待用户提供已确认比例')
})

test('pipeline rejects asset writes without actual Wiki reads and rejects reads made stale by an edit', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  writeFileSync(join(f.root, '剧本.md'), '# 原文\n甲归来')
  const save = (artifact_kind, content, extra = {}) => ({ name: 'wiki_save_artifact', args: { artifact_kind, content, ...extra } })
  const checkpoint = data => save('pipeline_checkpoint', JSON.stringify(data), { episode_number: 1, video_model: 'Seedance' })
  const read = path => ({ name: 'read', args: { file_path: join(f.root, path) } })
  const actor = save('character_asset', '# 甲提示词', { entity_name: '甲' })
  f.plan([
    checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] }),
    save('story_summary', '# 故事梗概\n甲归来'),
    save('character_bio', '# 甲\n主角归来', { entity_name: '甲' }),
    checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/故事梗概.md', 'wiki/项目资料/人物小传/甲.md'] }),
    read('wiki/项目资料/故事梗概.md'),
    save('film_style', '# 影片比例与风格\n比例：9:16\n风格：二维'),
    checkpoint({ stage: 'style', outputs: ['wiki/项目风格/影片比例与风格.md'] }), actor,
  ])
  await f.run('manju', { sessionId: 'read-gate' })
  assert.match(f.results().at(-1), /精准读取缺失/)
  assert.throws(() => readFileSync(join(f.root, 'wiki/资产/角色/甲/角色生图提示词.md')))
  f.plan([read('wiki/项目风格/影片比例与风格.md'), read('wiki/项目资料/人物小传/甲.md'),
    { name: 'write', args: { file_path: join(f.root, 'wiki/项目资料/人物小传/甲.md'), content: '# 甲\n修改后的设定' } }, actor])
  await f.run('manju', { sessionId: 'read-gate' })
  assert.match(f.results().at(-1), /精准读取缺失或已过期/)
  f.plan([read('wiki/项目风格/影片比例与风格.md'), read('wiki/项目资料/人物小传/甲.md'), actor])
  await f.run('manju', { sessionId: 'read-gate' })
  assert.match(f.results().at(-1), /"status":"saved"/)
})

test('short-drama pipeline uses real chapter cuts, enforces reads, continues and completes every target episode', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const a = '顾云舟穿着青色旧袍，手握旧剑站在门前，听见门外的呼喊。'
  const b = '他看清来者的金色眼睛和暗红长裙，握剑的手慢慢放下，转身逃走。'
  const outside = '第二章独有的远方援军抵达，此信息绝不进入第一章分集。'
  writeFileSync(join(f.root, '原作.md'), `第一章 山门\r\n${a}\r\n${b}\r\n第二章 援军\r\n${outside}`)
  const calls = []
  const read = path => calls.push({ name: 'read', args: { file_path: join(f.root, path) } })
  const save = (artifact_kind, content, extra = {}) => calls.push({ name: 'wiki_save_artifact', args: { artifact_kind, content, ...extra } })
  const checkpoint = input => save('adaptation_checkpoint', JSON.stringify(input))
  calls.push({ name: 'skill', args: { name: 'jc-duanju-pipeline' } })
  read('原作.md')
  save('source_material', JSON.stringify({ source_path: '原作.md' }), { work_name: '原作' })
  const originalCopy = 'wiki/原始材料/原作/原文.md'
  read(originalCopy)
  checkpoint({ stage: 'source', source_paths: [originalCopy], chapters: [{ source_path: originalCopy, chapter_heading: '第一章 山门' }], outputs: [] })
  save('story_summary', '# 原作梗概\n顾云舟在门前遇到来者后逃走。', { research_version: 'original' })
  save('character_bio', '# 顾云舟\n青色旧袍，握剑后逃走；五官原文未交代。', { research_version: 'original', entity_name: '顾云舟' })
  checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md', 'wiki/项目资料/原作/人物小传/顾云舟.md'] })
  calls.push(null)
  read('wiki/项目资料/原作/故事梗概.md')
  save('project_overview', '# 改编方案\n主题：莫欺少年穷。保持原作事件、服装和认知，以动作表现畏惧。')
  read('wiki/改编方案/项目总纲.md')
  save('adaptation_episode_plan', '# 分集规划\n第1集门前呼喊；第2集看清来者后逃走，不取第二章。')
  const plan = 'wiki/改编方案/分集规划.md'
  checkpoint({ stage: 'scheme', outputs: ['wiki/改编方案/项目总纲.md'] })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户审阅规划书', outputs: ['wiki/改编方案/项目总纲.md', plan] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'chapter-pipeline' })
  assert.ok(f.results().some(result => /缺少分集规划/.test(String(result))))
  assert.ok(f.requests.some(request => JSON.stringify(request.messages).includes('按jc-duanju-pipeline继续')))
  assert.match(JSON.stringify(f.requests.at(-1).messages.at(-1)), /"status\\":\\"saved/)
  assert.equal(JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8')).status, 'review')
  calls.length = 0
  read(originalCopy)
  checkpoint({ stage: 'scheme', outputs: ['wiki/改编方案/项目总纲.md', plan] })
  for (const index of [0, 1]) save('adaptation_cut', JSON.stringify({ segments: [{ source_path: originalCopy, chapter_heading: '第一章 山门', start_line: index + 2, end_line: index + 2 }] }), { episode_number: index + 1 })
  const cuts = ['wiki/改编方案/分集切分/第001集原文.md', 'wiki/改编方案/分集切分/第002集原文.md']
  checkpoint({ stage: 'cuts', episodes: [1], outputs: [cuts[0]] })
  checkpoint({ stage: 'cuts', episodes: [1, 2], outputs: cuts })
  calls.push(null)
  save('screenplay', '# 未读切分的错误稿', { episode_number: 1 })
  read('wiki/改编方案/项目总纲.md')
  read(plan)
  read('wiki/项目资料/原作/人物小传/顾云舟.md')
  read(cuts[0])
  save('screenplay', '# 第1集\n顾云舟站在门前，旧袍袖口随握剑的手收紧；呼喊从门外传来。', { episode_number: 1 })
  read(cuts[1])
  save('screenplay', '# 第2集\n顾云舟看清金瞳与暗红长裙，慢慢松开握剑的手，转身逃走。', { episode_number: 2 })
  const scripts = ['wiki/剧本/第001集/分集剧本.md', 'wiki/剧本/第002集/分集剧本.md']
  checkpoint({ stage: 'writing', outputs: scripts })
  checkpoint({ stage: 'complete', outputs: [] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'chapter-pipeline' })
  const state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.equal(state.stage, 'complete')
  assert.equal(state.status, 'completed')
  assert.deepEqual(state.episodes, [1, 2])
  for (const path of cuts) assert.doesNotMatch(readFileSync(join(f.root, path), 'utf8'), /远方援军抵达/)
  assert.ok(f.results().some(result => /必须先实际read/.test(String(result))))
  assert.deepEqual(state.unused, [])
  assert.ok(f.requests.some(request => JSON.stringify(request.messages).includes('按jc-duanju-pipeline继续')))
  assert.deepEqual(f.tools(), core)
  await f.h.close()
  const restored = f.create()
  f.plan([{ name: 'read', args: { file_path: join(f.root, 'wiki/改编方案/执行进度.json') } },
    { name: 'wiki_save_artifact', args: { artifact_kind: 'adaptation_checkpoint', content: JSON.stringify({ stage: 'complete', outputs: [] }) } }])
  await f.run('short-drama', { sessionId: 'chapter-pipeline', harness: restored })
  assert.match(f.results().at(-1), /"status":"saved"/)
  writeFileSync(join(f.root, originalCopy), '第一章 山门\n用户修改后的原作，不再对应旧切分。')
  f.plan([{ name: 'wiki_save_artifact', args: { artifact_kind: 'adaptation_checkpoint', content: JSON.stringify({ stage: 'complete', outputs: [] }) } }])
  await f.run('short-drama', { sessionId: 'chapter-pipeline', harness: restored })
  assert.match(f.results().at(-1), /原作已改变/)
})

test('short-drama writing may refresh registered adapted research but never original material, and borrows only design Skills', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const body = '顾云舟穿着青色旧袍，手握旧剑站在门前，听见门外的呼喊。'
  writeFileSync(join(f.root, '原作.md'), `第一章 山门\n${body}`)
  const calls = []
  const read = path => calls.push({ name: 'read', args: { file_path: path.startsWith('/') ? path : join(f.root, path) } })
  const save = (artifact_kind, content, extra = {}) => calls.push({ name: 'wiki_save_artifact', args: { artifact_kind, content, ...extra } })
  const checkpoint = input => save('adaptation_checkpoint', JSON.stringify(input))
  const original = 'wiki/原始材料/原作/原文.md', cut = 'wiki/改编方案/分集切分/第001集原文.md', script = 'wiki/剧本/第001集/分集剧本.md'
  const adapted = 'wiki/项目资料/改编版/人物小传/顾云舟.md', originalBio = 'wiki/项目资料/原作/人物小传/顾云舟.md'
  read(join(skills, 'jc-juese-sheji/SKILL.md'))
  read(join(skills, 'jc-seedance/SKILL.md'))
  read('原作.md')
  save('source_material', JSON.stringify({ source_path: '原作.md' }), { work_name: '原作' })
  read(original)
  checkpoint({ stage: 'source', source_paths: [original], outputs: [] })
  save('story_summary', '# 原作梗概\n顾云舟在门前听见呼喊。', { research_version: 'original' })
  save('character_bio', '# 顾云舟\n青色旧袍；五官原文未交代。', { research_version: 'original', entity_name: '顾云舟' })
  checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md', originalBio] })
  read('wiki/项目资料/原作/故事梗概.md')
  save('project_overview', '# 改编方案\n忠实原作，每集不超过3分钟。')
  save('character_bio', '# 顾云舟（改编版）\n五官：设计待逐集补充。', { research_version: 'adapted', entity_name: '顾云舟' })
  read('wiki/改编方案/项目总纲.md')
  save('adaptation_episode_plan', '# 分集规划\n第1集。')
  checkpoint({ stage: 'scheme', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md', adapted] })
  save('adaptation_cut', JSON.stringify({ segments: [{ source_path: original, chapter_heading: '第一章 山门', start_line: 2, end_line: 2 }] }), { episode_number: 1 })
  checkpoint({ stage: 'cuts', episodes: [1], outputs: [cut] })
  read('wiki/改编方案/分集规划.md')
  read(cut)
  read(adapted)
  save('screenplay', '# 第1集\n顾云舟立在门前，青色旧袍袖口随握剑的手收紧。', { episode_number: 1 })
  save('character_bio', '# 顾云舟（改编版）\n五官：设计——窄长脸，眉骨略高。首次出场：第1集。', { research_version: 'adapted', entity_name: '顾云舟' })
  checkpoint({ stage: 'writing', outputs: [script] })
  checkpoint({ stage: 'writing', outputs: [script, adapted] })
  read(originalBio)
  save('character_bio', '# 顾云舟\n被误写进原作的设计五官。', { research_version: 'original', entity_name: '顾云舟' })
  checkpoint({ stage: 'writing', outputs: [script, adapted, originalBio] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'adapted-refresh' })
  const results = f.results().map(String)
  assert.doesNotMatch(results[0], /Error:/)
  assert.match(results[1], /Error:/)
  const writing = results.filter((result, index) => calls[index]?.args?.artifact_kind === 'adaptation_checkpoint' && calls[index].args.content.includes('"writing"'))
  assert.match(writing[0], /前置产物已改变/)
  assert.match(writing[1], /"status":"saved"/)
  assert.match(writing[2], /前置产物已改变/)
  const state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.equal(state.stage, 'writing')
  assert.ok(state.files.writing[join(f.root, adapted)] ?? state.files.writing[adapted])
})

test('short-drama source expands a chapter range, cuts a heading-less short story as the whole text, and allows skipped text and flashbacks', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  writeFileSync(join(f.root, '长篇.md'), '第1章 开端\n甲在门前。\n第2章 相遇\n乙走进来。\n第3章 离别\n丙转身离开。\n第4章 后记\n范围外。\n')
  writeFileSync(join(f.root, '短篇.md'), '林晚推开雨夜的店门。\n这座城的设定介绍，长达三页。\n店主认出她手里的旧照片。\n她把照片拍在柜台上。\n')
  const calls = []
  const read = path => calls.push({ name: 'read', args: { file_path: join(f.root, path) } })
  const save = (artifact_kind, content, extra = {}) => calls.push({ name: 'wiki_save_artifact', args: { artifact_kind, content, ...extra } })
  const checkpoint = input => save('adaptation_checkpoint', JSON.stringify(input))
  const cut = (episode_number, segments) => save('adaptation_cut', JSON.stringify({ segments: segments.map(([start_line, end_line, flashback]) => ({ source_path: '短篇.md', chapter_heading: '全文', start_line, end_line, ...(flashback ? { flashback } : {}) })) }), { episode_number })
  const cutStage = n => checkpoint({ stage: 'cuts', episodes: Array.from({ length: n }, (_, i) => i + 1), outputs: Array.from({ length: n }, (_, i) => `wiki/改编方案/分集切分/第00${i + 1}集原文.md`) })
  read('长篇.md')
  checkpoint({ stage: 'source', source_paths: ['长篇.md'], chapter_range: { source_path: '长篇.md', from: '第1章 开端', to: '第3章 离别' }, outputs: [] })
  save('story_summary', '# 梗概\n甲乙丙。', { research_version: 'original' })
  checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md'] })
  read('wiki/项目资料/原作/故事梗概.md')
  save('project_overview', '# 总纲')
  read('wiki/改编方案/项目总纲.md')
  save('adaptation_episode_plan', '# 分集规划\n已规划到第2章。')
  checkpoint({ stage: 'scheme', planned_through: '第4章 后记', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md'] })
  checkpoint({ stage: 'scheme', planned_through: '第2章 相遇', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md'] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'range' })
  const state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.deepEqual(state.chapters.map(item => item.chapter_heading), ['第1章 开端', '第2章 相遇', '第3章 离别'])
  assert.match(f.results().at(-2), /planned_through/)
  assert.equal(state.planned_through, '第2章 相遇')

  rmSync(join(f.root, 'wiki'), { recursive: true, force: true })
  calls.length = 0
  read('短篇.md')
  checkpoint({ stage: 'source', source_paths: ['短篇.md'], outputs: [] })
  save('story_summary', '# 梗概\n林晚找店主要答案。', { research_version: 'original' })
  checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md'] })
  read('wiki/项目资料/原作/故事梗概.md')
  save('project_overview', '# 改编方案\n主题与人物。')
  read('wiki/改编方案/项目总纲.md')
  save('adaptation_episode_plan', '# 分集规划\n第1集倒叙开场；删减第2行设定。')
  checkpoint({ stage: 'scheme', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md'] })
  cut(1, [[3, 3], [1, 1]])
  cut(2, [[4, 4]])
  cutStage(2)
  cut(1, [[1, 1], [3, 3]])
  cut(2, [[3, 4]])
  cutStage(2)
  cut(1, [[4, 4, true], [1, 1]])
  cut(2, [[3, 4]])
  cutStage(2)
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'whole' })
  const results = f.results().map(String)
  const stages = results.filter((_, index) => calls[index]?.args?.artifact_kind === 'adaptation_checkpoint' && calls[index].args.content.includes('"cuts"'))
  assert.match(stages[0], /顺序|重叠/)
  assert.match(stages[1], /顺序|重叠/)
  assert.match(stages[2], /"status":"saved"/)
  const whole = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.equal(whole.stage, 'cuts')
  assert.deepEqual(whole.chapters.map(item => item.chapter_heading), ['全文'])
  assert.deepEqual(whole.unused.map(item => [item.chapter_heading, item.start_line, item.end_line]), [['全文', 2, 2]])
  const first = readFileSync(join(f.root, 'wiki/改编方案/分集切分/第001集原文.md'), 'utf8')
  assert.ok(first.indexOf('她把照片拍在柜台上') < first.indexOf('林晚推开雨夜的店门'))
  assert.match(first, /倒叙/)
})

test('short-drama uses split chapter nodes as sources in chapter-number order, host-driven turns are not nudged, and planning may refresh research', { timeout: 60000 }, async t => {
  const f = await fixture(t)
  const dir = join(f.root, 'wiki/原始材料/作品/原文节点/0001-0100')
  mkdirSync(dir, { recursive: true })
  const node = (name, heading, body) => writeFileSync(join(dir, name), `---\ntype: story-source-node\ntitle: "${heading}"\n---\n\n${heading}\n\n${body}\n`)
  node('0001_设定.md', '第0章 设定', '设定介绍。')
  node('0002_风向标.md', '第3章 风向标', '丙在田里。')
  node('0003_树洞.md', '第2章 树洞', '乙进树洞。')
  node('0004_无尽之塔.md', '第1章 无尽之塔', '甲被传送。')
  writeFileSync(join(dir, 'index.md'), '# 章节')
  writeFileSync(join(f.root, 'wiki/index.md'), '# Wiki')
  const nodes = 'wiki/原始材料/作品/原文节点/0001-0100'
  const calls = []
  const read = path => calls.push({ name: 'read', args: { file_path: join(f.root, path) } })
  const save = (artifact_kind, content, extra = {}) => calls.push({ name: 'wiki_save_artifact', args: { artifact_kind, content, ...extra } })
  const checkpoint = input => save('adaptation_checkpoint', JSON.stringify(input))
  const seg = (file, heading) => ({ source_path: `${nodes}/${file}`, chapter_heading: heading, start_line: 8, end_line: 8 })
  checkpoint({ stage: 'source', source_paths: [nodes], chapter_range: { from: '第1章 无尽之塔', to: '第2章 树洞' }, outputs: [] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'nodes', text: '【全自动改编·规划】「第1章 无尽之塔」至「第2章 树洞」：只做这一步。' })
  let state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.deepEqual(state.chapters.map(item => item.chapter_heading), ['第1章 无尽之塔', '第2章 树洞'])
  assert.equal(state.chapters[0].source_path.endsWith('0004_无尽之塔.md'), true)
  assert.deepEqual(state.source_inputs, [nodes])
  assert.ok(!f.requests.some(request => JSON.stringify(request.messages).includes('按jc-duanju-pipeline继续')), '全自动指令不触发自动续跑提醒')

  calls.length = 0
  checkpoint({ stage: 'source', source_paths: [nodes], outputs: [] })
  save('story_summary', '# 梗概\n甲乙丙。', { research_version: 'original' })
  save('character_bio', '# 甲\n第1章。', { research_version: 'original', entity_name: '甲' })
  checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md', 'wiki/项目资料/原作/人物小传/甲.md'] })
  read('wiki/项目资料/原作/故事梗概.md')
  save('project_overview', '# 总纲')
  read('wiki/改编方案/项目总纲.md')
  save('adaptation_episode_plan', '# 分集规划')
  checkpoint({ stage: 'scheme', planned_through: '第1章 无尽之塔', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md'] })
  read('wiki/项目资料/原作/人物小传/甲.md')
  save('character_bio', '# 甲\n第1章；第2章补充。', { research_version: 'original', entity_name: '甲' })
  checkpoint({ stage: 'scheme', planned_through: '第2章 树洞', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md'] })
  checkpoint({ stage: 'scheme', planned_through: '第2章 树洞', outputs: ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md', 'wiki/项目资料/原作/人物小传/甲.md'] })
  read(`${nodes}/0003_树洞.md`)
  read(`${nodes}/0004_无尽之塔.md`)
  save('adaptation_cut', JSON.stringify({ segments: [seg('0003_树洞.md', '第2章 树洞')] }), { episode_number: 1 })
  save('adaptation_cut', JSON.stringify({ segments: [seg('0004_无尽之塔.md', '第1章 无尽之塔')] }), { episode_number: 2 })
  checkpoint({ stage: 'cuts', episodes: [1, 2], outputs: ['wiki/改编方案/分集切分/第001集原文.md', 'wiki/改编方案/分集切分/第002集原文.md'] })
  save('adaptation_cut', JSON.stringify({ segments: [seg('0004_无尽之塔.md', '第1章 无尽之塔')] }), { episode_number: 1 })
  save('adaptation_cut', JSON.stringify({ segments: [seg('0003_树洞.md', '第2章 树洞')] }), { episode_number: 2 })
  checkpoint({ stage: 'cuts', episodes: [1, 2], outputs: ['wiki/改编方案/分集切分/第001集原文.md', 'wiki/改编方案/分集切分/第002集原文.md'] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'nodes2', text: '【全自动改编·规划】继续。' })
  const results = f.results().map(String)
  const stages = results.filter((_, index) => calls[index]?.args?.artifact_kind === 'adaptation_checkpoint')
  assert.match(stages[0], /"status":"saved"/, '整个节点目录作为来源时不要求逐个读过')
  state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.deepEqual(state.chapters.map(item => item.chapter_heading), ['第0章 设定', '第1章 无尽之塔', '第2章 树洞', '第3章 风向标'])
  assert.match(stages[3], /前置产物已改变/, '规划时改了原作资料却没重新登记')
  assert.match(stages[4], /"status":"saved"/, '规划时重新登记原作资料')
  assert.match(stages[5], /顺序/, '按章号顺序：第1集用第2章、第2集用第1章是倒序')
  assert.match(stages[6], /"status":"saved"/)
  assert.equal(state.stage, 'cuts')
})

test('short-drama deletion flow: events and suggested split pause for review, then cuts become episode scripts handed to manju', { timeout: 60000 }, async t => {
  const f = await fixture(t)
  const dir = join(f.root, 'wiki/原始材料/作品/原文节点/0001-0100')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(f.root, 'wiki/index.md'), '# Wiki')
  writeFileSync(join(dir, '0001_树洞.md'), '---\ntitle: "第1章 树洞"\n---\n\n第1章 树洞\n\n食物不见了，地上有细小的爪印。\n这是一大段关于种子的设定介绍。\n“谁偷了我的饭？”李长青握紧木棍。\n')
  const nodes = 'wiki/原始材料/作品/原文节点/0001-0100', node = `${nodes}/0001_树洞.md`
  const calls = []
  const read = path => calls.push({ name: 'read', args: { file_path: join(f.root, path) } })
  const save = (artifact_kind, content, extra = {}) => calls.push({ name: 'wiki_save_artifact', args: { artifact_kind, content, ...extra } })
  const checkpoint = input => save('adaptation_checkpoint', JSON.stringify(input))
  const docs = ['wiki/改编方案/项目总纲.md', 'wiki/改编方案/分集规划.md']
  checkpoint({ stage: 'source', source_paths: [nodes], outputs: [] })
  save('story_summary', '# 梗概', { research_version: 'original' })
  checkpoint({ stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md'] })
  read('wiki/项目资料/原作/故事梗概.md')
  save('project_overview', '# 项目总纲\n主题；事件摘要。')
  read('wiki/改编方案/项目总纲.md')
  save('adaptation_event', '# 噗叽偷食被收服', { entity_name: 'E01_噗叽偷食被收服' })
  save('adaptation_episode_plan', '# 建议分集方案\nE01 建议2集。')
  checkpoint({ stage: 'scheme', planned_through: '第1章 树洞', event_beats: [{ event: 'E01_噗叽偷食被收服', beats: 0 }], outputs: docs })
  checkpoint({ stage: 'scheme', planned_through: '第1章 树洞', event_beats: [{ event: 'E01_噗叽偷食被收服', beats: 4 }], outputs: docs })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户选择项目风格', style_options: 1, outputs: docs })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户选择项目风格', style_options: 3, outputs: docs })
  checkpoint({ stage: 'scheme', rhythm: { reference: '海贼王', beats_per_episode: 0, compact: 4, relaxed: 2 }, outputs: docs })
  checkpoint({ stage: 'scheme', rhythm: { reference: '海贼王', beats_per_episode: 3, compact: 4, relaxed: 2 }, event_beats: [{ event: 'E01_噗叽偷食被收服', beats: 5.5 }], outputs: docs })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户决定分集', event_episodes: [{ event: 'E02_不存在', episodes: 1 }], outputs: docs })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户决定分集', event_episodes: [{ event: 'E01_噗叽偷食被收服', episodes: 0 }], outputs: docs })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户决定分集', event_episodes: [{ event: 'E01_噗叽偷食被收服', episodes: 2 }], carry_from: '第9章 不存在', outputs: docs })
  checkpoint({ stage: 'scheme', status: 'review', reason: '等待用户决定分集', event_episodes: [{ event: 'E01_噗叽偷食被收服', episodes: 2 }], carry_from: '第1章 树洞', outputs: docs })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'delete-flow', text: '【全自动改编·规划】「第1章 树洞」至「第1章 树洞」' })
  let results = f.results().map(String)
  const schemes = results.filter((_, index) => calls[index]?.args?.content?.includes?.('"scheme"'))
  assert.match(schemes[0], /event_beats/)
  assert.match(schemes[1], /"status":"saved"/)
  assert.match(schemes[2], /style_options/)
  assert.match(schemes[3], /"status":"saved"/)
  assert.match(schemes[4], /rhythm/)
  assert.match(schemes[5], /"status":"saved"/)
  assert.match(schemes[6], /事件文档不存在/)
  assert.match(schemes[7], /正整数/)
  assert.match(schemes[8], /carry_from/)
  assert.match(schemes[9], /"status":"saved"/)
  let state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.equal(state.status, 'review')
  assert.deepEqual(state.event_episodes, [{ event: 'E01_噗叽偷食被收服', episodes: 2 }])

  calls.length = 0
  read(node)
  save('adaptation_cut', JSON.stringify({ segments: [{ source_path: node, chapter_heading: '第1章 树洞', start_line: 7, end_line: 7 }] }), { episode_number: 1 })
  save('adaptation_cut', JSON.stringify({ segments: [{ source_path: node, chapter_heading: '第1章 树洞', start_line: 9, end_line: 9 }] }), { episode_number: 2 })
  save('episode_source_script', JSON.stringify({ from_cut: 1 }), { episode_number: 1 })
  save('episode_source_script', JSON.stringify({ from_cut: 2 }), { episode_number: 2 })
  const scripts = ['wiki/项目资料/分集剧本/第1集分集剧本.md', 'wiki/项目资料/分集剧本/第2集分集剧本.md']
  checkpoint({ stage: 'cuts', episodes: [1, 2], outputs: ['wiki/改编方案/分集切分/第001集原文.md', 'wiki/改编方案/分集切分/第002集原文.md'] })
  checkpoint({ stage: 'writing', outputs: [] })
  checkpoint({ stage: 'writing', outputs: scripts })
  checkpoint({ stage: 'complete', outputs: [] })
  f.plan(calls)
  await f.run('short-drama', { sessionId: 'delete-flow', text: '【全自动改编·切集】按E01切两集。' })
  results = f.results().map(String)
  assert.ok(results.some(result => /阶段没有实际产物|分集剧本/.test(result)), 'writing 没登记剧本时拒绝')
  state = JSON.parse(readFileSync(join(f.root, 'wiki/改编方案/执行进度.json'), 'utf8'))
  assert.equal(state.stage, 'complete')
  assert.deepEqual(state.unused.map(item => [item.start_line, item.end_line]), [[8, 8]])
  assert.equal(state.carry_from, '第1章 树洞', '顺延起始章一直保留到完成，供下一批读取')
  assert.deepEqual(state.event_beats, [{ event: 'E01_噗叽偷食被收服', beats: 5.5 }], '同名事件续写时更新节拍数')
  assert.deepEqual(state.rhythm, { reference: '海贼王', beats_per_episode: 3, compact: 4, relaxed: 2 })
  assert.equal(readFileSync(join(f.root, scripts[0]), 'utf8').trim(), '食物不见了，地上有细小的爪印。')
})
