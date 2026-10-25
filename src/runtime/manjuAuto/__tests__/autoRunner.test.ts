import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAutoRun, estimateUnitCost, handleCheckpointSaved, runAuto, type AutoRunnerDeps, type RunnerCheckpoint } from '../autoRunner'

type Task = { status: string; localPath?: string; error?: string }

/** 假世界：文字流水线一跑就写出完整进度；生图/视频任务按测试设定完成。 */
function world(options: { episodes?: number[]; imageOk?: boolean; videoOk?: boolean; textFails?: number } = {}) {
  const fs = new Map<string, string>()
  const tasks = new Map<string, Task>()
  const log: string[] = []
  const images: string[] = [], videos: Array<{ images: string[] }> = [], concats: Array<{ videos: string[]; durations: number[]; out: string }> = []
  const checkpoints = new Map<number, RunnerCheckpoint>()
  let reviewCalls = 0
  let approve: 'approved' | 'stopped' = 'approved'
  let stop = false
  const settle = () => {
    for (const [id, task] of tasks) if (task.status === 'pending') {
      const ok = id.startsWith('i') ? options.imageOk !== false : options.videoOk !== false
      tasks.set(id, ok ? { status: 'success', localPath: `/out/${id}.${id.startsWith('i') ? 'png' : 'mp4'}` } : { status: 'failed', error: 'HTTP 500' })
    }
  }
  const files = {
    async readText(path: string) { const t = fs.get(path); if (t === undefined) throw new Error(`missing ${path}`); return t },
    async writeText(path: string, content: string) { fs.set(path, content) },
    async exists(path: string) { return fs.has(path) },
    async getTask(id: string) { return tasks.get(id) },
  }
  const deps: AutoRunnerDeps = {
    wikiRoot: 'wiki',
    async runEpisodeText(episode) {
      log.push(`text:${episode}`)
      if (options.textFails === episode) {
        checkpoints.set(episode, { episode_number: episode, video_model: 'Seedance', stage: 'assets', status: 'blocked', reason: '缺少风格', segments: [] })
        return
      }
      fs.set(`wiki/资产/角色/甲/角色生图格式提示词.md`, '# 甲\n甲的三视图')
      fs.set(`wiki/资产/场景/山门/场景生图提示词.md`, '# 山门\n山门')
      const seg = `wiki/剧本/视频提示词/Seedance/第${episode}集001视频提示词.md`
      fs.set(seg, `第${episode}集。\n@图1：甲\n@图2：山门`)
      const assets = {
        '角色/甲': { kind: 'character' as const, prompt_path: 'wiki/资产/角色/甲/角色生图格式提示词.md', prompt_hash: 'a'.repeat(64) },
        '场景/山门': { kind: 'scene' as const, prompt_path: 'wiki/资产/场景/山门/场景生图提示词.md', prompt_hash: 'b'.repeat(64) },
      }
      // 资产阶段保存时宿主收到事件，提前提交生图
      await handleCheckpointSaved(run, { episode_number: episode, video_model: 'Seedance', stage: 'assets', assets, segments: [] }, deps)
      checkpoints.set(episode, { episode_number: episode, video_model: 'Seedance', stage: 'complete', status: 'completed', assets,
        segments: [{ path: seg, start_seconds: 0, end_seconds: 12.5, refs: ['角色/甲', '场景/山门'] }] })
    },
    async readCheckpoint(episode) { return checkpoints.get(episode) },
    asset: {
      ...files,
      async submitImage(input) { images.push(input.requestId); const id = `i${images.length}`; tasks.set(id, { status: 'pending' }); return id },
      async sleep() { settle() },
    },
    video: {
      ...files,
      async submitVideo(input) { videos.push(input); const id = `v${videos.length}`; tasks.set(id, { status: 'pending' }); return id },
    },
    async concat(list, durations, out) { concats.push({ videos: list, durations, out }) },
    async waitForReview() { reviewCalls += 1; return approve },
    async save(state) { fs.set('wiki/制作流水线/全自动运行.json', JSON.stringify(state)) },
    shouldStop: () => stop,
    async sleep() { log.push('sleep'); settle() },
  }
  const run = createAutoRun({
    episodes: options.episodes ?? [1, 2], videoModel: 'Seedance', imageModelId: 'img', videoModelId: 'vid', ratio: '9:16', review: true,
  })
  return { deps, run, fs, log, images, videos, concats, get reviewCalls() { return reviewCalls }, setApprove(v: typeof approve) { approve = v }, setStop(v: boolean) { stop = v } }
}

test('runs episodes in order, submits assets early, reviews only the first episode, then concatenates each episode', async () => {
  const w = world()
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'done')
  assert.deepEqual(w.log.filter(entry => entry.startsWith('text')), ['text:1', 'text:2'])
  assert.equal(w.images.length, 2, '第 2 集复用第 1 集资产，不重复生图')
  assert.equal(w.reviewCalls, 1, '只有第 1 集审图')
  assert.equal(w.videos.length, 2)
  assert.deepEqual(w.videos[0].images, ['/out/i1.png', '/out/i2.png'])
  assert.deepEqual(w.concats.map(item => item.out), ['wiki/成片/第1集成片.mp4', 'wiki/成片/第2集成片.mp4'])
  assert.deepEqual(w.concats[0].durations, [12.5], '按片段计划时长裁尾')
  assert.equal(result.episodes['2'].phase, 'done')
  assert.equal(result.episodes['2'].output, 'wiki/成片/第2集成片.mp4')
})

test('next episode text starts without waiting for the previous episode videos', async () => {
  const w = world()
  await runAuto(w.run, w.deps)
  const text2 = w.log.indexOf('text:2')
  assert.ok(text2 >= 0)
  assert.ok(w.concats.length === 2)
  // 第 2 集文字开始前没有为视频进入 30 分钟等待
  assert.ok(!w.log.slice(0, text2).includes('sleep'))
})

test('a blocked text pipeline stops the run with its reason', async () => {
  const w = world({ textFails: 1 })
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'blocked')
  assert.equal(result.episodes['1'].phase, 'blocked')
  assert.match(result.episodes['1'].reason!, /缺少风格/)
  assert.equal(w.videos.length, 0)
})

test('asset generation failure blocks the run before any video is submitted', async () => {
  const w = world({ imageOk: false })
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'blocked')
  assert.match(result.episodes['1'].reason!, /资产/)
  assert.equal(w.videos.length, 0)
  assert.equal(w.images.length, 6, '每个资产首提 + 重试 2 次')
})

test('stopping at the review pause leaves the run resumable from the same episode', async () => {
  const w = world()
  w.setApprove('stopped')
  const stopped = await runAuto(w.run, w.deps)
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.episodes['1'].phase, 'review')
  w.setApprove('approved')
  const resumed = await runAuto(stopped, w.deps)
  assert.equal(resumed.status, 'done')
  assert.deepEqual(w.log.filter(entry => entry.startsWith('text')), ['text:1', 'text:2'], '续做不重跑已完成的文字流水线')
  assert.equal(w.images.length, 2)
})

test('failed episode videos mark only that episode blocked; the run still finishes others', async () => {
  const w = world({ videoOk: false })
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'blocked')
  assert.equal(result.episodes['1'].phase, 'blocked')
  assert.equal(result.episodes['2'].phase, 'blocked')
  assert.match(result.episodes['1'].reason!, /视频/)
  assert.equal(w.videos.length, 4, '每段重试 1 次')
  assert.equal(w.concats.length, 0)
})

test('per-episode budget blocks before spending when the estimate exceeds the cap', async () => {
  const w = world()
  w.run.config.budgetPerEpisode = 1
  w.run.config.imagePrice = 0.5
  w.run.config.videoPrice = '0.2/秒'
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'blocked')
  assert.match(result.episodes['1'].reason!, /预算/)
  assert.equal(w.images.length, 2, '资产 2×0.5=1 未超预算，照常提交')
  assert.equal(w.videos.length, 0, '加上视频 13 秒×0.2 超过预算 1，不提交视频')
})

test('unit cost parsing covers per-item, per-second and unknown prices', () => {
  assert.equal(estimateUnitCost(0.04), 0.04)
  assert.equal(estimateUnitCost('1.2/条'), 1.2)
  assert.equal(estimateUnitCost('0.2/秒', 15), 3)
  assert.equal(estimateUnitCost('8/张'), 8)
  assert.equal(estimateUnitCost(undefined), undefined)
  assert.equal(estimateUnitCost('按量计费'), undefined)
})
