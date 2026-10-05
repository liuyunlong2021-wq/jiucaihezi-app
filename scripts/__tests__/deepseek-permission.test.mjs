import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
async function fixture(t, escalation, holdSecond = false) {
  execFileSync(process.execPath, ['scripts/prepare-deepseek-harness.mjs'], { stdio: 'pipe' })
  const { DeepSeekHarness } = await import(`${vendor}dsh-sdk-client/lib/index.js`)
  const root = mkdtempSync(join(tmpdir(), 'jc-permission-'))
  const target = join(root, 'result.txt')
  let release, reached, secondReached
  const secondRequest = new Promise(resolve => { secondReached = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const firstRequest = new Promise(resolve => { reached = resolve })
  const requests = []
  const http = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    const first = requests.length === 1
    if (first) { reached(); await gate }
    if (!first && holdSecond) { secondReached(); await new Promise(resolve => res.on('close', resolve)); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const args = { file_path: target, content: 'approved', ...(escalation ? { sandbox_permissions: 'workspace-write', justification: '请允许本次写入测试文件' } : {}) }
    const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'write-1', type: 'function', function: { name: 'write', arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'OK' }
    for (const [part, finish_reason] of [[delta, null], [{}, first ? 'tool_calls' : 'stop']])
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: part, finish_reason }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const patch = join(root, 'route.yml')
  writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      jiucaihezi:\n        apiKeyEnv: JIUCAIHEZI_DH_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${http.address().port}/v1\n        models:\n          - id: test\n            name: test\n            contextWindow: 65536\n            maxTokens: 1024\n`)
  const options = { cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch], provider: 'jiucaihezi', model: 'test', initializeTimeoutMs: 15000,
    env: { ...process.env, DSH_AGENTS_HOME: join(root, 'agents'), DSH_PRIMARY_RUNTIME: '', JIUCAIHEZI_DH_API_KEY: 'local-test' } }
  let harness = new DeepSeekHarness(options)
  t.after(async () => { release(); await harness.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); rmSync(root, { recursive: true, force: true }) })
  await harness.start()
  await harness.client.request('session/permission', { sessionId: 'permission-test', preset: 'read-only' })
  return { get harness() { return harness }, target, firstRequest, secondRequest, release, requests, async restart() { await harness.close(); harness = new DeepSeekHarness(options); await harness.start() } }
}

test('real SDK reads effective permission and switches a running turn without recreating the agent', { timeout: 45000 }, async t => {
  const f = await fixture(t, false)
  const notices = []
  const running = f.harness.session('permission-test').run('写入文件', { onNotification: n => notices.push(n) })
  await f.firstRequest
  const before = await f.harness.client.request('session/permission', { sessionId: 'permission-test' })
  const after = await f.harness.client.request('session/permission', { sessionId: 'permission-test', preset: 'workspace-write' })
  f.release()
  await running
  assert.equal(before.preset, 'read-only')
  assert.equal(after.preset, 'workspace-write')
  assert.equal(before.agentId, after.agentId)
  assert.equal(readFileSync(f.target, 'utf8'), 'approved')
  assert.match(JSON.stringify(f.requests.at(-1).messages), /workspace-write/)
  const events = notices.filter(n => n.method === 'session.event').map(n => n.params.event)
  assert.equal(events.filter(e => e.type === 'turn/start').length, 1)
  assert.deepEqual(await f.harness.client.request('session/permission', { sessionId: 'catalog-only', existingOnly: true }), { exists: false })
  assert.ok(!(await f.harness.client.request('session/list', {})).some(entry => entry.header.id === 'catalog-only'))
  assert.equal(before.sandbox, 'read-only')
  assert.equal(after.approval, 'ask')
  const knobs = snapshot => snapshot.events.filter(e => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(e.type))
  const saved = await f.harness.client.request('session/read', { sessionId: 'permission-test' })
  await f.harness.client.request('session/permission', { sessionId: 'permission-test', preset: 'workspace-write' })
  assert.deepEqual(knobs(await f.harness.client.request('session/read', { sessionId: 'permission-test' })), knobs(saved))
  const full = await f.harness.client.request('session/permission', { sessionId: 'permission-test', preset: 'danger-full-access' })
  assert.equal(full.agentId, after.agentId)
  assert.equal(full.approval, 'never')
  await f.harness.session('permission-test').run('继续')
  assert.match(JSON.stringify(f.requests.at(-1).messages), /approval policy changed from.*ask.*never/)
  await f.restart()
  const restored = await f.harness.client.request('session/permission', { sessionId: 'permission-test' })
  assert.equal(restored.preset, 'danger-full-access')
})

test('real SDK one-time approval grants only the pending operation and preserves standing permission', { timeout: 45000 }, async t => {
  const f = await fixture(t, true)
  let request, reply
  f.release()
  const notices = []
  await f.harness.session('permission-test').run('写入文件', { onNotification(n) {
    notices.push(n)
    if (n.method !== 'session.approval-request') return
    request = n.params
    reply = f.harness.client.request('session/approval', { ...request, outcome: 'allowed-once' })
    reply.catch(() => {})
  } })
  assert.ok(request, 'official approval/request must reach the SDK client')
  await reply
  assert.equal(request.target, f.target)
  assert.equal(typeof request.turn, 'number')
  assert.equal(readFileSync(f.target, 'utf8'), 'approved')
  const actual = await f.harness.client.request('session/permission', { sessionId: 'permission-test' })
  assert.equal(actual.preset, 'read-only')
  await assert.rejects(f.harness.client.request('session/approval', { ...request, outcome: 'allowed-once' }), /expired|pending/)
  await assert.rejects(f.harness.client.request('session/approval', { ...request, sessionId: 'other', outcome: 'allowed-once' }), /session|pending/)
  const events = notices.filter(n => n.method === 'session.event').map(n => n.params.event)
  const asked = events.filter(e => e.type === 'approval/asked')
  const decided = events.filter(e => e.type === 'approval/decided')
  assert.equal(asked.length, 1)
  assert.deepEqual(decided.map(e => e.data), [{ id: asked[0].data.id, outcome: 'allowed-once' }])
  await f.restart()
  const restored = await f.harness.client.request('session/permission', { sessionId: 'permission-test' })
  assert.equal(restored.preset, 'read-only')
  await assert.rejects(f.harness.client.request('session/approval', { ...request, outcome: 'allowed-once' }), /expired|pending/)
})

test('real SDK rejection does not execute the requested file mutation', { timeout: 45000 }, async t => {
  const f = await fixture(t, true)
  f.release()
  let reply
  await f.harness.session('permission-test').run('写入文件', { onNotification(n) {
    if (n.method === 'session.approval-request') {
      reply = f.harness.client.request('session/approval', { ...n.params, outcome: 'rejected' })
      reply.catch(() => {})
    }
  } })
  await reply
  assert.ok(reply)
  assert.equal(existsSync(f.target), false)
})

async function scopedApproval(t, notify = () => {}) {
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { createScope } = await import(`${vendor}dsh-scope/lib/index.js`)
  const { default: ApprovalService } = await import(`${vendor}dsh-user-approval/lib/index.js`)
  const { attachApprovalBridge } = await import('../../src-tauri/resources/deepseek-harness/permission-bridge.mjs')
  const ctx = new Context()
  const service = await ctx.plugin(ApprovalService, { policy: 'ask' })
  const events = [{ type: 'turn/start', data: { turn: 3 } }]
  const session = { header: { id: 'scoped' }, get seq() { return events.length }, eventAt: seq => events[seq], append(type, data) { events.push({ type, data }) } }
  const agent = { id: 'agent-1', session }
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  const bridge = await attachApprovalBridge(agent, notify)
  t.after(async () => { await scope.dispose(); await service.dispose() })
  return { ctx, scope, bridge, agent, events }
}

const flush = () => new Promise(resolve => setImmediate(resolve))
test('real scoped approval rejects stale identities and settles cancellation and disposal once', async t => {
  const notices = []
  const f = await scopedApproval(t, (method, params) => notices.push({ method, params }))
  const controller = new AbortController()
  const request = f.ctx.approval.request({ agent: f.agent, toolName: 'write', callId: 'call-1', signal: controller.signal })
  await flush()
  const identity = notices.find(n => n.method === 'session.approval-request').params
  assert.equal(identity.turn, 3)
  for (const changes of [{ agentId: 'another' }, { turn: 4 }, { callId: 'another' }, { requestSessionId: 'another' }])
    assert.throws(() => f.bridge.answer({ ...identity, ...changes, outcome: 'allowed-once' }), /expired|pending/)
  assert.throws(() => f.bridge.answer({ ...identity, outcome: 'always' }), /invalid/)
  controller.abort()
  assert.equal(await request, 'cancelled')
  assert.throws(() => f.bridge.answer({ ...identity, outcome: 'allowed-once' }), /expired|pending/)
  const second = f.ctx.approval.request({ agent: f.agent, toolName: 'write', callId: 'call-2' })
  await flush()
  await f.scope.dispose()
  assert.equal(await second, 'cancelled')
  assert.deepEqual(f.events.filter(e => e.type === 'approval/decided').map(e => e.data.outcome), ['cancelled', 'cancelled'])
  assert.equal(notices.filter(n => n.method === 'session.approval-settled').length, 2)
})

test('disconnected approval transport fails closed and other agents do not inherit the answerer', async t => {
  const f = await scopedApproval(t, () => { throw new Error('disconnected') })
  assert.equal(await f.ctx.approval.request({ agent: f.agent, toolName: 'write' }), 'unavailable')
  const other = { id: 'other', session: f.agent.session }
  assert.equal(await f.ctx.approval.request({ agent: other, toolName: 'write' }), 'unavailable')
  assert.deepEqual(f.events.filter(e => e.type === 'approval/decided').map(e => e.data.outcome), ['unavailable', 'unavailable'])
})

test('a scoped subagent approval is routed to the owning SDK session with its actual agent and turn', async t => {
  const notices = []
  const f = await scopedApproval(t, (method, params) => notices.push({ method, params }))
  const { createScope, bindScopeParent } = await import(`${vendor}dsh-scope/lib/index.js`)
  const events = [{ type: 'turn/start', data: { turn: 7 } }]
  const child = { id: 'child-agent', session: { header: { id: 'child-session' }, get seq() { return events.length }, eventAt: seq => events[seq], append(type, data) { events.push({ type, data }) } } }
  bindScopeParent(child, f.agent)
  const childScope = createScope(f.agent.ctx, child)
  t.after(() => childScope.dispose())
  child.ctx = childScope.ctx
  const pending = f.ctx.approval.request({ agent: child, toolName: 'write', callId: 'child-call' })
  await flush()
  const identity = notices[0].params
  assert.equal(identity.sessionId, 'scoped')
  assert.equal(identity.requestSessionId, 'child-session')
  assert.equal(identity.agentId, 'child-agent')
  assert.equal(identity.turn, 7)
  f.bridge.answer({ ...identity, outcome: 'rejected' })
  assert.equal(await pending, 'rejected')
})


test('real SDK cancellation preserves accepted input and completed tool results after restart', { timeout: 45000 }, async t => {
  const f = await fixture(t, false, true)
  await f.harness.client.request('session/permission', { sessionId: 'permission-test', preset: 'workspace-write' })
  const running = f.harness.session('permission-test').run('保留已完成工作')
  const outcome = running.then(() => null, error => error)
  f.release()
  await f.secondRequest
  await f.restart()
  await outcome
  const snapshot = await f.harness.client.request('session/read', { sessionId: 'permission-test' })
  assert.ok(snapshot.events.some(event => event.type === 'user/message' && JSON.stringify(event.data).includes('保留已完成工作')))
  assert.equal(snapshot.events.filter(event => event.type === 'tool/call').length, 1)
  assert.equal(snapshot.events.filter(event => event.type === 'tool/result').length, 1)
  assert.equal(snapshot.events.findLast(event => event.type === 'turn/end').data.reason.kind, 'aborted')
  assert.equal(readFileSync(f.target, 'utf8'), 'approved')
})
