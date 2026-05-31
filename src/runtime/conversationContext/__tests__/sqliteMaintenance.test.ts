import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldRunSqliteMaintenance } from '../sqliteMaintenance'

test('sqlite maintenance does not run while user is sending messages', () => {
  assert.equal(shouldRunSqliteMaintenance({ isUserActive: true, deletedSessionCount: 100 }).run, false)
  assert.equal(shouldRunSqliteMaintenance({ isUserActive: false, deletedSessionCount: 100 }).run, true)
})
