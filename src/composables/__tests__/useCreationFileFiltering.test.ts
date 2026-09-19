import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addFiles, aiAppNodeToField, availableModels, clearFiles, cpState, switchModel, switchTask } from '../useCreation'

function makeFile(name: string, type: string): File {
  return new File(['fixture'], name, { type })
}

test('AI App ratio nodes without upstream options still expose standard video ratios', () => {
  const field = aiAppNodeToField({
    nodeId: '1', nodeName: 'Minimax-h3', fieldName: 'aspect_ratio',
    fieldValue: '16:9 (Widescreen)', fieldType: 'LIST', description: '比例',
  })
  assert.deepEqual(field.options?.map(option => option.value), ['16:9 (Widescreen)', '9:16 (Portrait Widescreen)'])
  assert.equal(field.defaultValue, '16:9 (Widescreen)')
})

test('addFiles only accepts file MIME groups supported by the selected model', () => {
  switchTask('video')
  switchModel('rh-mimic')
  clearFiles()

  addFiles([
    makeFile('role.png', 'image/png'),
    makeFile('voice.mp3', 'audio/mpeg'),
    makeFile('motion.mp4', 'video/mp4'),
  ])

  assert.deepEqual(cpState.files.map(file => file.name), ['role.png', 'motion.mp4'])
  clearFiles()
})

test('addFiles rejects attachments when the selected model has no file input', () => {
  switchTask('audio')
  switchModel('rh-suno-v55-single')
  clearFiles()

  addFiles([makeFile('song-reference.mp3', 'audio/mpeg')])

  assert.equal(cpState.files.length, 0)
})

test('addFiles rejects files larger than the desktop creation upload limit', () => {
  switchTask('video')
  switchModel('rh-mimic')
  clearFiles()

  const largeFile = new File(['fixture'], 'huge-motion.mp4', { type: 'video/mp4' })
  Object.defineProperty(largeFile, 'size', { value: 50 * 1024 * 1024 + 1 })

  addFiles([largeFile])

  assert.equal(cpState.files.length, 0)
  clearFiles()
})

test('creation lists the most-used image and video models first', () => {
  switchTask('image')
  assert.equal(availableModels.value[0], 'newapi/xiaoyi/grok-imagine-image-2.0')
  switchTask('video')
  assert.equal(availableModels.value[0], 'newapi/dola/seedance2.5')
})

test('Dola Seedance accepts up to 30 images with a 20 MB per-image limit', () => {
  switchTask('video')
  switchModel('newapi/dola/seedance2.5')
  clearFiles()

  addFiles(Array.from({ length: 30 }, (_, index) => makeFile(`${index}.png`, 'image/png')))
  assert.equal(cpState.files.length, 30)

  clearFiles()
  const oversized = makeFile('oversized.png', 'image/png')
  Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })
  addFiles([oversized])
  assert.equal(cpState.files.length, 0)
  clearFiles()
})
