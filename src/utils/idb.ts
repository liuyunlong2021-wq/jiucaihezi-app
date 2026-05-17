/**
 * utils/idb.ts — IndexedDB 存储引擎
 * 精确复制自 code.html JC_DB (行 1993-2153)
 * 
 * 保持与原代码完全相同的数据库结构：
 * - JiucaiDB version 2
 * - kv_store: 通用键值存储
 * - conversations: 对话记录 (keyPath: id, indexes: scopeKey, updatedAt)
 * - messages: 消息记录 (keyPath: id, indexes: conversationId, updatedAt)
 * - documents: 文档记录 (keyPath: id, indexes: docKey, updatedAt)
 */

let db: IDBDatabase | null = null

/**
 * 初始化 IndexedDB — 精确复制自行 1995-2049
 */
export async function initDB(): Promise<void> {
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

      // conversations store (行 2008-2019)
      let conversationsStore: IDBObjectStore
      if (!database.objectStoreNames.contains('conversations')) {
        conversationsStore = database.createObjectStore('conversations', { keyPath: 'id' })
      } else {
        conversationsStore = (e.target as IDBOpenDBRequest).transaction!.objectStore('conversations')
      }
      if (!conversationsStore.indexNames.contains('scopeKey')) {
        conversationsStore.createIndex('scopeKey', 'scopeKey', { unique: false })
      }
      if (!conversationsStore.indexNames.contains('updatedAt')) {
        conversationsStore.createIndex('updatedAt', 'updatedAt', { unique: false })
      }

      // messages store (行 2020-2031)
      let messagesStore: IDBObjectStore
      if (!database.objectStoreNames.contains('messages')) {
        messagesStore = database.createObjectStore('messages', { keyPath: 'id' })
      } else {
        messagesStore = (e.target as IDBOpenDBRequest).transaction!.objectStore('messages')
      }
      if (!messagesStore.indexNames.contains('conversationId')) {
        messagesStore.createIndex('conversationId', 'conversationId', { unique: false })
      }
      if (!messagesStore.indexNames.contains('updatedAt')) {
        messagesStore.createIndex('updatedAt', 'updatedAt', { unique: false })
      }

      // documents store (行 2032-2043)
      let documentsStore: IDBObjectStore
      if (!database.objectStoreNames.contains('documents')) {
        documentsStore = database.createObjectStore('documents', { keyPath: 'id' })
      } else {
        documentsStore = (e.target as IDBOpenDBRequest).transaction!.objectStore('documents')
      }
      if (!documentsStore.indexNames.contains('docKey')) {
        documentsStore.createIndex('docKey', 'docKey', { unique: false })
      }
      if (!documentsStore.indexNames.contains('updatedAt')) {
        documentsStore.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }

    request.onsuccess = (e) => {
      db = (e.target as IDBOpenDBRequest).result
      resolve()
    }
  })
}

/** KV getItem — 精确复制自行 2051-2061 */
export async function getItem(key: string): Promise<any> {
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

/** KV setItem — 精确复制自行 2063-2076 */
export async function setItem(key: string, value: any): Promise<void> {
  if (!db) {
    try { localStorage.setItem(key, value) } catch {}
    return
  }
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

/** KV removeItem — 精确复制自行 2078-2091 */
export async function removeItem(key: string): Promise<void> {
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

/** hasStore — 行 2093-2095 */
export function hasStore(storeName: string): boolean {
  return !!(db && db.objectStoreNames && db.objectStoreNames.contains(storeName))
}

/** getRecord — 精确复制自行 2096-2108 */
export async function getRecord(storeName: string, key: IDBValidKey): Promise<any> {
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

/** setRecord — 精确复制自行 2110-2122 */
export async function setRecord(storeName: string, value: any): Promise<void> {
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

/** removeRecord — 精确复制自行 2124-2136 */
export async function removeRecord(storeName: string, key: IDBValidKey): Promise<void> {
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

/** getAllByIndex — 精确复制自行 2138-2151 */
export async function getAllByIndex(
  storeName: string,
  indexName: string | null,
  key?: IDBValidKey
): Promise<any[]> {
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

/** 获取 store 中所有记录 */
export async function getAll(storeName: string): Promise<any[]> {
  return getAllByIndex(storeName, null)
}
