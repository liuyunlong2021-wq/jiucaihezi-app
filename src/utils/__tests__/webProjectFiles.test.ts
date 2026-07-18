import assert from 'node:assert/strict'
import { test } from 'node:test'

import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import {
  createWebProjectFiles,
  WebProjectCollisionCancelledError,
  type WebProjectRecordAdapter,
} from '../webProjectFiles'
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
  let nextRemoveError: Error | undefined
  let nextRemoveManyError: Error | undefined
  let removeCount = 0
  let failRemoveAt: number | undefined
  const adapter: WebProjectRecordAdapter & { removeMany(ids: string[]): Promise<void> } = {
    async all() { return [...records.values()].map(item => structuredClone(item)) },
    async get(id) { const value = records.get(id); return value ? structuredClone(value) : undefined },
    async put(entry) {
      const error = nextPutError
      nextPutError = undefined
      if (error) throw error
      records.set(entry.id, structuredClone(entry))
    },
    async remove(id) {
      removeCount += 1
      const error = nextRemoveError
      nextRemoveError = undefined
      if (error || failRemoveAt === removeCount) throw error || nextRemoveManyError || new Error('元数据删除失败')
      records.delete(id)
    },
    async removeMany(ids) {
      const error = nextRemoveManyError
      nextRemoveManyError = undefined
      if (error) throw error
      for (const id of ids) records.delete(id)
    },
  }
  return {
    adapter,
    records,
    failNextPut(error: Error) { nextPutError = error },
    failNextRemove(error: Error) {
      nextRemoveError = error
      nextRemoveManyError = error
    },
    failSecondRemove(error: Error) {
      failRemoveAt = removeCount + 2
      nextRemoveManyError = error
    },
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
  let nextRemoveError: Error | undefined
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
      const error = nextRemoveError
      nextRemoveError = undefined
      if (error) throw error
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
    failNextRemove(error: Error) { nextRemoveError = error },
  }
}

async function withUnavailableIndexedDb<T>(action: (localStorageCalls: () => number) => Promise<T>): Promise<T> {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let calls = 0
  const records: Record<string, FileEntry> = {
    webfile_project_fixture: {
      id: 'webfile_project_fixture', category: 'text', name: '正文.md', content: '正文', mimeType: 'text/markdown', size: 6,
      createdAt: 1, updatedAt: 1, metadata: { kind: 'project-file' },
    },
    webdir_project_fixture: {
      id: 'webdir_project_fixture', category: 'text', name: 'wiki', content: '', mimeType: 'folder', size: 0,
      createdAt: 1, updatedAt: 1, metadata: { kind: 'project-folder', isFolder: true },
    },
  }
  Reflect.deleteProperty(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { calls += 1; return JSON.stringify(records) },
      setItem() { calls += 1 },
      removeItem() { calls += 1 },
      get length() { calls += 1; return 0 },
      key() { calls += 1; return null },
    },
  })
  try {
    return await action(() => calls)
  } finally {
    if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
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

test('web project conditional text write rejects a stale revision inside the project lock', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('条件保存')
  const original = await files.write(project.id, 'wiki/hot.md', 'server')

  const result = await files.writeIfRevision(project.id, 'wiki/hot.md', 'local', `stale:${original.size}`)

  assert.equal(result.status, 'conflict')
  assert.equal((await files.read(project.id, 'wiki/hot.md')).content, 'server')
})

test('web project createText refuses to overwrite an existing path', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('另存为安全')
  await files.write(project.id, 'wiki/existing.md', 'original')

  await assert.rejects(() => files.createText(project.id, 'wiki/existing.md', 'replacement'), /文件已存在/)
  assert.equal((await files.read(project.id, 'wiki/existing.md')).content, 'original')
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

test('web project binary reads restore the MIME recorded outside OPFS', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('媒体类型')
  const file = await files.writeBinary(project.id, 'jc-media/videos/clip.webm', new Blob(['WEBM'], { type: 'video/webm' }), {
    category: 'video', mimeType: 'video/webm',
  })
  const fileId = String(file.metadata?.opfsFileId)
  binary.blobs.set(fileId, new Blob([await binary.blobs.get(fileId)!.arrayBuffer()]))

  const blob = await files.readBinary(project.id, 'jc-media/videos/clip.webm')

  assert.equal(blob.type, 'video/webm')
  assert.equal(await blob.text(), 'WEBM')
})

test('web project write collision decisions run inside the project lock', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('锁内碰撞')
  await files.write(project.id, 'wiki/大纲.md', '旧内容')

  await assert.rejects(
    () => files.write(project.id, 'wiki/大纲.md', '新内容', { onCollision: async () => 'cancel' }),
    WebProjectCollisionCancelledError,
  )
  assert.equal((await files.read(project.id, 'wiki/大纲.md')).content, '旧内容')

  await files.writeBinary(project.id, 'jc-media/images/poster.png', new Blob(['旧图']), {
    category: 'image', mimeType: 'image/png',
  })
  const written = await Promise.all([
    files.writeBinary(project.id, 'jc-media/images/poster.png', new Blob(['图一']), {
      category: 'image', mimeType: 'image/png', onCollision: async () => 'keep-both',
    }),
    files.writeBinary(project.id, 'jc-media/images/poster.png', new Blob(['图二']), {
      category: 'image', mimeType: 'image/png', onCollision: async () => 'keep-both',
    }),
  ])

  assert.deepEqual(
    written.map(entry => String(entry.metadata?.relativePath)).sort(),
    ['jc-media/images/poster (1).png', 'jc-media/images/poster (2).png'],
  )
  assert.equal(await (await files.readBinary(project.id, 'jc-media/images/poster.png')).text(), '旧图')
  assert.deepEqual(
    (await Promise.all(written.map(entry => files.readBinary(project.id, String(entry.metadata?.relativePath)).then(blob => blob.text())))).sort(),
    ['图一', '图二'],
  )
})

test('web project folders reject writes before invoking a collision resolver', async () => {
  const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
  const project = await files.createProject('目录碰撞')
  await files.createFolder(project.id, 'wiki')
  let collisionCalls = 0
  const onCollision = async () => {
    collisionCalls += 1
    return 'overwrite' as const
  }

  await assert.rejects(() => files.write(project.id, 'wiki', '文本', { onCollision }), /路径是文件夹/)
  await assert.rejects(() => files.writeBinary(project.id, 'wiki', new Blob(['二进制']), {
    category: 'binary', mimeType: 'application/octet-stream', onCollision,
  }), /路径是文件夹/)
  assert.equal(collisionCalls, 0)
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

test('web project deletion cleans binary bytes with file and folder metadata', async () => {
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

test('web project metadata deletion failure keeps OPFS bytes intact', async () => {
  const records = controllableMemoryAdapter()
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(records.adapter, () => {}, binary.adapter)
  const project = await files.createProject('删除原子性')
  const file = await files.writeBinary(project.id, 'media/keep.bin', new Blob(['保留']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const opfsFileId = String(file.metadata?.opfsFileId)
  records.failNextRemove(new Error('元数据删除失败'))

  await assert.rejects(() => files.remove(project.id, 'media/keep.bin'), /元数据删除失败/)

  assert.equal(binary.blobs.has(opfsFileId), true)
  assert.equal((await files.read(project.id, 'media/keep.bin')).id, file.id)
})

test('web project folder deletion keeps every metadata record and OPFS byte when its second metadata remove fails', async () => {
  const records = controllableMemoryAdapter()
  const binary = memoryBinaryAdapter()
  const changes: string[] = []
  const files = createWebProjectFiles(records.adapter, projectId => changes.push(projectId), binary.adapter)
  const project = await files.createProject('文件夹原子删除')
  const first = await files.writeBinary(project.id, 'media/one.bin', new Blob(['一']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const second = await files.writeBinary(project.id, 'media/two.bin', new Blob(['二']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  changes.length = 0
  records.failSecondRemove(new Error('第二条元数据删除失败'))

  await assert.rejects(() => files.remove(project.id, 'media'), /第二条元数据删除失败/)

  assert.deepEqual((await files.list(project.id)).map(entry => entry.path), [
    'media',
    'media/one.bin',
    'media/two.bin',
  ])
  assert.equal(binary.blobs.has(String(first.metadata?.opfsFileId)), true)
  assert.equal(binary.blobs.has(String(second.metadata?.opfsFileId)), true)
  assert.deepEqual(changes, [])
})

test('web project deletion completes after metadata commit when OPFS cleanup fails', async () => {
  const records = controllableMemoryAdapter()
  const binary = memoryBinaryAdapter()
  const changes: string[] = []
  const files = createWebProjectFiles(records.adapter, projectId => changes.push(projectId), binary.adapter)
  const project = await files.createProject('删除清理失败')
  const file = await files.writeBinary(project.id, 'media/left.bin', new Blob(['遗留']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  changes.length = 0
  binary.failNextRemove(new Error('OPFS 删除失败'))

  await assert.doesNotReject(() => files.remove(project.id, 'media/left.bin'))

  assert.equal(binary.blobs.has(String(file.metadata?.opfsFileId)), true)
  await assert.rejects(() => files.read(project.id, 'media/left.bin'), /文件不存在/)
  assert.deepEqual(changes, [project.id])
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

test('web project binary overwrite notifies after old OPFS cleanup fails', async () => {
  const binary = memoryBinaryAdapter()
  const changes: string[] = []
  const files = createWebProjectFiles(memoryAdapter(), projectId => changes.push(projectId), binary.adapter)
  const project = await files.createProject('覆盖清理失败')
  const first = await files.writeBinary(project.id, 'media/clip.bin', new Blob(['旧字节']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const firstId = String(first.metadata?.opfsFileId)
  changes.length = 0
  binary.failNextRemove(new Error('旧文件删除失败'))

  const second = await files.writeBinary(project.id, 'media/clip.bin', new Blob(['新字节']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })

  assert.notEqual(String(second.metadata?.opfsFileId), firstId)
  assert.equal(await (await files.readBinary(project.id, 'media/clip.bin')).text(), '新字节')
  assert.equal(binary.blobs.has(firstId), true)
  assert.deepEqual(changes, [project.id])
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

test('web project confirmed text overwrite replaces an OPFS binary after its metadata commit', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('确认覆盖')
  const media = await files.writeBinary(project.id, 'assets/result.md', new Blob(['旧媒体']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const oldId = String(media.metadata?.opfsFileId)

  const text = await files.write(project.id, 'assets/result.md', '# 新文本', {
    onCollision: async () => 'overwrite',
  })

  assert.equal(text.category, 'text')
  assert.equal(text.mimeType, 'text/markdown')
  assert.equal(text.content, '# 新文本')
  assert.equal(text.metadata?.binaryStorage, undefined)
  assert.equal(text.metadata?.opfsFileId, undefined)
  assert.equal(binary.blobs.has(oldId), false)
  await assert.rejects(() => files.readBinary(project.id, 'assets/result.md'), /不是 OPFS 二进制文件/)
})

test('web project confirmed text overwrite keeps new metadata when old OPFS cleanup fails', async () => {
  const binary = memoryBinaryAdapter()
  const files = createWebProjectFiles(memoryAdapter(), () => {}, binary.adapter)
  const project = await files.createProject('确认覆盖清理失败')
  const media = await files.writeBinary(project.id, 'assets/result.md', new Blob(['旧媒体']), {
    category: 'binary', mimeType: 'application/octet-stream',
  })
  const oldId = String(media.metadata?.opfsFileId)
  binary.failNextRemove(new Error('旧 OPFS 清理失败'))

  await files.write(project.id, 'assets/result.md', '# 新文本', { onCollision: async () => 'overwrite' })

  assert.equal((await files.read(project.id, 'assets/result.md')).content, '# 新文本')
  assert.equal(binary.blobs.has(oldId), true)
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

test('useFileStore sends web project editor IDs to strict IndexedDB without localStorage fallback', async () => {
  await withUnavailableIndexedDb(async localStorageCalls => {
    const store = useFileStore()
    const results = await Promise.allSettled([
      store.getFile('webfile_project_fixture'),
      store.updateFile('webfile_project_fixture', { content: '更新正文' }),
      store.deleteFile('webfile_project_fixture'),
      store.getFile('webdir_project_fixture'),
      store.updateFile('webdir_project_fixture', { name: 'wiki2' }),
    ])

    assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected', 'rejected', 'rejected', 'rejected'])
    for (const result of results) {
      if (result.status === 'rejected') assert.match(String(result.reason), /IndexedDB/)
    }
    assert.equal(localStorageCalls(), 0)
  })
})
