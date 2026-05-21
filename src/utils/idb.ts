/**
 * utils/idb.ts — 统一存储引擎 (Tauri fs / IndexedDB 双后端)
 *
 * 在 Tauri 桌面端：数据存为 JSON 文件 (~/.jiucaihezi/data/)
 * 在浏览器端：保持 IndexedDB 行为（向后兼容 Web 版）
 *
 * 对外 API 完全不变，调用方零改动。
 */

import { isTauriRuntime } from './tauriEnv'

// ─── 环境检测 ───
const isTauri = isTauriRuntime()

// ═══════════════════════════════════════════════════
//  Tauri 文件系统后端
// ═══════════════════════════════════════════════════

let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null
let tauriPath: typeof import('@tauri-apps/api/path') | null = null
let dataDir = '' // resolved at init
let legacyDataDir = ''

/**
 * 数据目录结构:
 *   ~/.jiucaihezi/data/
 *     kv_store.json          — { [key]: value }
 *     conversations.json     — { [id]: record }
 *     messages.json          — { [id]: record }
 *     documents.json         — { [id]: record }
 */

const STORES = ['kv_store', 'conversations', 'messages', 'documents'] as const
type StoreName = typeof STORES[number]

// In-memory cache — loaded once at init, written through on every mutation
const cache: Record<string, Record<string, any>> = {}
const loadedStores = new Set<string>()
let batchDepth = 0
const dirtyStores = new Set<string>()

function storePath(store: string): string {
  return `${dataDir}/${store}.json`
}

function legacyStorePath(store: string): string {
  return `${legacyDataDir}/${store}.json`
}

export function joinTauriPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      const text = String(part)
      if (index === 0) return text.replace(/\/+$/, '')
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

async function ensureTauriModules() {
  if (!tauriFs) {
    tauriFs = await import('@tauri-apps/plugin-fs')
    tauriPath = await import('@tauri-apps/api/path')
  }
}

async function loadStoreFile(store: string): Promise<Record<string, any>> {
  try {
    const text = await tauriFs!.readTextFile(storePath(store))
    return JSON.parse(text)
  } catch {
    if (legacyDataDir && legacyDataDir !== dataDir) {
      try {
        const text = await tauriFs!.readTextFile(legacyStorePath(store))
        const parsed = JSON.parse(text)
        await tauriFs!.writeTextFile(storePath(store), JSON.stringify(parsed))
        return parsed
      } catch {
        return {}
      }
    }
    return {}
  }
}

async function ensureTauriStoreLoaded(store: string): Promise<void> {
  if (loadedStores.has(store)) return
  cache[store] = await loadStoreFile(store)
  loadedStores.add(store)
}

async function saveStoreFile(store: string) {
  const data = cache[store] || {}
  await tauriFs!.writeTextFile(storePath(store), JSON.stringify(data))
}

async function persistStoreFile(store: string) {
  if (batchDepth > 0) {
    dirtyStores.add(store)
    return
  }
  await saveStoreFile(store)
}

async function flushDirtyStoreFiles() {
  const stores = Array.from(dirtyStores)
  for (const store of stores) {
    await saveStoreFile(store)
    dirtyStores.delete(store)
  }
}

async function initTauri(): Promise<void> {
  await ensureTauriModules()
  // Use Tauri app data dir for normal persistence, with a legacy fallback
  // from older builds that wrote to ~/.jiucaihezi/data.
  const appData = await tauriPath!.appDataDir()
  const home = await tauriPath!.homeDir()
  const dirs = resolveDesktopDataDirs(appData, home)
  dataDir = dirs.dataDir
  legacyDataDir = dirs.legacyDataDir
  // Ensure directory exists
  try {
    await tauriFs!.mkdir(dataDir, { recursive: true })
  } catch { /* already exists */ }
}

// ─── Tauri KV ───

async function tauriGetItem(key: string): Promise<any> {
  await ensureTauriStoreLoaded('kv_store')
  const store = cache['kv_store'] || {}
  return key in store ? store[key] : null
}

async function tauriSetItem(key: string, value: any): Promise<void> {
  await ensureTauriStoreLoaded('kv_store')
  if (!cache['kv_store']) cache['kv_store'] = {}
  cache['kv_store'][key] = value
  await persistStoreFile('kv_store')
}

async function tauriRemoveItem(key: string): Promise<void> {
  await ensureTauriStoreLoaded('kv_store')
  if (cache['kv_store']) {
    delete cache['kv_store'][key]
    await persistStoreFile('kv_store')
  }
}

// ─── Tauri Record ───

async function tauriGetRecord(storeName: string, key: string): Promise<any> {
  await ensureTauriStoreLoaded(storeName)
  return cache[storeName]?.[String(key)] ?? null
}

async function tauriSetRecord(storeName: string, value: any): Promise<void> {
  await ensureTauriStoreLoaded(storeName)
  if (!cache[storeName]) cache[storeName] = {}
  const id = value?.id ?? value?.key
  if (id == null) return
  cache[storeName][String(id)] = value
  await persistStoreFile(storeName)
}

async function tauriRemoveRecord(storeName: string, key: string): Promise<void> {
  await ensureTauriStoreLoaded(storeName)
  if (cache[storeName]) {
    delete cache[storeName][String(key)]
    await persistStoreFile(storeName)
  }
}

async function tauriGetAll(storeName: string): Promise<any[]> {
  await ensureTauriStoreLoaded(storeName)
  return Object.values(cache[storeName] || {})
}

async function tauriGetAllByIndex(storeName: string, indexName: string | null, key?: string): Promise<any[]> {
  const all = await tauriGetAll(storeName)
  if (!indexName || key === undefined) return all
  return all.filter((item: any) => item?.[indexName] === key)
}

// ═══════════════════════════════════════════════════
//  IndexedDB 后端 (浏览器 fallback)
// ═══════════════════════════════════════════════════

let db: IDBDatabase | null = null

async function initIDB(): Promise<void> {
  if (!window.indexedDB) {
    console.warn('浏览器不支持 IndexedDB，将可能遇到存储限制')
    return
  }
  return new Promise((resolve) => {
    const request = indexedDB.open('JiucaiDB', 2)
    request.onerror = () => resolve()
    request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const database = (e.target as IDBOpenDBRequest).result

      if (!database.objectStoreNames.contains('kv_store')) {
        database.createObjectStore('kv_store')
      }

      let conversationsStore: IDBObjectStore
      if (!database.objectStoreNames.contains('conversations')) {
        conversationsStore = database.createObjectStore('conversations', { keyPath: 'id' })
      } else {
        conversationsStore = (e.target as IDBOpenDBRequest).transaction!.objectStore('conversations')
      }
      if (!conversationsStore.indexNames.contains('scopeKey')) conversationsStore.createIndex('scopeKey', 'scopeKey', { unique: false })
      if (!conversationsStore.indexNames.contains('updatedAt')) conversationsStore.createIndex('updatedAt', 'updatedAt', { unique: false })

      let messagesStore: IDBObjectStore
      if (!database.objectStoreNames.contains('messages')) {
        messagesStore = database.createObjectStore('messages', { keyPath: 'id' })
      } else {
        messagesStore = (e.target as IDBOpenDBRequest).transaction!.objectStore('messages')
      }
      if (!messagesStore.indexNames.contains('conversationId')) messagesStore.createIndex('conversationId', 'conversationId', { unique: false })
      if (!messagesStore.indexNames.contains('updatedAt')) messagesStore.createIndex('updatedAt', 'updatedAt', { unique: false })

      let documentsStore: IDBObjectStore
      if (!database.objectStoreNames.contains('documents')) {
        documentsStore = database.createObjectStore('documents', { keyPath: 'id' })
      } else {
        documentsStore = (e.target as IDBOpenDBRequest).transaction!.objectStore('documents')
      }
      if (!documentsStore.indexNames.contains('docKey')) documentsStore.createIndex('docKey', 'docKey', { unique: false })
      if (!documentsStore.indexNames.contains('updatedAt')) documentsStore.createIndex('updatedAt', 'updatedAt', { unique: false })
    }
    request.onsuccess = (e) => {
      db = (e.target as IDBOpenDBRequest).result
      resolve()
    }
  })
}

// ═══════════════════════════════════════════════════
//  统一公开 API
// ═══════════════════════════════════════════════════

export async function initDB(): Promise<void> {
  if (isTauri) {
    await initTauri()
    console.log('[JC] 存储引擎: Tauri 文件系统 (' + dataDir + ')')
  } else {
    await initIDB()
    console.log('[JC] 存储引擎: IndexedDB')
  }
}

export async function runStorageBatch<T>(operation: () => Promise<T>): Promise<T> {
  if (!isTauri) return operation()

  batchDepth += 1
  let operationSucceeded = false
  try {
    const result = await operation()
    operationSucceeded = true
    return result
  } catch (err) {
    throw err
  } finally {
    batchDepth = Math.max(0, batchDepth - 1)
    if (batchDepth === 0) {
      if (operationSucceeded) {
        await flushDirtyStoreFiles()
      } else {
        dirtyStores.clear()
      }
    }
  }
}

export async function getItem(key: string): Promise<any> {
  if (isTauri) return await tauriGetItem(key)
  // IndexedDB path
  if (!db) return localStorage.getItem(key)
  try {
    const tx = db.transaction('kv_store', 'readonly')
    const store = tx.objectStore('kv_store')
    const req = store.get(key)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : localStorage.getItem(key))
      req.onerror = () => resolve(localStorage.getItem(key))
    })
  } catch {
    return localStorage.getItem(key)
  }
}

export async function setItem(key: string, value: any): Promise<void> {
  if (isTauri) return tauriSetItem(key, value)
  if (!db) { try { localStorage.setItem(key, value) } catch {} return }
  try {
    const tx = db.transaction('kv_store', 'readwrite')
    const store = tx.objectStore('kv_store')
    const req = store.put(value, key)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch {
    try { localStorage.setItem(key, value) } catch {}
  }
}

export async function removeItem(key: string): Promise<void> {
  if (isTauri) return tauriRemoveItem(key)
  if (!db) { localStorage.removeItem(key); return }
  try {
    const tx = db.transaction('kv_store', 'readwrite')
    const store = tx.objectStore('kv_store')
    const req = store.delete(key)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch {
    localStorage.removeItem(key)
  }
}

export function hasStore(storeName: string): boolean {
  if (isTauri) return (STORES as readonly string[]).includes(storeName)
  return !!(db && db.objectStoreNames && db.objectStoreNames.contains(storeName))
}

export async function getRecord(storeName: string, key: IDBValidKey): Promise<any> {
  if (isTauri) return await tauriGetRecord(storeName, String(key))
  if (!hasStore(storeName)) return null
  try {
    const tx = db!.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setRecord(storeName: string, value: any): Promise<void> {
  if (isTauri) return tauriSetRecord(storeName, value)
  if (!hasStore(storeName)) return
  try {
    const tx = db!.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.put(value)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch {}
}

export async function removeRecord(storeName: string, key: IDBValidKey): Promise<void> {
  if (isTauri) return tauriRemoveRecord(storeName, String(key))
  if (!hasStore(storeName)) return
  try {
    const tx = db!.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.delete(key)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch {}
}

export async function getAllByIndex(
  storeName: string,
  indexName: string | null,
  key?: IDBValidKey
): Promise<any[]> {
  if (isTauri) return await tauriGetAllByIndex(storeName, indexName, key !== undefined ? String(key) : undefined)
  if (!hasStore(storeName)) return []
  try {
    const tx = db!.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const source = indexName ? store.index(indexName) : store
    const req = key !== undefined ? source.getAll(key) : source.getAll()
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
      req.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

export async function getAll(storeName: string): Promise<any[]> {
  if (isTauri) return await tauriGetAll(storeName)
  return getAllByIndex(storeName, null)
}
