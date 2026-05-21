import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProgressiveOrganizePlan, buildProgressiveOrganizeReport } from '../vaultProgressiveOrganize'

test('buildProgressiveOrganizePlan creates small candidate updates from raw sections', () => {
  const plan = buildProgressiveOrganizePlan({
    rawFiles: [
      {
        id: 'raw1',
        name: '讨论记录.md',
        content: '## 文风要求\n用户希望语言克制、直接。\n\n## 新角色\n女主角出现，职业是律师。',
        metadata: { originalName: '讨论记录.md' },
      },
    ],
    wikiFolders: ['风格', '角色'],
  })

  assert.equal(plan.rawCount, 1)
  assert.ok(plan.candidates.length >= 2)
  assert.ok(plan.candidates.every(candidate => candidate.status === 'candidate'))
  assert.ok(plan.candidates.some(candidate => candidate.targetPath === 'wiki/风格/文风要求.md'))
  assert.ok(plan.candidates.some(candidate => candidate.targetPath === 'wiki/角色/新角色.md'))
})

test('buildProgressiveOrganizePlan suggests a new folder when no folder matches', () => {
  const plan = buildProgressiveOrganizePlan({
    rawFiles: [
      { id: 'raw1', name: '素材.md', content: '## 道具设定\n出现一把银色钥匙。' },
    ],
    wikiFolders: ['角色'],
  })

  assert.ok(plan.newFolderSuggestions.includes('道具'))
  assert.equal(plan.candidates[0].targetPath, 'wiki/道具/道具设定.md')
})

test('buildProgressiveOrganizePlan skips sections already recorded as organized', () => {
  const first = buildProgressiveOrganizePlan({
    rawFiles: [
      { id: 'raw1', name: '对话.md', content: '## 选题流程\n第一步明确目标用户。第二步连续测试。' },
    ],
    wikiFolders: ['流程'],
  })
  const chunkHash = first.candidates[0].chunkHash

  const second = buildProgressiveOrganizePlan({
    rawFiles: [
      {
        id: 'raw1',
        name: '对话.md',
        content: '## 选题流程\n第一步明确目标用户。第二步连续测试。',
        metadata: { organizedChunkHashes: [chunkHash] },
      },
    ],
    wikiFolders: ['流程'],
  })

  assert.equal(second.candidates.length, 0)
  assert.deepEqual(second.skippedRawIds, ['raw1'])
})

test('buildProgressiveOrganizeReport summarizes candidate status', () => {
  const plan = buildProgressiveOrganizePlan({
    rawFiles: [
      { id: 'raw1', name: '素材.md', content: '## 世界观\n城市被分为上下两层。' },
    ],
    wikiFolders: ['世界观'],
  })
  const report = buildProgressiveOrganizeReport('小说知识库', plan)

  assert.match(report, /# 小说知识库 渐进整理候选报告/)
  assert.match(report, /候选更新：1/)
  assert.match(report, /\[pending\]/)
  assert.match(report, /wiki\/世界观\/世界观.md/)
})
