import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectFileService } from '@/services/projectFileService'
import { saveWikiArtifact, chooseProjectWikiRoot } from '../wikiArtifacts'

function fixture(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  let failIndex = false
  let conflict = false
  const files = createProjectFileService({
    runtime: 'web',
    async list() { return [...data].map(([path, content]) => ({ path, content, isDirectory: false })) },
    async readText(_owner, path) {
      if (!data.has(path)) throw new Error('missing')
      const content = data.get(path)!
      return { content, size: content.length, truncated: false, revision: { value: content, size: content.length } }
    },
    async createFolder(_owner, path) { return { path, isDirectory: true } },
    async createText(_owner, path, content) {
      if (failIndex && path.endsWith('/index.md')) throw new Error('index unavailable')
      if (data.has(path)) throw new Error('exists')
      data.set(path, content)
      return { path, content, isDirectory: false }
    },
    async writeText(_owner, path, content, expected) {
      if (conflict || data.get(path) !== expected.value) return { status: 'conflict', current: { content: data.get(path)!, size: 0, truncated: false, revision: expected } }
      data.set(path, content)
      return { status: 'saved', revision: { value: content, size: content.length } }
    },
    async rename() { throw new Error('unused') },
    async remove() { throw new Error('unused') },
  })
  return { data, files, failIndex: (value: boolean) => { failIndex = value }, conflict: () => { conflict = true } }
}

test('typed output creates only required Wiki indexes and retry repairs partial save', async () => {
  const f = fixture()
  f.failIndex(true)
  const args = { artifact_kind: 'character_bio', entity_name: '王刚', content: '# 王刚\n初恋尚未揭晓。' }
  const first = await saveWikiArtifact('p', args, f.files)
  assert.equal(first.status, 'saved_with_warnings')
  assert.equal(f.data.get('wiki/项目资料/人物小传/王刚.md'), '# 王刚\n初恋尚未揭晓。\n')
  f.failIndex(false)
  const second = await saveWikiArtifact('p', args, f.files)
  assert.equal(second.operation, 'unchanged')
  assert.equal(second.status, 'saved')
  assert.match(f.data.get('wiki/项目资料/人物小传/index.md')!, /\[\[王刚\|王刚\]\]/)
  assert.match(f.data.get('wiki/index.md')!, /\[\[项目资料\/index/)
  assert.equal(f.data.has('wiki/剧本/index.md'), false)
})

test('existing content needs an observed version and update never overwrites a conflict', async () => {
  const f = fixture({ 'wiki/index.md': '# Wiki', 'wiki/项目资料/故事梗概.md': '人工正文\n' })
  const args = { artifact_kind: 'story_summary', content: '模型改稿', write_mode: 'update' }
  await assert.rejects(saveWikiArtifact('p', args, f.files), /先读取|版本/)
  const observed = new Map([['wiki/项目资料/故事梗概.md', '人工正文\n']])
  f.conflict()
  await assert.rejects(saveWikiArtifact('p', args, f.files, observed), /冲突|变化/)
  assert.equal(f.data.get('wiki/项目资料/故事梗概.md'), '人工正文\n')
})

test('root selection excludes repository docs and rejects ambiguous or unindexed roots', async () => {
  const repo = fixture({ 'docs/wiki/CLAUDE.md': '# 通用记忆工作台开发文档', 'docs/wiki/index.md': '# Repo' })
  assert.equal(await chooseProjectWikiRoot('p', repo.files), null)
  const dual = fixture({ 'wiki/index.md': '# Wiki', 'docs/wiki/index.md': '# Story' })
  await assert.rejects(chooseProjectWikiRoot('p', dual.files), /多个/)
  const selected = await saveWikiArtifact('p', { artifact_kind: 'story_summary', content: '选择后的梗概', wiki_root: 'docs/wiki' }, dual.files)
  assert.equal(selected.path, 'docs/wiki/项目资料/故事梗概.md')
  assert.equal(dual.data.get('wiki/index.md'), '# Wiki')
  await assert.rejects(saveWikiArtifact('p', { artifact_kind: 'story_summary', content: '越界', wiki_root: '../secret' }, dual.files), /Wiki根/)
  const unindexed = fixture({ 'wiki/王刚.md': '# 王刚' })
  await assert.rejects(saveWikiArtifact('p', { artifact_kind: 'story_summary', content: '梗概' }, unindexed.files), /索引/)
})

test('chapter confirmation requires exact saved draft, preserves source and is idempotent', async () => {
  const f = fixture()
  const args = { work_name: '初恋', chapter_number: 1, chapter_title: '重逢', content: '王刚没有回头。' }
  await saveWikiArtifact('p', { ...args, artifact_kind: 'novel_chapter_draft' }, f.files)
  await assert.rejects(saveWikiArtifact('p', { ...args, artifact_kind: 'novel_chapter_source' }, f.files), /确认/)
  await assert.rejects(saveWikiArtifact('p', { ...args, artifact_kind: 'novel_chapter_source', content: '偷偷改稿', user_confirmed: true }, f.files), /不一致/)
  const confirmed = { ...args, artifact_kind: 'novel_chapter_source', user_confirmed: true }
  await saveWikiArtifact('p', confirmed, f.files)
  const retry = await saveWikiArtifact('p', confirmed, f.files)
  assert.equal(retry.operation, 'unchanged')
  assert.equal(f.data.get('wiki/原始材料/初恋/原文.md')!.match(/# 第001章/g)?.length, 1)
  assert.match(f.data.get('wiki/创作/章节草稿/初恋/第001章.md')!, /SHA-256/)
})

test('invalid type, path injection and empty output cannot write arbitrary files', async () => {
  const f = fixture()
  for (const args of [
    { artifact_kind: '../outside', content: 'x' },
    { artifact_kind: 'story_summary', content: '' },
    { artifact_kind: 'story_summary', content: 'x', path: '.raw/对话记录/x.md' },
  ]) await assert.rejects(saveWikiArtifact('p', args, f.files))
  assert.equal(f.data.size, 0)
})
