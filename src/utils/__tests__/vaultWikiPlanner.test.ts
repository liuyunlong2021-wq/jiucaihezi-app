import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultChunks } from '../vaultChunking'
import { buildVaultWikiPlan } from '../vaultWikiPlanner'

test('buildVaultWikiPlan creates source-traceable wiki actions from chunks', () => {
  const chunks = buildVaultChunks({
    vaultId: 'vault_novel',
    rawFiles: [{
      id: 'raw_50',
      name: '第050章.md',
      content: [
        '# 第50章 山洞里的饼干',
        '男主和女主躲进小山洞，他们分吃了一块饼干。',
        '这件事成为两人感情线的重要回忆。',
      ].join('\n'),
      metadata: {
        folderPath: 'raw/转换后的MD',
        kind: 'converted-markdown',
      },
    }],
  })

  const plan = buildVaultWikiPlan({
    chunks,
    wikiFolders: ['人物', '关系', '事件线', '章节索引'],
  })

  assert.equal(plan.chunkCount, 1)
  assert.equal(plan.actions.length, 1)
  const action = plan.actions[0]
  assert.equal(action.type, 'create')
  assert.equal(action.rawId, 'raw_50')
  assert.equal(action.chunkHash, chunks[0].chunkHash)
  assert.deepEqual(action.sourceChunkIds, [chunks[0].id])
  assert.deepEqual(action.sources, [`raw/转换后的MD/第050章.md${chunks[0].anchor}`])
  assert.match(action.path, /^wiki\/章节索引\//)
  assert.match(action.content || '', /sourceChunks:/)
  assert.match(action.content || '', new RegExp(chunks[0].id))
  assert.match(action.content || '', /raw\/转换后的MD\/第050章.md#第50章-山洞里的饼干/)
  assert.match(action.content || '', /男主和女主躲进小山洞/)
})

test('buildVaultWikiPlan skips chunks already organized by hash', () => {
  const chunks = buildVaultChunks({
    vaultId: 'vault_law',
    rawFiles: [{
      id: 'raw_case',
      name: '故意伤害案.md',
      content: '# （2024）京0101刑初123号 故意伤害案\n案由：故意伤害罪。\n## 起诉状\n事实经过、证据、诉讼请求结构。',
      metadata: {
        folderPath: 'raw/转换后的MD',
        kind: 'converted-markdown',
        organizedChunkHashes: [],
      },
    }],
  })
  const organizedHash = chunks[0].chunkHash
  const skipped = buildVaultWikiPlan({
    chunks: chunks.map(chunk => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        organizedChunkHashes: [organizedHash],
      },
    })),
    wikiFolders: ['案由', '案件', '文书模板'],
  })

  assert.equal(skipped.actions.length, 1)
  assert.equal(skipped.actions[0].chunkHash, chunks[1].chunkHash)
  assert.deepEqual(skipped.skippedRawIds, [])
})

test('buildVaultWikiPlan prefers user custom semantic folders over default domain folders', () => {
  const chunks = buildVaultChunks({
    vaultId: 'vault_custom',
    rawFiles: [{
      id: 'raw_role',
      name: '人物设定.md',
      content: '# 男主\n男主性格克制，和女主有复杂感情。',
      metadata: { folderPath: 'raw/转换后的MD', kind: 'converted-markdown' },
    }],
  })
  const plan = buildVaultWikiPlan({
    chunks,
    wikiFolders: ['角色档案', '感情年表', '人物', '关系'],
  })

  assert.equal(plan.actions[0].path, 'wiki/角色档案/男主.md')
})
