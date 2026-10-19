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
import { runHarnessTask } from '../../src-tauri/resources/deepseek-harness/run-task.mjs'

test('required app tools are checked before any prompt or subscription is created', async () => {
  let prompted = false, subscribed = false, checked = false
  const harness = { async start() {}, client: {
    request: async (method, params) => {
      assert.equal(method, 'session/check-tools')
      assert.deepEqual(params.names, ['create_3d_scene'])
      checked = true
      throw new Error('内置工具未就绪：create_3d_scene')
    },
    prompt: async () => { prompted = true; throw new Error('must not send') },
    subscribeSessionTree: () => { subscribed = true; throw new Error('must not subscribe') },
  } }
  await assert.rejects(runHarnessTask(harness, [], {
    sessionId: 'parent', requiredTools: ['create_3d_scene'], onNotification() {},
  }), /内置工具未就绪/)
  assert.equal(checked, true)
  assert.equal(prompted, false)
  assert.equal(subscribed, false)
})

test('APP task waits beyond the first idle and includes the final parent summary', async () => {
  const queue = []
  const finished = Promise.withResolvers()
  const waiting = Promise.withResolvers()
  let pending, closed = false, settled = false
  const push = value => {
    if (pending) { const waiter = pending; pending = undefined; waiter.resolve(value) }
    else queue.push(value)
  }
  const event = (type, data) => ({ method: 'session.event', params: { sessionId: 'parent', event: { type, data } } })
  const harness = { async start() {}, client: {
    subscribeSessionTree() { return {
      next() { if (queue.length) return Promise.resolve(queue.shift()); pending = Promise.withResolvers(); return pending.promise },
      tryNext() { return queue.shift() },
      close() { closed = true; pending?.reject(new Error('closed')) },
    } },
    async prompt() {
      push(event('agent/inbox/spliced', { inserted: [{ id: 'input' }] }))
      push(event('assistant/message', { message: { content: [{ type: 'text', text: 'delegated' }] } }))
      push({ method: 'session.status', params: { sessionId: 'parent', status: 'idle' } })
      return 'input'
    },
    request(method, params) {
      assert.equal(method, 'session/wait')
      assert.equal(params.sessionId, 'parent')
      waiting.resolve()
      return finished.promise
    },
  } }
  const seen = []
  const running = runHarnessTask(harness, [], { sessionId: 'parent', onNotification: n => seen.push(n) })
    .then(result => { settled = true; return result })
  await waiting.promise
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false, 'first idle must not finish a task with active children')
  push(event('assistant/message', { message: { content: [{ type: 'text', text: 'final summary' }] } }))
  finished.resolve({})
  assert.equal((await running).finalResponse, 'final summary')
  assert.equal(seen.length, 4)
  assert.equal(closed, true)
})

test('APP task rejects failed waits and missing receipts and releases its subscription', async () => {
  for (const waitError of [undefined, new Error('child runtime failed')]) {
    let rejectNext, closed = false
    const harness = { async start() {}, client: {
      subscribeSessionTree() { return {
        next() { return new Promise((_resolve, reject) => { rejectNext = reject }) },
        tryNext() {},
        close() { closed = true; rejectNext?.(new Error('closed')) },
      } },
      async prompt() { return 'input' },
      async request() { if (waitError) throw waitError; return {} },
    } }
    await assert.rejects(runHarnessTask(harness, [], { sessionId: 'parent', onNotification() {} }),
      waitError ? /child runtime failed/ : /durable input receipt/)
    assert.equal(closed, true)
  }
})

async function fixture(t, configured = false, modelGate, { respond, maxTokens = 1024 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jc-session-lease-'))
  const requests = []
  const http = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    if (respond && await respond(requests.at(-1), res, requests.length)) return
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (modelGate) await modelGate.promise
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'OK' }, null], [{}, 'stop']])
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const patch = join(root, 'route.yml')
  writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      jiucaihezi:\n        apiKeyEnv: JIUCAIHEZI_DH_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${http.address().port}/v1\n        models:\n          - id: test\n            name: test\n            contextWindow: 262144\n            maxTokens: ${maxTokens}\n` + (configured ? `- id: agent-loop\n  config:\n    agents:\n      - id: configured\n        sessionId: lease-test\n        cwd: ${JSON.stringify(root)}\n        provider: jiucaihezi\n        model: test\n` : ''))
  const options = { cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch], provider: 'jiucaihezi', model: 'test', initializeTimeoutMs: 15000,
    env: { ...process.env, DSH_AGENTS_HOME: join(root, 'agents'), DSH_PRIMARY_RUNTIME: '', JIUCAIHEZI_DH_API_KEY: 'local-test' } }
  const harnesses = []
  const create = (overrides = {}) => { const h = new DeepSeekHarness({ ...options, ...overrides }); harnesses.push(h); return h }
  const createRunner = () => {
    const ready = Promise.withResolvers()
    const closed = Promise.withResolvers()
    const pending = new Map()
    const notifications = []
    let next = 0
    let stopping
    const runnerPath = fileURLToPath(new URL('../../src-tauri/resources/deepseek-harness/runner.mjs', import.meta.url))
    const child = spawn(process.execPath, [runnerPath, JSON.stringify({ cwd: root, dshHome: options.dshHome, patchPath: patch, model: 'test' })], { env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr.resume()
    createInterface({ input: child.stdout }).on('line', line => {
      const frame = JSON.parse(line)
      if (frame.type === 'notification') notifications.push(frame.notification)
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
      notifications,
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
  return { create, createRunner, requests, root, patch, options }
}

test('APP runner inherits official retries: 524 gets five retries, an unclassified error gets none', { timeout: 45000 }, async t => {
  let status = 524
  const f = await fixture(t, false, undefined, { respond: (_request, res) => {
    res.writeHead(status)
    res.end()
    return true
  } })
  const runner = f.createRunner()
  const run = sessionId => runner.request({ type: 'run', sessionId, contentBlocks: [{ type: 'text', text: 'test retry policy' }] })
  const failed = await run('server-error')
  assert.equal(failed.type, 'error')
  assert.equal(f.requests.length, 6)
  const events = runner.notifications.filter(n => n.method === 'session.event').map(n => n.params.event)
  assert.equal(events.filter(e => e.type === 'llm/retry').length, 5)
  assert.equal(events.filter(e => e.type === 'llm/retry-started').length, 5)
  assert.equal(events.findLast(e => e.type === 'turn/end').data.reason.error.code, 'SERVER')
  const saved = (await runner.request({ type: 'read-session', sessionId: 'server-error' })).data
  assert.equal(saved.events.filter(e => e.type === 'llm/retry').length, 5)

  status = 418
  assert.equal((await run('unknown-error')).type, 'error')
  assert.equal(f.requests.length, 7, 'PI_AI_ERROR must fail after the first request')
  const unknown = (await runner.request({ type: 'read-session', sessionId: 'unknown-error' })).data
  assert.equal(unknown.events.findLast(e => e.type === 'turn/end').data.reason.error.code, 'PI_AI_ERROR')
  assert.equal(unknown.events.filter(e => e.type === 'llm/retry').length, 0)
})

test('SDK prunes tool results, compacts under pressure, and cold-resumes the replacement surface', { timeout: 45000 }, async t => {
  let readRequested = false
  const f = await fixture(t, false, undefined, {
    maxTokens: 32768,
    respond: (request, res) => {
      if (readRequested || !JSON.stringify(request.messages).includes('HISTORY_TWO')) return false
      readRequested = true
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'read-test', type: 'function', function: {
        name: 'read', arguments: JSON.stringify({ file_path: join(f.root, 'tool.txt') }),
      } }] }
      res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
      return true
    },
  })
  const original = Array.from({ length: 600 }, (_, i) => `original-tool-line-${i}: abcdefghijklmnopqrstuvwxyz`).join('\n')
  writeFileSync(join(f.root, 'tool.txt'), original)
  const runner = f.createRunner()
  const run = (host, text) => host.request({ type: 'run', sessionId: 'compaction-test', contentBlocks: [{ type: 'text', text }] })
  assert.equal((await run(runner, 'HISTORY_ONE\n' + 'a'.repeat(350000))).type, 'result')
  assert.equal((await run(runner, 'HISTORY_TWO\n' + 'b'.repeat(350000))).type, 'result')
  const saved = (await runner.request({ type: 'read-session', sessionId: 'compaction-test' })).data
  const toolResults = saved.events.filter(e => e.type === 'tool/result')
  assert.ok(toolResults.some(e => e.surfaceOp === 'append' && JSON.stringify(e.data).includes('original-tool-line-300')))
  assert.ok(toolResults.some(e => typeof e.surfaceOp === 'object' && JSON.stringify(e.data).includes('pruned')))
  for (const type of ['compaction/start', 'compaction/summary', 'compaction/end']) {
    assert.ok(saved.events.some(e => e.type === type), `${type} must be persisted`)
    assert.ok(runner.notifications.some(n => n.method === 'session.event' && n.params.event.type === type), `${type} must reach the APP`)
  }
  assert.ok(saved.events.some(e => e.type === 'user/message' && e.surfaceOp === 'append' && JSON.stringify(e.data).includes('HISTORY_ONE')))
  await runner.close()
  const restored = f.createRunner()
  assert.equal((await run(restored, 'continue after restart')).type, 'result')
  assert.match(JSON.stringify(f.requests.at(-1).messages), /<compacted-summary>/)
})

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

test('official SDK resume preserves history and rejects missing sessions without creating replacements', { timeout: 45000 }, async t => {
  const f = await fixture(t)
  const first = f.create()
  await first.run('saved before upgrade', { sessionId: 'official-resume' })
  await first.close()
  const next = f.create()
  const session = await next.resumeSession('official-resume')
  await session.run('continued after upgrade')
  await next.client.request('session/wait', { sessionId: 'official-resume' })
  assert.match(JSON.stringify(f.requests[1].messages), /saved before upgrade/)
  assert.equal(f.requests.length, 2)
  await assert.rejects(next.resumeSession('missing-session'))
  const sessions = await next.client.request('session/list', {})
  assert.doesNotMatch(JSON.stringify(sessions), /missing-session/)
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

test('SDK waits for approval attachment even after the official creator registers its Agent', async t => {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { HarnessSdkJsonRpcServer } = await import(`${vendor}dsh-sdk-jsonrpc-server/lib/index.js`)
  const ctx = new Context()
  const server = new HarnessSdkJsonRpcServer(ctx, { notify() {} })
  const gate = Promise.withResolvers()
  const rec = { handle: { agent: {} } }
  server.createSession = async id => { server.sessions.set(id, rec); await gate.promise; return rec }
  t.after(async () => { gate.resolve(); await server.shutdown(); await ctx.fiber.dispose() })
  const first = server.getOrCreateSession('attaching')
  let delivered = false
  const second = server.getOrCreateSession('attaching').then(value => { delivered = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(delivered, false, 'a registered Agent is not ready until its approval bridge is attached')
  gate.resolve()
  assert.equal(await first, rec)
  assert.equal(await second, rec)
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

// 原版模块由 npm pack 的同版本发布包提供；不反向撤销 App 补丁来伪造对照组。
test('official unpatched SDK and APP runner share request budgets, tool loops and asynchronous subagents', { timeout: 45000 }, async t => {
  const officialServer = process.env.DSH_OFFICIAL_CONTROL_SERVER
  if (!officialServer) return t.skip('set DSH_OFFICIAL_CONTROL_SERVER to an unmodified 0.2.1-rc.2 server module')
  assert.doesNotMatch(readFileSync(officialServer, 'utf8'), /attachApprovalBridge|applyPinnedSkillScope|createOfficialSession/)
  const f = await fixture(t, false, undefined, { respond(request, res) {
    const text = JSON.stringify(request.messages)
    const called = request.messages.some(m => m.role === 'assistant' && m.tool_calls?.length)
    const tool = !called && text.includes('READ_FIXTURE') ? 'read'
      : !called && text.includes('DELEGATE_FIXTURE') ? 'subagent' : undefined
    if (!tool) return false
    const args = tool === 'read' ? { file_path: join(f.root, 'input.md') }
      : { description: 'Compare child route', prompt: 'CHILD_FIXTURE' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-fixture', type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
    return true
  } })
  writeFileSync(join(f.root, 'input.md'), 'READ_RESULT_FIXTURE')
  const controlPatch = join(f.root, 'control.yml')
  writeFileSync(controlPatch, `- id: sdk-jsonrpc-server\n  name: ${JSON.stringify(officialServer)}\n`)
  const official = f.create({ dshHome: join(f.root, 'official-home'), patches: [f.patch, controlPatch] })
  const app = f.createRunner()
  const signatures = []
  for (const host of [official, app]) {
    const start = f.requests.length
    const events = []
    for (const [sessionId, text] of [['plain', 'PLAIN_FIXTURE'], ['read', 'READ_FIXTURE'], ['parent', 'DELEGATE_FIXTURE']]) {
      if (host === official) {
        const result = await runHarnessTask(host, [{ type: 'text', text }], { sessionId,
          onNotification(n) { if (n.method === 'session.event') events.push(n.params.event) } })
        assert.equal(result.finalResponse, 'OK')
      } else {
        assert.equal((await host.request({ type: 'run', sessionId, contentBlocks: [{ type: 'text', text }] })).type, 'result')
      }
    }
    if (host === app) events.push(...app.notifications.filter(n => n.method === 'session.event').map(n => n.params.event))
    const requests = f.requests.slice(start)
    assert.ok(requests.length >= 6)
    assert.ok(requests.every(r => (r.max_tokens ?? r.max_completion_tokens) === 1024), `catalog budget differs: ${JSON.stringify(requests.map(r => ({ model: r.model, max_tokens: r.max_tokens, max_completion_tokens: r.max_completion_tokens })))}`)
    assert.ok(events.some(e => e.type === 'request/context' && e.data.contextWindow === 262144))
    const activations = events.filter(e => e.type === 'tool/result' && JSON.stringify(e.data).includes('started subagent '))
    assert.ok(activations.length, `subagent activation missing: ${JSON.stringify(events.filter(e => e.type === 'tool/result').map(e => e.data))}`)
    // 比较所有模型可见工具定义，不绑定并发完成时的请求到达顺序。
    signatures.push([...new Set(requests.map(r => JSON.stringify({ model: r.model, max_tokens: r.max_tokens, max_completion_tokens: r.max_completion_tokens,
      tools: r.tools, tool_choice: r.tool_choice })))].sort())
  }
  assert.deepEqual(signatures[1], signatures[0])
  const snapshot = (await app.request({ type: 'read-session', sessionId: 'parent' })).data
  assert.equal(snapshot.contextPressure.contextWindow, 262144)
})
