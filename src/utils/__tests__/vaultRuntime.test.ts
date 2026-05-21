import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRecallSections,
  buildRetrievalFiles,
  rankRetrievalFilesWithRules,
  toWikiWritebackRecords,
} from '../vaultRuntime'

const files = [
  {
    id: 'wiki-a',
    name: '普通页.md',
    content: '冷启动一般说明',
    kind: 'page',
    updatedAt: 10,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/普通' },
  },
  {
    id: 'wiki-b',
    name: '优先页.md',
    content: '冷启动关键流程',
    kind: 'page',
    updatedAt: 5,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/优先' },
  },
]

test('buildRecallSections keeps final output within total budget including config and pinned', () => {
  const output = buildRecallSections({
    claudeText: '配置'.repeat(500),
    pinned: [{ name: '钉选', content: '记忆'.repeat(500) }],
    contextPack: '上下文'.repeat(500),
    maxTotalChars: 500,
    claudeMaxChars: 200,
    pinnedMaxChars: 200,
  })

  assert.ok(output.length <= 500)
  assert.match(output, /\[知识库配置\]/)
  assert.match(output, /\[知识库上下文包\]/)
  assert.match(output, /\[钉选记忆\]/)
})

test('rankRetrievalFilesWithRules applies retrieval rule priority before building plan', () => {
  const ranked = rankRetrievalFilesWithRules('冷启动', buildRetrievalFiles(files as any, {
    filePath: file => String(file.metadata?.folderPath || ''),
    semanticFor: () => null,
  }), {
    retrievalRules: [{ path: 'wiki/优先', priority: 100, description: '冷启动' }],
  })

  assert.equal(ranked[0].id, 'wiki-b')
})

test('buildRetrievalFiles excludes pending wiki candidates from recall context', () => {
  const retrievalFiles = buildRetrievalFiles([
    ...files,
    {
      id: 'candidate',
      name: '待确认.md',
      content: '还没确认的候选事实',
      kind: 'page',
      indexed: false,
      updatedAt: 20,
      metadata: {
        vaultFolder: 'wiki',
        folderPath: 'wiki/沉淀内容',
        kind: 'writeback-candidate',
        status: 'pending',
      },
    },
  ] as any, {
    filePath: file => String(file.metadata?.folderPath || ''),
    semanticFor: () => null,
  })

  assert.deepEqual(retrievalFiles.map(file => file.id), ['wiki-a', 'wiki-b'])
})

test('toWikiWritebackRecords marks writeback as pending candidate and includes log/report records', () => {
  const records = toWikiWritebackRecords({
    drafts: [{
      targetPath: 'wiki/沉淀内容',
      fileName: '方案.md',
      content: '## 方案\n正文',
      kind: 'page',
      mode: 'append',
      reason: '生成内容达到沉淀阈值',
    }],
    userText: '写方案',
    assistantText: '## 方案\n正文',
    sessionId: 's1',
    sourceMessageIds: ['m1'],
    now: 1710000000000,
  })

  assert.equal(records[0].metadata.kind, 'writeback-candidate')
  assert.equal(records[0].metadata.status, 'pending')
  assert.ok(records.some(record => record.name === 'log.md'))
  assert.ok(records.some(record => record.metadata.kind === 'writeback-candidate-report'))
})
