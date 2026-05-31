import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateMediaModelInputs } from '../mediaModelInputValidation'

test('digital human validates required text and media without prompt text', () => {
  assert.doesNotThrow(() => validateMediaModelInputs({
    modelId: 'rh-digital-human',
    prompt: '',
    data: { text: '这是一段台词' },
    images: ['data:image/png;base64,avatar'],
    audios: ['data:audio/mp3;base64,voice'],
    emptyMessage: '请补充生成参数',
  }))
})

test('prompt-driven models still require prompt text', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'grok-video-3',
      prompt: '',
      emptyMessage: '请补充生成参数',
    }),
    /提示词/,
  )
})

test('required workflow fields report concrete missing labels', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'rh-mimic',
      prompt: '',
      data: { text: '转身' },
      images: ['data:image/png;base64,role'],
      emptyMessage: '请补充生成参数',
    }),
    /参考视频/,
  )
})

test('model capabilities limit total reference files', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'rh-mimic',
      prompt: '',
      data: { text: '转身' },
      images: ['data:image/png;base64,role', 'data:image/png;base64,extra'],
      videos: ['data:video/mp4;base64,motion'],
      emptyMessage: '请补充生成参数',
    }),
    /最多支持 2 个参考文件/,
  )
})

test('model capabilities reject unsupported media groups', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'gpt-image-2',
      prompt: '画一张图',
      audios: ['data:audio/mp3;base64,voice'],
      emptyMessage: '请补充生成参数',
    }),
    /不支持音频参考/,
  )
})

test('model capabilities reject unsupported select options', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'grok-video-3',
      prompt: '生成一段视频',
      data: { resolution: '4K' },
      emptyMessage: '请补充生成参数',
    }),
    /分辨率/,
  )

  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'grok-video-3',
      prompt: '生成一段视频',
      data: { ratio: '4:3' },
      emptyMessage: '请补充生成参数',
    }),
    /比例/,
  )
})

test('model capabilities enforce numeric min and max bounds', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'rh-mimic',
      prompt: '',
      data: { text: '转身', width: 8 },
      images: ['data:image/png;base64,role'],
      videos: ['data:video/mp4;base64,motion'],
      emptyMessage: '请补充生成参数',
    }),
    /宽不能小于 16/,
  )

  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'grok-video-3',
      prompt: '生成一段视频',
      data: { duration: 31 },
      emptyMessage: '请补充生成参数',
    }),
    /时长\(秒\)不能大于 30/,
  )
})

test('model capabilities enforce numeric step constraints', () => {
  assert.throws(
    () => validateMediaModelInputs({
      modelId: 'rh-mimic',
      prompt: '',
      data: { text: '转身', width: 481, height: 832 },
      images: ['data:image/png;base64,role'],
      videos: ['data:video/mp4;base64,motion'],
      emptyMessage: '请补充生成参数',
    }),
    /宽必须按 16 递增/,
  )
})
