import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildHotCacheMarkdown, isHotCacheWikiPage } from '../vaultHotCache'

test('buildHotCacheMarkdown ranks wiki summaries by read count', () => {
  const content = buildHotCacheMarkdown({
    vaultName: '小说知识库',
    wikiPages: [
      {
        id: 'low',
        name: '道具.md',
        content: '# 道具\n\n普通道具。',
        updatedAt: 10,
        metadata: { summary: '道具清单', readCount: 1 },
      },
      {
        id: 'high',
        name: '主角.md',
        content: '# 主角\n\n主角的心理冲突。',
        updatedAt: 8,
        metadata: { summary: '主角的心理冲突和行动目标', readCount: 7 },
      },
    ],
    rawFallback: [],
  })

  assert.match(content, /^# 小说知识库 热记忆/)
  assert.ok(content.indexOf('主角.md') < content.indexOf('道具.md'))
  assert.match(content, /主角的心理冲突和行动目标/)
})

test('buildHotCacheMarkdown does not include raw fallback when no wiki page exists', () => {
  const content = buildHotCacheMarkdown({
    vaultName: '空知识库',
    wikiPages: [],
    rawFallback: [
      { id: 'raw', name: '对话.md', content: '用户刚刚讨论了角色动机和场景目标。' },
    ],
  })

  assert.doesNotMatch(content, /用户刚刚讨论了角色动机/)
  assert.match(content, /暂无高频知识页/)
})

test('isHotCacheWikiPage excludes reports logs candidates and non-wiki files', () => {
  assert.equal(isHotCacheWikiPage({
    id: 'wiki',
    name: '主角.md',
    content: '主角摘要',
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/角色', kind: 'wiki-page', status: 'active' },
  }), true)
  assert.equal(isHotCacheWikiPage({
    id: 'report',
    name: '写回报告.md',
    content: '报告',
    metadata: { vaultFolder: 'reports', folderPath: '_reports/整理记录', kind: 'writeback-candidate-report' },
  }), false)
  assert.equal(isHotCacheWikiPage({
    id: 'candidate',
    name: '候选.md',
    content: '候选',
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/沉淀内容', kind: 'writeback-candidate', status: 'pending' },
  }), false)
})
