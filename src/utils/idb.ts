/**
 * utils/idb.ts — 统一存储引擎 (SQLite)
 *
 * 数据存储于 ~/.jiucaihezi/data/jiucaihezi.db (SQLite)
 * 首次启动自动从旧 JSON 文件迁移数据
 * 内存缓存避免每次读都走 SQL
 *
 * 对外 API 不变，调用方零改动。
 */

import Database from '@tauri-apps/plugin-sql'
import { isTauriRuntime } from './tauriEnv'

// ═══════════════════════════════════════════════════
//  初始化
// ═══════════════════════════════════════════════════

let db: Database | null = null
let webDb: IDBDatabase | null = null
let webDbPromise: Promise<IDBDatabase | null> | null = null
const isTauri = isTauriRuntime()

/** 内存缓存：fullyLoaded 标记防局部缓存污染全表查询 */
const cache: Record<string, { map: Map<string, any>; fullyLoaded: boolean }> = {
  kv_store:      { map: new Map(), fullyLoaded: false },
  conversations: { map: new Map(), fullyLoaded: false },
  messages:      { map: new Map(), fullyLoaded: false },
  documents:     { map: new Map(), fullyLoaded: false },
  media_assets:  { map: new Map(), fullyLoaded: false },
}

const STORE_NAMES = ['kv_store', 'conversations', 'messages', 'documents', 'media_assets'] as const
const CONVERSATION_CONTEXT_STORE_NAMES = [
  'runtime_segments',
  'conversation_run_snapshots',
  'conversation_message_chunks',
  'conversation_memory_items',
  'conversation_memory_jobs',
  'conversation_continuations',
  'conversation_rebuild_jobs',
  'conversation_dirty_segments',
] as const
const WEB_DB_NAME = 'jiucaihezi_web_store_v1'
const WEB_DB_VERSION = 1
const WEB_KV_MIGRATION_KEYS = [
  'jc_media_tasks_v1',
  'jc_mcp_servers_v1',
  'jc_canvas_document_v1',
]

export async function initDB(): Promise<void> {
  if (!isTauri) {
    const opened = await openWebDb()
    if (opened) {
      await migrateWebLocalStorageToIndexedDb()
      console.log('[JC] 存储引擎: IndexedDB (web)')
    } else {
      console.warn('[JC] 非 Tauri 环境且 IndexedDB 不可用，使用 localStorage 兜底')
    }
    return
  }

  const { appDataDir, homeDir } = await import('@tauri-apps/api/path')
  const appData = await appDataDir()
  const home = await homeDir()
  const dirs = resolveDesktopDataDirs(appData, home)

  // 确保目录存在
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(dirs.dataDir))) {
    await mkdir(dirs.dataDir, { recursive: true })
  }

  const dbPath = `${dirs.dataDir}/jiucaihezi.db`
  db = await Database.load(`sqlite:${dbPath}`)

  // 创建表结构
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL, scopeKey TEXT, updatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, data TEXT NOT NULL, conversationId TEXT, updatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL, docKey TEXT, updatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      logicalPath TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      hash TEXT,
      source TEXT NOT NULL,
      sourceId TEXT,
      sourceUrl TEXT,
      thumbnailAssetId TEXT,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conv_scopeKey ON conversations(scopeKey);
    CREATE INDEX IF NOT EXISTS idx_conv_updatedAt ON conversations(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_msg_convId ON messages(conversationId);
    CREATE INDEX IF NOT EXISTS idx_msg_updatedAt ON messages(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_doc_docKey ON documents(docKey);
    CREATE INDEX IF NOT EXISTS idx_doc_updatedAt ON documents(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_media_source ON media_assets(source);
    CREATE INDEX IF NOT EXISTS idx_media_createdAt ON media_assets(createdAt);
    CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL);
  `)
  await initConversationContextTables()

  // 首次运行：从旧 JSON 文件迁移
  await migrateFromJsonFiles(dirs.legacyDataDir)

  // 预热缓存：加载所有数据到内存
  await warmCache()

  // Schema 迁移：documents 表加 category 投影列（P0-0，不阻塞启动）
  await migrateDocumentsCategoryColumn()

  // Schema 迁移：media_assets 表加 sourceUrl 列（P1，不阻塞启动）
  await migrateMediaAssetsSourceUrlColumn()

  console.log('[JC] 存储引擎: SQLite (' + dbPath + ')')
}

async function initConversationContextTables() {
  if (!db) return
  await db.execute(`
    CREATE TABLE IF NOT EXISTS runtime_segments (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      trigger TEXT NOT NULL,
      label TEXT,
      skillId TEXT,
      toolSignature TEXT,
      createdAt INTEGER NOT NULL,
      closedAt INTEGER,
      metadata TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_segments_session ON runtime_segments(sessionId, createdAt);

    CREATE TABLE IF NOT EXISTS conversation_run_snapshots (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      runtimeSegmentId TEXT NOT NULL,
      userMessageId TEXT NOT NULL,
      assistantMessageId TEXT,
      skillId TEXT,
      enabledToolNames TEXT NOT NULL,
      modelId TEXT NOT NULL,
      providerId TEXT,
      contextMode TEXT NOT NULL,
      loadLevel TEXT NOT NULL,
      promptPlan TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_snapshots_session ON conversation_run_snapshots(sessionId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_run_snapshots_segment ON conversation_run_snapshots(runtimeSegmentId, createdAt);

    CREATE TABLE IF NOT EXISTS conversation_message_chunks (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      role TEXT NOT NULL,
      chunkIndex INTEGER NOT NULL,
      text TEXT NOT NULL,
      tokenCount INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      metadata TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_chunks_session ON conversation_message_chunks(sessionId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_message_chunks_message ON conversation_message_chunks(messageId, chunkIndex);

    CREATE TABLE IF NOT EXISTS conversation_memory_items (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      runtimeSegmentId TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      sourceMessageIds TEXT NOT NULL,
      skillId TEXT,
      score REAL,
      tokenCount INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastUsedAt INTEGER,
      indexDriver TEXT NOT NULL,
      externalId TEXT,
      idempotencyKey TEXT NOT NULL,
      syncStatus TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_items_session ON conversation_memory_items(sessionId, updatedAt);
    CREATE INDEX IF NOT EXISTS idx_memory_items_segment ON conversation_memory_items(runtimeSegmentId, updatedAt);
    CREATE INDEX IF NOT EXISTS idx_memory_items_external ON conversation_memory_items(indexDriver, externalId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_idempotency ON conversation_memory_items(idempotencyKey);

    CREATE TABLE IF NOT EXISTS conversation_memory_jobs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      runtimeSegmentId TEXT NOT NULL,
      runId TEXT NOT NULL,
      sourceMessageIds TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      nextRunAt INTEGER NOT NULL,
      lastError TEXT,
      idempotencyKey TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_status ON conversation_memory_jobs(status, nextRunAt);
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_session ON conversation_memory_jobs(sessionId, createdAt);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_jobs_idempotency ON conversation_memory_jobs(idempotencyKey);

    CREATE TABLE IF NOT EXISTS conversation_continuations (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      runtimeSegmentId TEXT NOT NULL,
      parentAssistantMessageId TEXT NOT NULL,
      partIds TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      reusedContextPlanId TEXT NOT NULL,
      outputStructureSummary TEXT NOT NULL,
      completedSectionPointers TEXT NOT NULL,
      lastFinishReason TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      metadata TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_continuations_run ON conversation_continuations(runId, updatedAt);
    CREATE INDEX IF NOT EXISTS idx_continuations_session ON conversation_continuations(sessionId, updatedAt);

    CREATE TABLE IF NOT EXISTS conversation_rebuild_jobs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      runtimeSegmentId TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      cursor TEXT,
      processedChunks INTEGER NOT NULL,
      totalChunks INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      lastError TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rebuild_jobs_status ON conversation_rebuild_jobs(status, priority, updatedAt);
    CREATE INDEX IF NOT EXISTS idx_rebuild_jobs_session ON conversation_rebuild_jobs(sessionId, updatedAt);

    CREATE TABLE IF NOT EXISTS conversation_dirty_segments (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      runtimeSegmentId TEXT NOT NULL,
      reason TEXT NOT NULL,
      severity TEXT NOT NULL,
      estimatedTokenImpact INTEGER NOT NULL,
      dirtySince INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dirty_segments_status ON conversation_dirty_segments(status, priority, dirtySince);
    CREATE INDEX IF NOT EXISTS idx_dirty_segments_session ON conversation_dirty_segments(sessionId, runtimeSegmentId);
  `)
}

// ═══════════════════════════════════════════════════
//  JSON → SQLite 迁移
// ═══════════════════════════════════════════════════

async function migrateFromJsonFiles(legacyDataDir: string) {
  if (!db) return
  const migrated = await db.select<{ name: string }[]>(
    "SELECT name FROM _migrations WHERE name = 'json_to_sqlite'"
  )
  if (migrated.length > 0) return

  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')

  for (const store of STORE_NAMES) {
    const path = `${legacyDataDir}/${store}.json`
    if (!(await exists(path))) continue
    try {
      const text = await readTextFile(path)
      const data = JSON.parse(text)
      if (store === 'kv_store') {
        for (const [key, value] of Object.entries(data)) {
          await db.execute(
            'INSERT OR REPLACE INTO kv_store (key, value) VALUES ($1, $2)',
            [key, JSON.stringify(value)]
          )
        }
      } else {
        for (const [id, record] of Object.entries(data as Record<string, any>)) {
          await db.execute(
            `INSERT OR REPLACE INTO ${store} (id, data, updatedAt) VALUES ($1, $2, $3)`,
            [id, JSON.stringify(record), Date.now()]
          )
        }
      }
      console.log(`[JC] 迁移完成: ${store}.json → SQLite`)
    } catch (err) {
      console.warn(`[JC] 迁移 ${store}.json 失败，跳过:`, err)
    }
  }

  await db.execute(
    "INSERT INTO _migrations (name, appliedAt) VALUES ('json_to_sqlite', $1)",
    [Date.now()]
  )
}

/** 预热缓存：只加载启动必需的 kv_store（设置项），其余表按需懒加载 */
async function warmCache() {
  if (!db) return
  // 只预热 kv_store（设置项，通常 < 100KB，瞬间完成）
  // conversations / messages / documents 不在启动时加载
  const entry = cache['kv_store']
  entry.map.clear()
  const rows = await db.select<{ key: string; value: string }[]>(
    'SELECT key, value FROM kv_store'
  )
  for (const row of rows) {
    try { entry.map.set(row.key, JSON.parse(row.value)) } catch { entry.map.set(row.key, row.value) }
  }
  entry.fullyLoaded = true
}

/** P0-0: documents 表加 category 投影列（不阻塞启动，不回填历史数据） */
async function migrateDocumentsCategoryColumn() {
  if (!db) return
  const done = await db.select<{ name: string }[]>(
    "SELECT name FROM _migrations WHERE name = 'documents_category_column'"
  )
  if (done.length > 0) return

  // 加列（不存在则加，SQLite 不支持 IF NOT EXISTS for ALTER TABLE，用 try/catch）
  try {
    await db.execute('ALTER TABLE documents ADD COLUMN category TEXT')
  } catch (_) {
    // 列已存在（可能是上次 ALTER 成功但 _migrations 写入失败）
  }
  await db.execute(
    "INSERT INTO _migrations (name, appliedAt) VALUES ('documents_category_column', $1)",
    [Date.now()]
  )
  // 索引在后台异步创建（0.8GB documents 表上 CREATE INDEX 可能扫全表，不能阻塞启动）
  const dbRef = db
  setTimeout(async () => {
    try {
      await dbRef.execute('CREATE INDEX IF NOT EXISTS idx_doc_category ON documents(category)')
    } catch { /* 忽略后台建索引失败 */ }
  }, 3000)
  console.log('[JC] Schema 迁移: documents 表 category 列已添加（索引后台创建中）')
}

/** P1: media_assets 表加 sourceUrl 列（存储上游 CDN URL，用于「复制 URL」功能） */
async function migrateMediaAssetsSourceUrlColumn() {
  if (!db) return
  const done = await db.select<{ name: string }[]>(
    "SELECT name FROM _migrations WHERE name = 'media_assets_source_url_column'"
  )
  if (done.length > 0) return

  try {
    await db.execute('ALTER TABLE media_assets ADD COLUMN sourceUrl TEXT')
    await db.execute(
      "INSERT INTO _migrations (name, appliedAt) VALUES ('media_assets_source_url_column', $1)",
      [Date.now()]
    )
    console.log('[JC] Schema 迁移: media_assets 表 sourceUrl 列已添加')
  } catch (e) {
    // 列已存在（可能是上次 ALTER 成功但 _migrations 写入失败）
    console.warn('[JC] Schema 迁移: media_assets sourceUrl 列添加失败（可能已存在）:', e)
  }
}

// ═══════════════════════════════════════════════════
//  Web IndexedDB fallback
// ═══════════════════════════════════════════════════

function getIndexedDbFactory(): IDBFactory | null {
  if (typeof indexedDB !== 'undefined') return indexedDB
  const runtime = globalThis as any
  return runtime.indexedDB || null
}

function ensureWebObjectStore(db: IDBDatabase, name: string, keyPath: string) {
  if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
  })
}

async function openWebDb(): Promise<IDBDatabase | null> {
  if (isTauri) return null
  if (webDb) return webDb
  if (webDbPromise) return webDbPromise

  const factory = getIndexedDbFactory()
  if (!factory) return null

  webDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = factory.open(WEB_DB_NAME, WEB_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      ensureWebObjectStore(database, 'kv_store', 'key')
      for (const store of STORE_NAMES) {
        if (store !== 'kv_store') ensureWebObjectStore(database, store, 'id')
      }
      for (const store of CONVERSATION_CONTEXT_STORE_NAMES) {
        ensureWebObjectStore(database, store, 'id')
      }
    }
    request.onsuccess = () => {
      webDb = request.result
      webDb.onversionchange = () => {
        webDb?.close()
        webDb = null
      }
      resolve(webDb)
    }
    request.onerror = () => {
      console.warn('[JC] IndexedDB 初始化失败，退回 localStorage:', request.error)
      resolve(null)
    }
    request.onblocked = () => {
      console.warn('[JC] IndexedDB 升级被旧页面阻塞，请关闭旧标签页后刷新')
    }
  }).finally(() => {
    webDbPromise = null
  })

  return webDbPromise
}

async function webGet(storeName: string, key: string): Promise<{ found: boolean; value: any }> {
  const database = await openWebDb()
  if (!database || !database.objectStoreNames.contains(storeName)) return { found: false, value: null }
  try {
    const tx = database.transaction(storeName, 'readonly')
    const value = await requestToPromise(tx.objectStore(storeName).get(String(key)))
    if (value === undefined) return { found: false, value: null }
    if (storeName === 'kv_store') return { found: true, value: (value as any).value }
    return { found: true, value }
  } catch (error) {
    console.warn(`[JC] IndexedDB 读取失败: ${storeName}`, error)
    return { found: false, value: null }
  }
}

async function webPut(storeName: string, value: any): Promise<boolean> {
  const database = await openWebDb()
  if (!database || !database.objectStoreNames.contains(storeName)) return false
  try {
    const tx = database.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value)
    await transactionDone(tx)
    return true
  } catch (error) {
    console.error(`[JC] IndexedDB 写入失败: ${storeName}`, error)
    return false
  }
}

async function webDelete(storeName: string, key: string): Promise<boolean> {
  const database = await openWebDb()
  if (!database || !database.objectStoreNames.contains(storeName)) return false
  try {
    const tx = database.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(String(key))
    await transactionDone(tx)
    return true
  } catch (error) {
    console.error(`[JC] IndexedDB 删除失败: ${storeName}`, error)
    return false
  }
}

async function webGetAll(storeName: string): Promise<any[] | null> {
  const database = await openWebDb()
  if (!database || !database.objectStoreNames.contains(storeName)) return null
  try {
    const tx = database.transaction(storeName, 'readonly')
    const values = await requestToPromise(tx.objectStore(storeName).getAll())
    if (storeName === 'kv_store') return values.map((item: any) => item.value)
    return values
  } catch (error) {
    console.warn(`[JC] IndexedDB 列表读取失败: ${storeName}`, error)
    return null
  }
}

function parseLocalStorageJson(raw: string): any {
  try { return JSON.parse(raw) } catch { return raw }
}

async function migrateWebLocalStorageToIndexedDb(): Promise<void> {
  const database = await openWebDb()
  if (!database || typeof localStorage === 'undefined') return

  for (const key of WEB_KV_MIGRATION_KEYS) {
    const raw = localStorage.getItem(key)
    if (raw == null) continue
    const existing = await webGet('kv_store', key)
    if (!existing.found && await webPut('kv_store', { key, value: parseLocalStorageJson(raw) })) {
      localStorage.removeItem(key)
    }
  }

  for (const store of STORE_NAMES) {
    if (store === 'kv_store') continue
    const storeKey = `jc_store_${store}`
    const raw = localStorage.getItem(storeKey)
    if (!raw) continue
    try {
      const all = JSON.parse(raw)
      if (!all || typeof all !== 'object') continue
      for (const [id, record] of Object.entries(all as Record<string, any>)) {
        await webPut(store, { ...(record || {}), id: String((record as any)?.id || id) })
      }
      localStorage.removeItem(storeKey)
    } catch (error) {
      console.warn(`[JC] 迁移 ${storeKey} 到 IndexedDB 失败，保留 localStorage 备份:`, error)
    }
  }

  for (const store of CONVERSATION_CONTEXT_STORE_NAMES) {
    const storeKey = `jc_context_store_${store}`
    const raw = localStorage.getItem(storeKey)
    if (!raw) continue
    try {
      const all = JSON.parse(raw)
      if (!all || typeof all !== 'object') continue
      for (const [id, record] of Object.entries(all as Record<string, any>)) {
        await webPut(store, { ...(record || {}), id: String((record as any)?.id || id) })
      }
      localStorage.removeItem(storeKey)
    } catch (error) {
      console.warn(`[JC] 迁移 ${storeKey} 到 IndexedDB 失败，保留 localStorage 备份:`, error)
    }
  }
}

// ═══════════════════════════════════════════════════
//  批量操作
// ═══════════════════════════════════════════════════

export async function runStorageBatch<T>(operation: () => Promise<T>): Promise<T> {
  return operation()
}

// ═══════════════════════════════════════════════════
//  KV Store API（设置、Skill配置等）
// ═══════════════════════════════════════════════════

export async function getItem(key: string): Promise<any> {
  if (isTauri) return cache.kv_store.map.get(key) ?? null
  const stored = await webGet('kv_store', key)
  if (stored.found) return stored.value
  // 浏览器降级
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return localStorage.getItem(key)
  }
}

export async function setItem(key: string, value: any): Promise<void> {
  if (isTauri) {
    cache.kv_store.map.set(key, value)
    if (db) {
      await db.execute('INSERT OR REPLACE INTO kv_store (key, value) VALUES ($1, $2)', [
        key, JSON.stringify(value),
      ])
    }
    return
  }
  if (await webPut('kv_store', { key, value })) return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error('[JC] localStorage 写入失败:', key, error)
    throw error
  }
}

export async function removeItem(key: string): Promise<void> {
  if (isTauri) {
    cache.kv_store.map.delete(key)
    if (db) await db.execute('DELETE FROM kv_store WHERE key = $1', [key])
    return
  }
  await webDelete('kv_store', key)
  localStorage.removeItem(key)
}

// ═══════════════════════════════════════════════════
//  Record Store API（conversations / messages / documents）
// ═══════════════════════════════════════════════════

export function hasStore(storeName: string): boolean {
  return (STORE_NAMES as readonly string[]).includes(storeName) && storeName !== 'kv_store'
}

export async function getRecord(storeName: string, key: string): Promise<any> {
  const id = String(key)
  if (isTauri) {
    const cached = cache[storeName]?.map.get(id)
    if (cached !== undefined) return cached
    if (!db || !hasStore(storeName)) return null
    const rows = await db.select<{ data: string }[]>(
      `SELECT data FROM ${storeName} WHERE id = $1`, [id]
    )
    if (rows.length === 0) return null
    try { return JSON.parse(rows[0].data) } catch { return rows[0].data }
  }
  const stored = await webGet(storeName, id)
  if (stored.found) return stored.value
  // 浏览器降级：从 localStorage 读取
  try {
    const storeKey = `jc_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    if (!raw) return null
    const all = JSON.parse(raw)
    if (!all || typeof all !== 'object') return null
    return all[id] ?? null
  } catch { return null }
}

export async function setRecord(storeName: string, value: any): Promise<void> {
  if (!hasStore(storeName)) return
  if (storeName === 'media_assets') {
    // media_assets 使用独立 insertMediaAsset()，不走通用 JSON blob 路径
    return
  }
  const id = value?.id ?? value?.key
  if (id == null) return
  const idStr = String(id)
  if (isTauri) {
    if (cache[storeName]?.fullyLoaded) cache[storeName].map.set(idStr, value)
    if (db) {
      if (storeName === 'documents') {
        // P0-1: 同步写 category 投影列，支持 getAllByIndex 走索引
        const category = String(value?.category || '').trim() || null
        await db.execute(
          `INSERT OR REPLACE INTO documents (id, data, updatedAt, category) VALUES ($1, $2, $3, $4)`,
          [idStr, JSON.stringify(value), Date.now(), category]
        )
      } else {
        await db.execute(
          `INSERT OR REPLACE INTO ${storeName} (id, data, updatedAt) VALUES ($1, $2, $3)`,
          [idStr, JSON.stringify(value), Date.now()]
        )
      }
    }
    return
  }
  if (await webPut(storeName, { ...value, id: idStr })) return
  // 浏览器降级：写入 localStorage
  try {
    const storeKey = `jc_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    const all = raw ? JSON.parse(raw) : {}
    if (!all || typeof all !== 'object') return
    all[idStr] = value
    localStorage.setItem(storeKey, JSON.stringify(all))
  } catch (error) {
    console.error('[JC] localStorage record 写入失败:', storeName, idStr, error)
    throw error
  }
}

export async function removeRecord(storeName: string, key: string): Promise<void> {
  if (!hasStore(storeName)) return
  const id = String(key)
  if (isTauri) {
    cache[storeName]?.map.delete(id)
    if (db) await db.execute(`DELETE FROM ${storeName} WHERE id = $1`, [id])
    return
  }
  await webDelete(storeName, id)
  try {
    const storeKey = `jc_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    const all = raw ? JSON.parse(raw) : {}
    if (!all || typeof all !== 'object') return
    delete all[id]
    localStorage.setItem(storeKey, JSON.stringify(all))
  } catch {}
}

export async function getAll(storeName: string): Promise<any[]> {
  if (isTauri) {
    const entry = cache[storeName]
    // fullyLoaded 才信任缓存（防止 setRecord 局部污染 → 全表查询只返回 1 条）
    if (entry?.fullyLoaded) return Array.from(entry.map.values())
    if (!db || !hasStore(storeName)) return []
    const rows = await db.select<{ data: string }[]>(`SELECT data FROM ${storeName}`)
    const parsed = rows.map(row => {
      try { return JSON.parse(row.data) } catch { return row.data }
    })
    // 全量加载后写回缓存并标记 fullyLoaded
    if (entry) {
      entry.map.clear()
      for (const item of parsed) entry.map.set(item.id ?? item.key, item)
      entry.fullyLoaded = true
    }
    return parsed
  }
  const values = await webGetAll(storeName)
  if (values) return values
  // 浏览器降级：从 localStorage 读取
  try {
    const storeKey = `jc_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    if (!raw) return []
    const all = JSON.parse(raw)
    if (!all || typeof all !== 'object') return []
    return Object.values(all)
  } catch { return [] }
}

export async function getAllByIndex(
  storeName: string,
  indexName: string | null,
  key?: string,
): Promise<any[]> {
  if (!isTauri) {
    const values = await getAll(storeName)
    if (!indexName || key === undefined) return values
    return values.filter(record => String(record?.[indexName] || '') === String(key))
  }
  if (!db || !hasStore(storeName)) return []

  let query: string
  let params: any[]
  if (indexName && key !== undefined) {
    query = `SELECT data FROM ${storeName} WHERE ${indexName} = $1`
    params = [key]
  } else {
    query = `SELECT data FROM ${storeName}`
    params = []
  }

  const rows = await db.select<{ data: string }[]>(query, params)
  return rows.map(row => {
    try { return JSON.parse(row.data) } catch { return row.data }
  })
}

// ═══════════════════════════════════════════════════
//  Conversation Context Engine stores
// ═══════════════════════════════════════════════════

export function hasConversationContextStore(storeName: string): boolean {
  return (CONVERSATION_CONTEXT_STORE_NAMES as readonly string[]).includes(storeName)
}

export async function getConversationContextRecord<T = any>(storeName: string, key: string): Promise<T | null> {
  if (!hasConversationContextStore(storeName)) return null
  if (isTauri && db) {
    const rows = await db.select<any[]>(`SELECT * FROM ${storeName} WHERE id = $1`, [String(key)])
    return rows[0] ? normalizeConversationContextRow<T>(storeName, rows[0]) : null
  }
  const stored = await webGet(storeName, key)
  if (stored.found) return stored.value as T
  try {
    const raw = localStorage.getItem(`jc_context_store_${storeName}`)
    const all = raw ? JSON.parse(raw) : {}
    return all?.[String(key)] || null
  } catch {
    return null
  }
}

export async function setConversationContextRecord(
  storeName: string,
  value: any,
  uniqueKey?: string,
): Promise<void> {
  if (!hasConversationContextStore(storeName) || !value?.id) return
  if (isTauri && db) {
    if (uniqueKey && value[uniqueKey] != null) {
      await db.execute(`DELETE FROM ${storeName} WHERE ${uniqueKey} = $1 AND id != $2`, [value[uniqueKey], value.id])
    }
    await upsertConversationContextSqlRecord(storeName, value)
    return
  }
  if (uniqueKey && value[uniqueKey] != null) {
    const existing = (await webGetAll(storeName)) || []
    await Promise.all(existing
      .filter(record => record?.[uniqueKey] === value[uniqueKey] && record.id !== value.id)
      .map(record => webDelete(storeName, record.id)))
  }
  if (await webPut(storeName, value)) return
  try {
    const storeKey = `jc_context_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    const all = raw ? JSON.parse(raw) : {}
    if (uniqueKey && value[uniqueKey] != null) {
      for (const id of Object.keys(all)) {
        if (all[id]?.[uniqueKey] === value[uniqueKey] && id !== value.id) delete all[id]
      }
    }
    all[value.id] = value
    localStorage.setItem(storeKey, JSON.stringify(all))
  } catch (error) {
    console.error('[JC] localStorage context 写入失败:', storeName, error)
    throw error
  }
}

export async function listConversationContextRecords<T = any>(
  storeName: string,
  indexName?: string,
  key?: string,
): Promise<T[]> {
  if (!hasConversationContextStore(storeName)) return []
  if (isTauri && db) {
    const rows = indexName && key !== undefined
      ? await db.select<any[]>(`SELECT * FROM ${storeName} WHERE ${indexName} = $1`, [key])
      : await db.select<any[]>(`SELECT * FROM ${storeName}`)
    return rows.map(row => normalizeConversationContextRow<T>(storeName, row))
  }
  const indexedDbValues = await webGetAll(storeName)
  if (indexedDbValues) {
    if (!indexName || key === undefined) return indexedDbValues as T[]
    return indexedDbValues.filter(record => String(record?.[indexName] || '') === String(key)) as T[]
  }
  try {
    const raw = localStorage.getItem(`jc_context_store_${storeName}`)
    const all = raw ? JSON.parse(raw) : {}
    const values = Object.values(all || {}) as any[]
    if (!indexName || key === undefined) return values as T[]
    return values.filter(record => String(record?.[indexName] || '') === String(key)) as T[]
  } catch {
    return []
  }
}

export async function removeConversationContextRecord(storeName: string, key: string): Promise<void> {
  if (!hasConversationContextStore(storeName)) return
  if (isTauri && db) {
    await db.execute(`DELETE FROM ${storeName} WHERE id = $1`, [String(key)])
    return
  }
  await webDelete(storeName, key)
  try {
    const storeKey = `jc_context_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    const all = raw ? JSON.parse(raw) : {}
    delete all[String(key)]
    localStorage.setItem(storeKey, JSON.stringify(all))
  } catch {}
}

async function upsertConversationContextSqlRecord(storeName: string, value: any): Promise<void> {
  if (!db) return
  const json = (field: string, fallback: any = []) => JSON.stringify(value[field] ?? fallback)
  const metadata = JSON.stringify(value.metadata || {})
  switch (storeName) {
    case 'runtime_segments':
      await db.execute(
        `INSERT OR REPLACE INTO runtime_segments (id, sessionId, trigger, label, skillId, toolSignature, createdAt, closedAt, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [value.id, value.sessionId, value.trigger, value.label || null, value.skillId || null, value.toolSignature || null, value.createdAt, value.closedAt || null, metadata],
      )
      return
    case 'conversation_run_snapshots':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_run_snapshots (id, sessionId, runtimeSegmentId, userMessageId, assistantMessageId, skillId, enabledToolNames, modelId, providerId, contextMode, loadLevel, promptPlan, createdAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [value.id, value.sessionId, value.runtimeSegmentId, value.userMessageId, value.assistantMessageId || null, value.skillId || null, json('enabledToolNames'), value.modelId, value.providerId || null, value.contextMode, value.loadLevel, JSON.stringify(value.promptPlan || {}), value.createdAt],
      )
      return
    case 'conversation_message_chunks':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_message_chunks (id, sessionId, messageId, role, chunkIndex, text, tokenCount, createdAt, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [value.id, value.sessionId, value.messageId, value.role, value.chunkIndex, value.text, value.tokenCount, value.createdAt, JSON.stringify({ ...(value.metadata || {}), parentMessageId: value.parentMessageId, startOffset: value.startOffset, endOffset: value.endOffset, semanticTitle: value.semanticTitle, semanticSummary: value.semanticSummary, contentKind: value.contentKind })],
      )
      return
    case 'conversation_memory_items':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_memory_items (id, sessionId, runtimeSegmentId, kind, text, sourceMessageIds, skillId, score, tokenCount, createdAt, updatedAt, lastUsedAt, indexDriver, externalId, idempotencyKey, syncStatus, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [value.id, value.sessionId, value.runtimeSegmentId, value.kind, value.text, json('sourceMessageIds'), value.skillId || null, value.score || 0, value.tokenCount, value.createdAt, value.updatedAt, value.lastUsedAt || null, value.indexDriver, value.externalId || null, value.idempotencyKey, value.syncStatus, metadata],
      )
      return
    case 'conversation_memory_jobs':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_memory_jobs (id, sessionId, runtimeSegmentId, runId, sourceMessageIds, status, attempts, nextRunAt, lastError, idempotencyKey, createdAt, updatedAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [value.id, value.sessionId, value.runtimeSegmentId, value.runId, json('sourceMessageIds'), value.status, value.attempts, value.nextRunAt, value.lastError || null, value.idempotencyKey, value.createdAt, value.updatedAt],
      )
      return
    case 'conversation_continuations':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_continuations (id, runId, sessionId, runtimeSegmentId, parentAssistantMessageId, partIds, status, attempts, reusedContextPlanId, outputStructureSummary, completedSectionPointers, lastFinishReason, createdAt, updatedAt, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [value.id, value.runId, value.sessionId, value.runtimeSegmentId, value.parentAssistantMessageId, json('partIds'), value.status, value.attempts, value.reusedContextPlanId, value.outputStructureSummary, json('completedSectionPointers'), value.lastFinishReason || null, value.createdAt, value.updatedAt, metadata],
      )
      return
    case 'conversation_rebuild_jobs':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_rebuild_jobs (id, sessionId, runtimeSegmentId, status, priority, cursor, processedChunks, totalChunks, attempts, lastError, createdAt, updatedAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [value.id, value.sessionId, value.runtimeSegmentId || null, value.status, value.priority, value.cursor || null, value.processedChunks, value.totalChunks, value.attempts, value.lastError || null, value.createdAt, value.updatedAt],
      )
      return
    case 'conversation_dirty_segments':
      await db.execute(
        `INSERT OR REPLACE INTO conversation_dirty_segments (id, sessionId, runtimeSegmentId, reason, severity, estimatedTokenImpact, dirtySince, priority, status, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [value.id, value.sessionId, value.runtimeSegmentId, value.reason, value.severity, value.estimatedTokenImpact, value.dirtySince, value.priority, value.status, metadata],
      )
  }
}

function normalizeConversationContextRow<T>(storeName: string, row: any): T {
  const parse = (value: any, fallback: any) => {
    try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback } catch { return fallback }
  }
  if (storeName === 'conversation_message_chunks') {
    const metadata = parse(row.metadata, {})
    return {
      ...row,
      metadata,
      parentMessageId: metadata.parentMessageId || row.messageId,
      startOffset: metadata.startOffset || 0,
      endOffset: metadata.endOffset || 0,
      semanticTitle: metadata.semanticTitle || `${row.messageId}#${row.chunkIndex}`,
      semanticSummary: metadata.semanticSummary || '',
      contentKind: metadata.contentKind || 'plain',
    } as T
  }
  if (storeName === 'conversation_run_snapshots') {
    return { ...row, enabledToolNames: parse(row.enabledToolNames, []), promptPlan: parse(row.promptPlan, {}) } as T
  }
  if (storeName === 'conversation_memory_items') {
    return { ...row, sourceMessageIds: parse(row.sourceMessageIds, []), metadata: parse(row.metadata, {}) } as T
  }
  if (storeName === 'conversation_memory_jobs') {
    return { ...row, sourceMessageIds: parse(row.sourceMessageIds, []) } as T
  }
  if (storeName === 'conversation_continuations') {
    return {
      ...row,
      partIds: parse(row.partIds, []),
      completedSectionPointers: parse(row.completedSectionPointers, []),
      metadata: parse(row.metadata, {}),
    } as T
  }
  return { ...row, metadata: parse(row.metadata, {}) } as T
}

// ═══════════════════════════════════════════════════
//  路径工具
// ═══════════════════════════════════════════════════

export function joinTauriPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, i) => {
      const text = String(part)
      if (i === 0) return text.replace(/\/+$/, '')
      return text.replace(/^\/+|\/+$/g, '')
    })
    .filter(Boolean)
    .join('/')
}

export function resolveDesktopDataDirs(appDataDir: string, homeDir: string) {
  return {
    dataDir: joinTauriPath(appDataDir, 'data'),
    legacyDataDir: joinTauriPath(homeDir, '.jiucaihezi', 'data'),
  }
}

// ═══════════════════════════════════════════════════
//  media_assets 表专用 API（P1：资产外迁）
// ═══════════════════════════════════════════════════

export interface MediaAssetRow {
  id: string
  logicalPath: string
  mime: string
  size: number
  width?: number | null
  height?: number | null
  hash?: string | null
  source: string
  sourceId?: string | null
  sourceUrl?: string | null
  thumbnailAssetId?: string | null
  createdAt: number
}

/** P3.5: WAL checkpoint — 回收 WAL 日志空间，不阻塞 */
export async function walCheckpoint(): Promise<void> {
  if (!isTauri || !db) return
  try { await db.execute('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* silent */ }
}

export async function insertMediaAsset(asset: MediaAssetRow): Promise<void> {
  if (!isTauri || !db) return
  cache['media_assets']?.map.set(asset.id, asset)
  try {
    await db.execute(
      `INSERT OR REPLACE INTO media_assets
        (id, logicalPath, mime, size, width, height, hash, source, sourceId, sourceUrl, thumbnailAssetId, createdAt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        asset.id, asset.logicalPath, asset.mime, asset.size,
        asset.width ?? null, asset.height ?? null, asset.hash ?? null,
        asset.source, asset.sourceId ?? null, asset.sourceUrl ?? null, asset.thumbnailAssetId ?? null, asset.createdAt,
      ]
    )
  } catch (e) {
    console.error('[JC] insertMediaAsset 失败:', asset.id, e)
    // 不 throw — 文件已落地，DB 索引失败不影响主流程
  }
}

export async function queryMediaAssets(opts: {
  source?: string
  mimePrefix?: string
  limit?: number
  offset?: number
}): Promise<MediaAssetRow[]> {
  if (!isTauri || !db) return []
  const clauses: string[] = []
  const params: any[] = []
  let idx = 1
  if (opts.source) {
    clauses.push(`source = $${idx++}`)
    params.push(opts.source)
  }
  if (opts.mimePrefix) {
    clauses.push(`mime LIKE $${idx++}`)
    params.push(`${opts.mimePrefix}%`)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const rows = await db.select<Record<string, any>[]>(
    `SELECT id, logicalPath, mime, size, width, height, hash, source, sourceId, thumbnailAssetId, createdAt
     FROM media_assets ${where} ORDER BY createdAt DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  )
  return rows.map(r => ({
    id: r.id,
    logicalPath: r.logicalPath || r.logicalpath,
    mime: r.mime,
    size: r.size,
    width: r.width ?? null,
    height: r.height ?? null,
    hash: r.hash ?? null,
    source: r.source,
    sourceId: r.sourceId ?? r.sourceid ?? null,
    sourceUrl: r.sourceUrl ?? r.sourceurl ?? null,
    thumbnailAssetId: r.thumbnailAssetId ?? r.thumbnailassetid ?? null,
    createdAt: r.createdAt || r.createdat,
  }))
}

export async function getMediaAssetById(id: string): Promise<MediaAssetRow | null> {
  if (!isTauri || !db) return null
  const cached = cache['media_assets']?.map.get(id)
  if (cached) return cached
  const rows = await db.select<Record<string, any>[]>(
    `SELECT id, logicalPath, mime, size, width, height, hash, source, sourceId, sourceUrl, thumbnailAssetId, createdAt
     FROM media_assets WHERE id = $1`, [id]
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id,
    logicalPath: r.logicalPath || r.logicalpath,
    mime: r.mime,
    size: r.size,
    width: r.width ?? null,
    height: r.height ?? null,
    hash: r.hash ?? null,
    source: r.source,
    sourceId: r.sourceId ?? r.sourceid ?? null,
    sourceUrl: r.sourceUrl ?? r.sourceurl ?? null,
    thumbnailAssetId: r.thumbnailAssetId ?? r.thumbnailassetid ?? null,
    createdAt: r.createdAt || r.createdat,
  }
}
