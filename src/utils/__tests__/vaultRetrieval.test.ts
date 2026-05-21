import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultRetrievalPlan, buildVaultContextPack, buildWikiWritebackCandidates } from '../vaultRetrieval'

const files = [
  {
    id: 'hot',
    name: 'hot.md',
    content: '账号冷启动正在讨论。',
    kind: 'page',
    updatedAt: 10,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki', kind: 'vault-hot-cache' },
  },
  {
    id: 'wiki1',
    name: '账号冷启动流程.md',
    content: '冷启动需要连续发布同一领域内容，并观察收藏率。',
    kind: 'page',
    updatedAt: 20,
    metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
  },
  {
    id: 'raw1',
    name: '工具书.md',
    content: '原文补充：冷启动期间不要频繁换方向。',
    kind: 'raw',
    updatedAt: 5,
    metadata: { vaultFolder: 'raw', folderPath: 'raw/转换后的MD' },
  },
]

test('buildVaultRetrievalPlan ranks wiki before raw fallback', () => {
  const plan = buildVaultRetrievalPlan('冷启动怎么做', files)

  assert.equal(plan.wikiHits[0].id, 'hot')
  assert.ok(plan.wikiHits.some(hit => hit.id === 'wiki1'))
  assert.equal(plan.rawFallback[0].id, 'raw1')
})

test('buildVaultContextPack labels wiki and raw sections separately', () => {
  const plan = buildVaultRetrievalPlan('冷启动怎么做', files)
  const pack = buildVaultContextPack(plan, { maxWikiItems: 2, maxRawItems: 1, perItemChars: 80 })

  assert.match(pack, /\[Wiki 命中\]/)
  assert.match(pack, /\[Raw 兜底\]/)
  assert.match(pack, /账号冷启动流程/)
  assert.match(pack, /Raw 兜底无\/未启用/)
})

test('buildVaultContextPack only injects raw fallback when wiki has no hits by default', () => {
  const plan = buildVaultRetrievalPlan('频繁换方向', files)
  const wikiFirstPlan = { ...plan, wikiHits: [] }
  const pack = buildVaultContextPack(wikiFirstPlan, { maxWikiItems: 2, maxRawItems: 1, perItemChars: 80 })

  assert.match(pack, /\[Wiki 命中\]/)
  assert.match(pack, /\[Raw 兜底\]/)
  assert.match(pack, /原文补充/)
})

test('buildVaultContextPack injects raw fallback when wiki hits are only structural pages', () => {
  const plan = buildVaultRetrievalPlan('频繁换方向', [
    {
      id: 'index',
      name: 'index.md',
      content: '知识库索引：频繁换方向相关资料待整理。',
      kind: 'page',
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki', kind: 'vault-index' },
    },
    {
      id: 'raw-specific',
      name: '工具书.md',
      content: '冷启动期间不要频繁换方向。',
      kind: 'raw',
      metadata: { vaultFolder: 'raw', folderPath: 'raw/转换后的MD' },
    },
  ])
  const pack = buildVaultContextPack(plan, { maxWikiItems: 2, maxRawItems: 1, perItemChars: 80 })

  assert.match(pack, /知识库索引/)
  assert.match(pack, /频繁换方向/)
})

test('buildVaultRetrievalPlan does not let unrelated wiki pages suppress raw fallback', () => {
  const plan = buildVaultRetrievalPlan('频繁换方向', [
    {
      id: 'wiki-unrelated',
      name: '人物设定.md',
      content: '女主角是律师。',
      kind: 'page',
      updatedAt: Date.now(),
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/角色' },
    },
    {
      id: 'raw-specific',
      name: '工具书.md',
      content: '冷启动期间不要频繁换方向。',
      kind: 'raw',
      metadata: { vaultFolder: 'raw', folderPath: 'raw/转换后的MD' },
    },
  ])
  const pack = buildVaultContextPack(plan, { maxWikiItems: 2, maxRawItems: 1, perItemChars: 80 })

  assert.equal(plan.wikiHits.length, 0)
  assert.equal(plan.rawFallback[0].id, 'raw-specific')
  assert.match(pack, /频繁换方向/)
})

test('buildVaultContextPack keeps raw when raw is much more specific than weak wiki hit', () => {
  const plan = buildVaultRetrievalPlan('频繁换方向怎么办', [
    {
      id: 'wiki-weak',
      name: 'FAQ.md',
      content: '常见问题：遇到问题怎么办。',
      kind: 'page',
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/FAQ' },
    },
    {
      id: 'raw-specific',
      name: '工具书.md',
      content: '冷启动期间不要频繁换方向，先连续发布同一领域内容。',
      kind: 'raw',
      metadata: { vaultFolder: 'raw', folderPath: 'raw/转换后的MD' },
    },
  ])
  const pack = buildVaultContextPack(plan, { maxWikiItems: 2, maxRawItems: 1, perItemChars: 80 })

  assert.match(pack, /频繁换方向/)
})

test('buildVaultContextPack respects total context budget', () => {
  const manyFiles = [
    ...files,
    {
      id: 'wiki2',
      name: '冷启动复盘.md',
      content: '复盘内容'.repeat(200),
      kind: 'page',
      updatedAt: 30,
      metadata: { vaultFolder: 'wiki', folderPath: 'wiki/操作流程' },
    },
  ]
  const plan = buildVaultRetrievalPlan('冷启动复盘怎么做', manyFiles)
  const pack = buildVaultContextPack(plan, {
    maxWikiItems: 3,
    maxRawItems: 2,
    perItemChars: 200,
    maxTotalChars: 260,
  })

  assert.ok(pack.length <= 260)
  assert.match(pack, /\[Wiki 命中\]/)
  assert.match(pack, /\[Raw 兜底\]/)
})

test('buildWikiWritebackCandidates creates candidate for substantial output', () => {
  const candidates = buildWikiWritebackCandidates({
    userText: '总结冷启动方法',
    assistantText: '## 冷启动方法\n' + '持续同领域发布，观察数据，逐步复盘。'.repeat(20),
    preferredPath: 'wiki/操作流程',
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].targetPath, 'wiki/操作流程')
  assert.match(candidates[0].content, /冷启动方法/)
})
