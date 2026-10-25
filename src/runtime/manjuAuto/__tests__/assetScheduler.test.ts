import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSET_REGISTRY_PATH,
  awaitAsset,
  awaitEpisodeAssets,
  lockAssets,
  regenerateAsset,
  submitEpisodeAssets,
  type AssetSchedulerDeps,
  type EpisodeCheckpoint,
} from '../assetScheduler'

type FakeTask = { status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'; localPath?: string; error?: string }

function fakeDeps(files: Record<string, string> = {}) {
  const fs = new Map(Object.entries(files))
  const tasks = new Map<string, FakeTask>()
  const submits: Array<{ requestId: string; prompt: string; kind: string; images?: string[] }> = []
  const deps: AssetSchedulerDeps = {
    async readText(path) {
      const text = fs.get(path)
      if (text === undefined) throw new Error(`missing ${path}`)
      return text
    },
    async writeText(path, content) { fs.set(path, content) },
    async exists(path) { return fs.has(path) },
    async submitImage(input) {
      submits.push(input)
      const id = `t${submits.length}`
      tasks.set(id, { status: 'pending' })
      return id
    },
    async getTask(taskId) { return tasks.get(taskId) },
    async sleep() {},
  }
  return { deps, fs, tasks, submits }
}

const wiki = 'wiki'
const checkpoint = (episode = 1, hash = 'a'.repeat(64)): EpisodeCheckpoint => ({
  episode_number: episode,
  assets: {
    '角色/莫甘娜': { kind: 'character', prompt_path: 'wiki/资产/角色/莫甘娜/角色生图格式提示词.md', prompt_hash: hash },
    '场景/石道': { kind: 'scene', prompt_path: 'wiki/资产/场景/石道/场景生图提示词.md', prompt_hash: 'b'.repeat(64) },
  },
})
const prompts = {
  'wiki/资产/角色/莫甘娜/角色生图格式提示词.md': '# 莫甘娜角色生图格式提示词\n\n9:16 三格人物设定图，银发金瞳。',
  'wiki/资产/场景/石道/场景生图提示词.md': '# 石道\n青灰石道，右侧石壁。',
}
const registry = (fs: Map<string, string>) => JSON.parse(fs.get(`${wiki}/${ASSET_REGISTRY_PATH}`)!).assets

test('submits each registered asset once without waiting, using the prompt body', async () => {
  const { deps, fs, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  assert.equal(submits.length, 2)
  assert.equal(submits[0].prompt, '9:16 三格人物设定图，银发金瞳。', '去掉 Markdown 标题，只提交提示词正文')
  assert.equal(submits[0].kind, 'character')
  const saved = registry(fs)
  assert.equal(saved['角色/莫甘娜'].status, 'pending')
  assert.equal(saved['角色/莫甘娜'].task_id, 't1')
  assert.equal(saved['角色/莫甘娜'].attempts, 1)
})

test('persisted registry prevents re-submitting after restart and reuses assets across episodes', async () => {
  const { deps, fs, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(1), deps)
  // 模拟重启：只保留磁盘文件，新建依赖
  const restarted = fakeDeps(Object.fromEntries(fs))
  await submitEpisodeAssets(wiki, checkpoint(1), restarted.deps)
  await submitEpisodeAssets(wiki, checkpoint(2), restarted.deps)
  assert.equal(submits.length, 2)
  assert.equal(restarted.submits.length, 0)
})

test('changed prompt hash resubmits, but locked assets are never regenerated', async () => {
  const { deps, fs, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(1), deps)
  await submitEpisodeAssets(wiki, checkpoint(2, 'c'.repeat(64)), deps)
  assert.equal(submits.length, 3)
  assert.equal(registry(fs)['角色/莫甘娜'].attempts, 1, '新版本提示词重新计数')
  await lockAssets(wiki, ['角色/莫甘娜'], deps)
  await submitEpisodeAssets(wiki, checkpoint(3, 'd'.repeat(64)), deps)
  assert.equal(submits.length, 3)
  assert.equal(registry(fs)['角色/莫甘娜'].status, 'locked')
})

test('gate marks finished images ready, retries failures up to two times, and reports the rest', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/莫甘娜.png' })
  tasks.set('t2', { status: 'failed', error: 'HTTP 502' })
  let polls = 0
  deps.sleep = async () => {
    polls += 1
    for (const [id, task] of tasks) if (id !== 't1' && task.status === 'pending') tasks.set(id, { status: 'failed', error: 'HTTP 502' })
  }
  const result = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 60_000, pollMs: 1 })
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.failed, ['场景/石道'])
  assert.equal(submits.length, 4, '首提 2 + 石道重试 2 次')
  const saved = registry(fs)
  assert.equal(saved['角色/莫甘娜'].status, 'ready')
  assert.equal(saved['角色/莫甘娜'].image_path, '/p/莫甘娜.png')
  assert.equal(saved['场景/石道'].status, 'failed')
  assert.equal(saved['场景/石道'].attempts, 3)
  assert.ok(polls > 0)
})

test('moderation failures are not retried', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/a.png' })
  tasks.set('t2', { status: 'failed', error: '内容审核未通过：涉及敏感内容' })
  const result = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 60_000, pollMs: 1 })
  assert.equal(result.status, 'failed')
  assert.equal(submits.length, 2)
  assert.match(registry(fs)['场景/石道'].error, /审核/)
})

test('success without a downloaded file keeps waiting; timeout reports pending assets', async () => {
  const { deps, tasks } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success' })
  let clock = 0
  deps.now = () => clock
  deps.sleep = async ms => { clock += ms }
  const result = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 100, pollMs: 10 })
  assert.equal(result.status, 'timeout')
  assert.deepEqual(result.pending.sort(), ['场景/石道', '角色/莫甘娜'])
})

test('review gate pauses once all images are ready until they are locked', async () => {
  const { deps, tasks } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/a.png' })
  tasks.set('t2', { status: 'success', localPath: '/p/b.png' })
  const paused = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1, review: true })
  assert.equal(paused.status, 'awaiting_review')
  assert.deepEqual(paused.review.sort(), ['场景/石道', '角色/莫甘娜'])
  await lockAssets(wiki, paused.review, deps)
  const ready = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1, review: true })
  assert.equal(ready.status, 'ready')
  assert.deepEqual(ready.images, { '角色/莫甘娜': '/p/a.png', '场景/石道': '/p/b.png' })
})

test('a lost task (not found after restart) is resubmitted as a retry', async () => {
  const { deps, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.clear()
  deps.sleep = async () => { for (const id of tasks.keys()) tasks.set(id, { status: 'success', localPath: `/p/${id}.png` }) }
  const result = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1 })
  assert.equal(result.status, 'ready')
  assert.equal(submits.length, 4)
})

test('assets that finally failed get a fresh retry series on the next run (e.g. after switching image model)', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/a.png' })
  tasks.set('t2', { status: 'failed', error: '内容审核未通过' })
  assert.equal((await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1 })).status, 'failed')
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  assert.equal(submits.length, 3, '只重提失败的石道，已就绪的不动')
  assert.equal(registry(fs)['场景/石道'].status, 'pending')
  assert.equal(registry(fs)['场景/石道'].attempts, 1)
})

test('rate-limited failures wait and resubmit without using up attempts, each with a fresh requestId', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/a.png' })
  tasks.set('t2', { status: 'failed', error: '请求过于频繁，请稍后再试' })
  let clock = 0, limited = 4
  deps.now = () => clock
  deps.sleep = async ms => {
    clock += ms
    for (const [id, task] of tasks) if (id !== 't1' && task.status === 'pending')
      tasks.set(id, limited-- > 0 ? { status: 'failed', error: 'HTTP 429 Too Many Requests' } : { status: 'success', localPath: `/p/${id}.png` })
  }
  const result = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 30 * 60_000, pollMs: 30_000 })
  assert.equal(result.status, 'ready')
  assert.equal(registry(fs)['场景/石道'].attempts, 1, '限流不计入失败次数')
  const ids = submits.map(item => item.requestId)
  assert.equal(new Set(ids).size, ids.length, '每次提交 requestId 都不同')
})

test('retrying a finally-failed asset on a later run never reuses an earlier requestId', async () => {
  const { deps, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/a.png' })
  tasks.set('t2', { status: 'failed', error: '内容审核未通过' })
  await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1 })
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  const ids = submits.map(item => item.requestId)
  assert.equal(new Set(ids).size, ids.length)
})

test('interrupted tasks (nobody tracking them after an app restart) resubmit immediately without using attempts', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'interrupted' })
  tasks.set('t2', { status: 'success', localPath: '/p/b.png' })
  deps.sleep = async () => { tasks.set('t3', { status: 'success', localPath: '/p/a.png' }) }
  const result = await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1 })
  assert.equal(result.status, 'ready')
  assert.equal(submits.length, 3)
  assert.equal(registry(fs)['角色/莫甘娜'].attempts, 1)
})

test('regenerating one asset during review resubmits only that asset, with a fresh requestId and optional new prompt hash', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/a.png' })
  tasks.set('t2', { status: 'success', localPath: '/p/b.png' })
  assert.equal((await awaitEpisodeAssets(wiki, checkpoint(), deps, { timeoutMs: 1000, pollMs: 1, review: true })).status, 'awaiting_review')
  fs.set('wiki/资产/场景/石道/场景生图提示词.md', '# 石道\n青灰石道，左侧加一株老松。')
  await regenerateAsset(wiki, '场景/石道', deps, 'e'.repeat(64))
  assert.equal(submits.length, 3)
  assert.equal(submits[2].prompt, '青灰石道，左侧加一株老松。')
  assert.notEqual(submits[2].requestId, submits[1].requestId)
  const entry = registry(fs)['场景/石道']
  assert.equal(entry.status, 'pending')
  assert.equal(entry.prompt_hash, 'e'.repeat(64))
  assert.equal(entry.image_path, undefined)
  assert.equal(registry(fs)['角色/莫甘娜'].status, 'ready', '其他图不动')
  tasks.set('t3', { status: 'success', localPath: '/p/b2.png' })
  const one = await awaitAsset(wiki, '场景/石道', deps, { timeoutMs: 1000, pollMs: 1 })
  assert.equal(one, '/p/b2.png')
})

test('regenerating a locked asset is refused so approved images stay stable', async () => {
  const { deps } = fakeDeps(prompts)
  await submitEpisodeAssets(wiki, checkpoint(), deps)
  await lockAssets(wiki, ['角色/莫甘娜'], deps)
  await assert.rejects(regenerateAsset(wiki, '角色/莫甘娜', deps), /已锁定/)
})

const lookPrompts = {
  'wiki/资产/角色/顾云舟/角色生图格式提示词.md': '# 顾云舟\n三格',
  'wiki/资产/角色/顾云舟·帝王/服装生图提示词.md': '# 帝王服\n龙袍',
  'wiki/资产/角色/顾云舟·帝王/角色造型融合提示词.md': '# 融合\n以参考图1为人物身份，换上参考图2的服装，三格人物设定图。',
}
const lookCheckpoint = (): EpisodeCheckpoint => ({
  episode_number: 12,
  assets: {
    '角色/顾云舟': { kind: 'character', prompt_path: 'wiki/资产/角色/顾云舟/角色生图格式提示词.md', prompt_hash: '1'.repeat(64) },
    '服装/顾云舟·帝王': { kind: 'costume', prompt_path: 'wiki/资产/角色/顾云舟·帝王/服装生图提示词.md', prompt_hash: '2'.repeat(64) },
    '角色/顾云舟·帝王': { kind: 'look', prompt_path: 'wiki/资产/角色/顾云舟·帝王/角色造型融合提示词.md', prompt_hash: '3'.repeat(64), base: '角色/顾云舟', costume: '服装/顾云舟·帝王' },
  },
})

test('a costume look waits for its identity and costume images, then fuses them in order [identity, costume]', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(lookPrompts)
  await submitEpisodeAssets(wiki, lookCheckpoint(), deps)
  assert.equal(submits.length, 2, '先只提交身份图与服装图')
  assert.equal(registry(fs)['角色/顾云舟·帝王'].status, 'waiting')
  deps.sleep = async () => {
    for (const [id, task] of tasks) if (task.status === 'pending') tasks.set(id, { status: 'success', localPath: `/p/${id}.png` })
  }
  const result = await awaitEpisodeAssets(wiki, lookCheckpoint(), deps, { timeoutMs: 60_000, pollMs: 1 })
  assert.equal(result.status, 'ready')
  const fusion = submits.find(item => item.requestId.startsWith('manju:角色/顾云舟·帝王'))!
  assert.deepEqual(fusion.images, ['/p/t1.png', '/p/t2.png'])
  assert.equal(fusion.prompt, '以参考图1为人物身份，换上参考图2的服装，三格人物设定图。')
  assert.equal(result.images['角色/顾云舟·帝王'], '/p/t3.png')
})

test('a look fails with a clear reason when its costume image finally fails', async () => {
  const { deps, tasks } = fakeDeps(lookPrompts)
  await submitEpisodeAssets(wiki, lookCheckpoint(), deps)
  tasks.set('t1', { status: 'success', localPath: '/p/base.png' })
  tasks.set('t2', { status: 'failed', error: '内容审核未通过' })
  const result = await awaitEpisodeAssets(wiki, lookCheckpoint(), deps, { timeoutMs: 1000, pollMs: 1 })
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.failed.sort(), ['服装/顾云舟·帝王', '角色/顾云舟·帝王'])
})

test('regenerating a costume during review also redoes the looks built from it', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(lookPrompts)
  await submitEpisodeAssets(wiki, lookCheckpoint(), deps)
  deps.sleep = async () => { for (const [id, task] of tasks) if (task.status === 'pending') tasks.set(id, { status: 'success', localPath: `/p/${id}.png` }) }
  await awaitEpisodeAssets(wiki, lookCheckpoint(), deps, { timeoutMs: 60_000, pollMs: 1 })
  const dependents = await regenerateAsset(wiki, '服装/顾云舟·帝王', deps)
  assert.deepEqual(dependents, ['角色/顾云舟·帝王'])
  assert.equal(registry(fs)['角色/顾云舟·帝王'].status, 'waiting')
  await awaitAsset(wiki, '服装/顾云舟·帝王', deps, { timeoutMs: 60_000, pollMs: 1 })
  const look = await awaitAsset(wiki, '角色/顾云舟·帝王', deps, { timeoutMs: 60_000, pollMs: 1 })
  const fusions = submits.filter(item => item.requestId.startsWith('manju:角色/顾云舟·帝王'))
  assert.equal(fusions.length, 2)
  assert.deepEqual(fusions[1].images, ['/p/t1.png', '/p/t4.png'], '用新服装图重新融合')
  assert.equal(look, '/p/t5.png')
})
