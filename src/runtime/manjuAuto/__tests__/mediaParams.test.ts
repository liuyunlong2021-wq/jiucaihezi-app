import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'
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

test('sends the chosen resolution only to models that declare a resolution field', () => {
  assert.equal(buildMediaParams(spec(['ratio', 'resolution']), { prompt: 'p', ratio: '9:16', resolution: '480P' }).resolution, '480P')
  assert.equal(buildMediaParams(spec(['ratio']), { prompt: 'p', ratio: '9:16', resolution: '480P' }).resolution, undefined)
})

// 项目风格里存的是「9:16」，而 H3 的 ResolutionSelector 只认「9:16 (Portrait Widescreen)」。
// 直接透传会让 submit_creation_task 抛「比例不支持：9:16」，整集被拦住。
test('项目短比例按模型登记的比例枚举收敛', () => {
  const h3 = profileFromSpec(getCreationModelSpec('jc-minimax-h3-ref2v')!)
  assert.equal(buildMediaParams(h3, { prompt: 'p', ratio: '9:16' }).ratio, '9:16 (Portrait Widescreen)')
  assert.equal(buildMediaParams(h3, { prompt: 'p', ratio: '16:9' }).ratio, '16:9 (Widescreen)')
  // 已经是枚举原值时不能再套一层
  assert.equal(buildMediaParams(h3, { prompt: 'p', ratio: '1:1 (Square)' }).ratio, '1:1 (Square)')

  // 图片模型登记的就是短比例，必须原样透传，不能被改写
  const image = profileFromSpec(getCreationModelSpec('jc-qwen-image-2.1')!)
  assert.equal(buildMediaParams(image, { prompt: 'p', ratio: '9:16' }).ratio, '9:16')
})

test('模型没有的比例要在提交前报出可读原因，而不是交给后端拒', () => {
  const h3 = profileFromSpec(getCreationModelSpec('jc-minimax-h3-ref2v')!)
  assert.throws(() => buildMediaParams(h3, { prompt: 'p', ratio: '7:5' }), /比例 7:5 该模型不支持.*9:16/)
})

test('远程能力档案同样按枚举收敛比例', () => {
  const profile = profileFromCapability({
    parameter_schema: { properties: { prompt: {}, aspect_ratio: { enum: ['16:9 (Widescreen)', '9:16 (Portrait Widescreen)'] } } },
    asset_slots: [],
  })
  assert.equal(buildMediaParams(profile, { prompt: 'p', ratio: '9:16' }).aspect_ratio, '9:16 (Portrait Widescreen)')
})
