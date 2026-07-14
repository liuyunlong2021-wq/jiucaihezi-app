import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createWebProjectBinaryStore,
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

test('default web project binary store explains when OPFS is unavailable', async () => {
  await assert.rejects(
    () => webProjectBinaryStore.write('asset-1', new Blob(['媒体内容'])),
    /浏览器.*OPFS/,
  )
})
