import { getItem, getRecord, runStorageBatch, setItem, setRecord } from './idb'

type RecordStoreName = 'conversations' | 'messages' | 'documents'
type BackupRecordStore = Record<string, any> | any[]

export interface JcBackupPackage {
  app: 'jiucaihezi'
  kind: 'web-backup'
  version: number
  exportedAt: number
  stores: {
    kv_store?: Record<string, unknown>
    conversations?: BackupRecordStore
    messages?: BackupRecordStore
    documents?: BackupRecordStore
  }
  localStorage?: Record<string, string>
}

export interface MigrationImportOptions {
  mode?: 'merge'
  now?: number
  randomId?: () => string
  storage?: MigrationStorageAdapter
}

export interface MigrationImportSummary {
  conversations: number
  messages: number
  documents: number
  skills: number
  localStorage: number
  skippedKeys: string[]
  remappedIds: Record<string, string>
}

export interface MigrationStorageAdapter {
  getItem: (key: string) => Promise<any>
  getRecord: (storeName: RecordStoreName, key: string) => Promise<any>
  setRecord: (storeName: RecordStoreName, value: any) => Promise<void>
  setItem: (key: string, value: any) => Promise<void>
}

const LOCAL_STORAGE_WHITELIST = new Set<string>()

const defaultStorage: MigrationStorageAdapter = {
  getItem: key => getItem(key),
  getRecord: (storeName, key) => getRecord(storeName, key),
  setRecord: (storeName, value) => setRecord(storeName, value),
  setItem: (key, value) => setItem(key, value),
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function parseJsonString(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    throw new Error('备份文件不是有效的 JSON，请选择完整的 .jcbackup 文件')
  }
}

function assertRecordStore(value: unknown, label: string): asserts value is BackupRecordStore | undefined {
  if (value === undefined) return
  if (Array.isArray(value)) return
  if (isPlainObject(value)) return
  throw new Error(`备份中的 ${label} 必须是数组或对象映射`)
}

export function parseBackupPackage(input: string | unknown): JcBackupPackage {
  const parsed = typeof input === 'string' ? parseJsonString(input) : input

  if (!isPlainObject(parsed)) {
    throw new Error('备份内容格式错误：顶层必须是对象')
  }
  if (parsed.app !== 'jiucaihezi' || parsed.kind !== 'web-backup') {
    throw new Error('备份内容格式错误：不是韭菜盒子 Web 备份')
  }
  if (typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) {
    throw new Error('备份内容格式错误：缺少有效的版本号')
  }
  if (typeof parsed.exportedAt !== 'number' || !Number.isFinite(parsed.exportedAt)) {
    throw new Error('备份内容格式错误：缺少有效的导出时间')
  }
  if (!isPlainObject(parsed.stores)) {
    throw new Error('备份内容格式错误：缺少 stores 数据')
  }

  const stores = parsed.stores as JcBackupPackage['stores']
  assertRecordStore(stores.conversations, 'conversations')
  assertRecordStore(stores.messages, 'messages')
  assertRecordStore(stores.documents, 'documents')
  if (stores.kv_store !== undefined && !isPlainObject(stores.kv_store)) {
    throw new Error('备份中的 kv_store 必须是对象映射')
  }
  if (parsed.localStorage !== undefined) {
    if (!isPlainObject(parsed.localStorage)) {
      throw new Error('备份中的 localStorage 必须是对象映射')
    }
    for (const [key, value] of Object.entries(parsed.localStorage)) {
      if (typeof value !== 'string') {
        throw new Error(`备份中的 localStorage.${key} 必须是字符串`)
      }
    }
  }

  return parsed as unknown as JcBackupPackage
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  if (err == null) return '未知错误'
  try {
    const serialized = JSON.stringify(err)
    return serialized && serialized !== '{}' ? serialized : String(err)
  } catch {
    return String(err) || '未知错误'
  }
}

function recordsFromStore(store: BackupRecordStore | undefined): any[] {
  if (!store) return []
  const values = Array.isArray(store) ? store : Object.values(store)
  return values.filter(isPlainObject)
}

function visibleDocumentRecords(store: BackupRecordStore | undefined): any[] {
  return recordsFromStore(store).filter(record => typeof record.category === 'string' && record.category)
}

export function summarizeBackupPackage(pkg: JcBackupPackage): MigrationImportSummary {
  return {
    conversations: recordsFromStore(pkg.stores.conversations).length,
    messages: recordsFromStore(pkg.stores.messages).length,
    documents: visibleDocumentRecords(pkg.stores.documents).length,
    skills: 0,
    localStorage: Object.keys(collectCandidateKv(pkg)).length,
    skippedKeys: [],
    remappedIds: {},
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function collectCandidateKv(pkg: JcBackupPackage): Record<string, unknown> {
  return {
    ...(pkg.stores.kv_store || {}),
    ...(pkg.localStorage || {}),
  }
}

function makeImportedId(oldId: string, timestamp: number, randomId: () => string): string {
  const safeOldId = oldId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const suffix = randomId().replace(/[^a-zA-Z0-9_-]/g, '_') || 'id'
  return `imported_${safeOldId}_${timestamp}_${suffix}`
}

async function resolveRecordId(
  storage: MigrationStorageAdapter,
  storeName: RecordStoreName,
  record: any,
  timestamp: number,
  randomId: () => string,
  remappedIds: Record<string, string>
): Promise<any | null> {
  if (!isPlainObject(record) || record.id == null) return null

  const oldId = String(record.id)
  const nextRecord = { ...record, id: remappedIds[oldId] || oldId }
  const existing = await storage.getRecord(storeName, nextRecord.id)
  if (!existing || deepEqual(existing, nextRecord)) return nextRecord

  const newId = makeImportedId(oldId, timestamp, randomId)
  remappedIds[oldId] = newId
  return { ...nextRecord, id: newId }
}

function remapValue(value: unknown, remappedIds: Record<string, string>): unknown {
  if (typeof value !== 'string') return value
  return remappedIds[value] || value
}

function remapMessage(record: any, remappedIds: Record<string, string>): any {
  return {
    ...record,
    conversationId: remapValue(record.conversationId, remappedIds),
  }
}

function remapDocument(record: any, remappedIds: Record<string, string>): any {
  const next = { ...record }
  if ('folderId' in next) next.folderId = remapValue(next.folderId, remappedIds)
  if ('sourceSessionId' in next) next.sourceSessionId = remapValue(next.sourceSessionId, remappedIds)
  if (isPlainObject(next.metadata)) next.metadata = remapObjectIds(next.metadata, remappedIds)
  return next
}

function remapObjectIds(value: unknown, remappedIds: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => remapObjectIds(item, remappedIds))
  if (!isPlainObject(value)) return remapValue(value, remappedIds)

  const next: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    next[key] = remapObjectIds(nested, remappedIds)
  }
  return next
}

async function sanitizeKvValue(
  storage: MigrationStorageAdapter,
  key: string,
  value: unknown,
  remappedIds: Record<string, string>,
  timestamp: number,
  randomId: () => string
): Promise<string | null> {
  if (!LOCAL_STORAGE_WHITELIST.has(key)) return null
  if (typeof value !== 'string') return null
  void storage
  void remappedIds
  void timestamp
  void randomId
  return value
}

async function importKvKey(
  storage: MigrationStorageAdapter,
  key: string,
  value: unknown,
  remappedIds: Record<string, string>,
  timestamp: number,
  randomId: () => string,
  skippedKeys: string[]
): Promise<boolean> {
  const sanitized = await sanitizeKvValue(storage, key, value, remappedIds, timestamp, randomId)
  if (sanitized == null) {
    skippedKeys.push(key)
    return false
  }
  await storage.setItem(key, sanitized)
  return true
}

async function importRecordStore(
  storage: MigrationStorageAdapter,
  storeName: RecordStoreName,
  records: any[],
  transform: (record: any) => any,
  timestamp: number,
  randomId: () => string,
  remappedIds: Record<string, string>
): Promise<number> {
  let imported = 0
  for (const record of records) {
    const nextRecord = await resolveRecordId(storage, storeName, transform(record), timestamp, randomId, remappedIds)
    if (!nextRecord) continue
    await storage.setRecord(storeName, nextRecord)
    imported += 1
  }
  return imported
}

export async function importBackupPackage(
  pkg: JcBackupPackage,
  options: MigrationImportOptions = {}
): Promise<MigrationImportSummary> {
  if (options.mode && options.mode !== 'merge') {
    throw new Error('目前仅支持合并导入模式')
  }

  const storage = options.storage || defaultStorage
  const timestamp = options.now || Date.now()
  const randomId = options.randomId || (() => Math.random().toString(36).slice(2, 10))
  const remappedIds: Record<string, string> = {}
  const candidates = collectCandidateKv(pkg)
  const skippedKeys: string[] = []
  let localStorageCount = 0

  return runStorageBatch(async () => {
    const conversations = await importRecordStore(
      storage,
      'conversations',
      recordsFromStore(pkg.stores.conversations),
      record => ({ ...record }),
      timestamp,
      randomId,
      remappedIds
    )
    const messages = await importRecordStore(
      storage,
      'messages',
      recordsFromStore(pkg.stores.messages),
      record => remapMessage(record, remappedIds),
      timestamp,
      randomId,
      remappedIds
    )

    const documents = await importRecordStore(
      storage,
      'documents',
      visibleDocumentRecords(pkg.stores.documents),
      record => remapDocument(record, remappedIds),
      timestamp,
      randomId,
      remappedIds
    )

    for (const [key, value] of Object.entries(candidates)) {
      const imported = await importKvKey(storage, key, value, remappedIds, timestamp, randomId, skippedKeys)
      if (imported) localStorageCount += 1
    }

    return {
      conversations,
      messages,
      documents,
      skills: 0,
      localStorage: localStorageCount,
      skippedKeys,
      remappedIds,
    }
  })
}
