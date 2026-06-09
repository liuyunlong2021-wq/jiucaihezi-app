import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildOpenCodeVaultMountInstruction,
  syncOpenCodeVaultContextDirectory,
} from '../vaultContext'
import type { FileEntry } from '@/composables/useFileStore'
import type { Vault } from '@/stores/vaultStore'

const vault: Vault = {
  id: 'vault_1',
  name: '项目知识库',
  description: '',
  type: 'project',
  createdAt: 1,
  updatedAt: 1,
  status: 'active',
}

function entry(patch: Partial<FileEntry>): FileEntry {
  return {
    id: patch.id || `file_${Math.random()}`,
    category: 'knowledge',
    name: patch.name || 'note.md',
    content: patch.content || 'content',
    mimeType: patch.mimeType || 'text/markdown',
    size: 0,
    createdAt: 1,
    updatedAt: patch.updatedAt || 1,
    vaultId: 'vault_1',
    ...patch,
  }
}

test('syncs selected vault into the OpenCode workspace as a readable directory', async () => {
  const writes = new Map<string, string>()
  const mkdirs: string[] = []

  const mount = await syncOpenCodeVaultContextDirectory({
    vault,
    entries: [
      entry({ name: 'CLAUDE.md', content: 'rules', metadata: { isConfig: true } }),
      entry({ name: 'draft.md', content: 'draft', metadata: { folderPath: 'raw/briefs' } }),
      entry({ name: 'page.md', content: 'page', metadata: { folderPath: 'wiki/pages' } }),
      entry({ name: 'binary.md', content: 'abc\0def', metadata: { folderPath: 'wiki/pages' } }),
      entry({ name: 'ignore.png', content: 'binary', mimeType: 'image/png' }),
    ],
    workspaceDirectory: '/tmp/opencode-workspace',
    writer: {
      mkdir: async path => { mkdirs.push(path) },
      writeTextFile: async (path, content) => { writes.set(path, content) },
      remove: async () => {},
    },
  })

  assert.equal(mount.relativeDirectory, '.jiucaihezi-vaults/current')
  assert.equal(mount.fileCount, 2)
  assert.ok(mkdirs.includes('/tmp/opencode-workspace/.jiucaihezi-vaults/current'))
  assert.equal(writes.has('/tmp/opencode-workspace/.jiucaihezi-vaults/current/CLAUDE.md'), false)
  assert.equal(writes.get('/tmp/opencode-workspace/.jiucaihezi-vaults/current/raw/briefs/draft.md'), 'draft')
  assert.equal(writes.get('/tmp/opencode-workspace/.jiucaihezi-vaults/current/wiki/pages/page.md'), 'page')
  assert.equal(writes.has('/tmp/opencode-workspace/.jiucaihezi-vaults/current/wiki/pages/binary.md'), false)
  assert.equal(writes.has('/tmp/opencode-workspace/.jiucaihezi-vaults/current/ignore.png'), false)
})

test('clears the current OpenCode vault mount when Knowledge is off', async () => {
  const removed: string[] = []
  const mount = await syncOpenCodeVaultContextDirectory({
    vault: null,
    entries: [],
    workspaceDirectory: '/tmp/opencode-workspace',
    writer: {
      mkdir: async () => {},
      writeTextFile: async () => {},
      remove: async path => { removed.push(path) },
    },
  })

  assert.equal(mount, null)
  assert.deepEqual(removed, ['/tmp/opencode-workspace/.jiucaihezi-vaults/current'])
})

test('rejects unsafe workspace directories before recursive cleanup', async () => {
  await assert.rejects(
    () => syncOpenCodeVaultContextDirectory({
      vault,
      entries: [],
      workspaceDirectory: '../relative',
      writer: { mkdir: async () => {}, writeTextFile: async () => {}, remove: async () => {} },
    }),
    /OpenCode workspace 路径无效/,
  )
})

test('fails closed when stale mount cleanup fails', async () => {
  await assert.rejects(
    () => syncOpenCodeVaultContextDirectory({
      vault,
      entries: [entry({ name: 'page.md', content: 'page', metadata: { folderPath: 'wiki' } })],
      workspaceDirectory: '/tmp/opencode-workspace',
      writer: {
        mkdir: async () => {},
        writeTextFile: async () => {},
        remove: async () => { throw new Error('permission denied') },
      },
    }),
    /permission denied/,
  )
})

test('clips oversized mounted text files without embedding them in prompt', async () => {
  const writes = new Map<string, string>()
  const mount = await syncOpenCodeVaultContextDirectory({
    vault,
    entries: [entry({ name: 'big.md', content: 'x'.repeat(260_000), metadata: { folderPath: 'wiki' } })],
    workspaceDirectory: '/tmp/opencode-workspace',
    writer: {
      mkdir: async () => {},
      writeTextFile: async (path, content) => { writes.set(path, content) },
      remove: async () => {},
    },
  })

  const content = writes.get('/tmp/opencode-workspace/.jiucaihezi-vaults/current/wiki/big.md') || ''
  assert.equal(mount?.fileCount, 1)
  assert.equal(content.length < 205_000, true)
  assert.match(content, /内容已截断/)
})

test('builds a minimal OpenCode vault mount instruction without embedding vault content', () => {
  const instruction = buildOpenCodeVaultMountInstruction({
    vaultName: '项目知识库',
    relativeDirectory: '.jiucaihezi-vaults/current',
    fileCount: 3,
  })

  assert.match(instruction, /已选择知识库目录/)
  assert.match(instruction, /\.jiucaihezi-vaults\/current/)
  assert.match(instruction, /使用 OpenCode 文件读取工具/)
  assert.doesNotMatch(instruction, /rules|draft|page/)
})
