import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeToolDefinition, searchToolDefinitions } from '../toolSearch'

const tools = [
  { type: 'function', function: { name: 'wiki_context', description: 'Read Wiki progressively' } },
  { type: 'function', function: { name: 'terminal', description: 'Run a terminal command' } },
  { type: 'function', function: { name: 'wiki_context', description: 'duplicate' } },
]

test('tool search matches names and descriptions with stable de-duplication', () => {
  assert.deepEqual(searchToolDefinitions(tools, 'WIKI'), [
    { name: 'wiki_context', description: 'Read Wiki progressively' },
  ])
  assert.deepEqual(searchToolDefinitions(tools, ''), [
    { name: 'wiki_context', description: 'Read Wiki progressively' },
    { name: 'terminal', description: 'Run a terminal command' },
  ])
})

test('tool description only returns an exact authorized definition', () => {
  assert.equal(describeToolDefinition(tools, 'wiki'), null)
  assert.deepEqual(describeToolDefinition(tools, 'terminal'), tools[1])
})
