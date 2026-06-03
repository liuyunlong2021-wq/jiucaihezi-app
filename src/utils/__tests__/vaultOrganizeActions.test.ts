import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  attachMissingWikiActionTrace,
  buildLocalWikiActions,
  detectWikiMergeConflicts,
  mergeExistingWikiPageContent,
  mergeWikiActionTraceMetadata,
} from '../vaultOrganizeActions'

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
  assert.match(result.actions[0].content || '', /pageType: style/)
  assert.match(result.actions[0].content || '', /sourceChunks:/)
  assert.ok(result.actions.every(action => Array.isArray(action.sourceChunkIds) && action.sourceChunkIds.length > 0))
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

test('mergeExistingWikiPageContent appends organize updates without overwriting existing wiki facts', () => {
  const merged = mergeExistingWikiPageContent({
    existingContent: '# 角色A\n\n## 关键事实\n- 已有事实',
    incomingContent: '# 角色A\n\n## 关键事实\n- 新事实',
    now: 1780000000000,
  })

  assert.match(merged, /已有事实/)
  assert.match(merged, /新事实/)
  assert.match(merged, /## 整理补充/)
  assert.ok(merged.indexOf('已有事实') < merged.indexOf('新事实'))
})

test('mergeWikiActionTraceMetadata keeps source paths and source chunk ids deduped', () => {
  const metadata = mergeWikiActionTraceMetadata({
    existingMetadata: {
      sources: ['raw/转换后的MD/a.md#一'],
      sourceChunks: ['chunk_a'],
      rawId: 'raw_a',
    },
    action: {
      type: 'create',
      path: 'wiki/章节索引/一.md',
      sources: ['raw/转换后的MD/a.md#一', 'raw/转换后的MD/b.md#二'],
      sourceChunkIds: ['chunk_a', 'chunk_b'],
      rawId: 'raw_b',
    },
  })

  assert.deepEqual(metadata.sources, ['raw/转换后的MD/a.md#一', 'raw/转换后的MD/b.md#二'])
  assert.deepEqual(metadata.sourceChunks, ['chunk_a', 'chunk_b'])
  assert.equal(metadata.rawId, 'raw_b')
})

test('attachMissingWikiActionTrace hydrates LLM wiki actions from local chunk-aware references', () => {
  const reference = buildLocalWikiActions({
    rawFiles: [{
      id: 'raw_50',
      name: '第050章.md',
      content: '# 第50章 山洞里的饼干\n男主和女主分吃了一块饼干。',
      metadata: { folderPath: 'raw/转换后的MD', kind: 'converted-markdown' },
    }],
    wikiFolders: ['章节索引'],
  }).actions[0]

  const hydrated = attachMissingWikiActionTrace({
    actions: [{
      type: 'create',
      path: 'wiki/章节索引/第50章 山洞里的饼干.md',
      content: '# 第50章 山洞里的饼干\n\n## 摘要\n山洞饼干事件。',
      sources: reference.sources,
    }],
    referenceActions: [reference],
  })

  assert.equal(hydrated[0].rawId, 'raw_50')
  assert.equal(hydrated[0].chunkHash, reference.chunkHash)
  assert.deepEqual(hydrated[0].sourceChunkIds, reference.sourceChunkIds)
})

test('detectWikiMergeConflicts reports current-state conflicts without blocking ordinary additions', () => {
  const conflicts = detectWikiMergeConflicts({
    path: 'wiki/人物/男主.md',
    existingContent: '# 男主\n\n## 当前状态\n- 和女主冷战\n\n## 关键事实\n- 性格克制',
    incomingContent: '# 男主\n\n## 当前状态\n- 和女主和好\n\n## 关键事实\n- 喜欢薄荷糖',
    sources: ['raw/转换后的MD/第101章.md#和好'],
  })
  const ordinary = detectWikiMergeConflicts({
    path: 'wiki/人物/男主.md',
    existingContent: '# 男主\n\n## 关键事实\n- 性格克制',
    incomingContent: '# 男主\n\n## 关键事实\n- 喜欢薄荷糖',
    sources: ['raw/转换后的MD/第101章.md#补充'],
  })

  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].path, 'wiki/人物/男主.md')
  assert.match(conflicts[0].description, /当前状态/)
  assert.deepEqual(conflicts[0].sources, ['raw/转换后的MD/第101章.md#和好'])
  assert.equal(ordinary.length, 0)
})
