import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  findMarkdownFileBacklinks,
  parseMarkdownFileLinks,
  renderMarkdownFileLinks,
  resolveMarkdownFileLinkTarget,
} from '../markdownFileLinks'
import type { ProjectResource } from '@/utils/projectResource'

function resource(path: string): ProjectResource {
  return { runtime: 'web', owner: 'project', path, name: path.split('/').at(-1) || path, kind: 'document', isDirectory: false }
}

test('Markdown file links preserve target and label while becoming safe in-page anchors', () => {
  assert.deepEqual(parseMarkdownFileLinks('见 [[角色/王小二|王小二]] 和 [[场景]]'), [
    { target: '角色/王小二', label: '王小二' },
    { target: '场景', label: '场景' },
  ])
  assert.match(renderMarkdownFileLinks('[[角色/王小二|王小二]]'), /\]\(#jc-file=%E8%A7%92%E8%89%B2%2F%E7%8E%8B%E5%B0%8F%E4%BA%8C\)/)
})

test('Markdown file links resolve relative, root and unique short file names', () => {
  const files = [resource('角色/王小二.md'), resource('第001集/剧本.md'), resource('场景.md')]
  assert.equal(resolveMarkdownFileLinkTarget('王小二', '角色/关系.md', files)?.path, '角色/王小二.md')
  assert.equal(resolveMarkdownFileLinkTarget('场景', '第001集/剧本.md', files)?.path, '场景.md')
  assert.equal(resolveMarkdownFileLinkTarget('剧本', '角色/关系.md', files)?.path, '第001集/剧本.md')
})

test('backlinks scan current Markdown sources without a separate index store', () => {
  const target = resource('角色/王小二.md')
  const sources = [
    { resource: resource('第001集/剧本.md'), content: '[[角色/王小二]]' },
    { resource: resource('第002集/剧本.md'), content: '没有链接' },
  ]
  assert.deepEqual(findMarkdownFileBacklinks(target, sources).map(item => item.path), ['第001集/剧本.md'])
})
