import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMediaParams } from '../mediaParams'

const spec = (keys: string[], extra: { duration?: { min?: number; max?: number; allowedValues?: number[] }; maxImages?: number } = {}) => ({
  fields: keys.map(key => ({ key, label: key, kind: 'text' })) as never,
  capabilities: { duration: extra.duration } as never,
  files: extra.maxImages === undefined ? undefined : { images: { max: extra.maxImages } },
})

test('uses the model-specific ratio field name', () => {
  assert.deepEqual(buildMediaParams(spec(['prompt', 'ratio']), { prompt: 'p', ratio: '9:16' }), { prompt: 'p', ratio: '9:16' })
  assert.deepEqual(buildMediaParams(spec(['prompt', 'aspect_ratio']), { prompt: 'p', ratio: '9:16' }), { prompt: 'p', aspect_ratio: '9:16' })
})

test('rounds duration up to the nearest allowed value and rejects overlong segments', () => {
  const fixed = spec(['ratio'], { duration: { allowedValues: [5, 10, 15, 30] } })
  assert.equal(buildMediaParams(fixed, { prompt: 'p', ratio: '9:16', durationSeconds: 13 }).duration, 15)
  assert.throws(() => buildMediaParams(spec(['ratio'], { duration: { allowedValues: [15] } }), { prompt: 'p', ratio: '9:16', durationSeconds: 28 }), /最长 15/)
  assert.equal(buildMediaParams(spec(['ratio'], { duration: { min: 4, max: 30 } }), { prompt: 'p', ratio: '9:16', durationSeconds: 3 }).duration, 4)
  assert.throws(() => buildMediaParams(spec(['ratio'], { duration: { min: 4, max: 15 } }), { prompt: 'p', ratio: '9:16', durationSeconds: 20 }), /最长 15/)
})

test('passes reference images in order and rejects counts above the model limit', () => {
  assert.deepEqual(buildMediaParams(spec(['ratio'], { maxImages: 2 }), { prompt: 'p', ratio: '9:16', images: ['/a.png', '/b.png'] }).images, ['/a.png', '/b.png'])
  assert.throws(() => buildMediaParams(spec(['ratio'], { maxImages: 1 }), { prompt: 'p', ratio: '9:16', images: ['/a.png', '/b.png'] }), /上限 1/)
})
