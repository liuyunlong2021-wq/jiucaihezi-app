import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildKnowledgeSummary, buildVaultIndexEntries, lintVaultKnowledge } from '../vaultCompilerCore'

test('buildVaultIndexEntries prefers metadata summary and strips markdown noise', () => {
  const entries = buildVaultIndexEntries([
    {
      id: 'a',
      title: '主角.md',
      kind: 'page',
      content: '---\ntags: [角色]\n---\n# 主角\n\n## 摘要\n主角的目标是逃离旧秩序。',
      metadata: { summary: '主角目标和核心冲突。' },
    },
    {
      id: 'b',
      title: '道具.md',
      kind: 'page',
      content: '# 道具\n\n## 摘要\n关键道具会推动第二幕反转。',
    },
  ] as any)

  assert.equal(entries.find(item => item.id === 'a')?.summary, '主角目标和核心冲突。')
  assert.equal(buildKnowledgeSummary(entries.find(item => item.id === 'b')?.summary || ''), '关键道具会推动第二幕反转。')
})

test('lintVaultKnowledge detects stale, orphan and similar duplicate wiki pages', () => {
  const now = 1710000000000
  const issues = lintVaultKnowledge([
    {
      id: 'old',
      title: '旧设定.md',
      kind: 'page',
      content: '# 旧设定\n\n来源：raw/a.md',
      updatedAt: now - 90 * 24 * 60 * 60 * 1000,
      metadata: { folderPath: 'wiki/设定', lastReadAt: now - 90 * 24 * 60 * 60 * 1000 },
    },
    {
      id: 'orphan',
      title: '孤立角色.md',
      kind: 'page',
      content: '# 孤立角色\n\n来源：raw/b.md',
      updatedAt: now,
      metadata: { folderPath: 'wiki/角色', lastReadAt: now },
    },
    {
      id: 'dup-a',
      title: '主角心理冲突.md',
      kind: 'page',
      content: '# 主角心理冲突\n\n来源：raw/c.md\n\n关联：[[孤立角色]]',
      updatedAt: now,
      metadata: { folderPath: 'wiki/角色', seeAlso: ['orphan'], lastReadAt: now },
    },
    {
      id: 'dup-b',
      title: '主角心理冲突稿.md',
      kind: 'page',
      content: '# 主角心理冲突稿\n\n来源：raw/d.md',
      updatedAt: now,
      metadata: { folderPath: 'wiki/角色', lastReadAt: now },
    },
  ] as any, { now, staleDays: 60 })

  assert.ok(issues.some(item => item.category === '过期知识' && item.id === 'old'))
  assert.ok(issues.some(item => item.category === '孤岛知识' && item.id === 'dup-b'))
  assert.ok(issues.some(item => item.category === '重复知识' && item.description.includes('主角心理冲突')))
})

test('lintVaultKnowledge ignores non-wiki reports and logs', () => {
  const now = 1710000000000
  const issues = lintVaultKnowledge([
    {
      id: 'organize-report',
      title: '整理报告.md',
      kind: 'summary',
      content: '# 整理报告\n\n完成整理。',
      updatedAt: now - 90 * 24 * 60 * 60 * 1000,
      metadata: { vaultFolder: 'reports', folderPath: '_reports/整理记录', kind: 'vault-organize-report' },
    },
    {
      id: 'log-entry',
      title: 'log.md',
      kind: 'summary',
      content: '# 日志\n\n一次操作。',
      updatedAt: now - 90 * 24 * 60 * 60 * 1000,
      metadata: { vaultFolder: 'logs', folderPath: '_reports/日志', kind: 'vault-log-entry' },
    },
  ] as any, { now, staleDays: 60 })

  assert.equal(issues.some(item => ['过期知识', '孤岛知识', '重复知识'].includes(item.category)), false)
})

test('lintVaultKnowledge detects isolated old source-backed pages and avoids cross-folder duplicate false positives', () => {
  const now = 1710000000000
  const issues = lintVaultKnowledge([
    {
      id: 'source-backed',
      title: '有来源叶子页.md',
      kind: 'page',
      content: '# 有来源叶子页\n\n来源：raw/a.md',
      updatedAt: now - 120 * 24 * 60 * 60 * 1000,
      metadata: { folderPath: 'wiki/角色', sources: ['raw-a'] },
    },
    {
      id: 'same-title-a',
      title: '主角心理冲突.md',
      kind: 'page',
      content: '# 主角心理冲突\n\n来源：raw/b.md',
      updatedAt: now,
      metadata: { folderPath: 'wiki/角色', sources: ['raw-b'] },
    },
    {
      id: 'same-title-b',
      title: '主角心理冲突稿.md',
      kind: 'page',
      content: '# 主角心理冲突稿\n\n来源：raw/c.md',
      updatedAt: now,
      metadata: { folderPath: 'wiki/草稿', sources: ['raw-c'] },
    },
  ] as any, { now, staleDays: 60 })

  assert.equal(issues.some(item => item.id === 'source-backed' && item.category === '过期知识'), true)
  assert.equal(issues.some(item => item.id === 'source-backed' && item.category === '孤岛知识'), true)
  assert.equal(issues.some(item => item.category === '重复知识'), false)
})
