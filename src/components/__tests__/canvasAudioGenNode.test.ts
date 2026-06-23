import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('audioGen canvas node is registered to the current executable audio node', () => {
  const workspaceSource = readFileSync(join(process.cwd(), 'src/components/canvas/CanvasWorkspace.vue'), 'utf8')
  const source = readFileSync(join(process.cwd(), 'src/components/canvas/nodes-next/nodes/AudioGenNode.vue'), 'utf8')

  assert.equal(workspaceSource.includes('audioGen: markRaw(AudioGenNode)'), true)
  assert.equal(source.includes("async function run"), true)
  assert.equal(source.includes("status:'submitting'"), true)
  assert.equal(source.includes("status:'polling'"), true)
  assert.equal(source.includes("status:'success'"), true)
  assert.equal(source.includes("style"), true)
  assert.equal(source.includes("title"), true)
  assert.equal(source.includes("prompt"), true)
  assert.equal(source.includes("<audio"), true)
})
