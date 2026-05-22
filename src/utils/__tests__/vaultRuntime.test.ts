import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRecallSections,
  buildRuntimeContextPackResult,
  buildRetrievalFiles,
  rankRetrievalFilesWithRules,
  resolveContextPackBudget,
  resolveRecallBudgetByIntent,
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

test('rankRetrievalFilesWithRules excludes unrelated pages instead of ranking by base weight', () => {
  const ranked = rankRetrievalFilesWithRules('心理冲突', buildRetrievalFiles([
    {
      id: 'unrelated',
      name: '道具清单.md',
      content: '钥匙和地图。',
      kind: 'page',
      updatedAt: Date.now(),
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/道具' },
    },
    {
      id: 'raw-specific',
      name: '访谈.md',
      content: '用户明确提到主角的心理冲突。',
      kind: 'raw',
      updatedAt: 1,
      metadata: { vaultFolder: 'raw', folderPath: 'raw/对话记录' },
    },
  ] as any, {
    filePath: file => String(file.metadata?.folderPath || ''),
    semanticFor: () => null,
  }))

  assert.deepEqual(ranked.map(file => file.id), ['raw-specific'])
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

test('buildRuntimeContextPackResult exposes only final injected wiki hit ids', () => {
  const result = buildRuntimeContextPackResult(
    '冷启动复盘',
    buildRetrievalFiles([
      {
        id: 'wiki-large',
        name: '冷启动复盘.md',
        content: '冷启动复盘步骤'.repeat(80),
        kind: 'page',
        updatedAt: 30,
        metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
      },
      {
        id: 'wiki-second',
        name: '冷启动案例.md',
        content: '冷启动案例'.repeat(60),
        kind: 'page',
        updatedAt: 20,
        metadata: { vaultFolder: 'wiki', folderPath: 'wiki/案例' },
      },
    ] as any, {
      filePath: file => String(file.metadata?.folderPath || ''),
      semanticFor: () => null,
    }),
    undefined,
    {
      maxWikiItems: 2,
      maxRawItems: 1,
      perItemChars: 200,
      maxTotalChars: 180,
    },
  )

  assert.deepEqual(result.wikiHitIds, ['wiki-large'])
  assert.match(result.contextPack, /冷启动复盘/)
})

test('buildRuntimeContextPackResult keeps summary-only wiki matches through runtime ranking', () => {
  const result = buildRuntimeContextPackResult(
    '心理冲突',
    buildRetrievalFiles([
      {
        id: 'summary-only',
        name: '角色档案.md',
        content: '正文只记录了角色日程安排。',
        kind: 'page',
        updatedAt: 20,
        metadata: {
          vaultFolder: 'wiki',
          folderPath: 'wiki/角色',
          summary: '人物心理冲突、行动目标和关系压力。',
        },
      },
      {
        id: 'raw-specific',
        name: '访谈.md',
        content: '原始资料中也提到心理冲突。',
        kind: 'raw',
        updatedAt: 1,
        metadata: { vaultFolder: 'raw', folderPath: 'raw/对话记录' },
      },
    ] as any, {
      filePath: file => String(file.metadata?.folderPath || ''),
      semanticFor: () => null,
    }),
    undefined,
    {
      maxWikiItems: 1,
      maxRawItems: 1,
      perItemChars: 120,
      maxTotalChars: 1000,
    },
  )

  assert.deepEqual(result.wikiHitIds, ['summary-only'])
  assert.match(result.contextPack, /人物心理冲突、行动目标和关系压力/)
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

test('toWikiWritebackRecords promotes high confidence markdown to active wiki page', () => {
  const records = toWikiWritebackRecords({
    drafts: [{
      targetPath: 'wiki/产品报告',
      fileName: '增长方案.md',
      content: '# 增长方案\n\n' + '围绕目标用户、转化路径、内容节奏和复盘机制展开。'.repeat(60),
      kind: 'page',
      mode: 'create',
      reason: '高置信正式沉淀',
    }],
    userText: '写一份增长方案',
    assistantText: '# 增长方案\n\n正文',
    now: 1710000000000,
  })

  assert.equal(records[0].metadata.kind, 'wiki-page')
  assert.equal(records[0].metadata.status, 'active')
  assert.equal(records[0].metadata.autoAccepted, true)
  assert.doesNotMatch(records[0].content, /写回候选/)
  assert.match(records[0].content, /^# 增长方案/)
})

test('toWikiWritebackRecords keeps default auto-planned long output pending', () => {
  const records = toWikiWritebackRecords({
    drafts: [{
      targetPath: 'wiki/产品报告',
      fileName: '增长方案.md',
      content: '# 增长方案\n\n' + '围绕目标用户、转化路径、内容节奏和复盘机制展开。'.repeat(60),
      kind: 'page',
      mode: 'create',
      reason: '生成内容达到沉淀阈值，自动规划写回 wiki',
    }],
    userText: '写一份增长方案',
    assistantText: '# 增长方案\n\n正文',
    now: 1710000000000,
  })

  assert.equal(records[0].metadata.kind, 'writeback-candidate')
  assert.equal(records[0].metadata.status, 'pending')
  assert.match(records[0].content, /写回候选/)
})

test('resolveRecallBudgetByIntent expands creative tasks and shrinks casual chat', () => {
  assert.equal(resolveRecallBudgetByIntent('帮我写第三章正文', 6000), 10000)
  assert.equal(resolveRecallBudgetByIntent('查询主角人设', 6000), 8000)
  assert.equal(resolveRecallBudgetByIntent('今天怎么样', 6000), 3000)
})

test('resolveContextPackBudget only reserves space for existing config and pinned memory', () => {
  assert.equal(resolveContextPackBudget({ maxTotalChars: 3000 }), 3000)
  assert.equal(resolveContextPackBudget({ maxTotalChars: 6000, hasClaudeText: true }), 4500)
  assert.equal(resolveContextPackBudget({ maxTotalChars: 6000, hasPinned: true }), 4000)
  assert.equal(resolveContextPackBudget({ maxTotalChars: 6000, hasClaudeText: true, hasPinned: true }), 2500)
})

test('toWikiWritebackRecords keeps append drafts as pending even when content is long', () => {
  const records = toWikiWritebackRecords({
    drafts: [{
      targetPath: 'wiki/产品报告',
      fileName: '增长方案.md',
      content: '# 增长方案\n\n' + '围绕目标用户、转化路径、内容节奏和复盘机制展开。'.repeat(60),
      kind: 'page',
      mode: 'append',
      reason: '生成内容达到沉淀阈值，自动规划写回 wiki',
    }],
    userText: '补充增长方案',
    assistantText: '# 增长方案\n\n正文',
    now: 1710000000000,
  })

  assert.equal(records[0].metadata.kind, 'writeback-candidate')
  assert.equal(records[0].metadata.status, 'pending')
})
