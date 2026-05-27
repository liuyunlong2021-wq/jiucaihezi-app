import assert from 'node:assert/strict'
import { test } from 'node:test'

import { removeVaultBindingsFromSessions } from '../sessionVaultCleanup'

test('removeVaultBindingsFromSessions detaches deleted vault from conversations and chat images', () => {
  const result = removeVaultBindingsFromSessions({
    vaultId: 'vault_deleted',
    now: 12345,
    conversations: [
      { id: 'c1', vaultId: 'vault_deleted', contextPolicy: 'vault-only', updatedAt: 1 },
      { id: 'c2', vaultId: 'vault_other', contextPolicy: 'vault-only', updatedAt: 2 },
    ],
    documents: [
      {
        id: 'img1',
        category: 'image',
        vaultId: 'vault_deleted',
        sourceSessionId: 'c1',
        metadata: { kind: 'chat-image', vaultId: 'vault_deleted', sessionId: 'c1' },
      },
      {
        id: 'k1',
        category: 'knowledge',
        vaultId: 'vault_deleted',
        metadata: { vaultFolder: 'raw' },
      },
    ],
  })

  assert.deepEqual(result.conversationsToUpdate, [
    { id: 'c1', vaultId: null, contextPolicy: 'no-memory', updatedAt: 12345 },
  ])
  assert.deepEqual(result.documentsToUpdate, [
    {
      id: 'img1',
      category: 'image',
      sourceSessionId: 'c1',
      updatedAt: 12345,
      metadata: { kind: 'chat-image', sessionId: 'c1' },
    },
  ])
  assert.equal(result.conversationsToUpdate.some(item => item.id === 'c2'), false)
  assert.equal(result.documentsToUpdate.some(item => item.id === 'k1'), false)
})
