import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isLocalLoopbackUrl, isLocalOllamaUrl, shouldUseRustHttpBridge } from '../httpClient'

test('detects local loopback urls that should stay on native fetch', () => {
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

test('keeps mlx local requests native but routes Ollama through the rust http bridge', () => {
  assert.equal(shouldUseRustHttpBridge('http://127.0.0.1:17880/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ stream: true }),
  }), false)
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
