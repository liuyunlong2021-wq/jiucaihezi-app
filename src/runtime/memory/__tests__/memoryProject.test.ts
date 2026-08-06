import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { createProjectFileService, type ProjectFileAdapter, type ProjectFileEntry } from '@/services/projectFileService'
import { MEMORY_PROJECT_SKELETON_DIRECTORIES } from '@/utils/memoryProjectPaths'
import { initializeMemoryProject } from '../memoryProject'

const memoryProjectSource = readFileSync(join(process.cwd(), 'src/runtime/memory/memoryProject.ts'), 'utf8')

test('memory project initialization does not implement a lossy evidence fingerprint path', () => {
  assert.match(memoryProjectSource, /async fingerprint\(\) \{[\s\S]*初始化过程不支持来源指纹/)
  assert.doesNotMatch(memoryProjectSource, /async fingerprint\([^)]*\) \{[\s\S]{0,300}readText/)
})

test('memory project initialization creates the complete protected skeleton', async () => {
  const entries = new Map<string, ProjectFileEntry>()
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...entries.values()] },
    async readText(_owner, path) {
      const entry = entries.get(path)
      if (!entry || entry.isDirectory) throw new Error('missing')
      const content = String(entry.content || '')
      return { content, size: content.length, truncated: false, revision: { value: path, size: content.length } }
    },
    async createText(_owner, path, content) {
      const entry = { path, isDirectory: false, content, size: content.length, mimeType: 'text/markdown' }
      entries.set(path, entry)
      return entry
    },
    async createFolder(_owner, path) {
      const entry = { path, isDirectory: true }
      entries.set(path, entry)
      return entry
    },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
  }

  await initializeMemoryProject('project', createProjectFileService(adapter))

  for (const path of MEMORY_PROJECT_SKELETON_DIRECTORIES) {
    assert.equal(entries.get(path)?.isDirectory, true, path)
  }
})
