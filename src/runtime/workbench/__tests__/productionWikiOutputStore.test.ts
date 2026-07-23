import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createProductionWikiSkeleton,
  readProductionWikiBinding,
  saveProductionWikiBinding,
  listProductionRuns,
  saveProductionMediaTask,
  saveProductionWikiOutput,
} from '../productionWikiOutputStore'

test('successful production output writes its Skill result and run record through project files', async () => {
  const created: Array<{ path: string; content: string }> = []
  await saveProductionWikiOutput({
    list: async () => [],
    createText: async (_owner, path, content) => { created.push({ path, content }); return { path } as any },
    readText: async () => { throw new Error('not used') },
    writeText: async () => ({ status: 'saved' as const, revision: { value: 'x', size: 1 } }),
  }, 'project_1', {
    runId: 'run_1', kind: 'character', content: '{"cards":[]}',
    cards: [{ name: '沈昭', prompt: '黑衣剑客' }, { name: '顾晚', prompt: '红伞少女' }],
    record: { step: 'characters', modelId: 'gpt-5.5', profile: 'production-characters', userText: '设计沈昭', sourcePaths: ['wiki/剧本/第一场.md'] },
  })

  assert.deepEqual(created.map(item => item.path), [
    'wiki/角色/沈昭.md', 'wiki/角色/沈昭.design.json',
    'wiki/角色/顾晚.md', 'wiki/角色/顾晚.design.json',
    'wiki/制作/运行/run_1.json',
  ])
  const record = JSON.parse(created[4].content)
  assert.equal(record.runId, 'run_1')
  assert.equal(record.status, 'succeeded')
  assert.equal(record.result.content, '{"cards":[]}')
  assert.deepEqual(record.input, { userText: '设计沈昭', sourcePaths: ['wiki/剧本/第一场.md'] })
  assert.deepEqual(record.profile, { id: 'production-characters' })
})

test('a Wiki-linked asset writes beside its entity without replacing the source record', async () => {
  const created: Array<{ path: string; content: string }> = []
  await saveProductionWikiOutput({
    list: async () => [],
    createText: async (_owner, path, content) => { created.push({ path, content }); return { path } as any },
    readText: async () => { throw new Error('not used') },
    writeText: async () => ({ status: 'saved' as const, revision: { value: 'x', size: 1 } }),
  }, 'project_1', {
    runId: 'run_linked', kind: 'character', content: '{"cards":[]}',
    cards: [{ name: '林不凡', prompt: '雨夜剑客', sourcePath: 'wiki/角色/林不凡/01-基础信息/基础档案.md' }],
  })

  assert.deepEqual(created.map(item => item.path), [
    'wiki/角色/林不凡/制作-角色提示词.md',
    'wiki/角色/林不凡/制作-角色图.design.json',
    'wiki/制作/运行/run_linked.json',
  ])
})

test('submitted media task is written back to its production run record', async () => {
  let written = ''
  await saveProductionMediaTask({
    list: async () => [{ path: 'wiki/制作/运行/run_1.json' } as any],
    readText: async () => ({ content: JSON.stringify({ result: { mediaTaskIds: [] } }), revision: { value: 'v1', size: 1 } }),
    writeText: async (_resource, content) => {
      written = content
      return { status: 'saved' as const, revision: { value: 'v2', size: 2 } }
    },
  }, 'project_1', 'run_1', 'task_1')

  assert.deepEqual(JSON.parse(written), { status: 'media-submitted', result: { mediaTaskIds: ['task_1'] } })
})

test('project Wiki binding persists only its root, selected scene, and exclusions', async () => {
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

test('production run history is read only from its Wiki run records', async () => {
  const records = await listProductionRuns({
    list: async () => [
      { path: 'wiki/制作/运行/run_1.json' } as any,
      { path: 'wiki/角色/沈昭.md' } as any,
    ],
    readText: async () => ({ content: JSON.stringify({ runId: 'run_1', step: 'characters', status: 'succeeded', modelId: 'gpt-5.5', profile: { id: 'production-characters' }, result: { content: '角色卡' }, createdAt: 1 }), revision: { value: 'v1', size: 1 } }),
  }, 'project_1')

  assert.deepEqual(records, [{ runId: 'run_1', step: 'characters', status: 'succeeded', modelId: 'gpt-5.5', profile: 'production-characters', content: '角色卡', createdAt: 1 }])
})

test('a new production project receives only an empty Wiki skeleton', async () => {
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
    'wiki/制作',
    'wiki/制作/运行',
  ])
})
