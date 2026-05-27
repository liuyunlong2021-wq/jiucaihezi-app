import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultExportPackage, importVaultPackage, parseVaultImportPackage } from '../vaultPackage'

function memoryStorage(initialKv: Record<string, any> = {}, initialRecords: Record<string, Record<string, any>> = {}) {
  const kv = new Map(Object.entries(initialKv))
  const records = new Map<string, Map<string, any>>()
  for (const [store, values] of Object.entries(initialRecords)) {
    records.set(store, new Map(Object.entries(values)))
  }
  return {
    kv,
    records,
    adapter: {
      async getItem(key: string) { return kv.get(key) },
      async setItem(key: string, value: any) { kv.set(key, value) },
      async getRecord(storeName: 'documents', key: string) {
        return records.get(storeName)?.get(key)
      },
      async setRecord(storeName: 'documents', value: any) {
        if (!records.has(storeName)) records.set(storeName, new Map())
        records.get(storeName)!.set(value.id, value)
      },
    },
  }
}

test('parseVaultImportPackage accepts jcvault packages', () => {
  const pkg = parseVaultImportPackage(JSON.stringify({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    vault: { id: 'v1', name: '小说知识库' },
    documents: [{ id: 'd1', category: 'knowledge', vaultId: 'v1', name: 'CLAUDE.md' }],
  }))

  assert.equal(pkg.sourceKind, 'vault-backup')
  assert.equal(pkg.vaults.length, 1)
  assert.equal(pkg.documents.length, 1)
})

test('parseVaultImportPackage rejects vault-backup packages without valid vaults after filtering', () => {
  assert.throws(() => parseVaultImportPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    vaults: [{ id: 'v_missing_name' }],
    documents: [{ id: 'd1', category: 'knowledge', vaultId: 'v_missing_name', name: 'Hidden.md' }],
  }), /缺少 vault 数据/)
})

test('parseVaultImportPackage validates vault manifest counts when present', () => {
  assert.throws(() => parseVaultImportPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    manifest: { documentCount: 2, rawCount: 1, wikiCount: 0, reportCount: 0, templateCount: 0 },
    vault: { id: 'v1', name: '知识库' },
    documents: [
      { id: 'd1', category: 'knowledge', vaultId: 'v1', name: 'A.md', mimeType: 'text/markdown' },
    ],
  }), /manifest 与内容数量不一致/)
})

test('parseVaultImportPackage validates vault manifest bucket counts when present', () => {
  assert.throws(() => parseVaultImportPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    manifest: { documentCount: 1, rawCount: 0, wikiCount: 1, reportCount: 0, templateCount: 0 },
    vault: { id: 'v1', name: '知识库' },
    documents: [
      {
        id: 'd1',
        category: 'knowledge',
        vaultId: 'v1',
        name: 'A.md',
        mimeType: 'text/markdown',
        metadata: { vaultFolder: 'raw' },
      },
    ],
  }), /rawCount 与内容数量不一致/)
})

test('parseVaultImportPackage excludes malformed knowledge documents without ids', () => {
  const pkg = parseVaultImportPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    vault: { id: 'v1', name: '知识库' },
    documents: [
      { category: 'knowledge', vaultId: 'v1', name: 'MissingId.md', mimeType: 'text/markdown' },
      { id: 'd1', category: 'knowledge', vaultId: 'v1', name: 'A.md', mimeType: 'text/markdown' },
    ],
  })

  assert.equal(pkg.documents.length, 1)
  assert.equal(pkg.documents[0].id, 'd1')
})

test('parseVaultImportPackage requires full bucket manifest when manifest is present', () => {
  assert.throws(() => parseVaultImportPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    manifest: { documentCount: 1, rawCount: 1 },
    vault: { id: 'v1', name: '知识库' },
    documents: [
      {
        id: 'd1',
        category: 'knowledge',
        vaultId: 'v1',
        name: 'A.md',
        mimeType: 'text/markdown',
        metadata: { vaultFolder: 'raw' },
      },
    ],
  }), /缺少 wikiCount/)
})

test('importVaultPackage filters vault-backup documents outside package vault ids', async () => {
  const storage = memoryStorage(
    { jc_vaults_v1: JSON.stringify([{ id: 'v_other', name: '已有无关知识库' }]) },
    { documents: { existing: { id: 'existing', category: 'knowledge', name: 'Existing.md', vaultId: 'v_other' } } },
  )

  const summary = await importVaultPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    vault: { id: 'v_import', name: '导入知识库', status: 'active' },
    documents: [
      { id: 'in_scope', category: 'knowledge', name: 'In.md', vaultId: 'v_import' },
      { id: 'outside', category: 'knowledge', name: 'Outside.md', vaultId: 'v_other' },
    ],
  }, { storage: storage.adapter })

  assert.equal(summary.vaults, 1)
  assert.equal(summary.documents, 1)
  assert.equal(storage.records.get('documents')!.has('in_scope'), true)
  assert.equal(storage.records.get('documents')!.has('outside'), false)
  assert.equal(storage.records.get('documents')!.get('existing').name, 'Existing.md')
})

test('importVaultPackage remaps conflicting vault and folder document ids', async () => {
  const storage = memoryStorage(
    { jc_vaults_v1: JSON.stringify([{ id: 'v1', name: '已有知识库' }]) },
    { documents: { raw: { id: 'raw', category: 'knowledge', name: 'raw', vaultId: 'v1' } } },
  )

  const summary = await importVaultPackage({
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt: 1,
    vault: { id: 'v1', name: '导入知识库', status: 'active' },
    documents: [
      { id: 'raw', category: 'knowledge', name: 'raw', vaultId: 'v1', mimeType: 'folder' },
      { id: 'doc1', category: 'knowledge', name: 'A.md', vaultId: 'v1', folderId: 'raw' },
    ],
  }, {
    storage: storage.adapter,
    now: 123,
    randomId: () => 'abc',
  })

  const importedVaultId = 'imported_v1_123_abc'
  const importedRawId = 'imported_raw_123_abc'
  assert.equal(summary.vaults, 1)
  assert.equal(summary.documents, 2)
  assert.equal(summary.remappedIds.v1, importedVaultId)
  assert.equal(summary.remappedIds.raw, importedRawId)

  const vaults = JSON.parse(storage.kv.get('jc_vaults_v1'))
  assert.equal(vaults.at(-1).id, importedVaultId)
  assert.equal(storage.records.get('documents')!.get('doc1').vaultId, importedVaultId)
  assert.equal(storage.records.get('documents')!.get('doc1').folderId, importedRawId)
})

test('importVaultPackage extracts only vault knowledge from web backup', async () => {
  const storage = memoryStorage({ jc_vaults_v1: JSON.stringify([]) })
  const summary = await importVaultPackage({
    app: 'jiucaihezi',
    kind: 'web-backup',
    version: 1,
    exportedAt: 1,
    stores: {
      kv_store: {
        jc_vaults_v1: JSON.stringify([{ id: 'v_web', name: 'Web 知识库', status: 'active' }]),
        jc_skills_v2: JSON.stringify([{ id: 's1' }]),
      },
      conversations: [{ id: 'c1' }],
      documents: {
        k1: { id: 'k1', category: 'knowledge', name: 'CLAUDE.md', vaultId: 'v_web' },
        t1: { id: 't1', category: 'text', name: '普通文本' },
      },
    },
  }, { storage: storage.adapter })

  assert.equal(summary.vaults, 1)
  assert.equal(summary.documents, 1)
  assert.equal(storage.records.get('documents')!.has('k1'), true)
  assert.equal(storage.records.get('documents')!.has('t1'), false)
})

test('importVaultPackage excludes web-backup knowledge without a vault owner', async () => {
  const storage = memoryStorage({ jc_vaults_v1: JSON.stringify([]) })
  const summary = await importVaultPackage({
    app: 'jiucaihezi',
    kind: 'web-backup',
    version: 1,
    exportedAt: 1,
    stores: {
      kv_store: {
        jc_vaults_v1: JSON.stringify([{ id: 'v_web', name: 'Web 知识库', status: 'active' }]),
      },
      documents: {
        loose: { id: 'loose', category: 'knowledge', name: 'Loose.md' },
      },
    },
  }, { storage: storage.adapter })

  assert.equal(summary.vaults, 1)
  assert.equal(summary.documents, 0)
  assert.equal(storage.records.get('documents')?.has('loose') || false, false)
})

test('buildVaultExportPackage includes only selected vault knowledge', () => {
  const exported = buildVaultExportPackage({
    vault: { id: 'v1', name: '小说知识库', status: 'active' },
    documents: [
      { id: 'k1', category: 'knowledge', name: 'CLAUDE.md', vaultId: 'v1' },
      { id: 'raw1', category: 'knowledge', name: '资料.md', vaultId: 'v1', metadata: { vaultFolder: 'raw' } },
      { id: 'raw_folder', category: 'knowledge', name: 'raw', vaultId: 'v1', mimeType: 'folder', metadata: { vaultFolder: 'raw' } },
      { id: 'wiki1', category: 'knowledge', name: '页面.md', vaultId: 'v1', metadata: { vaultFolder: 'wiki' } },
      { id: 'k2', category: 'knowledge', name: '其他.md', vaultId: 'v2' },
      { id: 't1', category: 'text', name: '普通文本', vaultId: 'v1' },
    ],
    exportedAt: 1710000000000,
  })

  assert.equal(exported.app, 'jiucaihezi')
  assert.equal(exported.kind, 'vault-backup')
  assert.equal(exported.vault.id, 'v1')
  assert.equal(exported.documents.length, 4)
  assert.equal(exported.documents[0].id, 'k1')
  assert.equal(exported.manifest.documentCount, 3)
  assert.equal(exported.manifest.rawCount, 1)
  assert.equal(exported.manifest.wikiCount, 1)
})
