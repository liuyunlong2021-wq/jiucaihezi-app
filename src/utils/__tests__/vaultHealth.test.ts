import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultHealthReport, inspectVaultHealth } from '../vaultHealth'

const files = [
  {
    id: 'raw1',
    name: '访谈记录.md',
    content: '用户多次讨论冷启动。',
    kind: 'raw',
    indexed: false,
    metadata: { vaultFolder: 'raw', folderPath: 'raw/对话记录' },
  },
  {
    id: 'wiki1',
    name: '冷启动.md',
    content: '# 冷启动\n\n没有来源引用。\n\n关联：[[缺失页面]]',
    kind: 'page',
    indexed: true,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
  },
  {
    id: 'wiki2',
    name: '冷启动.md',
    content: '# 冷启动\n\n来源：raw/访谈记录.md',
    kind: 'page',
    indexed: true,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/方法模型', sources: ['raw1'] },
  },
  {
    id: 'hot',
    name: 'hot.md',
    content: '最近上下文',
    kind: 'page',
    updatedAt: Date.now() - 12 * 24 * 60 * 60 * 1000,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki', kind: 'vault-hot-cache' },
  },
]

test('inspectVaultHealth detects phase 6 issue categories', () => {
  const result = inspectVaultHealth(files)

  assert.equal(result.stats.unprocessedRaw, 1)
  assert.equal(result.stats.brokenLinks, 1)
  assert.equal(result.stats.missingSourceRefs, 1)
  assert.equal(result.stats.duplicatePages, 0)
  assert.equal(result.stats.orphanPages, 2)
  assert.equal(result.stats.staleHotCache, 1)
  assert.ok(result.suggestions.some(item => item.includes('对话记录')))
})

test('inspectVaultHealth resolves wiki links by path when folder metadata is available', () => {
  const result = inspectVaultHealth([
    {
      id: 'source',
      name: '入口.md',
      content: '来源：raw/入口.md\n\n关联：[[操作流程/冷启动]]',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki' },
    },
    {
      id: 'target',
      name: '冷启动.md',
      content: '来源：raw/访谈记录.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
    },
  ])

  assert.equal(result.stats.brokenLinks, 0)
})

test('inspectVaultHealth treats duplicate pages as duplicate only when full wiki paths match', () => {
  const result = inspectVaultHealth([
    {
      id: 'a',
      name: '冷启动.md',
      content: '来源：raw/a.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
    },
    {
      id: 'b',
      name: '冷启动.md',
      content: '来源：raw/b.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/方法模型' },
    },
    {
      id: 'c',
      name: '同一路径.md',
      content: '来源：raw/c.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
    },
    {
      id: 'd',
      name: '同一路径.md',
      content: '来源：raw/d.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
    },
  ])

  assert.equal(result.stats.duplicatePages, 1)
  assert.equal(result.issues.filter(item => item.category === '重复页面')[0]?.fileName, '操作流程/同一路径')
})

test('inspectVaultHealth detects orphan wiki pages and reports orphan stats', () => {
  const result = inspectVaultHealth([
    {
      id: 'index',
      name: 'index.md',
      content: '来源：raw/index.md\n\n关联：[[操作流程/冷启动]]',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki' },
    },
    {
      id: 'linked',
      name: '冷启动.md',
      content: '来源：raw/linked.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
    },
    {
      id: 'orphan',
      name: '孤立页.md',
      content: '来源：raw/orphan.md',
      kind: 'page',
      indexed: true,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/方法模型' },
    },
  ])

  assert.equal(result.stats.orphanPages, 1)
  assert.equal(result.issues.filter(item => item.category === '孤立页面')[0]?.fileId, 'orphan')
})

test('inspectVaultHealth uses configured hot cache age threshold in stale message', () => {
  const now = 1710000000000
  const result = inspectVaultHealth([
    {
      id: 'hot',
      name: 'hot.md',
      content: '最近上下文',
      kind: 'page',
      updatedAt: now - 5 * 24 * 60 * 60 * 1000,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki', kind: 'vault-hot-cache' },
    },
  ], { now, hotCacheMaxAgeDays: 3 })

  assert.equal(result.stats.staleHotCache, 1)
  assert.match(result.issues.filter(item => item.category === '热记忆过期')[0]?.description || '', /3 天/)
  assert.doesNotMatch(result.issues.filter(item => item.category === '热记忆过期')[0]?.description || '', /7 天/)
})

test('buildVaultHealthReport renders a human readable report', () => {
  const result = inspectVaultHealth(files)
  const report = buildVaultHealthReport('测试知识库', result, 1710000000000)

  assert.match(report, /# 测试知识库 健康检查/)
  assert.match(report, /未整理资料：1/)
  assert.match(report, /失效链接：1/)
  assert.match(report, /建议新增栏目/)
})
