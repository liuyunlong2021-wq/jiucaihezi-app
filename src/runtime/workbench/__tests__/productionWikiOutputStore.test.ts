import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createProductionWikiSkeleton,
  readProductionWikiBinding,
  saveProductionWikiBinding,
  saveProductionWikiOutput,
} from '../productionWikiOutputStore'

test('production output writes only the business Wiki files', async () => {
  const created: Array<{ path: string; content: string }> = []
  await saveProductionWikiOutput({
    list: async () => [],
    createText: async (_owner, path, content) => { created.push({ path, content }); return { path } as any },
    readText: async () => { throw new Error('not used') },
    writeText: async () => ({ status: 'saved' as const, revision: { value: 'x', size: 1 } }),
  }, 'project_1', {
    kind: 'character', content: '{"cards":[]}',
    cards: [{ name: '沈昭', prompt: '黑衣剑客' }, { name: '顾晚', prompt: '红伞少女' }],
  })

  assert.deepEqual(created.map(item => item.path), [
    'wiki/角色/沈昭/制作-角色提示词.md',
    'wiki/角色/顾晚/制作-角色提示词.md',
  ])
  assert.deepEqual(created.map(item => item.content), ['黑衣剑客', '红伞少女'])
})

test('a Wiki-linked asset writes beside its entity without replacing its source', async () => {
  const created: Array<{ path: string; content: string }> = []
  await saveProductionWikiOutput({
    list: async () => [],
    createText: async (_owner, path, content) => { created.push({ path, content }); return { path } as any },
    readText: async () => { throw new Error('not used') },
    writeText: async () => ({ status: 'saved' as const, revision: { value: 'x', size: 1 } }),
  }, 'project_1', {
    kind: 'character', content: '{"cards":[]}',
    cards: [{ name: '林不凡', prompt: '雨夜剑客', sourcePath: 'wiki/角色/林不凡/01-基础信息/基础档案.md' }],
  })

  assert.deepEqual(created.map(item => item.path), ['wiki/角色/林不凡/制作-角色提示词.md'])
})

test('project Wiki binding persists only explicit root, anchor, and exclusions', async () => {
  let written = ''
  await saveProductionWikiBinding({
    list: async () => [],
    createText: async (_owner, _path, content) => { written = content; return {} as any },
    readText: async () => { throw new Error('not used') },
    writeText: async () => ({ status: 'saved' as const, revision: { value: 'x', size: 1 } }),
  }, 'project_1', {
    rootPath: 'wiki', anchorPath: 'wiki/作品/第8集.md', excludedEntityKeys: ['prop:红伞'],
    sources: [{ path: 'wiki/作品/第8集.md', revision: 'v1' }],
  })
  assert.deepEqual(JSON.parse(written), {
    rootPath: 'wiki', anchorPath: 'wiki/作品/第8集.md', excludedEntityKeys: ['prop:红伞'],
    sources: [{ path: 'wiki/作品/第8集.md', revision: 'v1' }],
  })

  const restored = await readProductionWikiBinding({
    list: async () => [{ path: 'wiki/制作/绑定.json' } as any],
    readText: async () => ({ content: written, revision: { value: 'x', size: 1 } }),
  }, 'project_1')
  assert.deepEqual(restored, {
    rootPath: 'wiki', anchorPath: 'wiki/作品/第8集.md', excludedEntityKeys: ['prop:红伞'],
    sources: [{ path: 'wiki/作品/第8集.md', revision: 'v1' }],
  })
})

test('a new production project creates no run-history folders', async () => {
  const created: string[] = []
  await createProductionWikiSkeleton({
    list: async () => [],
    createFolder: async (_owner, path) => {
      created.push(path)
      return { path } as any
    },
  }, 'project_1')

  assert.deepEqual(created, [
    'wiki',
    'wiki/世界观',
    'wiki/角色',
    'wiki/场景',
    'wiki/道具',
    'wiki/分镜',
    'wiki/分镜/视频',
  ])
})
