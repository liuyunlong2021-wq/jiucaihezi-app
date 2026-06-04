import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultEvidencePlan } from '../vaultEvidencePlanner'

test('buildVaultEvidencePlan expands novel relationship queries through wiki structure and source chunks', () => {
  const plan = buildVaultEvidencePlan({
    query: '继续写男主和女主的爱情故事，记得之前的重要回忆',
    wikiFiles: [
      { id: 'w1', path: 'wiki/人物/男主.md', name: '男主.md', content: '男主性格克制。' },
      { id: 'w2', path: 'wiki/人物/女主.md', name: '女主.md', content: '女主是律师。' },
      { id: 'w3', path: 'wiki/关系/男主-女主.md', name: '男主-女主.md', content: '两人感情线里有山洞饼干回忆。' },
      { id: 'w4', path: 'wiki/事件线/感情线.md', name: '感情线.md', content: '第50章山洞分吃饼干。' },
    ],
    chunks: [
      {
        id: 'chunk_50',
        rawId: 'raw_50',
        vaultId: 'vault_novel',
        sourcePath: 'raw/转换后的MD/第050章.md',
        anchor: '#饼干',
        headingPath: ['第50章 山洞', '饼干'],
        title: '饼干',
        text: '男主和女主在小山洞里分吃了一块饼干。',
        chunkHash: 'abc',
        charStart: 0,
        charEnd: 20,
        metadata: { chapterNumber: 50 },
      },
    ],
  })

  assert.equal(plan.intent.kind, 'novel_relationship')
  assert.equal(plan.intent.domain, 'novel')
  assert.deepEqual(plan.selectedWiki.map(item => item.path), [
    'wiki/人物/男主.md',
    'wiki/人物/女主.md',
    'wiki/关系/男主-女主.md',
    'wiki/事件线/感情线.md',
  ])
  assert.deepEqual(plan.selectedChunks.map(item => `${item.sourcePath}${item.anchor}`), [
    'raw/转换后的MD/第050章.md#饼干',
  ])
  assert.match(plan.evidenceText, /\[检索意图\]/)
  assert.match(plan.evidenceText, /男主性格克制/)
  assert.match(plan.evidenceText, /分吃了一块饼干/)
})

test('buildVaultEvidencePlan expands legal similarity queries through case, cause and template pages', () => {
  const plan = buildVaultEvidencePlan({
    query: '有没有和这个故意伤害案类似的案子，后面要参照之前案子写起诉状',
    wikiFiles: [
      { id: 'w1', path: 'wiki/案由/故意伤害.md', name: '故意伤害.md', content: '故意伤害的证据要点。' },
      { id: 'w2', path: 'wiki/案件/（2024）京0101刑初123号.md', name: '（2024）京0101刑初123号.md', content: '相似案件处理结果。' },
      { id: 'w3', path: 'wiki/文书模板/起诉状.md', name: '起诉状.md', content: '起诉状模板。' },
      { id: 'w4', path: 'wiki/办案策略/轻伤二级.md', name: '轻伤二级.md', content: '处理策略。' },
    ],
    chunks: [],
    maxTotalChars: 280,
  })

  assert.equal(plan.intent.kind, 'legal_template_draft')
  assert.equal(plan.intent.domain, 'legal')
  assert.ok(plan.evidenceText.length <= 280)
  assert.deepEqual(plan.selectedWiki.map(item => item.path), [
    'wiki/案由/故意伤害.md',
    'wiki/案件/（2024）京0101刑初123号.md',
    'wiki/文书模板/起诉状.md',
    'wiki/办案策略/轻伤二级.md',
  ])
  assert.match(plan.evidenceText, /起诉状模板/)
  assert.match(plan.evidenceText, /相似案件处理结果/)
})

test('buildVaultEvidencePlan follows selected wiki sourceChunks back to raw evidence', () => {
  const plan = buildVaultEvidencePlan({
    query: '继续写男主和女主的爱情故事',
    wikiFiles: [
      {
        id: 'rel',
        path: 'wiki/关系/男主-女主.md',
        name: '男主-女主.md',
        content: '两人的关系已经进入互相信任阶段。',
        metadata: { sourceChunks: ['chunk_cave'] },
      },
    ],
    chunks: [
      {
        id: 'chunk_cave',
        rawId: 'raw_50',
        vaultId: 'vault_novel',
        sourcePath: 'raw/转换后的MD/第050章.md',
        anchor: '#山洞',
        headingPath: ['第50章 山洞'],
        title: '第50章 山洞',
        text: '她递给他半块干粮，火光照着两个人。',
        chunkHash: 'hash_cave',
        charStart: 0,
        charEnd: 20,
        metadata: {},
      },
      {
        id: 'chunk_unrelated',
        rawId: 'raw_8',
        vaultId: 'vault_novel',
        sourcePath: 'raw/转换后的MD/第008章.md',
        anchor: '#街市',
        headingPath: ['第8章 街市'],
        title: '第8章 街市',
        text: '街市很热闹。',
        chunkHash: 'hash_market',
        charStart: 0,
        charEnd: 6,
        metadata: {},
      },
    ],
  })

  assert.deepEqual(plan.selectedChunks.map(item => item.id), ['chunk_cave'])
  assert.match(plan.evidenceText, /半块干粮/)
})

test('buildVaultEvidencePlan keeps raw source section visible under tight budget', () => {
  const plan = buildVaultEvidencePlan({
    query: '继续写男主和女主的爱情故事，参考当时的原文',
    wikiFiles: [
      {
        id: 'rel',
        path: 'wiki/关系/男主-女主.md',
        name: '男主-女主.md',
        content: '关系页面里有很长很长的摘要。'.repeat(20),
        metadata: { sourceChunks: ['chunk_cave'] },
      },
    ],
    chunks: [
      {
        id: 'chunk_cave',
        rawId: 'raw_50',
        vaultId: 'vault_novel',
        sourcePath: 'raw/转换后的MD/第050章.md',
        anchor: '#山洞',
        headingPath: ['第50章 山洞'],
        title: '第50章 山洞',
        text: '她递给他半块干粮，火光照着两个人。',
        chunkHash: 'hash_cave',
        charStart: 0,
        charEnd: 20,
        metadata: {},
      },
    ],
    maxTotalChars: 360,
  })

  assert.ok(plan.evidenceText.length <= 360)
  assert.match(plan.evidenceText, /\[来源原文片段\]/)
  assert.match(plan.evidenceText, /半块干粮/)
})
