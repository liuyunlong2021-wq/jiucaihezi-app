import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { createProjectFileService, type ProjectFileAdapter, type ProjectFileEntry } from '@/services/projectFileService'
import { MEMORY_PROJECT_SKELETON_DIRECTORIES } from '@/utils/memoryProjectPaths'
import {
  CONVERSATION_DIRECTORY,
  createConversationTranscript,
  parseConversationTranscript,
  type ConversationTurn,
} from '../conversationTranscript'
import { appendMemoryRound, initializeMemoryProject } from '../memoryProject'

const memoryProjectSource = readFileSync(join(process.cwd(), 'src/runtime/memory/memoryProject.ts'), 'utf8')

test('memory Wiki writes use the file service hash instead of hashing truncated text', () => {
  assert.match(memoryProjectSource, /async fingerprint\(path\) \{[\s\S]{0,200}files\.hashFile/)
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

test('appendMemoryRound is idempotent for the same user turn', async () => {
  const path = `${CONVERSATION_DIRECTORY}/conversation-1.md`
  let content = createConversationTranscript('conversation-1')
  let revision = 1
  let writes = 0
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() {
      return [{ path, isDirectory: false, content, mimeType: 'text/markdown' }]
    },
    async readText() {
      return { content, size: content.length, truncated: false, revision: { value: String(revision), size: content.length } }
    },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
    async writeText(_owner, _path, next) {
      writes += 1
      content = next
      revision += 1
      return { status: 'saved' as const, revision: { value: String(revision), size: content.length } }
    },
  }
  const files = createProjectFileService(adapter)
  const [resource] = await files.list('project')
  const turn: ConversationTurn = {
    id: 'turn-user-1',
    role: 'user',
    content: '继续任务',
    createdAt: '2026-08-09T00:00:00.000Z',
  }

  await appendMemoryRound(resource, turn, '已完成', files)
  await appendMemoryRound(resource, turn, '不应重复', files)

  const transcript = parseConversationTranscript(path, content)
  assert.equal(writes, 1)
  assert.deepEqual(transcript?.turns.map(item => [item.role, item.content]), [
    ['user', '继续任务'],
    ['assistant', '已完成'],
  ])
})
