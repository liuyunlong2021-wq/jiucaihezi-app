import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildLocalWikiActions } from '../vaultOrganizeActions'

test('buildLocalWikiActions turns raw sections into formal wiki create actions', () => {
  const result = buildLocalWikiActions({
    rawFiles: [
      {
        id: 'raw1',
        name: '对话记录.md',
        content: '## 文风要求\n语言克制、直接。\n\n## 新角色\n女主角是律师。',
      },
    ],
    wikiFolders: ['风格', '角色'],
  })

  assert.equal(result.rawCount, 1)
  assert.ok(result.actions.some(action => action.path === 'wiki/风格/文风要求.md'))
  assert.ok(result.actions.some(action => action.path === 'wiki/角色/新角色.md'))
  assert.ok(result.actions.every(action => action.type === 'create'))
  assert.ok(result.actions.every(action => action.rawId === 'raw1'))
  assert.ok(result.actions.every(action => typeof action.chunkHash === 'string' && action.chunkHash.length > 0))
  assert.match(result.actions[0].content || '', /pageType: wiki/)
  assert.doesNotMatch(result.actions[0].content || '', /candidate-pending-review/)
})

test('buildLocalWikiActions skips chunks already recorded as organized', () => {
  const first = buildLocalWikiActions({
    rawFiles: [
      {
        id: 'raw1',
        name: '对话记录.md',
        content: '## 文风要求\n语言克制、直接。',
      },
    ],
    wikiFolders: ['风格'],
  })

  const chunkHash = first.actions[0].chunkHash
  const second = buildLocalWikiActions({
    rawFiles: [
      {
        id: 'raw1',
        name: '对话记录.md',
        content: '## 文风要求\n语言克制、直接。',
        metadata: { organizedChunkHashes: [chunkHash] },
      },
    ],
    wikiFolders: ['风格'],
  })

  assert.equal(second.actions.length, 0)
  assert.deepEqual(second.skippedRawIds, ['raw1'])
})
