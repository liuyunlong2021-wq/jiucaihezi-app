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

  // 首次运行：从旧 JSON 文件迁移
  await migrateFromJsonFiles(dirs.legacyDataDir)

  // 预热缓存：加载所有数据到内存
  await warmCache()

  console.log('[JC] 存储引擎: SQLite (' + dbPath + ')')
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
