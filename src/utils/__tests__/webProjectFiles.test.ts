import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import { createWebProjectFiles, type WebProjectRecordAdapter } from '../webProjectFiles'
import type { WebBinarySource, WebProjectBinaryAdapter } from '../webProjectBinaryStore'

function memoryAdapter(): WebProjectRecordAdapter {
  const records = new Map<string, FileEntry>()
  return {
    async all() { return [...records.values()].map(item => structuredClone(item)) },
    async get(id) { const value = records.get(id); return value ? structuredClone(value) : undefined },
    async put(entry) { records.set(entry.id, structuredClone(entry)) },
    async remove(id) { records.delete(id) },
  }
}

function controllableMemoryAdapter() {
  const records = new Map<string, FileEntry>()
  let nextPutError: Error | undefined
  const adapter: WebProjectRecordAdapter = {
    async all() { return [...records.values()].map(item => structuredClone(item)) },
    async get(id) { const value = records.get(id); return value ? structuredClone(value) : undefined },
    async put(entry) {
      const error = nextPutError
      nextPutError = undefined
      if (error) throw error
      records.set(entry.id, structuredClone(entry))
    },
    async remove(id) { records.delete(id) },
  }
  return {
    adapter,
    records,
    failNextPut(error: Error) { nextPutError = error },
  }
}

async function sourceBlob(source: WebBinarySource): Promise<Blob> {
  if (source instanceof Blob) return source
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(chunks)
}

function memoryBinaryAdapter() {
  const blobs = new Map<string, Blob>()
  const calls: string[] = []
  let nextWriteError: Error | undefined
  const adapter: WebProjectBinaryAdapter = {
    async write(id, source) {
      calls.push(`write:${id}`)
      const error = nextWriteError
      nextWriteError = undefined
      if (error) throw error
      const blob = await sourceBlob(source)
      blobs.set(id, blob)
      return blob.size
    },
    async read(id) {
      calls.push(`read:${id}`)
      const blob = blobs.get(id)
      if (!blob) throw new Error(`二进制文件不存在: ${id}`)
      return blob
    },
    async remove(id) {
      calls.push(`remove:${id}`)
      blobs.delete(id)
    },
    async estimate() {
      calls.push('estimate')
      return { usage: [...blobs.values()].reduce((size, blob) => size + blob.size, 0), quota: 1_000_000 }
    },
    async persist() {
      calls.push('persist')
      return true
    },
  }
  return {
    adapter,
    blobs,
    calls,
    failNextWrite(error: Error) { nextWriteError = error },
  }
}

test('web project files create parents and isolate projects', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const first = await files.createProject('第一部剧')
  const second = await files.createProject('第二部剧')

  await files.write(first.id, 'wiki/角色/林风.md', '# 林风\n主角')
  await files.write(second.id, 'wiki/角色/林风.md', '# 同名配角')

  assert.equal((await files.read(first.id, 'wiki/角色/林风.md')).content, '# 林风\n主角')
  assert.equal((await files.read(second.id, 'wiki/角色/林风.md')).content, '# 同名配角')
  assert.deepEqual(
    (await files.list(first.id)).map(entry => [entry.path, entry.isDir]),
    [
      ['wiki', true],
      ['wiki/角色', true],
      ['wiki/角色/林风.md', false],
    ],
  )
})

test('web project files create one record for an explicit folder', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('文件夹测试')

  await files.createFolder(project.id, 'wiki/角色')

  assert.deepEqual(
    (await files.list(project.id)).map(entry => [entry.path, entry.isDir]),
    [
      ['wiki', true],
      ['wiki/角色', true],
    ],
  )
})

test('web project files support glob grep edit and folder rename', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('测试项目')
  await files.write(project.id, 'wiki/角色/林风.md', '# 林风\n林风是主角')
  await files.write(project.id, 'wiki/剧情/大纲.md', '# 大纲')

  assert.deepEqual(
    (await files.glob(project.id, 'wiki/**/*.md')).map(entry => entry.path),
    ['wiki/剧情/大纲.md', 'wiki/角色/林风.md'],
  )
  assert.deepEqual(await files.grep(project.id, '林风'), [
    { path: 'wiki/角色/林风.md', line: 1, text: '# 林风' },
    { path: 'wiki/角色/林风.md', line: 2, text: '林风是主角' },
  ])

  const replacements = await files.edit(project.id, 'wiki/角色/林风.md', '林风', '陆川', true)
  assert.equal(replacements, 2)
  await files.rename(project.id, 'wiki/角色', '人物')
  assert.equal((await files.read(project.id, 'wiki/人物/林风.md')).content, '# 陆川\n陆川是主角')
})

test('web project files reject traversal and remove folder descendants', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('安全测试')
  await files.write(project.id, 'wiki/角色/甲.md', '甲')

  await assert.rejects(() => files.read(project.id, '../secret.md'), /项目路径/)
  await assert.rejects(() => files.write(project.id, '/secret.md', 'x'), /项目路径/)

  await files.remove(project.id, 'wiki')
  assert.deepEqual(await files.list(project.id), [])
})

test('web project files notify the active tree after a mutation', async () => {
  const changes: string[] = []
  const files = createWebProjectFiles(memoryAdapter(), projectId => changes.push(projectId))
  const project = await files.createProject('刷新测试')

  await files.write(project.id, 'wiki/hot.md', '# 热缓存')

  assert.deepEqual(changes, [project.id])
})

test('web project files serialize concurrent writes to the same path', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('并发写入')

  await Promise.all([
    files.write(project.id, 'wiki/hot.md', 'first'),
    files.write(project.id, 'wiki/hot.md', 'second'),
  ])

  assert.equal((await files.list(project.id)).filter(entry => entry.path === 'wiki/hot.md').length, 1)
})

test('web project files do not lose concurrent edits in one project', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('并发编辑')
  await files.write(project.id, 'wiki/hot.md', 'AB')

  await Promise.all([
    files.edit(project.id, 'wiki/hot.md', 'A', 'X'),
    files.edit(project.id, 'wiki/hot.md', 'B', 'Y'),
  ])

  assert.equal((await files.read(project.id, 'wiki/hot.md')).content, 'XY')
})

test('web project binary files keep bytes in OPFS metadata and read them back', async () => {
  const records = controllableMemoryAdapter()
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(records.adapter, () => {}, binary.adapter)
  const project = await files.createProject('二进制项目')
  const source = new Blob(['媒体字节'], { type: 'text/plain' })

  const file = await files.writeBinary(project.id, 'assets/poster.png', source, {
    category: 'image',
    mimeType: 'image/png',
    metadata: { originalUrl: 'https://example.com/poster.png', kind: 'wrong', projectId: 'wrong' },
  })

  const fileId = String(file.metadata?.opfsFileId || '')
  assert.match(fileId, /^webbin_/)
  assert.equal(file.category, 'image')
  assert.equal(file.content, '')
  assert.equal(file.size, source.size)
  assert.deepEqual(file.metadata, {
    originalUrl: 'https://example.com/poster.png',
    kind: 'project-file',
    projectId: project.id,
    relativePath: 'assets/poster.png',
    binaryStorage: 'opfs',
    opfsFileId: fileId,
  })
  assert.equal(records.records.get(file.id)?.content, '')
  assert.equal(await (await files.readBinary(project.id, 'assets/poster.png')).text(), '媒体字节')
  assert.equal(await files.readBinaryDataUrl(project.id, 'assets/poster.png'), 'data:image/png;base64,5aqS5L2T5a2X6IqC')
  assert.deepEqual(binary.calls.slice(0, 3), ['persist', 'estimate', `write:${fileId}`])
})

test('web project binary overwrite keeps the old bytes when the new OPFS write fails', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('覆盖保护')
  const first = await files.writeBinary(project.id, 'assets/clip.mp4', new Blob(['旧字节']), {
    category: 'video', mimeType: 'video/mp4',
  })
  const firstId = String(first.metadata?.opfsFileId)
  binary.failNextWrite(new Error('OPFS 写入失败'))

  await assert.rejects(
    () => files.writeBinary(project.id, 'assets/clip.mp4', new Blob(['新字节']), {
      category: 'video', mimeType: 'video/mp4',
    }),
    /OPFS 写入失败/,
  )

  assert.equal(String((await files.read(project.id, 'assets/clip.mp4')).metadata?.opfsFileId), firstId)
  assert.equal(await binary.blobs.get(firstId)?.text(), '旧字节')
  assert.deepEqual([...binary.blobs.keys()], [firstId])
})

test('web project binary metadata failure reclaims the new OPFS object without losing the old one', async () => {
  const records = controllableMemoryAdapter()
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(records.adapter, () => {}, binary.adapter)
  const project = await files.createProject('元数据回收')
  const first = await files.writeBinary(project.id, 'clip.mp4', new Blob(['旧字节']), {
    category: 'video', mimeType: 'video/mp4',
  })
  const firstId = String(first.metadata?.opfsFileId)
  records.failNextPut(new Error('元数据写入失败'))

  await assert.rejects(
    () => files.writeBinary(project.id, 'clip.mp4', new Blob(['新字节']), {
      category: 'video', mimeType: 'video/mp4',
    }),
    /元数据写入失败/,
  )

  assert.equal(String((await files.read(project.id, 'clip.mp4')).metadata?.opfsFileId), firstId)
  assert.equal(await binary.blobs.get(firstId)?.text(), '旧字节')
  assert.deepEqual([...binary.blobs.keys()], [firstId])
  assert.equal(binary.calls.filter(call => call.startsWith('remove:')).length, 1)
})

test('web project deletion removes binary bytes before file and folder metadata', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('删除媒体')
  const direct = await files.writeBinary(project.id, 'single.bin', new Blob(['单文件']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const directId = String(direct.metadata?.opfsFileId)

  await files.remove(project.id, 'single.bin')
  assert.equal(binary.blobs.has(directId), false)

  const first = await files.writeBinary(project.id, 'media/one.bin', new Blob(['一']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const second = await files.writeBinary(project.id, 'media/two.bin', new Blob(['二']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  await files.remove(project.id, 'media')

  assert.equal(binary.blobs.has(String(first.metadata?.opfsFileId)), false)
  assert.equal(binary.blobs.has(String(second.metadata?.opfsFileId)), false)
  assert.deepEqual(await files.list(project.id), [])
})

test('web project binary rename changes only metadata paths', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('重命名媒体')
  const file = await files.writeBinary(project.id, 'media/one.bin', new Blob(['保留字节']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const fileId = String(file.metadata?.opfsFileId)
  const writes = binary.calls.filter(call => call.startsWith('write:')).length
  const removals = binary.calls.filter(call => call.startsWith('remove:')).length

  await files.rename(project.id, 'media', 'archive')

  assert.equal(binary.calls.filter(call => call.startsWith('write:')).length, writes)
  assert.equal(binary.calls.filter(call => call.startsWith('remove:')).length, removals)
  assert.equal(String((await files.read(project.id, 'archive/one.bin')).metadata?.opfsFileId), fileId)
  assert.equal(await (await files.readBinary(project.id, 'archive/one.bin')).text(), '保留字节')
})

test('web project text write and edit reject OPFS binary files without clearing media', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('文本保护')
  const file = await files.writeBinary(project.id, 'media/keep.bin', new Blob(['不能清空']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const fileId = String(file.metadata?.opfsFileId)

  await assert.rejects(() => files.write(project.id, 'media/keep.bin', '文本'), /二进制/)
  await assert.rejects(() => files.edit(project.id, 'media/keep.bin', '不能', '会'), /二进制/)

  assert.equal(String((await files.read(project.id, 'media/keep.bin')).metadata?.opfsFileId), fileId)
  assert.equal(await binary.blobs.get(fileId)?.text(), '不能清空')
})

test('the production project adapter never falls back to localStorage when IndexedDB is unavailable', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let localStorageCalls = 0
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { localStorageCalls += 1; return '{}' },
      setItem() { localStorageCalls += 1 },
      removeItem() { localStorageCalls += 1 },
      get length() { localStorageCalls += 1; return 0 },
      key() { localStorageCalls += 1; return null },
    },
  })
  try {
    await assert.rejects(() => createWebProjectFiles().listProjects(), /IndexedDB/)
    assert.equal(localStorageCalls, 0)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
