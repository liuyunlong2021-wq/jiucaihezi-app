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
const isTauri = isTauriRuntime()

/** 内存缓存：避免每次读都走 SQL */
const cache: Record<string, Map<string, any>> = {
  kv_store: new Map(),
  conversations: new Map(),
  messages: new Map(),
  documents: new Map(),
}

const STORE_NAMES = ['kv_store', 'conversations', 'messages', 'documents'] as const
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

export async function initDB(): Promise<void> {
  if (!isTauri) {
    console.warn('[JC] 非 Tauri 环境，使用内存+localStorage 降级（调试模式）')
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
    CREATE INDEX IF NOT EXISTS idx_conv_scopeKey ON conversations(scopeKey);
    CREATE INDEX IF NOT EXISTS idx_conv_updatedAt ON conversations(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_msg_convId ON messages(conversationId);
    CREATE INDEX IF NOT EXISTS idx_msg_updatedAt ON messages(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_doc_docKey ON documents(docKey);
    CREATE INDEX IF NOT EXISTS idx_doc_updatedAt ON documents(updatedAt);
    CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL);
  `)
  await initConversationContextTables()

  // 首次运行：从旧 JSON 文件迁移
  await migrateFromJsonFiles(dirs.legacyDataDir)

  // 预热缓存：加载所有数据到内存
  await warmCache()

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

/** 预热缓存：一次性加载全部数据到内存 */
async function warmCache() {
  if (!db) return
  for (const store of STORE_NAMES) {
    const map = cache[store]
    map.clear()
    if (store === 'kv_store') {
      const rows = await db.select<{ key: string; value: string }[]>(
        'SELECT key, value FROM kv_store'
      )
      for (const row of rows) {
        try { map.set(row.key, JSON.parse(row.value)) } catch { map.set(row.key, row.value) }
      }
    } else {
      const rows = await db.select<{ id: string; data: string }[]>(
        `SELECT id, data FROM ${store}`
      )
      for (const row of rows) {
        try { map.set(row.id, JSON.parse(row.data)) } catch { map.set(row.id, row.data) }
      }
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
  if (isTauri) return cache.kv_store.get(key) ?? null
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
    cache.kv_store.set(key, value)
    if (db) {
      await db.execute('INSERT OR REPLACE INTO kv_store (key, value) VALUES ($1, $2)', [
        key, JSON.stringify(value),
      ])
    }
    return
  }
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export async function removeItem(key: string): Promise<void> {
  if (isTauri) {
    cache.kv_store.delete(key)
    if (db) await db.execute('DELETE FROM kv_store WHERE key = $1', [key])
    return
  }
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
    const cached = cache[storeName]?.get(id)
    if (cached !== undefined) return cached
    if (!db || !hasStore(storeName)) return null
    const rows = await db.select<{ data: string }[]>(
      `SELECT data FROM ${storeName} WHERE id = $1`, [id]
    )
    if (rows.length === 0) return null
    try { return JSON.parse(rows[0].data) } catch { return rows[0].data }
  }
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
  const id = value?.id ?? value?.key
  if (id == null) return
  const idStr = String(id)
  if (isTauri) {
    cache[storeName]?.set(idStr, value)
    if (db) {
      await db.execute(
        `INSERT OR REPLACE INTO ${storeName} (id, data, updatedAt) VALUES ($1, $2, $3)`,
        [idStr, JSON.stringify(value), Date.now()]
      )
    }
    return
  }
  // 浏览器降级：写入 localStorage
  try {
    const storeKey = `jc_store_${storeName}`
    const raw = localStorage.getItem(storeKey)
    const all = raw ? JSON.parse(raw) : {}
    if (!all || typeof all !== 'object') return
    all[idStr] = value
    localStorage.setItem(storeKey, JSON.stringify(all))
  } catch {}
}

export async function removeRecord(storeName: string, key: string): Promise<void> {
  if (!hasStore(storeName)) return
  const id = String(key)
  if (isTauri) {
    cache[storeName]?.delete(id)
    if (db) await db.execute(`DELETE FROM ${storeName} WHERE id = $1`, [id])
    return
  }
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
    const cached = cache[storeName]
    if (cached && cached.size > 0) return Array.from(cached.values())
    if (!db || !hasStore(storeName)) return []
    const rows = await db.select<{ data: string }[]>(`SELECT data FROM ${storeName}`)
    return rows.map(row => {
      try { return JSON.parse(row.data) } catch { return row.data }
    })
  }
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
  if (!isTauri || !db || !hasStore(storeName)) return []

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
  } catch {}
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
