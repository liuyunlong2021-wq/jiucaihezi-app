import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createJiucaiOpenCodeClient,
  createJiucaiOpenCodeGlobalClient,
  resetJiucaiOpenCodeClient,
} from '../client'

const handle = { running: true, url: 'http://127.0.0.1:4096', authorization: 'Basic token' }

test('keeps one global client and one stable client per directory', () => {
  resetJiucaiOpenCodeClient()
  const global = createJiucaiOpenCodeGlobalClient(handle)
  const projectA = createJiucaiOpenCodeClient(handle, '/a')
  const projectB = createJiucaiOpenCodeClient(handle, '/b')

  assert.equal(createJiucaiOpenCodeGlobalClient(handle), global)
  assert.equal(createJiucaiOpenCodeClient(handle, '/a'), projectA)
  assert.equal(createJiucaiOpenCodeClient(handle, '/b'), projectB)
  assert.notEqual(global, projectA)
  assert.notEqual(projectA, projectB)
})
