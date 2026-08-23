import assert from 'node:assert/strict'
import { test } from 'node:test'

import { connectLocalMlx, normalizeLocalMlxApiBase } from '../localMlxRuntime'

test('normalizeLocalMlxApiBase accepts loopback HTTP services only', () => {
  assert.equal(normalizeLocalMlxApiBase('http://127.0.0.1:8081/v1/'), 'http://127.0.0.1:8081')
  assert.equal(normalizeLocalMlxApiBase('http://localhost:8081'), 'http://localhost:8081')
  assert.throws(() => normalizeLocalMlxApiBase('https://example.com'), /仅支持本机回环地址/)
  assert.throws(() => normalizeLocalMlxApiBase('http://192.168.1.2:8081'), /仅支持本机回环地址/)
})

test('connectLocalMlx reads OpenAI models and persists valid model ids', async () => {
  const store = new Map<string, string>()
  const requested: string[] = []
  const result = await connectLocalMlx('http://127.0.0.1:8081/v1', store, async input => {
    requested.push(String(input))
    return new Response(JSON.stringify({
      data: [
        { id: '/Users/test/MLX/Qwen3.8-27B-Uncensored-MLX/6-bit' },
        { id: '   ' },
      ],
    }), { status: 200 })
  })

  assert.deepEqual(requested, ['http://127.0.0.1:8081/v1/models'])
  assert.equal(result.models.length, 1)
  assert.equal(result.models[0].providerId, 'local-mlx')
  assert.equal(store.get('jcLocalMlxApiBase'), 'http://127.0.0.1:8081')
  assert.match(store.get('jcLocalMlxModels') || '', /Qwen3\.8-27B/)
})

test('connectLocalMlx failures do not overwrite saved models', async () => {
  const previous = JSON.stringify([{ id: 'existing', providerId: 'local-mlx' }])
  const store = new Map<string, string>([['jcLocalMlxModels', previous]])

  await assert.rejects(
    () => connectLocalMlx('http://127.0.0.1:8081', store, async () => new Response('{}', { status: 503 })),
    /HTTP 503/,
  )
  assert.equal(store.get('jcLocalMlxModels'), previous)
})
