import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { isLocalLoopbackUrl, isLocalOllamaUrl, normalizeRustHttpRequest, shouldUseRustHttpBridge } from '../httpClient'

test('detects local loopback urls', () => {
  assert.equal(isLocalLoopbackUrl('http://127.0.0.1:17880/v1/chat/completions'), true)
  assert.equal(isLocalLoopbackUrl('http://localhost:17880/v1/models'), true)
  assert.equal(isLocalLoopbackUrl('http://[::1]:17880/v1/models'), true)
  assert.equal(isLocalLoopbackUrl('https://api.jiucaihezi.studio/v1/models'), false)
})

test('detects Ollama urls that must use the rust http bridge in Tauri', () => {
  assert.equal(isLocalOllamaUrl('http://127.0.0.1:11434/api/tags'), true)
  assert.equal(isLocalOllamaUrl('http://localhost:11434/api/chat'), true)
  assert.equal(isLocalOllamaUrl('http://127.0.0.1:17880/v1/models'), false)
})

test('routes all loopback requests through the rust bridge in Tauri', () => {
  assert.equal(shouldUseRustHttpBridge('http://127.0.0.1:17880/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ stream: true }),
  }), true)
  assert.equal(shouldUseRustHttpBridge('http://localhost:11434/api/chat', {
    method: 'POST',
    body: JSON.stringify({ stream: true }),
  }), true)
  assert.equal(shouldUseRustHttpBridge('http://127.0.0.1:11434/api/tags', {
    method: 'GET',
  }), true)
  assert.equal(shouldUseRustHttpBridge('https://api.jiucaihezi.studio/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ stream: true }),
  }), true)
})

test('recognizes OpenCode global event GET as a streaming request', async () => {
  const { isStreamingHttpRequest } = await import('../httpClient')
  assert.equal(isStreamingHttpRequest('http://127.0.0.1:53486/global/event', {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }), true)
})

test('preserves SDK Request method authorization body and signal for the rust bridge', async () => {
  const controller = new AbortController()
  const request = new Request('http://127.0.0.1:53486/session/ses_1/prompt_async', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text: '你好' }] }),
    signal: controller.signal,
  })

  const normalized = await normalizeRustHttpRequest(request)

  assert.equal(normalized.url, request.url)
  assert.equal(normalized.init.method, 'POST')
  assert.equal(new Headers(normalized.init.headers).get('authorization'), 'Bearer secret')
  assert.deepEqual(JSON.parse(String(normalized.init.body)), { parts: [{ type: 'text', text: '你好' }] })
  controller.abort()
  assert.equal(normalized.init.signal?.aborted, true)
})

test('aborting a Rust-backed stream errors the reader immediately', () => {
  const source = readFileSync('src/utils/httpClient.ts', 'utf8')
  assert.match(source, /init\?\.signal\?\.addEventListener\('abort'/)
  assert.match(source, /new DOMException\('The operation was aborted', 'AbortError'\)/)
  assert.match(source, /removeEventListener\('abort'/)
})
