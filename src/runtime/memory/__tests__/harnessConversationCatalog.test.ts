import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createHarnessConversationCatalogEntry,
  listHarnessConversationCatalog,
  removeHarnessConversationCatalogEntry,
  renameHarnessConversationCatalogEntry,
  upsertHarnessConversationCatalogEntry,
} from '../harnessConversationCatalog'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

test('Harness conversation catalog stores navigation metadata without message bodies', () => {
  const storage = memoryStorage()
  const created = createHarnessConversationCatalogEntry('/project-a', '新对话', storage, 'conversation-1', '2026-09-24T00:00:00.000Z')
  assert.deepEqual(created, {
    conversationId: 'conversation-1',
    sessionId: 'jc-v1-conversation-1',
    workspaceKey: '/project-a',
    title: '新对话',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  })
  assert.deepEqual(listHarnessConversationCatalog('/project-a', storage), [created])
  assert.deepEqual(listHarnessConversationCatalog('/project-b', storage), [])
  assert.doesNotMatch(JSON.stringify(created), /turns|messages|content/)
})

test('Harness conversation catalog supports legacy mapping, rename, and logical delete', () => {
  const storage = memoryStorage()
  upsertHarnessConversationCatalogEntry({
    conversationId: 'legacy-1', sessionId: 'jc-v1-legacy-1', workspaceKey: '/project-a',
    title: '旧对话', createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
    legacyRawPath: '.raw/对话记录/legacy-1.md',
  }, storage)
  renameHarnessConversationCatalogEntry('/project-a', 'legacy-1', '新标题', storage, '2026-09-24T01:00:00.000Z')
  assert.equal(listHarnessConversationCatalog('/project-a', storage)[0]?.title, '新标题')
  removeHarnessConversationCatalogEntry('/project-a', 'legacy-1', storage)
  assert.deepEqual(listHarnessConversationCatalog('/project-a', storage), [])
})
