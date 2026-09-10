import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyWikiLinkSelection,
  completeWikiLink,
  findOpenWikiLink,
  searchWikiLinkCandidates,
} from '../markdownWikiLinkInput'

test('wiki link command wraps a selection and places a blank cursor inside brackets', () => {
  assert.deepEqual(applyWikiLinkSelection('林默', 0, 2), {
    value: '[[林默]]',
    selectionStart: 2,
    selectionEnd: 4,
    query: '林默',
  })
  assert.deepEqual(applyWikiLinkSelection('正文', 2, 2), {
    value: '正文[[]]',
    selectionStart: 4,
    selectionEnd: 4,
    query: '',
  })
})

test('wiki link command reuses an unfinished link instead of nesting brackets', () => {
  assert.deepEqual(findOpenWikiLink('正文 [[lin', 8), { start: 3, end: 8, query: 'lin' })
  assert.deepEqual(applyWikiLinkSelection('正文 [[lin', 8, 8), {
    value: '正文 [[lin',
    selectionStart: 8,
    selectionEnd: 8,
    query: 'lin',
  })
})

test('wiki link candidates support Chinese, pinyin, and full project-relative insertion', () => {
  const resources = [
    { path: 'wiki/资产/角色/林默/角色档案.md', isDirectory: false },
    { path: 'wiki/资产/场景/旧码头/场景档案.md', isDirectory: false },
    { path: '.raw/隐藏.md', isDirectory: false },
  ]
  assert.equal(
    searchWikiLinkCandidates(resources, 'linmo')[0]?.path,
    'wiki/资产/角色/林默/角色档案.md',
  )
  assert.equal(
    searchWikiLinkCandidates(resources, '角色档案')[0]?.target,
    'wiki/资产/角色/林默/角色档案',
  )
  assert.deepEqual(searchWikiLinkCandidates(resources, '隐藏'), [])
  assert.deepEqual(
    completeWikiLink('[[林默]]', 2, searchWikiLinkCandidates(resources, '林默')[0]!, '林默'),
    {
      value: '[[wiki/资产/角色/林默/角色档案|林默]]',
      cursor: 25,
    },
  )
})

test('wiki link picker limits visible results and demotes generic index files', () => {
  const resources = [
    { path: 'wiki/index.md', isDirectory: false },
    { path: 'wiki/资产/角色/index.md', isDirectory: false },
    ...Array.from({ length: 9 }, (_, index) => ({
      path: `wiki/资产/角色/角色${index + 1}.md`,
      isDirectory: false,
    })),
  ]
  const results = searchWikiLinkCandidates(resources, '')
  assert.equal(results.length, 5)
  assert.ok(results.every(item => !item.name.endsWith(' · index')))
  assert.ok(searchWikiLinkCandidates(resources, 'index').some(item => item.name === '角色 · index'))
})
