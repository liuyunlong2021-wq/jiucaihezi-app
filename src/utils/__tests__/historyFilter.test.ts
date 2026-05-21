import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getHistoryVaultFilter } from '../historyFilter'

test('loads all conversations by default in the second column history list', () => {
  assert.equal(getHistoryVaultFilter('vault_1'), undefined)
  assert.equal(getHistoryVaultFilter(null), undefined)
})
