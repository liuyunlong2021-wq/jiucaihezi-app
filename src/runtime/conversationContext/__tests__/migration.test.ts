import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ensureMigrationBaselineSegment } from '../migration'
import { createConversationContextMemoryStorage } from '../storage'

test('migration creates one baseline segment for old sessions', async () => {
  const storage = createConversationContextMemoryStorage()
  const first = await ensureMigrationBaselineSegment({
    storage,
    sessionId: 'old_sess',
    skillId: 'skill_old',
    createdAt: 1000,
    now: 2000,
  })
  const second = await ensureMigrationBaselineSegment({
    storage,
    sessionId: 'old_sess',
    createdAt: 1000,
    now: 3000,
  })

  assert.equal(first.id, second.id)
  assert.equal(first.trigger, 'migration_baseline')
})
