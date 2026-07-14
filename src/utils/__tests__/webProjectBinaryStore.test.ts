import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createWebProjectBinaryStore,
  ensureWebProjectStorage,
  webProjectBinaryStore,
  type WebProjectBinaryAdapter,
  type WebBinarySource,
} from '../webProjectBinaryStore'

function memoryAdapter(): WebProjectBinaryAdapter {
  const files = new Map<string, Blob>()

  return {
    async write(id: string, source: WebBinarySource) {
      const reader = (source instanceof Blob ? source.stream() : source).getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          size += value.byteLength
        }
      } finally {
        reader.releaseLock()
      }
      files.set(id, new Blob(chunks))
      return size
    },
    async read(id: string) {
      const file = files.get(id)
      if (!file) throw new Error(`二进制文件不存在: ${id}`)
      return file
    },
    async remove(id: string) {
      files.delete(id)
    },
    async estimate() {
      return { usage: [...files.values()].reduce((total, file) => total + file.size, 0) }
    },
    async persist() {
      return true
    },
  }
}

function notFoundError(): Error {
  const error = new Error('Not found')
  error.name = 'NotFoundError'
  return error
}

function browserStorageFake(
  config: {
    persisted?: boolean
    quota?: number
    usage?: number
    writeError?: Error
  } = {},
) {
  const files = new Map<string, Blob>()
  const state = {
    aborted: 0,
    closed: 0,
    directoryNames: [] as string[],
    fileIds: [] as string[],
    writableCount: 0,
    writes: [] as unknown[],
  }
  const directory = {
    async getFileHandle(id: string, options?: { create?: boolean }) {
      state.fileIds.push(id)
      if (!options?.create && !files.has(id)) throw notFoundError()
      return {
        async createWritable() {
          state.writableCount += 1
          const chunks: Uint8Array[] = []
          return {
            async write(chunk: Uint8Array) {
              state.writes.push(chunk)
              if (config.writeError) throw config.writeError
              chunks.push(chunk)
            },
            async close() {
              state.closed += 1
              files.set(id, new Blob(chunks))
            },
            async abort() {
              state.aborted += 1
            },
          }
        },
        async getFile() {
          const file = files.get(id)
          if (!file) throw notFoundError()
          return file
        },
      }
    },
    async removeEntry(id: string) {
      if (!files.delete(id)) throw notFoundError()
    },
  }
  const root = {
    async getDirectoryHandle(name: string) {
      state.directoryNames.push(name)
      return directory
    },
  }

  return {
    state,
    storage: {
      async getDirectory() {
        return root
      },
      async estimate() {
        return { quota: config.quota, usage: config.usage }
      },
      async persist() {
        return config.persisted ?? true
      },
    },
  }
}

async function withBrowserStorage<T>(storage: unknown, action: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage } })
  try {
    return await action()
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
}

test('web project binary store writes and reads a Blob', async () => {
  const store = createWebProjectBinaryStore(memoryAdapter())
  const source = new Blob(['媒体内容'], { type: 'text/plain' })

  const size = await store.write('asset-1', source)
  const result = await store.read('asset-1')

  assert.equal(size, source.size)
  assert.equal(await result.text(), '媒体内容')
})

test('web project binary store removes a Blob', async () => {
  const store = createWebProjectBinaryStore(memoryAdapter())
  await store.write('asset-1', new Blob(['媒体内容']))

  await store.remove('asset-1')

  await assert.rejects(() => store.read('asset-1'), /二进制文件不存在/)
})

test('web project binary store writes ReadableStream chunks', async () => {
  const store = createWebProjectBinaryStore(memoryAdapter())
  const encoder = new TextEncoder()
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('第一块'))
      controller.enqueue(encoder.encode('第二块'))
      controller.close()
    },
  })

  const size = await store.write('stream-1', source)

  assert.equal(size, new TextEncoder().encode('第一块第二块').byteLength)
  assert.equal(await (await store.read('stream-1')).text(), '第一块第二块')
})

test('web project binary store rejects an unknown id', async () => {
  const store = createWebProjectBinaryStore(memoryAdapter())

  await assert.rejects(() => store.read('missing'), /二进制文件不存在: missing/)
})

test('default browser adapter writes, reads, and removes an OPFS Blob', async () => {
  const fake = browserStorageFake()
  await withBrowserStorage(fake.storage, async () => {
    const source = new Blob(['第一块', '第二块'])

    const size = await webProjectBinaryStore.write('asset-1', source)

    assert.equal(size, source.size)
    assert.deepEqual(fake.state.directoryNames, ['jc-project-files'])
    assert.deepEqual(fake.state.fileIds, ['asset-1'])
    assert.ok(fake.state.writes.every(chunk => chunk instanceof Uint8Array))
    assert.equal(await (await webProjectBinaryStore.read('asset-1')).text(), '第一块第二块')
    await webProjectBinaryStore.remove('asset-1')
    await assert.rejects(() => webProjectBinaryStore.read('asset-1'), /二进制文件不存在/)
  })
})

test('default browser adapter ignores a missing OPFS file during removal', async () => {
  const fake = browserStorageFake()
  await withBrowserStorage(fake.storage, async () => {
    await assert.doesNotReject(() => webProjectBinaryStore.remove('missing'))
  })
})

test('ensure web project storage keeps a nonpersistent store usable', async () => {
  const fake = browserStorageFake({ persisted: false, quota: 100, usage: 40 })
  await withBrowserStorage(fake.storage, async () => {
    assert.deepEqual(await ensureWebProjectStorage(60), { persisted: false, quota: 100, usage: 40 })
  })
})

test('ensure web project storage rejects a binary larger than available space', async () => {
  const fake = browserStorageFake({ quota: 100, usage: 40 })
  await withBrowserStorage(fake.storage, async () => {
    await assert.rejects(() => ensureWebProjectStorage(61), /本地存储空间不足/)
  })
})

test('default browser adapter does not create a writable for a locked stream', async () => {
  const fake = browserStorageFake()
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
    },
  })
  const lock = source.getReader()

  try {
    await withBrowserStorage(fake.storage, async () => {
      await assert.rejects(() => webProjectBinaryStore.write('locked', source), /locked/)
    })
    assert.equal(fake.state.writableCount, 0)
  } finally {
    lock.releaseLock()
  }
})

test('default browser adapter cancels the source when an OPFS write fails', async () => {
  const writeError = new Error('写入失败')
  const fake = browserStorageFake({ writeError })
  let cancelled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
    },
    cancel() {
      cancelled = true
    },
  })

  await withBrowserStorage(fake.storage, async () => {
    await assert.rejects(
      () => webProjectBinaryStore.write('failed', source),
      error => error === writeError,
    )
  })

  assert.equal(cancelled, true)
  assert.equal(fake.state.aborted, 1)
})

test('default web project binary store explains when OPFS is unavailable', async () => {
  await assert.rejects(
    () => webProjectBinaryStore.write('asset-1', new Blob(['媒体内容'])),
    /浏览器.*OPFS/,
  )
})
