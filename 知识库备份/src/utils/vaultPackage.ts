import { getItem, getRecord, runStorageBatch, setItem, setRecord } from './idb'

export type VaultImportSourceKind = 'vault-backup' | 'web-backup'

export interface VaultImportPackage {
  sourceKind: VaultImportSourceKind
  vaults: any[]
  documents: any[]
}

export interface VaultImportSummary {
  vaults: number
  documents: number
  importedVaultIds: string[]
  remappedIds: Record<string, string>
}

export interface VaultImportStorageAdapter {
  getItem: (key: string) => Promise<any>
  setItem: (key: string, value: any) => Promise<void>
  getRecord: (storeName: 'documents', key: string) => Promise<any>
  setRecord: (storeName: 'documents', value: any) => Promise<void>
}

export interface VaultImportOptions {
  storage?: VaultImportStorageAdapter
  now?: number
  randomId?: () => string
}

export interface VaultExportPackage {
  app: 'jiucaihezi'
  kind: 'vault-backup'
  version: number
  exportedAt: number
  manifest: {
    documentCount: number
    rawCount: number
    wikiCount: number
    reportCount: number
    templateCount: number
  }
  vault: any
  documents: any[]
}

export interface VaultExportInput {
  vault: any
  documents: any[]
  exportedAt?: number
}

const defaultStorage: VaultImportStorageAdapter = {
  getItem: key => getItem(key),
  setItem: (key, value) => setItem(key, value),
  getRecord: (storeName, key) => getRecord(storeName, key),
  setRecord: (storeName, value) => setRecord(storeName, value),
}

export function buildVaultExportPackage(input: VaultExportInput): VaultExportPackage {
  const vaultId = String(input.vault?.id || '')
  const exportedAt = input.exportedAt || Date.now()
  const documents = (input.documents || [])
    .filter(doc => doc?.category === 'knowledge' && String(doc.vaultId || '') === vaultId)
    .map(doc => ({ ...doc }))
  const folderType = (doc: any) => String(doc?.metadata?.vaultFolder || '')
  const knowledgeFiles = documents.filter(doc => doc.mimeType !== 'folder')
  return {
    app: 'jiucaihezi',
    kind: 'vault-backup',
    version: 1,
    exportedAt,
    manifest: {
      documentCount: knowledgeFiles.length,
      rawCount: knowledgeFiles.filter(doc => folderType(doc) === 'raw').length,
      wikiCount: knowledgeFiles.filter(doc => folderType(doc) === 'wiki').length,
      reportCount: knowledgeFiles.filter(doc => folderType(doc) === 'reports').length,
      templateCount: knowledgeFiles.filter(doc => folderType(doc) === 'templates').length,
    },
    vault: {
      ...input.vault,
      exportedAt,
    },
    documents,
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    throw new Error('知识库文件不是有效 JSON')
  }
}

function recordsFromStore(store: unknown): any[] {
  if (Array.isArray(store)) return store.filter(isPlainObject)
  if (isPlainObject(store)) return Object.values(store).filter(isPlainObject)
  return []
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function collectWebVaults(parsed: Record<string, any>): any[] {
  const kv = {
    ...(isPlainObject(parsed.stores?.kv_store) ? parsed.stores.kv_store : {}),
    ...(isPlainObject(parsed.localStorage) ? parsed.localStorage : {}),
  }
  return parseJsonArray(kv.jc_vaults_v1).filter(vault => isPlainObject(vault) && vault.id && vault.name)
}

function validVaultsFrom(value: unknown): any[] {
  return (Array.isArray(value) ? value : [])
    .filter(vault => isPlainObject(vault) && vault.id && vault.name)
}

function validateManifestCount(parsed: Record<string, any>, documents: any[]) {
  const manifest = parsed.manifest
  if (!isPlainObject(manifest) || manifest.documentCount === undefined) return
  const folderType = (doc: any) => String(doc?.metadata?.vaultFolder || '')
  const knowledgeFiles = documents.filter(doc => doc.mimeType !== 'folder')
  const counts: Record<string, number> = {
    documentCount: knowledgeFiles.length,
    rawCount: knowledgeFiles.filter(doc => folderType(doc) === 'raw').length,
    wikiCount: knowledgeFiles.filter(doc => folderType(doc) === 'wiki').length,
    reportCount: knowledgeFiles.filter(doc => folderType(doc) === 'reports').length,
    templateCount: knowledgeFiles.filter(doc => folderType(doc) === 'templates').length,
  }
  const expected = Number(manifest.documentCount)
  if (!Number.isFinite(expected)) throw new Error('知识库文件 manifest 无效')
  if (expected !== counts.documentCount) {
    throw new Error('知识库文件 manifest 与内容数量不一致')
  }
  for (const key of ['rawCount', 'wikiCount', 'reportCount', 'templateCount']) {
    if (manifest[key] === undefined) throw new Error(`知识库文件 manifest 缺少 ${key}`)
    const expectedBucket = Number(manifest[key])
    if (!Number.isFinite(expectedBucket) || expectedBucket !== counts[key]) {
      throw new Error(`知识库文件 manifest ${key} 与内容数量不一致`)
    }
  }
}

function collectWebKnowledgeDocuments(parsed: Record<string, any>, vaultIds: Set<string>): any[] {
  return recordsFromStore(parsed.stores?.documents)
    .filter(doc => doc.id && doc.category === 'knowledge' && doc.vaultId && vaultIds.has(String(doc.vaultId)))
}

export function parseVaultImportPackage(input: string | unknown): VaultImportPackage {
  const parsed = typeof input === 'string' ? parseJson(input) : input
  if (!isPlainObject(parsed)) throw new Error('知识库文件格式错误：顶层必须是对象')
  if (parsed.app !== 'jiucaihezi') throw new Error('知识库文件格式错误：不是韭菜盒子数据包')

  if (parsed.kind === 'vault-backup') {
    const rawVaults = Array.isArray(parsed.vaults)
      ? parsed.vaults
      : (isPlainObject(parsed.vault) ? [parsed.vault] : [])
    const vaults = validVaultsFrom(rawVaults)
    const vaultIds = new Set(vaults.map(vault => String(vault.id)))
    const documents = recordsFromStore(parsed.documents)
      .filter(doc => doc.id && doc.category === 'knowledge' && doc.vaultId && vaultIds.has(String(doc.vaultId)))
    if (vaults.length === 0) throw new Error('知识库文件缺少 vault 数据')
    validateManifestCount(parsed, documents)
    return {
      sourceKind: 'vault-backup',
      vaults,
      documents,
    }
  }

  if (parsed.kind === 'web-backup') {
    const vaults = validVaultsFrom(collectWebVaults(parsed))
    if (vaults.length === 0) throw new Error('知识库文件缺少 vault 数据')
    const vaultIds = new Set(vaults.map(vault => String(vault.id)))
    return {
      sourceKind: 'web-backup',
      vaults,
      documents: collectWebKnowledgeDocuments(parsed, vaultIds),
    }
  }

  throw new Error('知识库文件格式错误：仅支持 .jcvault 或网页版 .jcbackup')
}

function makeImportedId(oldId: string, timestamp: number, randomId: () => string): string {
  const safeOldId = oldId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const suffix = randomId().replace(/[^a-zA-Z0-9_-]/g, '_') || 'id'
  return `imported_${safeOldId}_${timestamp}_${suffix}`
}

function remapScalar(value: unknown, remappedIds: Record<string, string>): unknown {
  if (typeof value !== 'string') return value
  return remappedIds[value] || value
}

function remapObjectIds(value: unknown, remappedIds: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => remapObjectIds(item, remappedIds))
  if (!isPlainObject(value)) return remapScalar(value, remappedIds)

  const next: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    next[key] = remapObjectIds(nested, remappedIds)
  }
  return next
}

async function importVaults(
  storage: VaultImportStorageAdapter,
  vaults: any[],
  timestamp: number,
  randomId: () => string,
  remappedIds: Record<string, string>,
): Promise<{ count: number; importedIds: string[] }> {
  const existingRaw = await storage.getItem('jc_vaults_v1')
  const merged = parseJsonArray(existingRaw).filter(isPlainObject)
  const existingIds = new Set(merged.map(vault => String(vault.id)))
  let count = 0
  const importedIds: string[] = []

  for (const vault of vaults) {
    if (!vault?.id || !vault?.name) continue
    const oldId = String(vault.id)
    const nextId = existingIds.has(oldId) ? makeImportedId(oldId, timestamp, randomId) : oldId
    if (nextId !== oldId) remappedIds[oldId] = nextId
    existingIds.add(nextId)
    importedIds.push(nextId)
    merged.push({
      ...vault,
      id: nextId,
      updatedAt: Date.now(),
      status: vault.status || 'active',
    })
    count += 1
  }

  await storage.setItem('jc_vaults_v1', JSON.stringify(merged))
  return { count, importedIds }
}

async function reserveDocumentIds(
  storage: VaultImportStorageAdapter,
  documents: any[],
  timestamp: number,
  randomId: () => string,
  remappedIds: Record<string, string>,
) {
  for (const doc of documents) {
    if (!doc?.id) continue
    const oldId = String(doc.id)
    const existing = await storage.getRecord('documents', oldId)
    if (existing) remappedIds[oldId] = makeImportedId(oldId, timestamp, randomId)
  }
}

async function importDocuments(
  storage: VaultImportStorageAdapter,
  documents: any[],
  remappedIds: Record<string, string>,
): Promise<number> {
  let count = 0
  for (const doc of documents) {
    if (!doc?.id || doc.category !== 'knowledge') continue
    const next = remapObjectIds(doc, remappedIds) as Record<string, any>
    next.id = remappedIds[String(doc.id)] || String(doc.id)
    next.category = 'knowledge'
    next.updatedAt = Date.now()
    if (!next.createdAt) next.createdAt = next.updatedAt
    await storage.setRecord('documents', next)
    count += 1
  }
  return count
}

export async function importVaultPackage(
  input: string | unknown,
  options: VaultImportOptions = {},
): Promise<VaultImportSummary> {
  const pkg = parseVaultImportPackage(input)
  const storage = options.storage || defaultStorage
  const timestamp = options.now || Date.now()
  const randomId = options.randomId || (() => Math.random().toString(36).slice(2, 10))
  const remappedIds: Record<string, string> = {}

  return runStorageBatch(async () => {
    const vaultResult = await importVaults(storage, pkg.vaults, timestamp, randomId, remappedIds)
    await reserveDocumentIds(storage, pkg.documents, timestamp, randomId, remappedIds)
    const documents = await importDocuments(storage, pkg.documents, remappedIds)
    return {
      vaults: vaultResult.count,
      documents,
      importedVaultIds: vaultResult.importedIds,
      remappedIds,
    }
  })
}
