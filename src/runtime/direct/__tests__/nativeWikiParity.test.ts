import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeWikiAction } from '../wikiRuntime'

function wiki(initial: Record<string, string | null> = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    workspace: {
      async list() { return [...entries].map(([path, content]) => ({ path, isDir: content === null })) },
      async read(path: string) { const value = entries.get(path); if (typeof value !== 'string') throw new Error(`不存在: ${path}`); return value },
      async write(path: string, content: string) { entries.set(path, content) },
      async createDirectory(path: string) { entries.set(path, null) },
      async fingerprint(path: string) { return `fp:${path}:${entries.get(path) || ''}` },
    },
  }
}

test('native query parity is read-only and evidence-based', async () => {
  const project = wiki({
    wiki: null,
    'wiki/index.md': '# 项目入口\n\n- [[hot]]\n',
    'wiki/hot.md': '# 当前\n\n角色：林风\n',
    'wiki/角色.md': '# 角色\n\n林风：主角\n',
  })
  const before = new Map(project.entries)
  const output = await executeWikiAction(project.workspace, { action: 'search', query: '林风' })
  assert.match(output, /角色\.md/)
  assert.deepEqual(project.entries, before)
})

test('native planning parity uses preview before structural extension', async () => {
  const project = wiki({ wiki: null, 'wiki/index.md': '# 项目入口\n' })
  const preview = await executeWikiAction(project.workspace, {
    action: 'extend', category: '角色', description: '人物资料', reason: '用户确认', basis: '结构方案',
  })
  assert.match(preview, /预览|角色/)
  assert.equal(project.entries.has('wiki/角色'), false)
})

test('native fill parity records provenance and writes only after apply', async () => {
  const project = wiki({ wiki: null, 'wiki/index.md': '# 项目入口\n', 'wiki/来源索引.md': '# 来源索引\n' })
  const preview = await executeWikiAction(project.workspace, { action: 'replace', path: 'wiki/来源索引.md', oldText: '# 来源索引', newText: '# 来源索引\n\n确认事实', reason: '用户确认', basis: '指定来源' })
  assert.match(preview, /预览/)
  assert.equal(project.entries.get('wiki/来源索引.md'), '# 来源索引\n')
})

test('native inspection parity is scoped and read-only', async () => {
  const project = wiki({ wiki: null, 'wiki/index.md': '# 项目入口\n', 'wiki/角色.md': '# 角色\n\n[[不存在]]\n' })
  const before = new Map(project.entries)
  const output = await executeWikiAction(project.workspace, { action: 'audit', evidencePaths: ['角色.md'] })
  assert.match(output, /角色|候选|断链/)
  assert.deepEqual(project.entries, before)
})

test('native repair parity requires explicit basis and applies one file only', async () => {
  const project = wiki({ wiki: null, 'wiki/index.md': '# 项目入口\n', 'wiki/角色.md': '# 角色\n\n林风：配角\n' })
  await assert.rejects(() => executeWikiAction(project.workspace, { action: 'replace', path: 'wiki/角色.md', oldText: '配角', newText: '主角' } as any), /原因|依据|basis/)
  await executeWikiAction(project.workspace, { action: 'replace', path: 'wiki/角色.md', oldText: '配角', newText: '主角', reason: '用户确认', basis: '角色设定', apply: true })
  assert.match(String(project.entries.get('wiki/角色.md')), /主角/)
})
