import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('CanvasAudioGenNode exposes catalog-backed Suno and voice workflow fields', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/canvas/nodes/CanvasAudioGenNode.vue'), 'utf8')

  assert.equal(source.includes("data.model === 'suno_music'"), false)
  assert.equal(source.includes("hasField('title')"), true)
  assert.equal(source.includes("hasField('tags')"), true)
  assert.equal(source.includes("hasField('negative_tags')"), true)
  assert.equal(source.includes("hasField('start_time')"), true)
  assert.equal(source.includes("hasField('end_time')"), true)
  assert.equal(source.includes("hasField('ref_text')"), true)
  assert.equal(source.includes("hasField('voice_prompt')"), true)
})
