import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldSyncVaultEntryToDisk } from '../vaultSyncScope'

test('shouldSyncVaultEntryToDisk syncs only selected vault ids when scope is provided', () => {
  assert.equal(shouldSyncVaultEntryToDisk({ vaultId: 'v1', category: 'knowledge' }, new Set(['v1'])), true)
  assert.equal(shouldSyncVaultEntryToDisk({ vaultId: 'v2', category: 'knowledge' }, new Set(['v1'])), false)
})

test('shouldSyncVaultEntryToDisk keeps all-vault behavior when scope is empty', () => {
  assert.equal(shouldSyncVaultEntryToDisk({ vaultId: 'v1', category: 'knowledge' }, new Set()), true)
  assert.equal(shouldSyncVaultEntryToDisk({ vaultId: 'v1', category: 'text' }, new Set()), false)
  assert.equal(shouldSyncVaultEntryToDisk({ category: 'knowledge' }, new Set()), false)
})
