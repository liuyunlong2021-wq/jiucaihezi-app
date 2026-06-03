import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultChunks } from '../vaultChunking'

test('buildVaultChunks splits markdown by headings and keeps source anchors', () => {
  const chunks = buildVaultChunks({
    vaultId: 'vault_novel',
    rawFiles: [{
      id: 'raw_50',
      name: '第050章.md',
      content: [
        '# 第50章 山洞里的饼干',
        '男主和女主躲进小山洞。',
        '',
        '## 饼干',
        '他们分吃了一块饼干，这成为后续感情线的重要回忆。',
        '',
        '## 离开山洞',
        '天亮后两人离开。',
      ].join('\n'),
      metadata: {
        folderPath: 'raw/转换后的MD',
      },
    }],
  })

  assert.equal(chunks.length, 3)
  assert.equal(chunks[0].vaultId, 'vault_novel')
  assert.equal(chunks[0].rawId, 'raw_50')
  assert.equal(chunks[0].sourcePath, 'raw/转换后的MD/第050章.md')
  assert.equal(chunks[0].title, '第50章 山洞里的饼干')
  assert.deepEqual(chunks[1].headingPath, ['第50章 山洞里的饼干', '饼干'])
  assert.equal(chunks[1].anchor, '#饼干')
  assert.match(chunks[1].text, /分吃了一块饼干/)
  assert.equal(chunks[0].metadata.chapterNumber, 50)
  assert.equal(typeof chunks[0].chunkHash, 'string')
  assert.ok(chunks[0].id.includes('raw_50'))
})

test('buildVaultChunks detects legal case metadata from converted markdown', () => {
  const chunks = buildVaultChunks({
    vaultId: 'vault_law',
    rawFiles: [{
      id: 'raw_case',
      name: '故意伤害案材料.md',
      content: [
        '# （2024）京0101刑初123号 故意伤害案',
        '案由：故意伤害罪。',
        '',
        '## 起诉状',
        '本案起诉状采用事实经过、证据、诉讼请求结构。',
      ].join('\n'),
      metadata: {
        folderPath: 'raw/转换后的MD',
      },
    }],
  })

  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].metadata.caseNumber, '（2024）京0101刑初123号')
  assert.equal(chunks[0].metadata.caseCause, '故意伤害罪')
  assert.equal(chunks[1].metadata.documentType, '起诉状')
})
