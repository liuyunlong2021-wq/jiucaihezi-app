import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addFiles, clearFiles, cpState, switchModel, switchTask } from '../useCreation'

function makeFile(name: string, type: string): File {
  return new File(['fixture'], name, { type })
}

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
  switchModel('suno-custom-song')
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
