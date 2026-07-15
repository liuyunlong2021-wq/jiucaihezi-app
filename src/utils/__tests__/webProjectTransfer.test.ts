import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import {
  createWebProjectFiles,
  type WebProjectRecordAdapter,
} from '../webProjectFiles'
import type { WebBinarySource, WebProjectBinaryAdapter } from '../webProjectBinaryStore'
import {
  exportWebProject,
  importWebProject,
  writeWebProjectEntries,
  type WebProjectTransferEntry,
} from '../webProjectTransfer'

function memoryAdapter(): WebProjectRecordAdapter {
  const records = new Map<string, FileEntry>()
  return {
    async all() { return [...records.values()].map(entry => structuredClone(entry)) },
    async get(id) { const entry = records.get(id); return entry ? structuredClone(entry) : undefined },
    async put(entry) { records.set(entry.id, structuredClone(entry)) },
    async remove(id) { records.delete(id) },
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

function memoryBinaryAdapter(): WebProjectBinaryAdapter {
  const blobs = new Map<string, Blob>()
  return {
    async write(id, source) {
      const blob = await sourceBlob(source)
      blobs.set(id, blob)
      return blob.size
    },
    async read(id) {
      const blob = blobs.get(id)
      if (!blob) throw new Error(`missing binary ${id}`)
      return blob
    },
    async remove(id) { blobs.delete(id) },
    async estimate() { return { usage: 0, quota: 1_000_000 } },
    async persist() { return true },
  }
}

function transferEntry(path: string, content: string): WebProjectTransferEntry {
  return {
    path,
    kind: 'text',
    category: 'text',
    mimeType: 'text/markdown',
    blob: new Blob([content], { type: 'text/markdown' }),
  }
}

test('exports nested text and OPFS binary entries as blobs', async () => {
  const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
  const project = await files.createProject('导出项目')
  await files.write(project.id, 'wiki/角色/林风.md', '# 林风')
  await files.writeBinary(project.id, 'jc-media/images/hero.png', new Blob(['PNG'], { type: 'image/png' }), {
    category: 'image',
    mimeType: 'image/png',
  })

  const entries = await exportWebProject(files, project.id)

  assert.deepEqual(entries.map(entry => [entry.path, entry.kind, entry.mimeType]), [
    ['jc-media/images/hero.png', 'binary', 'image/png'],
    ['wiki/角色/林风.md', 'text', 'text/markdown'],
  ])
  assert.equal(await entries.find(entry => entry.path === 'wiki/角色/林风.md')?.blob.text(), '# 林风')
  const media = entries.find(entry => entry.path === 'jc-media/images/hero.png')
  assert.ok(media?.blob instanceof Blob)
  assert.equal(await media?.blob.text(), 'PNG')
})

test('imports a selected project folder while stripping only its top-level segment', async () => {
  const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
  const result = await importWebProject(files, 'source-project', [
    transferEntry('source-project/wiki/角色/林风.md', '# 林风'),
    {
      path: 'source-project/jc-media/images/hero.png',
      kind: 'binary',
      category: 'image',
      mimeType: 'image/png',
      blob: new Blob(['PNG'], { type: 'image/png' }),
    },
  ])

  assert.equal(result.project.name, 'source-project')
  assert.deepEqual(result.importedPaths, ['wiki/角色/林风.md', 'jc-media/images/hero.png'])
  assert.equal((await files.read(result.project.id, 'wiki/角色/林风.md')).content, '# 林风')
  assert.equal(await (await files.readBinary(result.project.id, 'jc-media/images/hero.png')).text(), 'PNG')
  await assert.rejects(() => files.read(result.project.id, 'source-project/wiki/角色/林风.md'), /文件不存在/)
})

test('transfers a confirmed text overwrite over an existing OPFS binary', async () => {
  const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
  const project = await files.createProject('覆盖媒体')
  await files.writeBinary(project.id, 'wiki/素材.md', new Blob(['BINARY']), {
    category: 'binary',
    mimeType: 'application/octet-stream',
  })

  await writeWebProjectEntries(files, project.id, [transferEntry('wiki/素材.md', '# 文本')], {
    resolveCollision: async () => 'overwrite',
  })

  const entry = await files.read(project.id, 'wiki/素材.md')
  assert.equal(entry.content, '# 文本')
  assert.equal(entry.metadata?.binaryStorage, undefined)
})

for (const [decision, expectedPaths, expectedContent, skippedPaths] of [
  ['overwrite', ['wiki/大纲.md'], 'new', []],
  ['keep-both', ['wiki/大纲 (1).md', 'wiki/大纲.md'], 'old', []],
  ['cancel', ['wiki/大纲.md'], 'old', ['wiki/大纲.md']],
] as const) {
  test(`imports collisions with ${decision}`, async () => {
    const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
    const result = await importWebProject(files, 'source-project', [
      transferEntry('source-project/wiki/大纲.md', 'old'),
      transferEntry('source-project/wiki/大纲.md', 'new'),
    ], {
      resolveCollision: async () => decision,
    })

    assert.deepEqual((await files.list(result.project.id)).filter(entry => !entry.isDir).map(entry => entry.path), expectedPaths)
    assert.equal((await files.read(result.project.id, 'wiki/大纲.md')).content, expectedContent)
    assert.deepEqual(result.skippedPaths, skippedPaths)
    if (decision === 'keep-both') {
      assert.equal((await files.read(result.project.id, 'wiki/大纲 (1).md')).content, 'new')
    }
  })
}
