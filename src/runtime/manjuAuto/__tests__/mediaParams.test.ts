import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMediaParams, profileFromCapability, profileFromSpec } from '../mediaParams'

const spec = (keys: string[], extra: { duration?: { min?: number; max?: number; allowedValues?: number[] }; maxImages?: number } = {}) => profileFromSpec({
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

test('remote capability profile uses its schema keys, image slot name, duration enum and slot limit', () => {
  const profile = profileFromCapability({
    parameter_schema: { properties: { prompt: {}, ratio: {}, duration: { enum: [5, 10, 15] } } },
    asset_slots: [{ name: 'reference_images', modalities: ['image'], max: 4 }],
  })
  assert.deepEqual(buildMediaParams(profile, { prompt: 'p', ratio: '9:16', images: ['/a.png'], durationSeconds: 7 }),
    { prompt: 'p', ratio: '9:16', reference_images: ['/a.png'], duration: 10 })
  assert.throws(() => buildMediaParams(profile, { prompt: 'p', ratio: '9:16', images: ['1', '2', '3', '4', '5'] }), /上限 4/)
})
