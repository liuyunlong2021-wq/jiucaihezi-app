import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createHarnessConversationCatalogEntry, listHarnessConversationCatalog,
  refreshHarnessConversationCatalog, removeHarnessConversationCatalogEntry,
  renameHarnessConversationCatalogEntry, updateHarnessConversationPreferences,
  upsertHarnessConversationCatalogEntry, type HarnessConversationCatalogEntry,
} from '../harnessConversationCatalog'
import { migrateHarnessConversationPreferences } from '@/services/harnessConversationMigration'
import type { DeepSeekHarnessInput } from '@/services/deepSeekHarness'

function fixture(owner: string) {
  const input = { cwd: owner, sessionId: '', message: '', model: 'offline', apiBase: 'http://127.0.0.1', apiKey: '' }
  const rows = new Map<string, HarnessConversationCatalogEntry>()
  const hidden = new Set<string>()
  let failure = false
  const calls: string[] = []
  const query = async (_input: DeepSeekHarnessInput, params: Record<string, unknown>) => {
    calls.push(String(params.action))
    if (failure) throw new Error('DSH unavailable')
    const id = String(params.conversationId)
    if (params.action === 'create') rows.set(id, entry(id))
    if (params.action === 'rename') rows.set(id, { ...rows.get(id)!, title: String(params.title) })
    if (params.action === 'hide') hidden.add(id)
    if (params.action === 'preferences') rows.set(id, { ...rows.get(id)!, ...params.preferences as object })
    return { entries: [...rows.values()].filter(row => !hidden.has(row.conversationId)), hiddenIds: [...hidden], warnings: [] }
  }
  function entry(id: string) { return { conversationId: id, sessionId: `jc-v1-${id}`, workspaceKey: owner, title: id,
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' } }
  return { input, rows, query, entry, calls, fail: () => { failure = true } }
}

test('Desktop discovers official sessions with no browser directory and keeps projects isolated', async () => {
  const f = fixture('/official-a')
  f.rows.set('old', f.entry('old'))
  await refreshHarnessConversationCatalog(f.input, f.query)
  assert.equal(listHarnessConversationCatalog('/official-a')[0].conversationId, 'old')
  assert.deepEqual(listHarnessConversationCatalog('/official-b'), [])
  assert.deepEqual(f.calls, ['list'])
})

test('creating, renaming and preferences commit through DSH before updating the view', async () => {
  const f = fixture('/official-mutations')
  await refreshHarnessConversationCatalog(f.input, f.query)
  const created = await createHarnessConversationCatalogEntry(f.input.cwd)
  await renameHarnessConversationCatalogEntry(f.input.cwd, created.conversationId, 'renamed')
  await updateHarnessConversationPreferences(f.input.cwd, created.conversationId, { manju: { enabled: true } })
  assert.equal(f.rows.get(created.conversationId)?.title, 'renamed')
  assert.deepEqual(listHarnessConversationCatalog(f.input.cwd)[0].manju, { enabled: true })
  assert.deepEqual(f.calls, ['list', 'create', 'rename', 'preferences'])
})

test('deleted sessions cannot be resurrected by a late completion or a later official refresh', async () => {
  const f = fixture('/official-delete')
  f.rows.set('old', f.entry('old'))
  await refreshHarnessConversationCatalog(f.input, f.query)
  await removeHarnessConversationCatalogEntry(f.input.cwd, 'old')
  upsertHarnessConversationCatalogEntry(f.entry('old'))
  await refreshHarnessConversationCatalog(f.input, f.query)
  assert.deepEqual(listHarnessConversationCatalog(f.input.cwd), [])
  assert.equal(f.rows.size, 1, 'official history is retained')
})

test('a failed official list never becomes an empty successful directory or a replacement new chat', async () => {
  const f = fixture('/official-failure')
  f.rows.set('old', f.entry('old'))
  await refreshHarnessConversationCatalog(f.input, f.query)
  f.fail()
  await assert.rejects(() => refreshHarnessConversationCatalog(f.input, f.query), /DSH unavailable/)
  assert.equal(listHarnessConversationCatalog(f.input.cwd).length, 1)
  await assert.rejects(() => createHarnessConversationCatalogEntry(f.input.cwd), /DSH unavailable/)
  assert.equal(listHarnessConversationCatalog(f.input.cwd).length, 1)
})

test('legacy browser keys retire only after successful durable migration, and failures are retryable', async () => {
  const f = fixture('/official-migration')
  const key = `jc:harness-conversations:${f.input.cwd}`
  const values = new Map([[key, JSON.stringify([f.entry('old')])]])
  const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key) } } as Storage
  await assert.rejects(() => migrateHarnessConversationPreferences(f.input, storage, async () => { throw new Error('write failed') }))
  assert.ok(values.has(key))
  await migrateHarnessConversationPreferences(f.input, storage, f.query)
  assert.equal(values.has(key), false)
  assert.deepEqual(f.calls, ['import'])
})
