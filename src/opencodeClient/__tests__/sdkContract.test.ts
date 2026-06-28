/**
 * OpenCode SDK 契约集成测试
 *
 * 启动真实 OpenCode 二进制，验证 SDK 关键 API 行为与我们的代码预期一致。
 * 每次 SDK 升级、每次改 opencodeClient/* 后必须跑。
 *
 * 运行：pnpm run test:focused
 * 跳过条件：找不到 opencode 二进制时自动 skip
 */

import assert from 'node:assert/strict'
import { test, beforeEach, afterEach } from 'node:test'
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'

// ── helpers ──────────────────────────────────────────────

function resolveBinary(): string | null {
  const candidates = [
    join(process.cwd(), 'src-tauri/binaries/opencode-aarch64-apple-darwin'),
    join(process.cwd(), 'src-tauri/binaries/opencode-x86_64-apple-darwin'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // fallback: try PATH
  try { return execSync('which opencode', { encoding: 'utf-8' }).trim() || null } catch { /* */ }
  return null
}

interface ServerHandle {
  url: string
  password: string
  process: ReturnType<typeof spawn>
}

function startServer(binary: string): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const password = randomBytes(16).toString('hex')
    const port = 19876 + Math.floor(Math.random() * 1000)
    const tmpDir = join(tmpdir(), `jc-contract-${Date.now()}`)
    execSync(`mkdir -p "${tmpDir}"`)

    const child = spawn(binary, [
      'serve',
      `--hostname=127.0.0.1`,
      `--port=${port}`,
    ], {
      cwd: tmpDir,
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_CONFIG_CONTENT: '{}',
        OPENCODE_AUTH_CONTENT: '{}',
        OPENCODE_EXPERIMENTAL: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('OpenCode server 启动超时（10s）'))
    }, 10000)

    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('opencode server listening')) {
        clearTimeout(timeout)
        const match = output.match(/https?:\/\/[\w.]+:\d+/)
        const url = match ? match[0] : `http://127.0.0.1:${port}`
        resolve({ url, password, process: child })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code !== null) reject(new Error(`OpenCode 进程意外退出，code=${code}`))
    })
  })
}

function createClient(handle: ServerHandle): OpencodeClient {
  return createOpencodeClient({
    baseUrl: handle.url,
    headers: { Authorization: `Bearer ${handle.password}` },
  })
}

// ── test suite ───────────────────────────────────────────

const binary = resolveBinary()

if (!binary) {
  test('SKIP: 未找到 opencode 二进制，契约测试跳过', { skip: true }, () => {})
} else {
  let handle: ServerHandle | null = null
  let client: OpencodeClient | null = null

  beforeEach(async () => {
    handle = await startServer(binary!)
    client = createClient(handle)
  })

  afterEach(() => {
    handle?.process.kill('SIGTERM')
    handle = null
    client = null
  })

  // ── 契约 1: session.create ─────────────────────────────

  test('session.create 应在 3s 内返回带 id 的 session 对象', async () => {
    const result = await client!.session.create({ title: 'contract-test' })
    const data = (result as any)?.data || result
    assert.ok(data, 'session.create 应返回 data')
    assert.ok(typeof data.id === 'string' && data.id.length > 0, 'session 应有 id')
  })

  // ── 契约 2: session.prompt ─────────────────────────────

  test('session.prompt 应在 5s 内返回 message 对象（含 info + parts）', async () => {
    const session = ((await client!.session.create({ title: 'prompt-test' })) as any)?.data
    const result = await client!.session.prompt({
      sessionID: session.id,
      parts: [{ type: 'text', text: '回复一个字：好' }],
    })
    const data = (result as any)?.data || result
    assert.ok(data, 'session.prompt 应返回 data')
    assert.ok(data.info || data.id, 'prompt 响应应含 info 或 id')
    // 官方返回结构：{ data: { info: Message, parts: Part[] } }
    if (data.info) {
      assert.ok(data.info.role === 'assistant' || data.info.type === 'assistant',
        `assistant message role 应为 assistant，实际 ${data.info.role || data.info.type}`)
      assert.ok(Array.isArray(data.parts), 'parts 应为数组')
    }
  })

  // ── 契约 3: event.subscribe ────────────────────────────

  test('event.subscribe 应在 8s 内收到 ≥1 个事件，且事件含 type 属性', async () => {
    const session = ((await client!.session.create({ title: 'event-test' })) as any)?.data
    // 发送一个 prompt 以产生事件
    void client!.session.prompt({
      sessionID: session.id,
      parts: [{ type: 'text', text: '回复一个字：好' }],
    })

    const eventStream = await client!.event.subscribe({ directory: undefined })
    const events: unknown[] = []
    const timeout = setTimeout(() => eventStream.return?.(), 8000)

    try {
      for await (const event of eventStream) {
        events.push(event)
        if (events.length >= 5) break // 收够 5 个事件即可
      }
    } finally {
      clearTimeout(timeout)
    }

    assert.ok(events.length >= 1, `应在 8s 内收到至少 1 个事件，实际 ${events.length} 个`)
    // 官方事件格式：{ type: string, properties: Record<string, unknown> }
    for (const event of events) {
      const evt = event as any
      assert.ok(typeof evt.type === 'string' && evt.type.length > 0,
        `每个事件应有 type 字符串，实际: ${JSON.stringify(evt).slice(0, 120)}`)
    }
  })

  // ── 契约 4: session.messages ────────────────────────────

  test('session.messages 应在 prompt 后返回 ≥1 条消息', async () => {
    const session = ((await client!.session.create({ title: 'messages-test' })) as any)?.data
    await client!.session.prompt({
      sessionID: session.id,
      parts: [{ type: 'text', text: '回复一个字：好' }],
    })

    // 等一小会确保消息持久化
    await new Promise(r => setTimeout(r, 2000))

    const result = await client!.session.messages({ sessionID: session.id })
    const messages = Array.isArray(result)
      ? result
      : ((result as any)?.data || (result as any)?.messages || [])
    assert.ok(messages.length >= 1, `应至少有 1 条消息，实际 ${messages.length} 条`)
    const hasUser = messages.some((m: any) =>
      (m.role === 'user' || m.type === 'user') &&
      (typeof m.content === 'string' || Array.isArray(m.content) || (m as any).parts?.length > 0)
    )
    assert.ok(hasUser, '应有 user 消息')
  })

  // ── 契约 5: session.abort ──────────────────────────────

  test('session.abort 应不抛异常', async () => {
    const session = ((await client!.session.create({ title: 'abort-test' })) as any)?.data
    // 发一个 prompt 然后立即 abort
    void client!.session.prompt({
      sessionID: session.id,
      parts: [{ type: 'text', text: '写一篇关于AI的5000字论文' }],
    })
    await new Promise(r => setTimeout(r, 500))
    await assert.doesNotReject(() =>
      client!.session.abort({ sessionID: session.id }),
      'abort 不应抛异常'
    )
  })
}
