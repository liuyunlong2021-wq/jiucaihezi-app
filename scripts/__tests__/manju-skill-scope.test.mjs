import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { pinManjuSkills } from '../../src-tauri/resources/deepseek-harness/manju-skills.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jc-manju-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'manju-route.json'), JSON.stringify({ router: 'jc-manju-zhizuo', skills: ['jc-manju-zhizuo', 'h3-prompt-writing', 'jc-seedance'] }))
  writeFileSync(join(root, 'wiki-artifacts.json'), readFileSync('public/skills/wiki-artifacts.json', 'utf8'))
  for (const name of ['jc-manju-zhizuo', 'h3-prompt-writing', 'jc-seedance', 'wiki-memory', 'jc-novel']) {
    mkdirSync(join(root, name))
    writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: "test ${name}"\n---\n\n# ${name}\n`)
  }
  const registered = new Map()
  const registeredTools = new Map()
  const ctx = { skills: { register(skill) {
    registered.set(skill.name, skill)
    return () => registered.delete(skill.name)
  } }, tools: { register(tool) {
    registeredTools.set(tool.name, tool)
    return () => registeredTools.delete(tool.name)
  } }, fs: { sandboxMode: undefined },
  get() { return undefined }, plugin(definition) {
    const releases = []
    const child = {
      skills: { register(skill) { releases.push(ctx.skills.register(skill)) } },
      tools: ctx.tools, fs: ctx.fs, get: ctx.get,
      effect(callback) { releases.push(callback()) },
    }
    return {
      await: async () => definition.apply(child),
      assertActive() {},
      dispose: async () => { for (const release of releases.splice(0).reverse()) await release?.() },
    }
  } }
  const rec = { handle: { agent: { ctx } } }
  return { root, rec, registered, registeredTools }
}

test('both production routes pin wiki-memory and expose one shared wiki writer in the agent scope', async t => {
  const { root, rec, registered, registeredTools } = fixture(t)
  const dispose = await pinManjuSkills(rec, ['jc-manju-zhizuo', 'wiki-memory'], root)
  assert.deepEqual([...registered.keys()], ['wiki-memory', 'jc-manju-zhizuo', 'h3-prompt-writing', 'jc-seedance'])
  assert.equal(registered.get('jc-seedance').resourceBase.path, join(root, 'jc-seedance'))
  assert.match(registered.get('jc-seedance').content, /# jc-seedance/)
  assert.ok(registeredTools.has('wiki_save_artifact'))
  await dispose()
  assert.equal(registered.size, 0)
  assert.equal(registeredTools.size, 0)

  const novel = await pinManjuSkills(rec, ['jc-novel', 'wiki-memory'], root)
  assert.deepEqual([...registered.keys()], ['wiki-memory', 'jc-novel'])
  assert.ok(registeredTools.has('wiki_save_artifact'))
  await novel()
  assert.equal(registered.size, 0)
  assert.equal(registeredTools.size, 0)
})

test('missing packages and incompatible production skills fail before changing the agent scope', async t => {
  const { root, rec, registered } = fixture(t)
  await assert.rejects(pinManjuSkills(rec, ['jc-manju-zhizuo', 'jc-novel'], root), /漫剧制作.*小说创作/)
  await assert.rejects(pinManjuSkills(rec, ['jc-novel', 'wiki-memory', 'h3-prompt-writing'], root), /小说创作.*不能同时加载/)
  assert.equal(registered.size, 0)
  rmSync(join(root, 'jc-seedance'), { recursive: true })
  await assert.rejects(pinManjuSkills(rec, ['jc-manju-zhizuo'], root), /jc-seedance/)
  assert.equal(registered.size, 0)
})

test('ordinary skill selection does not pin production packages', async t => {
  const { root, rec, registered } = fixture(t)
  const dispose = await pinManjuSkills(rec, ['skill-creator'], root)
  await dispose()
  assert.equal(registered.size, 0)
})

test('the real Harness registry prefers scoped bundled definitions and releases them on exit', async t => {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  if (!existsSync(new URL(`${vendor}dsh-skill/lib/index.js`, import.meta.url))) return t.skip('Harness SDK not installed')
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { default: SkillRegistry } = await import(`${vendor}dsh-skill/lib/index.js`)
  const { createScope } = await import(`${vendor}dsh-scope/lib/index.js`)
  const { root } = fixture(t)
  const ctx = new Context()
  const service = await ctx.plugin(SkillRegistry)
  ctx.provide('tools', { register() { return () => {} } })
  ctx.provide('fs', { sandboxMode: undefined })
  ctx.provide('sandboxPolicy', {})
  let checked = false
  const localDispose = ctx.skills.register({ name: 'jc-seedance', source: 'user', description: 'local', content: 'LOCAL VERSION' })
  const localNovelDispose = ctx.skills.register({ name: 'jc-novel', source: 'user', description: 'stale novel', content: 'LOCAL NOVEL VERSION' })
  const consumer = await ctx.plugin({ name: 'manju-registry-test', inject: ['tools', 'fs', 'sandboxPolicy'], async apply(c) {
    const agent = {}
    const scope = createScope(c, agent)
    agent.ctx = scope.ctx
    const dispose = await pinManjuSkills({ handle: { agent } }, ['jc-manju-zhizuo'], root)
    const lookup = { scope: agent, signal: new AbortController().signal }
    assert.throws(() => agent.ctx.skills, /without inject/)
    const loaded = await ctx.skills.get('jc-seedance', lookup)
    assert.equal(loaded.source, 'bundled')
    assert.equal(loaded.resourceBase.path, join(root, 'jc-seedance'))
    assert.equal((await ctx.skills.get('jc-seedance', { signal: lookup.signal })).content, 'LOCAL VERSION')
    await dispose()
    assert.equal((await ctx.skills.get('jc-seedance', lookup)).content, 'LOCAL VERSION')
    const disposeNovel = await pinManjuSkills({ handle: { agent } }, ['jc-novel', 'wiki-memory'], root)
    const novel = await ctx.skills.get('jc-novel', lookup)
    assert.equal(novel.source, 'bundled')
    assert.equal(novel.resourceBase.path, join(root, 'jc-novel'))
    assert.match(novel.content, /# jc-novel/)
    assert.equal((await ctx.skills.get('jc-novel', { signal: lookup.signal })).content, 'LOCAL NOVEL VERSION')
    await disposeNovel()
    assert.equal((await ctx.skills.get('jc-novel', lookup)).content, 'LOCAL NOVEL VERSION')
    checked = true
    await scope.dispose()
    await localDispose()
    await localNovelDispose()
  } })
  await consumer.dispose()
  await service.dispose()
  assert.ok(checked)
})

test('missing skills service rejects instead of treating an inactive plugin as ready', async t => {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  if (!existsSync(new URL(`${vendor}cordis/lib/index.js`, import.meta.url))) return t.skip('Harness SDK not installed')
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { createScope } = await import(`${vendor}dsh-scope/lib/index.js`)
  const { root } = fixture(t)
  const ctx = new Context()
  const agent = {}
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  t.after(() => scope.dispose())
  await assert.rejects(pinManjuSkills({ handle: { agent } }, ['jc-manju-zhizuo'], root), /漫剧制作.*skills.*未启动/)
})

async function realFixture(t, tools) {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  if (!existsSync(new URL(`${vendor}dsh-skill/lib/index.js`, import.meta.url))) {
    t.skip('Harness SDK not installed')
    return
  }
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { default: SkillRegistry } = await import(`${vendor}dsh-skill/lib/index.js`)
  const { createScope } = await import(`${vendor}dsh-scope/lib/index.js`)
  const { root } = fixture(t)
  const ctx = new Context()
  const service = await ctx.plugin(SkillRegistry)
  ctx.provide('tools', { register() { return () => {} }, ...tools })
  ctx.provide('fs', { sandboxMode: undefined })
  ctx.provide('sandboxPolicy', { resolve() { return { mode: 'workspace-write', workspaceRoot: process.cwd() } } })
  const agents = []
  const owner = await ctx.plugin({ name: 'agent-loop-context', inject: tools ? ['tools'] : [], apply(c) {
    for (let i = 0; i < 2; i++) {
      const agent = { id: 'same-session' }
      const scope = createScope(c, agent)
      agent.ctx = scope.ctx
      agents.push({ rec: { handle: { agent } }, scope })
    }
  } })
  t.after(async () => { await owner.dispose(); await service.dispose() })
  return { root, ctx, agents }
}

test('bundled registrations stay isolated and parent teardown releases them', async t => {
  const f = await realFixture(t)
  if (!f) return
  const [a, b] = f.agents
  const lookup = agent => ({ scope: agent, signal: new AbortController().signal })
  const dispose = await pinManjuSkills(a.rec, ['jc-manju-zhizuo'], f.root)
  assert.equal((await f.ctx.skills.get('jc-seedance', lookup(b.rec.handle.agent))), undefined)
  await pinManjuSkills(b.rec, ['jc-manju-zhizuo'], f.root)
  await a.scope.dispose()
  assert.equal(await f.ctx.skills.get('jc-seedance', lookup(a.rec.handle.agent)), undefined)
  assert.equal((await f.ctx.skills.get('jc-seedance', lookup(b.rec.handle.agent))).source, 'bundled')
  await dispose()
  await dispose()
})

test('a partially failed registration is rolled back and can be retried', async t => {
  const f = await realFixture(t)
  if (!f) return
  const { rec } = f.agents[0]
  const registry = f.ctx.skills
  const original = registry.register
  registry.register = function(skill) {
    if (skill.name === 'h3-prompt-writing') throw new Error('registration failure')
    return original.call(this, skill)
  }
  await assert.rejects(pinManjuSkills(rec, ['jc-manju-zhizuo'], f.root), /registration failure/)
  const lookup = { scope: rec.handle.agent, signal: new AbortController().signal }
  assert.deepEqual(await f.ctx.skills.list(lookup), [])
  registry.register = original
  await (await pinManjuSkills(rec, ['jc-manju-zhizuo'], f.root))()
  assert.deepEqual(await f.ctx.skills.list(lookup), [])
})

test('agent teardown during bundle reads rejects without registering into another scope', async t => {
  const f = await realFixture(t)
  if (!f) return
  const { rec, scope } = f.agents[0]
  const pending = pinManjuSkills(rec, ['jc-manju-zhizuo'], f.root)
  await scope.dispose()
  await assert.rejects(pending, /inactive|disposed/i)
  assert.deepEqual(await f.ctx.skills.list({ scope: rec.handle.agent, signal: new AbortController().signal }), [])
})

test('SDK bindings reuse the same agent, rebind restored agents, and clean up after restriction failure', async t => {
  let failRestriction = true
  let failRelease = false
  let restrictions = 0
  const f = await realFixture(t, { restrict() {
    if (failRestriction) throw new Error('restriction failure')
    restrictions++
    return () => { restrictions--; if (failRelease) throw new Error('release failure') }
  } })
  if (!f) return
  const { HarnessSdkJsonRpcServer } = await import('../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/lib/index.js')
  const originalDirectory = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_BUNDLED_SKILL_DIR = f.root
  t.after(() => {
    if (originalDirectory === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
    else process.env.DSH_BUNDLED_SKILL_DIR = originalDirectory
  })
  let rec = f.agents[0].rec
  f.ctx.provide('agents', { get: () => rec.handle.agent })
  const server = Object.assign(Object.create(HarnessSdkJsonRpcServer.prototype), { ctx: f.ctx })
  const production = [{ type: 'text', text: '/jc-manju-zhizuo\nmake a prompt' }]
  const ordinary = [{ type: 'text', text: 'ordinary conversation' }]
  const lookup = () => ({ scope: rec.handle.agent, signal: new AbortController().signal })
  await assert.rejects(server.applyPinnedSkillScope(rec, production), /restriction failure/)
  assert.deepEqual(await f.ctx.skills.list(lookup()), [])
  assert.equal(server.pinnedSkillScopes.has(rec.handle.agent), false)
  failRestriction = false
  await server.applyPinnedSkillScope(rec, production)
  await server.applyPinnedSkillScope(rec, production)
  assert.equal(restrictions, 1)
  failRelease = true
  await assert.rejects(server.applyPinnedSkillScope(rec, ordinary), /release failure/)
  assert.deepEqual(await f.ctx.skills.list(lookup()), [])
  assert.equal(server.pinnedSkillScopes.has(rec.handle.agent), false)
  failRelease = false
  await server.applyPinnedSkillScope(rec, production)
  await server.applyPinnedSkillScope(rec, ordinary)
  rec = f.agents[1].rec // 相同 id、新 Agent 实例：不能命中旧绑定。
  await server.applyPinnedSkillScope(rec, production)
  assert.equal((await f.ctx.skills.get('jc-seedance', lookup())).source, 'bundled')
  await server.applyPinnedSkillScope(rec, ordinary)
  assert.equal(restrictions, 0)
})

test('SDK rejects a disposed agent after bundle preparation and rolls back its plugin', async t => {
  const f = await realFixture(t, { restrict() { throw new Error('must not restrict disposed agent') } })
  if (!f) return
  const { HarnessSdkJsonRpcServer } = await import('../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/lib/index.js')
  const { rec } = f.agents[0]
  let liveChecks = 0
  f.ctx.provide('agents', { get: () => ++liveChecks === 1 ? rec.handle.agent : undefined })
  const originalDirectory = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_BUNDLED_SKILL_DIR = f.root
  t.after(() => {
    if (originalDirectory === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
    else process.env.DSH_BUNDLED_SKILL_DIR = originalDirectory
  })
  const server = Object.assign(Object.create(HarnessSdkJsonRpcServer.prototype), { ctx: f.ctx })
  await assert.rejects(server.applyPinnedSkillScope(rec, [{ type: 'text', text: '/jc-manju-zhizuo' }]), /disposed/)
  assert.deepEqual(await f.ctx.skills.list({ scope: rec.handle.agent, signal: new AbortController().signal }), [])
  assert.equal(server.pinnedSkillScopes.has(rec.handle.agent), false)
})

test('the actual SDK injects bundled skills before the model request and restores ordinary selection', { timeout: 45000 }, async t => {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  if (!existsSync(new URL(`${vendor}dsh-sdk-client/lib/index.js`, import.meta.url))) return t.skip('Harness SDK not installed')
  execFileSync(process.execPath, ['scripts/prepare-deepseek-harness.mjs'], { stdio: 'pipe' })
  const { DeepSeekHarness } = await import(`${vendor}dsh-sdk-client/lib/index.js`)
  let removeRoot
  const { root } = fixture({ after: cleanup => { removeRoot = cleanup } })
  let harness
  const local = join(root, '.dsh', 'skills')
  for (const name of ['jc-manju-zhizuo', 'jc-seedance', 'jc-novel']) {
    mkdirSync(join(local, name), { recursive: true })
    writeFileSync(join(local, name, 'SKILL.md'), `---\nname: ${name}\ndescription: local\n---\n\nLOCAL_${name}\n`)
  }
  const requests = []
  const http = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'OK' }, null], [{}, 'stop']]) {
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    }
    res.end('data: [DONE]\n\n')
  })
  t.after(async () => {
    try { await harness?.close() } finally {
      http.closeAllConnections()
      await new Promise(resolve => http.close(resolve))
      removeRoot()
    }
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const patch = join(root, 'route.yml')
  writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      jiucaihezi:\n        apiKeyEnv: JIUCAIHEZI_DH_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${http.address().port}/v1\n        models:\n          - id: test\n            name: test\n            contextWindow: 65536\n            maxTokens: 1024\n`)
  const options = {
    cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch],
    provider: 'jiucaihezi', model: 'test', initializeTimeoutMs: 15000,
    env: { ...process.env, DSH_BUNDLED_SKILL_DIR: root, DSH_AGENTS_HOME: join(root, 'agents'),
      DSH_PRIMARY_RUNTIME: '', JIUCAIHEZI_DH_API_KEY: 'local-test' },
  }
  harness = new DeepSeekHarness(options)
  const session = harness.session('manju-sdk-test')
  await session.run('/jc-manju-zhizuo\nmake a prompt')
  assert.match(JSON.stringify(requests[0].messages), /# jc-manju-zhizuo/)
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /LOCAL_jc-manju-zhizuo/)
  assert.ok(!requests[0].tools?.some(tool => tool.function.name === 'skill'))
  await session.run('/jc-manju-zhizuo\ncontinue')
  await session.run('/jc-novel\nwrite a chapter draft')
  assert.match(JSON.stringify(requests.at(-1).messages), /# jc-novel/)
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /LOCAL_jc-novel/)
  assert.ok(requests.at(-1).tools?.some(tool => tool.function.name === 'wiki_save_artifact'))
  assert.ok(!requests.at(-1).tools?.some(tool => tool.function.name === 'manju_save_artifact'))
  await session.run('/jc-seedance\nordinary selection')
  assert.match(JSON.stringify(requests.at(-1).messages), /LOCAL_jc-seedance/)
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /# jc-seedance/)
  await harness.close()
  harness = new DeepSeekHarness(options)
  await harness.session('manju-sdk-test').run('/jc-manju-zhizuo\nresume')
  assert.match(JSON.stringify(requests.at(-1).messages), /ordinary selection/)
  assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /# jc-manju-zhizuo/)
  assert.ok(!requests.at(-1).tools?.some(tool => tool.function.name === 'skill'))
  assert.equal(requests.length, 5)
})
