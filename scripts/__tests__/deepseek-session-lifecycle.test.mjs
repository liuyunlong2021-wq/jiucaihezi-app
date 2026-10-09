import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js'

async function fixture(t, configured = false, modelGate) {
  const root = mkdtempSync(join(tmpdir(), 'jc-session-lease-'))
  const requests = []
  const http = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (modelGate) await modelGate.promise
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'OK' }, null], [{}, 'stop']])
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const patch = join(root, 'route.yml')
  writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      jiucaihezi:\n        apiKeyEnv: JIUCAIHEZI_DH_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${http.address().port}/v1\n        models:\n          - id: test\n            name: test\n            contextWindow: 65536\n            maxTokens: 1024\n` + (configured ? `- id: agent-loop\n  config:\n    agents:\n      - id: configured\n        sessionId: lease-test\n        cwd: ${JSON.stringify(root)}\n        provider: jiucaihezi\n        model: test\n` : ''))
  const options = { cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch], provider: 'jiucaihezi', model: 'test', initializeTimeoutMs: 15000,
    env: { ...process.env, DSH_AGENTS_HOME: join(root, 'agents'), DSH_PRIMARY_RUNTIME: '', JIUCAIHEZI_DH_API_KEY: 'local-test' } }
  const harnesses = []
  const create = () => { const h = new DeepSeekHarness(options); harnesses.push(h); return h }
  const createRunner = () => {
    const ready = Promise.withResolvers()
    const closed = Promise.withResolvers()
    const pending = new Map()
    let next = 0
    let stopping
    const runnerPath = fileURLToPath(new URL('../../src-tauri/resources/deepseek-harness/runner.mjs', import.meta.url))
    const child = spawn(process.execPath, [runnerPath, JSON.stringify({ cwd: root, dshHome: options.dshHome, patchPath: patch, model: 'test' })], { env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr.resume()
    createInterface({ input: child.stdout }).on('line', line => {
      const frame = JSON.parse(line)
      if (frame.type === 'ready') ready.resolve()
      if (frame.type === 'closed') closed.resolve()
      if (['error', 'result', 'query-result'].includes(frame.type)) {
        pending.get(frame.requestId)?.resolve(frame)
        pending.delete(frame.requestId)
      }
    })
    child.on('exit', () => {
      closed.resolve()
      for (const request of pending.values()) request.reject(new Error('runner exited'))
      pending.clear()
    })
    const runner = {
      async request(command) {
        await ready.promise
        const requestId = String(++next)
        const result = Promise.withResolvers()
        pending.set(requestId, result)
        child.stdin.write(JSON.stringify({ ...command, requestId }) + '\n')
        return result.promise
      },
      close() {
        return stopping ??= (async () => {
          await ready.promise
          child.stdin.end(JSON.stringify({ type: 'close' }) + '\n')
          await closed.promise
        })()
      },
    }
    harnesses.push(runner)
    return runner
  }
  t.after(async () => {
    modelGate?.resolve()
    await Promise.allSettled(harnesses.map(h => h.close()))
    http.closeAllConnections()
    await new Promise(resolve => http.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  return { create, createRunner, requests }
}

test('session queue can be edited and removed durably while a turn is running', { timeout: 45000 }, async t => {
  const modelGate = Promise.withResolvers()
  const f = await fixture(t, false, modelGate)
  const runner = f.createRunner()
  const running = runner.request({ type: 'run', sessionId: 'queue-test', contentBlocks: [{ type: 'text', text: '正在运行' }] })
  const waitFor = async predicate => {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the model request')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await waitFor(() => f.requests.length === 1)

    const queuedFrame = await runner.request({
      type: 'queue', sessionId: 'queue-test', contentBlocks: [{ type: 'text', text: '待编辑的内容' }],
    })
    const removedFrame = await runner.request({
      type: 'queue', sessionId: 'queue-test', contentBlocks: [{ type: 'text', text: '待移除的内容' }],
    })
    const queued = queuedFrame.data
    const removed = removedFrame.data
    assert.ok(queued.messageId)
    assert.ok(removed.messageId)
    assert.deepEqual((await runner.request({
      type: 'update-queue', sessionId: 'queue-test', itemId: queued.messageId,
      action: { kind: 'edit', content: [{ type: 'text', text: '已编辑的内容' }] },
    })).data, { accepted: true })
    assert.deepEqual((await runner.request({
      type: 'update-queue', sessionId: 'queue-test', itemId: removed.messageId, action: { kind: 'remove' },
    })).data, { accepted: true })

    const snapshot = (await runner.request({ type: 'read-session', sessionId: 'queue-test' })).data
    const inbox = { 'next-turn': [], 'next-step': [] }
    for (const event of snapshot.events) {
      if (event.type !== 'agent/inbox/spliced') continue
      const splice = event.data
      inbox[splice.target].splice(splice.start, splice.removedCount || 0, ...splice.inserted)
    }
    assert.deepEqual(inbox['next-turn'].map(message => [message.id, message.content]), [
      [queued.messageId, [{ type: 'text', text: '已编辑的内容' }]],
    ])

    modelGate.resolve()
    await running
    await waitFor(() => f.requests.some(request => JSON.stringify(request.messages).includes('已编辑的内容')))
    assert.equal(f.requests.some(request => JSON.stringify(request.messages).includes('待移除的内容')), false)
  } finally {
    modelGate.resolve()
    await running
  }
})

test('stopping a live turn leaves queued prompts durable and resumes them in order', { timeout: 45000 }, async t => {
  const modelGate = Promise.withResolvers()
  const f = await fixture(t, false, modelGate)
  const runner = f.createRunner()
  const running = runner.request({ type: 'run', sessionId: 'queue-stop-test', contentBlocks: [{ type: 'text', text: '正在运行' }] })
  const waitFor = async predicate => {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the model request')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await waitFor(() => f.requests.length === 1)
    const queued = (await runner.request({
      type: 'queue', sessionId: 'queue-stop-test', contentBlocks: [{ type: 'text', text: '停止后继续' }],
    })).data
    assert.deepEqual((await runner.request({ type: 'cancel', sessionId: 'queue-stop-test' })).data, { accepted: true })
    const snapshot = (await runner.request({ type: 'read-session', sessionId: 'queue-stop-test' })).data
    const inbox = { 'next-turn': [], 'next-step': [] }
    for (const event of snapshot.events) {
      if (event.type !== 'agent/inbox/spliced') continue
      const splice = event.data
      inbox[splice.target].splice(splice.start, splice.removedCount || 0, ...splice.inserted)
    }
    assert.deepEqual(inbox['next-turn'].map(message => message.id), [queued.messageId])

    modelGate.resolve()
    await running
    assert.equal(f.requests.length, 1)
    await runner.request({ type: 'run', sessionId: 'queue-stop-test', contentBlocks: [{ type: 'text', text: '恢复后追加' }] })
    await waitFor(() => f.requests.length === 3)
    assert.match(JSON.stringify(f.requests[1].messages), /停止后继续/)
    assert.match(JSON.stringify(f.requests[2].messages), /恢复后追加/)
  } finally {
    modelGate.resolve()
    await running
  }
})

test('steering a queued prompt removes it from the next turn and feeds the running turn', { timeout: 45000 }, async t => {
  const modelGate = Promise.withResolvers()
  const f = await fixture(t, false, modelGate)
  const runner = f.createRunner()
  const running = runner.request({ type: 'run', sessionId: 'queue-steer-test', contentBlocks: [{ type: 'text', text: '当前任务' }] })
  const waitFor = async predicate => {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the model request')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await waitFor(() => f.requests.length === 1)
    const queued = (await runner.request({
      type: 'queue', sessionId: 'queue-steer-test', contentBlocks: [{ type: 'text', text: '转向当前轮的补充要求' }],
    })).data
    assert.deepEqual((await runner.request({
      type: 'update-queue', sessionId: 'queue-steer-test', itemId: queued.messageId, action: { kind: 'steer' },
    })).data, { accepted: true })
    const snapshot = (await runner.request({ type: 'read-session', sessionId: 'queue-steer-test' })).data
    const inbox = { 'next-turn': [], 'next-step': [] }
    for (const event of snapshot.events) {
      if (event.type !== 'agent/inbox/spliced') continue
      const splice = event.data
      inbox[splice.target].splice(splice.start, splice.removedCount || 0, ...splice.inserted)
    }
    assert.deepEqual(inbox['next-turn'], [])

    modelGate.resolve()
    await running
    await waitFor(() => f.requests.some((request, index) => index > 0
      && JSON.stringify(request.messages).includes('转向当前轮的补充要求')))
  } finally {
    modelGate.resolve()
    await running
  }
})

test('SDK adopts an already-live configured Agent without claiming its write handle again', { timeout: 45000 }, async t => {
  const f = await fixture(t, true)
  const h = f.create()
  await h.start()
  await h.run('first', { sessionId: 'lease-test' })
  await h.run('second', { sessionId: 'lease-test' })
  const saved = await h.client.request('session/read', { sessionId: 'lease-test' })
  assert.equal(saved.events.filter(e => e.type === 'turn/start').length, 2)
  assert.equal(f.requests.length, 2)
  assert.match(JSON.stringify(f.requests[1].messages), /first/)
  assert.match(JSON.stringify(f.requests[1].messages), /second/)
})

test('real cross-process lease preserves history and permits the rejected runtime to retry after release', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const owner = f.create()
  const contender = f.create()
  await owner.run('original', { sessionId: 'lease-test' })
  await assert.rejects(contender.run('rejected', { sessionId: 'lease-test' }), /already owned by an active write handle/)
  const before = await contender.client.request('session/read', { sessionId: 'lease-test' })
  assert.equal(before.events.filter(e => e.type === 'turn/start').length, 1)
  await owner.close()
  await contender.run('retry', { sessionId: 'lease-test' })
  await contender.run('again', { sessionId: 'lease-test' })
  const after = await contender.client.request('session/read', { sessionId: 'lease-test' })
  assert.equal(after.events.filter(e => e.type === 'turn/start').length, 3)
  assert.match(JSON.stringify(f.requests[1].messages), /original/)
  const messages = after.events.filter(e => e.type === 'user/message').map(e => e.data.content)
  assert.doesNotMatch(JSON.stringify(messages), /"text":"rejected"/)
  assert.equal(f.requests.length, 3)
})

test('APP runner preserves writer-held identity and the same runner can continue the original session after release', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const a = f.createRunner()
  const b = f.createRunner()
  const run = (runner, text) => runner.request({ type: 'run', sessionId: 'lease-test', contentBlocks: [{ type: 'text', text }] })
  assert.equal((await run(a, 'original')).type, 'result')
  const failure = await run(b, 'rejected')
  assert.equal(failure.type, 'error')
  assert.equal(failure.errorCode, 'session/writer-held')
  assert.match(failure.error, /already owned by an active write handle/)
  await a.close()
  assert.equal((await run(b, 'retry')).type, 'result')
  const saved = await b.request({ type: 'read-session', sessionId: 'lease-test' })
  assert.equal(saved.data.events.filter(e => e.type === 'turn/start').length, 2)
  assert.equal(f.requests.length, 2)
})

test('SDK shares a cold activation across concurrent permission and prompt consumers', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const h = f.create()
  await h.start()
  const [first, second] = await Promise.all([
    h.client.request('session/permission', { sessionId: 'lease-test' }),
    h.client.request('session/permission', { sessionId: 'lease-test' }),
  ])
  assert.equal(first.agentId, second.agentId)
  await h.run('one message', { sessionId: 'lease-test' })
  const saved = await h.client.request('session/read', { sessionId: 'lease-test' })
  assert.equal(saved.events.filter(e => e.type === 'turn/start').length, 1)
  assert.equal(f.requests.length, 1)
})

test('SDK adopts a losing activation race without taking the original owner disposer', async t => {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { createScope } = await import(`${vendor}dsh-scope/lib/index.js`)
  const { SessionAlreadyOwnedError } = await import(`${vendor}dsh-session-persistence/lib/index.js`)
  const { HarnessSdkJsonRpcServer } = await import(`${vendor}dsh-sdk-jsonrpc-server/lib/index.js`)
  const ctx = new Context()
  const agent = { id: 'raced', session: { header: { id: 'raced', cwd: 'workspace' } }, options: { provider: 'fixture', model: 'test' } }
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  let live, resumes = 0
  ctx.provide('approval', {})
  ctx.provide('sessionPersistence', { stat: async () => ({ header: agent.session.header }) })
  ctx.provide('agents', {
    get: () => live,
    async resume() { resumes++; live = agent; throw new SessionAlreadyOwnedError('raced') },
  })
  const server = new HarnessSdkJsonRpcServer(ctx, { notify() {} })
  Object.assign(server, { cwd: 'workspace', provider: 'fixture', model: 'test' })
  t.after(async () => { await server.shutdown(); await scope.dispose(); await ctx.fiber.dispose() })
  const [a, b] = await Promise.all([server.getOrCreateSession('raced'), server.getOrCreateSession('raced')])
  assert.equal(a, b)
  assert.equal(a.handle.agent, agent)
  assert.equal(resumes, 1)
  assert.equal(a.handle.dispose, undefined, 'a borrowed reference must not fabricate ownership')
  await server.shutdown()
  scope.ctx.fiber.assertActive()
})

// Exercise the actual runtime handoff functions with a controlled stdio transport.
// A pending send / reap must not make a new runtime appear safe to resume.
function lifecycle(createRuntime) {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  const start = source.slice(source.indexOf('async function ensureRuntime('), source.indexOf('/** Bounded control RPCs'))
  const stop = source.slice(source.indexOf('async function waitForRuntimeClose('))
  const code = transformSync(start + '\n' + stop.replace('export async function', 'async function'), { loader: 'ts', target: 'es2022' }).code
  const runtimes = new Map()
  return new Function('runtimes', 'createRuntime', 'workspaceRuntimeKey', 'runtimeKey', 'DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS', code + '\nreturn { ensureRuntime, stopRuntime, stopDeepSeekHarness };')(
    runtimes, createRuntime, input => input.cwd, input => input.model, 20,
  )
}

test('shutdown deadline covers a blocked stdin send, so process-tree cleanup remains reachable', async () => {
  let reaped = false
  const runtime = { closed: new Promise(() => {}), transport: { send: () => new Promise(() => {}), close: async () => { reaped = true } } }
  const f = lifecycle()
  await Promise.race([f.stopRuntime(runtime), new Promise(resolve => setTimeout(resolve, 100))])
  assert.equal(reaped, true)
})

test('stop-all retains the closing slot until cleanup finishes, so a new resume waits', async () => {
  const gate = Promise.withResolvers()
  const closed = Promise.withResolvers()
  let creations = 0
  const runtime = { closed: closed.promise, transport: { send: async () => { closed.resolve() }, close: () => gate.promise } }
  const f = lifecycle(async () => { creations++; return creations === 1 ? runtime : { ...runtime, closed: new Promise(() => {}) } })
  await f.ensureRuntime({ cwd: 'workspace', model: 'model' })
  const stopping = f.stopDeepSeekHarness()
  const next = f.ensureRuntime({ cwd: 'workspace', model: 'model' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(creations, 1, 'a replacement must not start while its predecessor still owns the lease')
  gate.resolve()
  await stopping
  await next
})

test('a failed handoff does not abandon the old runtime and the next attempt retries its cleanup', async () => {
  let creations = 0, reaps = 0
  const runtime = { closed: new Promise(() => {}), transport: { send: async () => {}, close: async () => {
    if (++reaps === 1) throw new Error('reap failed')
  } } }
  const f = lifecycle(async () => { creations++; return runtime })
  await f.ensureRuntime({ cwd: 'workspace', model: 'old' })
  await assert.rejects(f.stopRuntime(runtime), /reap failed/)
  await f.ensureRuntime({ cwd: 'workspace', model: 'new' })
  assert.equal(reaps, 2)
  assert.equal(creations, 2)
})

test('a configuration handoff that fails cleanup restores its predecessor instead of leaking its lease', async () => {
  let creations = 0, reaps = 0
  const runtime = { closed: new Promise(() => {}), transport: { send: async () => {}, close: async () => {
    if (++reaps === 1) throw new Error('reap failed')
  } } }
  const f = lifecycle(async () => { creations++; return { ...runtime } })
  await f.ensureRuntime({ cwd: 'workspace', model: 'old' })
  await assert.rejects(f.ensureRuntime({ cwd: 'workspace', model: 'new' }), /reap failed/)
  assert.equal(creations, 1)
  await f.ensureRuntime({ cwd: 'workspace', model: 'new' })
  assert.equal(reaps, 2, 'the old write owner must be reaped before a replacement can start')
  assert.equal(creations, 2)
})

function transportFixture(invoke) {
  const source = readFileSync('src/services/mcpStdioTransport.ts', 'utf8')
  const code = transformSync(source, { loader: 'ts', target: 'es2022' }).code
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
  return new Function('globalThis', 'crypto', 'invoke', 'Channel', code + '\nreturn { McpStdioTransport, prepareHarnessRuntime };')(
    {}, { randomUUID: () => 'page-realm' }, invoke, class {},
  )
}

test('runner spawning waits for stale-page cleanup and a failed cleanup can be retried', async () => {
  const gate = Promise.withResolvers()
  const calls = []
  let fail = true
  const f = transportFixture(async method => {
    calls.push(method)
    if (method === 'mcp_reap_stale_harness') { await gate.promise; if (fail) throw new Error('reap failed'); return 1 }
    return 'handle'
  })
  const runner = new f.McpStdioTransport({ args: ['/fixture/runner.mjs'], command: 'node' })
  const starting = runner.start()
  const failed = assert.rejects(starting, /reap failed/)
  await Promise.resolve()
  assert.deepEqual(calls, ['mcp_reap_stale_harness'])
  gate.resolve()
  await failed
  fail = false
  await runner.start()
  assert.deepEqual(calls, ['mcp_reap_stale_harness', 'mcp_reap_stale_harness', 'mcp_spawn_stdio'])
})

test('a failed process reap is reported and keeps its handle for a later close attempt', async () => {
  let attempts = 0
  const f = transportFixture(async method => {
    if (method === 'mcp_kill_stdio' && ++attempts === 1) throw new Error('kill failed')
    return 'handle'
  })
  const transport = new f.McpStdioTransport({ args: [], command: 'node' })
  await transport.start()
  await assert.rejects(transport.close(), /kill failed/)
  await transport.close()
  assert.equal(attempts, 2)
})
