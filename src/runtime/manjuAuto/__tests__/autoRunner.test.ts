import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adviceSummary, referenceAdvice, scanEpisodeScripts } from '../autoRunner'
import { createAutoRun, deriveCheckpoint, episodeInstruction, episodeTextStatus, estimateUnitCost, handleCheckpointSaved, modelLimits, priceForResolution, resumeAutoRun, revisionInstruction, runAuto, type AutoRunConfig, type AutoRunnerDeps, type RunnerCheckpoint } from '../autoRunner'

type Task = { status: string; localPath?: string; error?: string }

/** 假世界：文字流水线一跑就写出完整进度；生图/视频任务按测试设定完成。 */
function world(options: { episodes?: number[]; imageOk?: boolean; videoOk?: boolean; textFails?: number; newAssetIn?: number; config?: Partial<AutoRunConfig>; refs?: string[][] } = {}) {
  const fs = new Map<string, string>()
  const tasks = new Map<string, Task>()
  const log: string[] = []
  const images: string[] = [], videos: Array<{ images: string[] }> = [], concats: Array<{ videos: string[]; durations: number[]; out: string }> = []
  const checkpoints = new Map<number, RunnerCheckpoint>()
  let reviewCalls = 0
  let approve: 'approved' | 'stopped' = 'approved'
  const cutReviews: Array<{ episode: number; videos: string[] }> = []
  let approveCut: 'approved' | 'stopped' = 'approved'
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
    async runEpisodeText(episode, rewrite) {
      log.push(rewrite ? `text:${episode}:rewrite` : `text:${episode}`)
      if (options.textFails === episode) {
        checkpoints.set(episode, { episode_number: episode, video_model: 'Seedance', stage: 'assets', status: 'blocked', reason: '缺少风格', segments: [] })
        return
      }
      fs.set(`wiki/资产/角色/甲/角色生图格式提示词.md`, '# 甲\n甲的三视图')
      fs.set(`wiki/资产/场景/山门/场景生图提示词.md`, '# 山门\n山门')
      const seg = `wiki/剧本/视频提示词/Seedance/第${episode}集001视频提示词.md`
      fs.set(seg, `第${episode}集。\n@图1：甲\n@图2：山门`)
      const assets: Record<string, { kind: 'character' | 'scene'; prompt_path: string; prompt_hash: string }> = {
        '角色/甲': { kind: 'character' as const, prompt_path: 'wiki/资产/角色/甲/角色生图格式提示词.md', prompt_hash: 'a'.repeat(64) },
        '场景/山门': { kind: 'scene' as const, prompt_path: 'wiki/资产/场景/山门/场景生图提示词.md', prompt_hash: 'b'.repeat(64) },
      }
      if (options.newAssetIn === episode) {
        fs.set('wiki/资产/场景/大殿/场景生图提示词.md', '# 大殿\n大殿')
        assets['场景/大殿'] = { kind: 'scene', prompt_path: 'wiki/资产/场景/大殿/场景生图提示词.md', prompt_hash: 'c'.repeat(64) }
      }
      // refs 按段给出（每段 12.5 秒）：只登记被引用到的资产，全为空即纯文生。
      const refs = options.refs ?? [['角色/甲', '场景/山门']]
      for (const id of Object.keys(assets)) if (options.refs && !refs.flat().includes(id)) delete assets[id]
      // 资产阶段保存时宿主收到事件，提前提交生图
      await handleCheckpointSaved(run, { episode_number: episode, video_model: 'Seedance', stage: 'assets', assets, segments: [] }, deps)
      checkpoints.set(episode, { episode_number: episode, video_model: 'Seedance', stage: 'complete', status: 'completed', assets,
        segments: refs.map((list, i) => {
          const path = seg.replace('001', String(i + 1).padStart(3, '0'))
          if (i) fs.set(path, `第${episode}集第${i + 1}段，纯文生。`)
          return { path, start_seconds: i * 12.5, end_seconds: (i + 1) * 12.5, refs: list }
        }) })
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
    async waitForVideoReview(episode, list) { cutReviews.push({ episode, videos: list }); return approveCut },
    async save(state) { fs.set('wiki/制作流水线/全自动运行.json', JSON.stringify(state)) },
    shouldStop: () => stop,
    async sleep() { log.push('sleep'); settle() },
  }
  const run = createAutoRun({
    episodes: options.episodes ?? [1, 2], videoModel: 'Seedance', imageModelId: 'img', videoModelId: 'vid', ratio: '9:16', review: true, ...options.config,
  })
  return { deps, run, fs, log, checkpoints, images, videos, concats, get reviewCalls() { return reviewCalls }, setApprove(v: typeof approve) { approve = v }, cutReviews, setApproveCut(v: typeof approveCut) { approveCut = v }, setStop(v: boolean) { stop = v } }
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
  assert.equal(estimateUnitCost('6元/次'), 6, '模型目录常写“元”')
  assert.equal(estimateUnitCost('0.2元/秒', 10), 2)
  assert.equal(estimateUnitCost(undefined), undefined)
  assert.equal(estimateUnitCost('按量计费'), undefined)
})

test('resuming after an asset failure retries failed assets and can use a new image model config', async () => {
  const w = world({ imageOk: false })
  const blocked = await runAuto(w.run, w.deps)
  assert.equal(blocked.status, 'blocked')
  const before = w.images.length
  const resumed = resumeAutoRun(blocked, { ...blocked.config, imageModelId: 'img2', episodes: [9] })
  assert.equal(resumed.config.imageModelId, 'img2')
  assert.deepEqual(resumed.config.episodes, [1, 2], '续做保留原集数')
  // 换模型后线路恢复：新提交的都成功
  ;(w.deps.asset as { submitImage: unknown }).submitImage = async (input: { requestId: string }) => { w.images.push(input.requestId); return `ok${w.images.length}` }
  ;(w.deps.asset as { getTask: unknown }).getTask = async (id: string) => id.startsWith('ok') ? { status: 'success', localPath: `/out/${id}.png` } : { status: 'failed', error: 'HTTP 502' }
  ;(w.deps.video as { getTask: unknown }).getTask = async (id: string) => id.startsWith('ok') ? { status: 'success', localPath: `/out/${id}.png` } : { status: 'success', localPath: `/out/${id}.mp4` }
  const done = await runAuto(resumed, w.deps)
  assert.equal(w.images.length - before, 2, '两个失败资产各重提一次')
  assert.equal(done.episodes['1'].phase, 'done')
})

test('tiered prices resolve to the chosen resolution, and ¥ prefixes parse', () => {
  const wan = '480P ¥0.2/秒 · 720P ¥0.4/秒 · 1080P ¥0.5/秒'
  assert.equal(priceForResolution(wan, '480P'), '0.2/秒')
  assert.equal(priceForResolution(wan, '720p'), '0.4/秒')
  assert.equal(priceForResolution('480P ¥11/次 · 720P ¥15/次', '720P'), '15/次')
  assert.equal(priceForResolution('¥0.05/秒', '768P'), undefined, '不分档的价格原样使用')
  assert.equal(estimateUnitCost('¥0.05/秒', 10), 0.5)
  assert.equal(estimateUnitCost(priceForResolution(wan, '480P'), 27), 5.4)
})

test('resuming an episode already in the video phase checks videos immediately, before any 30-minute wait', async () => {
  const w = world()
  w.setApprove('stopped')
  await runAuto(w.run, w.deps) // 停在第 1 集审图
  w.setApprove('approved')
  w.setStop(false)
  const order: string[] = []
  const originalSleep = w.deps.sleep
  w.deps.sleep = async ms => { order.push('sleep'); await originalSleep(ms) }
  const check = w.deps.video.getTask
  w.deps.video.getTask = async id => { order.push('check'); return check(id) }
  w.run.config.episodes = [1]
  delete w.run.episodes['2']
  await runAuto(w.run, w.deps) // 审图通过、视频提交，进入出片中
  // 模拟 App 重启后续做：第 1 集处于 videos 阶段
  order.length = 0
  w.run.status = 'stopped'
  w.run.episodes['1'].phase = 'videos'
  const registryPath = 'wiki/制作流水线/Seedance/第1集视频任务.json'
  const registry = JSON.parse(w.fs.get(registryPath)!)
  for (const segment of registry.segments) segment.status = 'pending'
  w.fs.set(registryPath, JSON.stringify(registry))
  await runAuto(w.run, w.deps)
  assert.equal(order[0], 'check', `续做应先检查视频，实际顺序：${order.join(',')}`)
})

test('resuming retries failed video segments of an episode before checking again', async () => {
  const w = world({ videoOk: false })
  w.run.config.episodes = [1]
  delete w.run.episodes['2']
  const blocked = await runAuto(w.run, w.deps)
  assert.equal(blocked.episodes['1'].phase, 'blocked')
  const before = w.videos.length
  ;(w.deps.video as { getTask: unknown }).getTask = async () => ({ status: 'success', localPath: '/out/v.mp4' })
  const done = await runAuto(blocked, w.deps)
  assert.equal(w.videos.length - before, 1, '失败的那一段重新提交一次')
  assert.equal(done.episodes['1'].phase, 'done')
})

test('model limits come from the chosen video model: fixed tiers use the largest ≤30s, ranges cap at 30s', () => {
  assert.deepEqual(modelLimits('H3', { duration: { min: 1, max: 28 }, maxImages: 6 }), { max_seconds: 28, max_refs: 6 })
  assert.deepEqual(modelLimits('Seedance', { duration: { allowedValues: [15, 30] }, maxImages: 9 }), { max_seconds: 30, max_refs: 9, allowed_seconds: [15, 30] })
  assert.deepEqual(modelLimits('Seedance', { duration: { min: 2, max: 60 } }), { max_seconds: 30 })
  assert.deepEqual(modelLimits('H3', {}), { max_seconds: 30 }, '未知限制时按默认 30 秒（2026-10-26 MiniMax H3 也支持 30 秒）')
})

test('episode instruction names the route and the model limits the pipeline must write into plan', () => {
  const text = episodeInstruction(3, 'wiki', { videoModel: 'H3', limits: { max_seconds: 28, max_refs: 6 } })
  assert.match(text, /【全自动成片·第3集】/)
  assert.match(text, /视频模型 H3/)
  assert.match(text, /每段不超过 28 秒/)
  assert.match(text, /最多 6 张参考图/)
  assert.match(text, /"limits":\{"max_seconds":28,"max_refs":6\}/)
  const tiers = episodeInstruction(1, 'wiki', { videoModel: 'Seedance', limits: { max_seconds: 30, allowed_seconds: [15, 30] } })
  assert.match(tiers, /只支持 15\/30 秒/)
})

test('resuming keeps the original video route even if the card changed it', () => {
  const saved = createAutoRun({ episodes: [1], videoModel: 'H3', imageModelId: 'a', videoModelId: 'b', ratio: '9:16', review: true })
  const resumed = resumeAutoRun(saved, { ...saved.config, videoModel: 'Seedance', videoModelId: 'c' })
  assert.equal(resumed.config.videoModel, 'H3')
  assert.equal(resumed.config.videoModelId, 'c')
})

test('review mode "new" pauses every episode that brings new assets, showing only the new ones', async () => {
  const w = world({ newAssetIn: 2 })
  w.run.config.reviewMode = 'new'
  const reviewed: string[][] = []
  w.deps.waitForReview = async ids => { reviewed.push(ids.slice().sort()); return 'approved' }
  await runAuto(w.run, w.deps)
  assert.deepEqual(reviewed, [['场景/山门', '角色/甲'], ['场景/大殿']])
})

test('review mode "new" skips the pause when an episode has no new assets; "off" never pauses', async () => {
  const w = world()
  w.run.config.reviewMode = 'new'
  let calls = 0
  w.deps.waitForReview = async () => { calls += 1; return 'approved' }
  await runAuto(w.run, w.deps)
  assert.equal(calls, 1)
  const off = world()
  off.run.config.reviewMode = 'off'
  let offCalls = 0
  off.deps.waitForReview = async () => { offCalls += 1; return 'approved' }
  assert.equal((await runAuto(off.run, off.deps)).status, 'done')
  assert.equal(offCalls, 0)
})

test('target "prompts" writes every episode up to complete prompts and never spends on images or videos', async () => {
  const w = world({ config: { target: 'prompts' } })
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'done')
  assert.deepEqual(w.log.filter(entry => entry.startsWith('text')), ['text:1', 'text:2'])
  assert.equal(w.images.length, 0, '资产阶段保存事件也不提交生图')
  assert.equal(w.videos.length, 0)
  assert.equal(w.concats.length, 0)
  assert.equal(result.episodes['1'].phase, 'done')
})

test('episode text status: complete within limits, stale when a segment breaks the chosen model limits, partial, none', () => {
  const checkpoint = (stage: string, seconds: number, refs: number) => ({ episode_number: 1, video_model: 'H3', stage,
    segments: [{ path: 'a.md', start_seconds: 0, end_seconds: seconds, refs: Array.from({ length: refs }, (_, i) => `角色/${i}`) }] })
  assert.deepEqual(episodeTextStatus(undefined, { max_seconds: 28, max_refs: 6 }), { state: 'none' })
  assert.deepEqual(episodeTextStatus(checkpoint('engineering', 0, 0), { max_seconds: 28 }), { state: 'partial', stage: 'engineering' })
  assert.deepEqual(episodeTextStatus(checkpoint('complete', 28, 6), { max_seconds: 28, max_refs: 6 }), { state: 'complete' })
  assert.match(episodeTextStatus(checkpoint('complete', 30, 2), { max_seconds: 15 }).reason!, /30 秒.*15 秒/)
  assert.match(episodeTextStatus(checkpoint('complete', 10, 7), { max_seconds: 28, max_refs: 6 }).reason!, /7 张.*6 张/)
  assert.equal(episodeTextStatus(checkpoint('complete', 30, 2), { max_seconds: 15 }).state, 'stale')
})

test('an episode already complete from free creation skips the text turn; one written for another model is rewritten', async () => {
  const w = world({ episodes: [1, 2], config: { target: 'prompts', limits: { max_seconds: 15 } } })
  w.checkpoints.set(1, { episode_number: 1, video_model: 'Seedance', stage: 'complete', segments: [{ path: 'a.md', start_seconds: 0, end_seconds: 12, refs: [] }] })
  w.checkpoints.set(2, { episode_number: 2, video_model: 'Seedance', stage: 'complete', segments: [{ path: 'b.md', start_seconds: 0, end_seconds: 30, refs: [] }] })
  const result = await runAuto(w.run, w.deps)
  assert.deepEqual(w.log.filter(entry => entry.startsWith('text')), ['text:2:rewrite'])
  assert.equal(result.status, 'done')
})

test('episode instruction for a rewrite tells the pipeline why the old prompts must be redone from plan', () => {
  const text = episodeInstruction(2, 'wiki', { videoModel: 'H3', limits: { max_seconds: 15 } }, '片段1 30 秒，超过所选模型 15 秒')
  assert.match(text, /重新执行/)
  assert.match(text, /片段1 30 秒/)
})

test('a partially written episode resumes from its saved stage instead of re-planning', () => {
  const text = episodeInstruction(1, 'wiki', { videoModel: 'Seedance', limits: { max_seconds: 30 } }, undefined, 'engineering')
  assert.match(text, /已有进度到 engineering 阶段/)
  assert.doesNotMatch(text, /从 plan/)
  assert.match(episodeInstruction(1, 'wiki', { videoModel: 'Seedance' }), /从 plan 连续执行/)
})

test('revision instruction lists the review notes in segment order, whole-episode note first', () => {
  const text = revisionInstruction(2, { videoModel: 'H3', limits: { max_seconds: 30, max_refs: 6 } }, { 3: '打斗太慢', 0: '整体色调偏暗', 1: '  ', 2: '主角不要笑' })
  assert.match(text, /【全自动成片·第2集·审片修改】/)
  assert.match(text, /- 整集：整体色调偏暗\n- 第2段：主角不要笑\n- 第3段：打斗太慢/)
  assert.doesNotMatch(text, /第1段/, '空意见不写')
  assert.match(text, /「审片修改」/)
  assert.match(text, /最多 6 张参考图/)
})

test('a finished H3 episode derives a Seedance checkpoint that keeps materials, assets and the engineering script', () => {
  const h3 = { stage: 'complete', status: 'completed', video_model: 'H3', episode_number: 1, source_path: 's.md', source_hash: 'h',
    files: { plan: {}, materials: { 'm.md': '1' }, style: { 'st.md': '2' }, assets: { 'a.md': '3' }, engineering: { 'e.md': '4' }, prompts: { 'p.md': '5' }, complete: {} },
    assets: { '角色/甲': { kind: 'character' } }, limits: { max_seconds: 30, max_refs: 6 }, duration_seconds: 90, segments: [{ path: 'p.md' }] }
  const derived = deriveCheckpoint(h3, 'Seedance', { max_seconds: 15, max_refs: 9, allowed_seconds: [15] })
  assert.equal(derived.stage, 'engineering')
  assert.equal(derived.status, 'running')
  assert.equal(derived.video_model, 'Seedance')
  assert.deepEqual(Object.keys(derived.files as object), ['plan', 'materials', 'style', 'assets', 'engineering'])
  assert.deepEqual(derived.limits, { max_seconds: 15, max_refs: 9 })
  assert.equal(derived.segments, undefined)
  assert.equal(derived.duration_seconds, 90)
  assert.deepEqual(derived.assets, h3.assets)
  assert.equal(h3.files.prompts['p.md'], '5', '不改动原路线进度')
})

test('stopping while waiting for asset images stops at the next poll instead of after the 30-minute gate', async () => {
  const w = world({ episodes: [1] })
  const sleep = w.deps.asset.sleep
  w.deps.asset.sleep = async ms => { w.setStop(true); await sleep(ms) }
  const result = await runAuto(w.run, w.deps)
  assert.equal(result.status, 'stopped')
  assert.equal(result.episodes['1'].phase, 'assets', '续做时从资产阶段接着等')
  assert.equal(w.videos.length, 0)
})

test('video review pauses each episode after its segments are ready and before concatenation', async () => {
  const w = world({ episodes: [1] })
  const result = await runAuto(w.run, w.deps)
  assert.deepEqual(w.cutReviews, [{ episode: 1, videos: ['/out/v1.mp4'] }])
  assert.equal(w.concats.length, 1)
  assert.equal(result.episodes['1'].phase, 'done')
})

test('stopping at the video review leaves the episode unconcatenated and reviewed again on resume', async () => {
  const w = world({ episodes: [1] })
  w.setApproveCut('stopped')
  const stopped = await runAuto(w.run, w.deps)
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.episodes['1'].phase, 'videos')
  assert.equal(w.concats.length, 0)
  w.setApproveCut('approved')
  const resumed = await runAuto(resumeAutoRun(stopped, stopped.config), w.deps)
  assert.equal(resumed.status, 'done')
  assert.equal(w.cutReviews.length, 2)
  assert.equal(w.videos.length, 1, '续做不重交视频')
})

test('reviewVideos false concatenates without pausing', async () => {
  const w = world({ episodes: [1], config: { reviewVideos: false } })
  await runAuto(w.run, w.deps)
  assert.equal(w.cutReviews.length, 0)
  assert.equal(w.concats.length, 1)
})

test('pure text-to-video: no assets registered, no images generated, every segment submitted without reference images', async () => {
  const w = world({ episodes: [1], refs: [[], []], config: { limits: { max_seconds: 30, max_refs: 0 } } })
  const state = await runAuto(w.run, w.deps)
  assert.equal(state.status, 'done')
  assert.equal(w.images.length, 0)
  assert.equal(w.reviewCalls, 0, '没有资产就不停下审图')
  assert.deepEqual(w.videos.map(video => video.images.length), [0, 0])
  assert.equal(w.concats.length, 1)
})

test('references are per segment: only the segment that needs the asset carries its image', async () => {
  const w = world({ episodes: [1], refs: [['场景/山门'], []] })
  const state = await runAuto(w.run, w.deps)
  assert.equal(state.status, 'done')
  assert.equal(w.images.length, 1, '只为被引用的资产生图')
  assert.deepEqual(w.videos.map(video => video.images.length), [1, 0])
})

test('pure text-to-video limits (max_refs 0) reach plan, mark prompts with images stale, and survive derivation', () => {
  const limits = { max_seconds: 30, max_refs: 0 }
  const text = episodeInstruction(2, 'wiki', { videoModel: 'H3', limits })
  assert.match(text, /"limits":\{"max_seconds":30,"max_refs":0\}/)
  assert.match(text, /纯文生/)
  assert.match(text, /T2VA/)
  const segment = { path: 'p.md', start_seconds: 0, end_seconds: 30, refs: ['场景/木塔'] }
  assert.equal(episodeTextStatus({ stage: 'complete', segments: [segment] }, limits).state, 'stale')
  assert.equal(episodeTextStatus({ stage: 'complete', segments: [{ ...segment, refs: [] }] }, limits).state, 'complete')
  assert.deepEqual(deriveCheckpoint({ stage: 'complete', files: {} }, 'Seedance', limits).limits, limits)
  assert.match(revisionInstruction(2, { videoModel: 'H3', limits }, { 1: '慢一点' }), /纯文生/)
})

test('episode instruction: references are decided per segment, and the user\'s explicit requirements override skill defaults', () => {
  const text = episodeInstruction(1, 'wiki', { videoModel: 'H3', limits: { max_seconds: 30, max_refs: 9 } })
  assert.match(text, /按段/)
  assert.match(text, /优先于 Skill 默认/)
})

const STYLE = '制作路线：旁白宣传片\n判断理由：英文旁白推动\n画面比例：16:9\n参考图方式：按段决定（只有木塔需要跨段一致）\n'
  + '资产名称：木塔\n资产类别：场景\n参考图：需要（6段都出现，外观必须一致）\n'
  + '资产名称：工匠\n资产类别：角色\n参考图：文字带过（群体，不露正脸）\n'
  + '资产名称：墨斗\n资产类别：道具\n参考图：文字带过（一次性出现）\n'

test('project style advice: route, reference mode, and which assets need reference images', () => {
  assert.deepEqual(referenceAdvice(STYLE), { route: '旁白宣传片', mode: 'segment', reason: '只有木塔需要跨段一致', needed: ['木塔'], skipped: ['工匠', '墨斗'] })
  assert.deepEqual(referenceAdvice('制作路线：旁白宣传片\n参考图方式：纯文生（广告不需要一致性）\n资产名称：木塔\n参考图：文字带过（远景）').mode, 'pure')
  assert.deepEqual(referenceAdvice('# 影片比例与风格\n画面比例：9:16'), { needed: [], skipped: [] }, '旧项目风格没有建议')
})

test('advice summary tells the user what will be drawn and roughly what it costs', () => {
  const advice = referenceAdvice(STYLE)
  assert.equal(adviceSummary(advice, '0.2/张'), '旁白宣传片 · 按段决定：1 张参考图（木塔），生图约 ¥0.20；文字带过：工匠、墨斗')
  assert.equal(adviceSummary(advice, '按量计费'), '旁白宣传片 · 按段决定：1 张参考图（木塔）；文字带过：工匠、墨斗')
  assert.equal(adviceSummary(referenceAdvice('制作路线：旁白宣传片\n参考图方式：纯文生（广告）'), 0.2), '旁白宣传片 · 纯文生：不生图')
  assert.equal(adviceSummary(referenceAdvice('画面比例：9:16'), 0.2), undefined)
})

test('manju auto finds short-drama screenplays as episode scripts and prefers the adapted script over the intake script when both exist', () => {
  const only = scanEpisodeScripts(['wiki/剧本/第001集/分集剧本.md', 'wiki/剧本/第002集/分集剧本.md', 'wiki/剧本/index.md'])
  assert.equal(only.wikiRoot, 'wiki')
  assert.deepEqual(only.episodes, [1, 2])
  assert.equal(only.scripts[2], 'wiki/剧本/第002集/分集剧本.md')
  assert.deepEqual(only.duplicates, [])
  const both = scanEpisodeScripts(['docs/wiki/项目资料/分集剧本/第1集分集剧本.md', 'docs/wiki/剧本/第001集/分集剧本.md', 'docs/wiki/剧本/第003集/分集剧本.md'])
  assert.equal(both.wikiRoot, 'docs/wiki')
  assert.deepEqual(both.episodes, [1, 3])
  assert.equal(both.scripts[1], 'docs/wiki/剧本/第001集/分集剧本.md')
  assert.deepEqual(both.duplicates, [1])
})

test('episode instruction uses the actual script path of that episode', () => {
  const text = episodeInstruction(2, 'wiki', { videoModel: 'H3', limits: { max_seconds: 30 } }, undefined, undefined, 'wiki/剧本/第002集/分集剧本.md')
  assert.match(text, /剧本使用 wiki\/剧本\/第002集\/分集剧本\.md/)
  assert.match(episodeInstruction(2, 'wiki', { videoModel: 'H3' }), /剧本使用 wiki\/项目资料\/分集剧本\/第2集分集剧本\.md/)
})

test('漫剧只读工程剧本：同一集有多份稿时以工程剧本为准', () => {
  const scanned = scanEpisodeScripts([
    'docs/wiki/项目资料/分集剧本/第1集分集剧本.md',
    'docs/wiki/剧本/第001集/分集剧本.md',
    'docs/wiki/剧本/工程剧本/第1集工程剧本.md',
  ])
  assert.equal(scanned.scripts[1], 'docs/wiki/剧本/工程剧本/第1集工程剧本.md', '工程剧本优先于分集剧本')
  assert.ok(scanned.duplicates.includes(1), '其余稿仍列为重复，供确认卡提示')
  // 没有工程剧本时，短剧改编稿优先于切分原文
  const noEngineering = scanEpisodeScripts([
    'docs/wiki/项目资料/分集剧本/第1集分集剧本.md',
    'docs/wiki/剧本/第001集/分集剧本.md',
  ])
  assert.equal(noEngineering.scripts[1], 'docs/wiki/剧本/第001集/分集剧本.md')
  // 只有工程剧本也能开跑
  const onlyEngineering = scanEpisodeScripts(['docs/wiki/剧本/工程剧本/第3集工程剧本.md'])
  assert.deepEqual(onlyEngineering.episodes, [3])
  assert.equal(onlyEngineering.scripts[3], 'docs/wiki/剧本/工程剧本/第3集工程剧本.md')
})

test('an episode already in videos is checked before the next episode waits for its own asset review', async () => {
  const w = world()
  // 先让第 1 集停在出片中：审图通过 → 提交视频 → 审片时停住
  w.setApprove('stopped')
  await runAuto(w.run, w.deps)
  w.setApprove('approved')
  w.setApproveCut('stopped')
  w.run.config.episodes = [1]
  delete w.run.episodes['2']
  await runAuto(w.run, w.deps)

  // 模拟 App 关掉时第 1 集正在出片、第 2 集还没开始；视频任务记录已不在（等价于任务表被清）
  w.run.status = 'stopped'
  w.run.episodes['1'].phase = 'videos'
  delete w.run.episodes['1'].videosReviewed
  w.run.episodes['2'] = { phase: 'queued' }
  w.run.config.episodes = [1, 2]
  const registryPath = 'wiki/制作流水线/Seedance/第1集视频任务.json'
  const registry = JSON.parse(w.fs.get(registryPath)!)
  for (const segment of registry.segments) { segment.status = 'pending'; segment.task_id = 'gone' }
  w.fs.set(registryPath, JSON.stringify(registry))

  const textDoneWhenChecked: number[] = []
  const getTask = w.deps.video.getTask
  w.deps.video.getTask = async id => {
    textDoneWhenChecked.push(w.log.filter(entry => entry.startsWith('text')).length)
    return getTask(id)
  }
  w.setApproveCut('approved')
  w.log.length = 0 // 前两轮的文字记录与本次顺序无关，从零开始数
  await runAuto(w.run, w.deps)
  assert.ok(textDoneWhenChecked.length > 0, '第 1 集在出片中就一定会被检查')
  assert.equal(textDoneWhenChecked[0], 0, `第 1 集必须在第 ${textDoneWhenChecked[0]} 次写文字之后才被检查：` +
    '主循环要先检查出片中的集，否则它会被后面几集的审图闸门一直挡住')
})
