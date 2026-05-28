import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('CanvasAudioGenNode exposes catalog-backed Suno and voice workflow fields', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/canvas/nodes/CanvasAudioGenNode.vue'), 'utf8')

  assert.equal(source.includes("submitAudio"), true)
  assert.equal(source.includes("queryAudio"), true)
  assert.equal(source.includes("uploadAudioForSuno"), true)
  assert.equal(source.includes("version"), true)
  assert.equal(source.includes("title"), true)
  assert.equal(source.includes("tags"), true)
  assert.equal(source.includes("mode"), true)
  assert.equal(source.includes("prompt"), true)
})
