import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createOpenCodeId } from '../identifier'

test('creates official sortable OpenCode ids with stable prefixes', () => {
  const first = createOpenCodeId('message', 1000)
  const second = createOpenCodeId('message', 1001)
  const part = createOpenCodeId('part', 1001)

  assert.match(first, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  assert.match(part, /^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  assert.ok(first < second)
})
