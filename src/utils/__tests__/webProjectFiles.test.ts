import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import { createWebProjectFiles, type WebProjectRecordAdapter } from '../webProjectFiles'

function memoryAdapter(): WebProjectRecordAdapter {
  const records = new Map<string, FileEntry>()
  return {
    async all() { return [...records.values()].map(item => structuredClone(item)) },
    async get(id) { const value = records.get(id); return value ? structuredClone(value) : undefined },
    async put(entry) { records.set(entry.id, structuredClone(entry)) },
    async remove(id) { records.delete(id) },
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
