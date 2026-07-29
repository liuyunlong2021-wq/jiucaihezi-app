import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findWikiBacklinks, parseWikiLinks, renderWikiLinks, resolveWikiLinkTarget } from '../markdownLinks'
import type { ProjectResource } from '@/utils/projectResource'

function resource(path: string): ProjectResource {
  return { runtime: 'web', owner: 'project', path, name: path.split('/').at(-1) || path, kind: 'document', isDirectory: false }
}

test('wiki links preserve target and display label while becoming safe in-page anchors', () => {
  assert.deepEqual(parseWikiLinks('见 [[角色/王小二|王小二]] 和 [[wiki/场景]]'), [
    { target: '角色/王小二', label: '王小二' },
    { target: 'wiki/场景', label: 'wiki/场景' },
  ])
  assert.match(renderWikiLinks('[[角色/王小二|王小二]]'), /\]\(#jc-file=%E8%A7%92%E8%89%B2%2F%E7%8E%8B%E5%B0%8F%E4%BA%8C\)/)
})

test('wiki links resolve relative, root and unique short file names', () => {
  const files = [resource('wiki/角色/王小二.md'), resource('第001集/剧本.md'), resource('wiki/场景.md')]
  assert.equal(resolveWikiLinkTarget('王小二', 'wiki/角色/关系.md', files)?.path, 'wiki/角色/王小二.md')
  assert.equal(resolveWikiLinkTarget('wiki/场景', '第001集/剧本.md', files)?.path, 'wiki/场景.md')
  assert.equal(resolveWikiLinkTarget('剧本', 'wiki/角色/关系.md', files)?.path, '第001集/剧本.md')
})

test('backlinks scan current Markdown sources without an index store', () => {
  const target = resource('角色/王小二.md')
  const sources = [
    { resource: resource('第001集/剧本.md'), content: '[[角色/王小二]]' },
    { resource: resource('第002集/剧本.md'), content: '没有链接' },
  ]
  assert.deepEqual(findWikiBacklinks(target, sources).map(item => item.path), ['第001集/剧本.md'])
})
