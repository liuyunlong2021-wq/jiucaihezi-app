import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import { createWebProjectFiles, type WebProjectRecordAdapter } from '@/utils/webProjectFiles'
import { WEB_PROJECT_TOOL_DEFINITIONS, createWebProjectToolExecutor } from '../webProjectTools'

function memoryAdapter(): WebProjectRecordAdapter {
  const records = new Map<string, FileEntry>()
  return {
    async all() { return [...records.values()] },
    async get(id) { return records.get(id) },
    async put(entry) { records.set(entry.id, structuredClone(entry)) },
    async remove(id) { records.delete(id) },
  }
}

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

test('web project tools use OpenCode-compatible names', () => {
  assert.deepEqual(
    WEB_PROJECT_TOOL_DEFINITIONS.map(tool => tool.function.name),
    ['skill', 'read', 'glob', 'grep', 'write', 'edit'],
  )
})

test('web project tool executor reads writes searches and edits the bound project', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('工具测试')
  const execute = createWebProjectToolExecutor({ projectId: project.id, files })

  await execute(call('write', { path: 'wiki/hot.md', content: '# 热缓存\n林风' }))
  assert.match((await execute(call('read', { path: '.' }))).content, /wiki/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /林风/)
  assert.match((await execute(call('glob', { pattern: 'wiki/**/*.md' }))).content, /wiki\/hot.md/)
  assert.match((await execute(call('grep', { pattern: '林风' }))).content, /Line 2/)
  assert.match((await execute(call('edit', {
    path: 'wiki/hot.md', oldString: '林风', newString: '陆川', replaceAll: false,
  }))).content, /Replacements: 1/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /陆川/)

  await assert.rejects(() => execute(call('read', { path: '../secret.md' })), /项目路径/)
})
