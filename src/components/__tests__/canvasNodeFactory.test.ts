import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { defaultCanvasDataForType } from '../canvas/utils/canvasNodeFactory'
import { useCanvasStore } from '../../stores/canvasStore'

test('audio generation canvas node defaults to the upstream Suno custom song model name', () => {
  const data = defaultCanvasDataForType('audioGen') as any

  assert.equal(data.model, 'suno_music')
  assert.equal(data.mv, 'chirp-fenix')
})

test('canvas allows audio result media connections into audio and video generators', () => {
  setActivePinia(createPinia())
  const store = useCanvasStore()
  store.replaceNodes([
    { id: 'audio-result', type: 'audioResult', position: { x: 0, y: 0 }, data: { label: '音频', url: 'https://cdn.example.com/a.mp3' } as any },
    { id: 'audio-gen', type: 'audioGen', position: { x: 0, y: 0 }, data: defaultCanvasDataForType('audioGen') as any },
    { id: 'video-gen', type: 'videoGen', position: { x: 0, y: 0 }, data: defaultCanvasDataForType('videoGen') as any },
    { id: 'image-gen', type: 'imageGen', position: { x: 0, y: 0 }, data: defaultCanvasDataForType('imageGen') as any },
  ] as any)

  assert.equal(store.isValidConnection({ source: 'audio-result', target: 'audio-gen', sourceHandle: null, targetHandle: null }), true)
  assert.equal(store.isValidConnection({ source: 'audio-result', target: 'video-gen', sourceHandle: null, targetHandle: null }), true)
  assert.equal(store.isValidConnection({ source: 'audio-result', target: 'image-gen', sourceHandle: null, targetHandle: null }), false)
})
