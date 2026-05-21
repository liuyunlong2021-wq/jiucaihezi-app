import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getErrorMessage,
  importBackupPackage,
  parseBackupPackage,
  summarizeBackupPackage,
  type JcBackupPackage,
  type MigrationStorageAdapter,
} from '../webDataMigration'

function backup(overrides: Partial<JcBackupPackage> = {}): JcBackupPackage {
  return {
    app: 'jiucaihezi',
    kind: 'web-backup',
    version: 1,
    exportedAt: 1700000000000,
    stores: {},
    ...overrides,
  }
}

function createMemoryStorage(seed: Partial<Record<'conversations' | 'messages' | 'documents', Record<string, any>>> = {}) {
  const records = {
    conversations: new Map<string, any>(Object.entries(seed.conversations || {})),
    messages: new Map<string, any>(Object.entries(seed.messages || {})),
    documents: new Map<string, any>(Object.entries(seed.documents || {})),
  }
  const kv = new Map<string, any>()
  const adapter: MigrationStorageAdapter = {
    async getItem(key) {
      return kv.get(key) ?? null
    },
    async getRecord(storeName, key) {
      return records[storeName].get(key) || null
    },
    async setRecord(storeName, value) {
      records[storeName].set(String(value.id), value)
    },
    async setItem(key, value) {
      kv.set(key, value)
    },
  }
  return { records, kv, adapter }
}

test('parseBackupPackage accepts valid JSON with array and map stores', () => {
  const parsed = parseBackupPackage(JSON.stringify(backup({
    stores: {
      conversations: [{ id: 'c1' }],
      messages: { m1: { id: 'm1' } },
      documents: [],
    },
    localStorage: { jcTheme: 'dark' },
  })))

  assert.equal(parsed.app, 'jiucaihezi')
  assert.equal(Array.isArray(parsed.stores.conversations), true)
  assert.equal(typeof parsed.stores.messages, 'object')
})

test('parseBackupPackage rejects invalid packages with Chinese errors', () => {
  assert.throws(
    () => parseBackupPackage('{broken'),
    /备份文件不是有效的 JSON/
  )
  assert.throws(
    () => parseBackupPackage({ app: 'other' }),
    /不是韭菜盒子 Web 备份/
  )
  assert.throws(
    () => parseBackupPackage(backup({ stores: { messages: 'bad' as any } })),
    /messages 必须是数组或对象映射/
  )
})

test('getErrorMessage gives useful text for non-Error thrown values', () => {
  assert.equal(getErrorMessage(new Error('明确错误')), '明确错误')
  assert.equal(getErrorMessage('字符串错误'), '字符串错误')
  assert.equal(getErrorMessage(undefined), '未知错误')
  assert.equal(getErrorMessage({ reason: 'bad' }), '{"reason":"bad"}')
})

test('summarizeBackupPackage counts records, vaults, and skills', () => {
  const summary = summarizeBackupPackage(backup({
    stores: {
      conversations: [{ id: 'c1' }, { id: 'c2' }],
      messages: { m1: { id: 'm1' } },
      documents: [{ id: 'd1', category: 'text' }, null],
      kv_store: {
        jc_vaults_v1: JSON.stringify([{ id: 'v1' }, { id: 'v2' }]),
      },
    },
    localStorage: {
      jc_skills_v2: JSON.stringify([{ id: 's1' }]),
      jc_my_skills: JSON.stringify(['s1', 's2']),
    },
  }))

  assert.equal(summary.conversations, 2)
  assert.equal(summary.messages, 1)
  assert.equal(summary.documents, 1)
  assert.equal(summary.vaults, 2)
  assert.equal(summary.skills, 3)
})

test('importBackupPackage skips settings and keeps desktop API configuration untouched', async () => {
  const storage = createMemoryStorage()
  storage.kv.set('jcApiKey', 'sk-desktop')
  storage.kv.set('jcProviders', JSON.stringify([{ id: 'jiucaihezi', apiHost: 'https://api.jiucaihezi.studio' }]))
  storage.kv.set('jcTheme', 'light')

  const summary = await importBackupPackage(backup({
    stores: {
      kv_store: {
        jcApiBase: 'https://attacker.example',
        unknownHost: 'https://attacker.example',
        jc_call_counts: JSON.stringify({ s1: 10 }),
      },
    },
    localStorage: {
      jcApiKey: 'sk-imported',
      jcModel: 'imported-model',
      jcModelProviderId: 'imported-provider',
      jcProviders: JSON.stringify([
        {
          id: 'custom',
          name: 'Bad Host',
          type: 'new-api',
          apiKey: 'sk-provider',
          apiHost: 'https://attacker.example/v1',
          enabled: false,
          models: [{ id: 'm1', providerId: 'custom' }],
        },
      ]),
      jcTheme: 'dark',
      jc_bigfont: 'true',
      jc_router_enabled: 'true',
    },
  }), { storage: storage.adapter })

  assert.equal(storage.kv.get('jcApiKey'), 'sk-desktop')
  assert.deepEqual(JSON.parse(storage.kv.get('jcProviders')), [{ id: 'jiucaihezi', apiHost: 'https://api.jiucaihezi.studio' }])
  assert.equal(storage.kv.get('jcTheme'), 'light')
  assert.equal(storage.kv.has('jcApiBase'), false)
  assert.equal(storage.kv.has('jcModel'), false)
  assert.equal(storage.kv.has('jcModelProviderId'), false)
  assert.equal(storage.kv.has('jc_call_counts'), false)
  assert.equal(storage.kv.has('jc_bigfont'), false)
  assert.equal(storage.kv.has('jc_router_enabled'), false)
  assert.equal(storage.kv.has('unknownHost'), false)
  assert.deepEqual(summary.skippedKeys.sort(), [
    'jcApiBase',
    'jcApiKey',
    'jcModel',
    'jcModelProviderId',
    'jcProviders',
    'jcTheme',
    'jc_bigfont',
    'jc_call_counts',
    'jc_router_enabled',
    'unknownHost',
  ].sort())
})

test('importBackupPackage remaps conflicting conversation and message references', async () => {
  const storage = createMemoryStorage({
    conversations: {
      c1: { id: 'c1', title: 'Desktop conversation' },
    },
  })

  const summary = await importBackupPackage(backup({
    stores: {
      conversations: [{ id: 'c1', title: 'Imported conversation' }],
      messages: [
        { id: 'm1', conversationId: 'c1', role: 'user', content: 'hello' },
      ],
    },
  }), {
    storage: storage.adapter,
    now: 123,
    randomId: () => 'rand',
  })

  assert.equal(summary.conversations, 1)
  assert.equal(summary.messages, 1)
  assert.equal(summary.remappedIds.c1, 'imported_c1_123_rand')
  assert.deepEqual(storage.records.conversations.get('c1'), { id: 'c1', title: 'Desktop conversation' })
  assert.deepEqual(storage.records.conversations.get('imported_c1_123_rand'), {
    id: 'imported_c1_123_rand',
    title: 'Imported conversation',
  })
  assert.deepEqual(storage.records.messages.get('m1'), {
    id: 'm1',
    conversationId: 'imported_c1_123_rand',
    role: 'user',
    content: 'hello',
  })
})

test('importBackupPackage preserves existing vaults, remaps conflicting vault, and rewrites documents', async () => {
  const storage = createMemoryStorage()
  storage.kv.set('jc_vaults_v1', JSON.stringify([
    { id: 'v1', name: 'Desktop vault', createdAt: 1 },
  ]))

  const summary = await importBackupPackage(backup({
    stores: {
      documents: [
        { id: 'd1', category: 'knowledge', name: 'Imported doc', vaultId: 'v1', content: 'doc' },
      ],
    },
    localStorage: {
      jc_vaults_v1: JSON.stringify([
        { id: 'v1', name: 'Imported vault', createdAt: 2 },
      ]),
      jc_active_vault: 'v1',
    },
  }), {
    storage: storage.adapter,
    now: 456,
    randomId: () => 'vault',
  })

  const importedVaultId = 'imported_v1_456_vault'
  assert.equal(summary.remappedIds.v1, importedVaultId)
  assert.deepEqual(JSON.parse(storage.kv.get('jc_vaults_v1')), [
    { id: 'v1', name: 'Desktop vault', createdAt: 1 },
    { id: importedVaultId, name: 'Imported vault', createdAt: 2 },
  ])
  assert.equal(storage.kv.has('jc_active_vault'), false)
  assert.deepEqual(summary.skippedKeys, ['jc_active_vault'])
  assert.deepEqual(storage.records.documents.get('d1'), {
    id: 'd1',
    category: 'knowledge',
    name: 'Imported doc',
    vaultId: importedVaultId,
    content: 'doc',
  })
})

test('importBackupPackage preserves existing skills when importing new skills and skips call counts', async () => {
  const storage = createMemoryStorage()
  storage.kv.set('jc_skills_v2', JSON.stringify([
    { id: 's1', name: 'Existing skill' },
  ]))
  storage.kv.set('jc_my_skills', JSON.stringify(['s1']))
  storage.kv.set('jc_call_counts', JSON.stringify({ s1: 4, oldOnly: 2 }))

  await importBackupPackage(backup({
    localStorage: {
      jc_skills_v2: JSON.stringify([
        { id: 's2', name: 'Imported skill' },
      ]),
      jc_my_skills: JSON.stringify(['s2', 's2']),
      jc_call_counts: JSON.stringify({ s1: 3, s2: 1 }),
    },
  }), { storage: storage.adapter })

  assert.deepEqual(JSON.parse(storage.kv.get('jc_skills_v2')), [
    { id: 's1', name: 'Existing skill' },
    { id: 's2', name: 'Imported skill' },
  ])
  assert.deepEqual(JSON.parse(storage.kv.get('jc_my_skills')), ['s1', 's2'])
  assert.deepEqual(JSON.parse(storage.kv.get('jc_call_counts')), { s1: 4, oldOnly: 2 })
})

test('importBackupPackage accepts pure web export shape from production exporter', async () => {
  const storage = createMemoryStorage()

  const summary = await importBackupPackage(backup({
    stores: {
      kv_store: {
        jc_vaults_v1: JSON.stringify([{ id: 'v1', name: 'Web vault' }]),
      },
      conversations: [{ id: 'c1', title: 'Web conversation' }],
      messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello' }],
      documents: [{ id: 'd1', category: 'knowledge', vaultId: 'v1', name: 'Web doc' }],
    },
    localStorage: {
      jc_skills_v2: JSON.stringify([{ id: 's1', name: 'Web skill' }]),
      jc_my_skills: JSON.stringify(['s1']),
    },
  }), { storage: storage.adapter })

  assert.equal(summary.conversations, 1)
  assert.equal(summary.messages, 1)
  assert.equal(summary.documents, 1)
  assert.equal(summary.vaults, 1)
  assert.equal(summary.skills, 2)
  assert.equal(summary.localStorage, 3)
  assert.deepEqual(summary.skippedKeys, [])
  assert.deepEqual(storage.records.conversations.get('c1'), { id: 'c1', title: 'Web conversation' })
  assert.deepEqual(JSON.parse(storage.kv.get('jc_vaults_v1')), [{ id: 'v1', name: 'Web vault' }])
  assert.deepEqual(JSON.parse(storage.kv.get('jc_skills_v2')), [{ id: 's1', name: 'Web skill' }])
  assert.deepEqual(JSON.parse(storage.kv.get('jc_my_skills')), ['s1'])
})
