import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mediaReferenceToken,
  referencedMediaSlots,
  sortCanvasReferences,
  trailingMediaSearch,
  validateMediaReferenceSlots,
} from '../creationMediaReferences'

test('official Seedance media references are not treated as project-media searches', () => {
  assert.equal(trailingMediaSearch('参考@'), '')
  assert.equal(trailingMediaSearch('参考@石道'), '石道')
  for (const prompt of ['@图', '@图1', '@图1：角色', '@视频1', '@音频12']) assert.equal(trailingMediaSearch(prompt), null)
})

test('Seedance image, video and audio slots are counted independently and validated', () => {
  const prompt = '@图1站在@图3中，参考@视频2的动作，使用@音频1说话。'
  assert.deepEqual(referencedMediaSlots(prompt), { image: 3, video: 2, audio: 1 })
  assert.equal(validateMediaReferenceSlots(prompt, { image: 3, video: 2, audio: 1 }), null)
  assert.equal(
    validateMediaReferenceSlots(prompt, { image: 2, video: 2, audio: 1 }),
    '提示词引用了 @图3，但当前只有 2 个对应参考素材',
  )
  assert.equal(mediaReferenceToken('audio', 2), '@音频2')
})

test('box-selected canvas media are ordered by rows and then from left to right', () => {
  const entries = [
    { id: 'bottom', x: 5, y: 220, height: 100 },
    { id: 'right', x: 300, y: 12, height: 100 },
    { id: 'left', x: 20, y: 0, height: 100 },
  ]
  assert.deepEqual(sortCanvasReferences(entries, entry => entry).map(entry => entry.id), ['left', 'right', 'bottom'])
})
