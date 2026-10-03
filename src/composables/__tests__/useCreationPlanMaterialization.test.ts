import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addFiles,
  buildCurrentCreationParams,
  clearFiles,
  cpState,
  currentRunPlan,
  genericModelFields,
  setAspect,
  setResolution,
  switchModel,
  switchTask,
} from '../useCreation'

function makeFile(name: string, type: string): File {
  return new File(['fixture'], name, { type })
}

test('switching from a 2K GPT route to the 1K route discards the stale derived size', () => {
  switchTask('image')
  switchModel('gpt-image-2-超分')
  cpState.prompt = '一张方形图片'
  cpState.ar = '1:1'
  setResolution('2k')
  assert.equal(cpState.size, '2048x2048')

  switchModel('gpt-image-2-1k')

  assert.equal(buildCurrentCreationParams().size, undefined)
  assert.equal(currentRunPlan.value?.debug.normalizedParams.size, '1024x1024')
})

test('buildCurrentCreationParams keeps creation file objects so plan preview can materialize the same payload as submit', () => {
  switchTask('image')
  switchModel('gpt-image-2-超分')
  clearFiles()

  addFiles([makeFile('hero.png', 'image/png')])
  cpState.prompt = '一张电影海报'

  const params = buildCurrentCreationParams()

  assert.equal(Array.isArray(params.images), true)
  assert.equal((params.images as unknown[])[0] instanceof File, true)
  assert.equal((params.image as unknown[])[0] instanceof File, true)
  assert.equal((params.images as File[])[0]?.name, 'hero.png')

  clearFiles()
})

test('短式比例在面板里就补全成模型枚举，不会原样发给工作流', () => {
  switchTask('video')
  switchModel('jc-minimax-h3-ref2v')
  clearFiles()
  cpState.prompt = '镜头缓慢推进'

  // 记忆计划/画布给的是 '16:9' 这种界面标签；原样提交会被 ResolutionSelector 的
  // 「Value not in list」校验直接拒掉（2026-10-02 实测）
  setAspect('16:9')
  assert.equal(cpState.ar, '16:9 (Widescreen)')

  const params = buildCurrentCreationParams({ images: ['https://cdn.example.test/a.png'] })
  assert.equal(params.aspect_ratio, '16:9 (Widescreen)')

  // 已经是枚举值就原样保留
  setAspect('21:9 (Ultrawide)')
  assert.equal(cpState.ar, '21:9 (Ultrawide)')
})

test('buildCurrentCreationParams materializes current model field defaults into RunPlan params', () => {
  switchTask('image')
  switchModel('runninghub/api/z-image-turbo')
  clearFiles()

  cpState.prompt = '一张品牌海报'
  cpState.ar = '16:9'

  const params = buildCurrentCreationParams()

  assert.equal(params.outputFormat, 'png')
  assert.equal(params.lora_strength, 1)
})

test('buildCurrentCreationParams uses the selected server AI App contract', () => {
  switchTask('ai-app')
  switchModel('runninghub/aiapp/rh-aiapp')
  cpState.aiAppWebappId = '12345'
  cpState.aiAppLabel = '图片应用'
  cpState.aiAppOutputType = 'image'
  cpState.aiAppBillingModel = 'rh-custom-image'

  const params = buildCurrentCreationParams()

  assert.equal(params.webappId, '12345')
  assert.equal(params.outputType, 'image')
  assert.equal(params.billingModel, 'rh-custom-image')
  assert.equal(params.prompt, cpState.prompt)
})

test('Minimax H3 AI Apps use one prompt and map canvas images to workflow slots', () => {
  switchTask('ai-app')
  switchModel('runninghub/aiapp/rh-aiapp')
  cpState.aiAppWebappId = '2093662476146667522'
  cpState.aiAppLabel = 'Minimax-h3 多参3图'
  cpState.aiAppOutputType = 'video'
  cpState.aiAppBillingModel = 'rh-aiapp'
  cpState.prompt = '三个人一起大笑'
  cpState.aiAppFields = [
    { key: '137:image', label: 'image1', kind: 'image' },
    { key: '156:image', label: 'image2', kind: 'image' },
    { key: '157:image', label: 'image3', kind: 'image' },
    { key: '141:text', label: '提示词', kind: 'text', defaultValue: '旧提示词' },
    { key: '115:megapixels', label: '质量', kind: 'number', defaultValue: '0.4' },
    { key: '132:value', label: '时长', kind: 'number', defaultValue: '2' },
  ]

  const params = buildCurrentCreationParams({ images: ['left.png', 'middle.png', 'right.png'] })

  assert.equal(params.prompt, '三个人一起大笑')
  assert.equal(params['141:text'], '三个人一起大笑')
  assert.equal(params['137:image'], 'left.png')
  assert.equal(params['156:image'], 'middle.png')
  assert.equal(params['157:image'], 'right.png')
  // 质量控件已隐藏，固定提交 0.9；时长统一默认 5，不沿用工作流自带的 2
  assert.equal(params['115:megapixels'], 0.9)
  assert.equal(params['132:value'], 5)

  // 张数是上限不是等值：少传时按顺序只占用前面的槽位
  const partial = buildCurrentCreationParams({ images: ['only-one.png'] })
  assert.equal(partial['137:image'], 'only-one.png')
  assert.equal(partial['156:image'], 'None')
  assert.equal(partial['157:image'], 'None')

  assert.throws(
    () => buildCurrentCreationParams({ images: ['a.png', 'b.png', 'c.png', 'd.png'] }),
    /最多 3 张参考图/,
  )
})

test('Minimax H3 node 134 prompt is merged into the main creation prompt', () => {
  switchTask('ai-app')
  switchModel('runninghub/aiapp/rh-aiapp')
  cpState.aiAppWebappId = '2093571735550521345'
  cpState.aiAppLabel = 'Minimax-h3 首帧图生视频'
  cpState.aiAppOutputType = 'video'
  cpState.aiAppBillingModel = 'rh-aiapp'
  cpState.prompt = '镜头推近人物'
  cpState.aiAppFields = [
    { key: '134:text', label: '提示词', kind: 'text', defaultValue: '工作流默认提示词' },
    { key: '140:image', label: '首帧', kind: 'image' },
  ]

  const params = buildCurrentCreationParams({ images: ['first.png'] })

  assert.equal(params.prompt, '镜头推近人物')
  assert.equal(params['134:text'], '镜头推近人物')
  assert.equal(params['140:image'], 'first.png')
})

test('文武双修 应用用 28:prompt 承接主提示词，参考图按画布顺序取前 N 张', () => {
  switchTask('ai-app')
  switchModel('runninghub/aiapp/rh-aiapp')
  cpState.aiAppWebappId = '2101840271142117377'
  cpState.aiAppLabel = '文武双修'
  cpState.aiAppOutputType = 'video'
  cpState.aiAppBillingModel = 'rh-aiapp'
  cpState.prompt = '一个男人在雨里回头'
  cpState.aiAppFields = [
    { key: '28:prompt', label: 'prompt', kind: 'text', defaultValue: '作者示例提示词' },
    ...[6, 35, 36, 37, 38, 39, 40, 41, 42].map((nodeId, index) => ({
      key: `${nodeId}:image`,
      label: `image${index + 1}`,
      kind: 'image',
    })),
    { key: '29:aspect_ratio', label: '比例', kind: 'select', defaultValue: '16:9 (Widescreen)' },
    { key: '27:value', label: '时长', kind: 'number', defaultValue: '15' },
  ]

  const params = buildCurrentCreationParams({
    images: [1, 2, 3].map(index => `ref-${index}.png`),
  })

  assert.equal(params.prompt, '一个男人在雨里回头')
  assert.equal(params['28:prompt'], '一个男人在雨里回头')
  assert.equal(params['6:image'], 'ref-1.png')
  assert.equal(params['36:image'], 'ref-3.png')
  assert.equal(params['37:image'], 'None')
  assert.equal(params['29:aspect_ratio'], '16:9 (Widescreen)')
  assert.equal(params['27:value'], 5)
})

test('多参-4图 的时长节点描述是 value，仍按统一默认 5 提交', () => {
  switchTask('ai-app')
  switchModel('runninghub/aiapp/rh-aiapp')
  cpState.aiAppWebappId = '2093651661213491202'
  cpState.aiAppLabel = 'Minimax-h3 多参-4图'
  cpState.aiAppOutputType = 'video'
  cpState.aiAppBillingModel = 'rh-aiapp'
  cpState.prompt = '四个人一起转绘'
  cpState.aiAppFields = [
    ...[137, 156, 157, 158].map((nodeId, index) => ({
      key: `${nodeId}:image`,
      label: 'image',
      kind: 'image',
    })),
    { key: '141:text', label: 'text', kind: 'text', defaultValue: '旧提示词' },
    { key: '115:aspect_ratio', label: 'aspect_ratio', kind: 'select', defaultValue: '9:16 (Portrait Widescreen)' },
    { key: '115:megapixels', label: 'megapixels', kind: 'number', defaultValue: '0.4' },
    { key: '132:value', label: 'value', kind: 'number', defaultValue: '15' },
  ]

  const params = buildCurrentCreationParams({ images: ['a.png', 'b.png'] })

  assert.equal(params['141:text'], '四个人一起转绘')
  assert.equal(params['137:image'], 'a.png')
  assert.equal(params['156:image'], 'b.png')
  assert.equal(params['157:image'], 'None')
  assert.equal(params['115:megapixels'], 0.9)
  assert.equal(params['132:value'], 5)
})

test('AI App selected nodes override stale standard controls and clear saved H3 placeholders', () => {
  switchTask('ai-app')
  switchModel('runninghub/aiapp/rh-aiapp')
  cpState.aiAppWebappId = '2101840271142117377'
  cpState.aiAppOutputType = 'video'
  cpState.dur = 20
  cpState.ar = '1:1'
  cpState.aiAppFields = [
    { key: '27:value', label: '时长', kind: 'number', defaultValue: 20 },
    { key: '29:aspect_ratio', label: '比例', kind: 'select' },
    { key: '6:image', label: 'image1', kind: 'image', defaultValue: 'placeholder.png' },
    { key: '35:image', label: 'image2', kind: 'image', defaultValue: 'placeholder.png' },
    { key: '80:value', label: 'seed', kind: 'number', defaultValue: 123 },
  ]
  cpState.fieldValues = { '27:value': 3, '29:aspect_ratio': '9:16 (Portrait Widescreen)', '35:image': 'stored.png' }
  const params = buildCurrentCreationParams({ images: ['selected.png'] })
  assert.equal(params.duration, 3)
  assert.equal(params.aspect_ratio, '9:16')
  assert.equal(params['35:image'], 'None')
  assert.equal(params['80:value'], 123)

  cpState.aiAppWebappId = 'dynamic-app'
  cpState.aiAppFields = [{ key: '80:value', label: 'seed', kind: 'number', defaultValue: 123 },
    { key: '1:image', label: 'image', kind: 'image', defaultValue: 'placeholder.png' }]
  const dynamic = buildCurrentCreationParams({ images: [] })
  assert.equal(dynamic.duration, undefined)
  assert.equal(dynamic.aspect_ratio, undefined)
  assert.equal(dynamic['1:image'], undefined)
  cpState.aiAppFields = [
    { key: '8:duration', label: 'duration', kind: 'number', defaultValue: 4 },
    { key: '9:seconds', label: 'seconds', kind: 'number', defaultValue: 6 },
  ]
  const ambiguous = buildCurrentCreationParams({ images: [] })
  assert.equal(ambiguous.duration, undefined)
  assert.equal(ambiguous['8:duration'], 4)
  assert.equal(ambiguous['9:seconds'], 6)
  cpState.fieldValues = {}
})

test('Seed Audio rejects reference files larger than 10 MB', () => {
  switchTask('audio')
  switchModel('seed-audio-1.0')
  clearFiles()

  const oversized = makeFile('oversized.mp3', 'audio/mpeg')
  Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 })
  addFiles([oversized])

  assert.equal(cpState.files.length, 0)
  clearFiles()
})

test('Gemini Omni video edit derives billing seconds at submit time and never keeps stale duration', () => {
  switchTask('video')
  switchModel('runninghub/api/rh-gemini-omni-video-edit')
  clearFiles()
  cpState.dur = 5
  cpState.fieldValues.seconds = 99

  const params = buildCurrentCreationParams()

  assert.equal(params.duration, undefined)
  assert.equal(params.seconds, undefined)
  assert.equal(genericModelFields.value.some(field => field.key === 'seconds'), false)
  delete cpState.fieldValues.seconds
  clearFiles()
})

test('Gemini Omni media files reject references over 10 MB before submission', () => {
  switchTask('video')
  switchModel('runninghub/api/rh-gemini-omni-image-video')
  clearFiles()
  const oversized = makeFile('oversized.png', 'image/png')
  Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 })

  addFiles([oversized])

  assert.equal(cpState.files.length, 0)
  clearFiles()
})
