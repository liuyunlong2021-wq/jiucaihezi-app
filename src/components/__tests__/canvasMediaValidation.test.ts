import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateCanvasImageInputs,
  validateCanvasAudioInputs,
  validateCanvasVideoInputs,
} from '../canvas/runtime/canvasMediaValidation'

const emptyMedia = { all: [], references: [], videos: [], audios: [] }

test('RunningHub video workflows can run from node fields and media without prompt text', () => {
  assert.doesNotThrow(() => validateCanvasVideoInputs('rh-digital-human-fast', '', {}, {
    ...emptyMedia,
    all: ['data:image/png;base64,avatar'],
    audios: ['data:audio/mp3;base64,voice'],
  }))

  assert.doesNotThrow(() => validateCanvasVideoInputs('rh-mimic', '', { text: '挥手转身' }, {
    ...emptyMedia,
    all: ['data:image/png;base64,role'],
    videos: ['data:video/mp4;base64,motion'],
  }))
})

test('RunningHub audio workflows can run from node text fields without prompt text', () => {
  assert.doesNotThrow(() => validateCanvasAudioInputs('rh-voice-clone', '', {
    refText: '参考音频文字',
    text: '输出这句话',
  }, {
    ...emptyMedia,
    audios: ['data:audio/mp3;base64,voice'],
  }))

  assert.doesNotThrow(() => validateCanvasAudioInputs('rh-voice-design', '', {
    text: '输出文稿',
    voicePrompt: '温柔、清晰、年轻女声',
  }, emptyMedia))
})

test('prompt-driven models still require prompt text', () => {
  assert.throws(
    () => validateCanvasVideoInputs('grok-video-3', '', {}, emptyMedia),
    /视频生成节点没有输入内容/,
  )
  assert.throws(
    () => validateCanvasAudioInputs('suno_music', '', {}, emptyMedia),
    /音频生成节点没有输入内容/,
  )
})

test('canvas image generation uses catalog-backed media constraints', () => {
  assert.throws(
    () => validateCanvasImageInputs('gpt-image-2', '画图', {}, {
      ...emptyMedia,
      audios: ['data:audio/mp3;base64,voice'],
    }),
    /不支持音频参考/,
  )

  assert.throws(
    () => validateCanvasImageInputs('nano-banana-2k', '画图', { aspectRatio: '5:7' }, emptyMedia),
    /比例/,
  )
})
