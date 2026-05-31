import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCreationModelAvailability,
  publicErrorPayload,
  parseChannelRows,
  sanitizeErrorForLog,
} from '../server.mjs'

test('parseChannelRows reads NewAPI channel rows', () => {
  const rows = parseChannelRows('55\tRH-图片\t1\thttp://172.17.0.1:8789\trh-pro-image,rh-gpt2-text\n')

  assert.deepEqual(rows, [
    {
      id: 55,
      name: 'RH-图片',
      status: 1,
      baseUrl: 'http://172.17.0.1:8789',
      models: ['rh-pro-image', 'rh-gpt2-text'],
    },
  ])
})

test('buildCreationModelAvailability marks configured status from NewAPI channels', () => {
  const models = buildCreationModelAvailability([
    { id: 14, name: 'official', status: 1, baseUrl: 'x', models: ['gpt-image-2'] },
    { id: 16, name: 't8', status: 1, baseUrl: 'x', models: ['nano-banana-pro-4k'] },
    { id: 55, name: 'RH-图片', status: 1, baseUrl: 'x', models: ['rh-pro-image', 'rh-gpt2-text'] },
    { id: 56, name: 'RH-视频', status: 3, baseUrl: 'x', models: ['grok-video-3'] },
  ], new Date('2026-05-31T00:00:00Z'))

  const byId = Object.fromEntries(models.map(model => [model.id, model]))

  assert.equal(byId['gpt-image-2'].status, 'enabled')
  assert.equal(byId['nano-banana-4k'].status, 'enabled')
  assert.equal(byId['rh-pro-image'].status, 'enabled')
  assert.equal(byId['grok-video-3'].status, 'disabled')
  assert.equal(byId['grok-video-3'].reason, 'NewAPI 渠道已自动禁用')
  assert.equal(byId['rh-grok-text-video'].status, 'disabled')
  assert.equal(byId['rh-grok-text-video'].reason, 'NewAPI 未配置该模型渠道')
})

test('publicErrorPayload does not expose internal exception details', () => {
  assert.deepEqual(publicErrorPayload(new Error('PGPASSWORD leaked stack detail'), () => {}), {
    success: false,
    error: {
      message: '模型可用性服务暂不可用',
    },
  })
})

test('sanitizeErrorForLog redacts password-bearing command details', () => {
  const safe = sanitizeErrorForLog({
    message: 'command failed: docker exec -e PGPASSWORD=secret-value postgres psql',
    stack: 'Error: failed\n    at queryChannels\nPGPASSWORD=another-secret',
    cmd: 'docker exec -e PGPASSWORD=secret-value postgres psql',
  })

  assert.ok(!safe.includes('secret-value'))
  assert.ok(!safe.includes('another-secret'))
  assert.ok(safe.includes('PGPASSWORD=***'))
})
