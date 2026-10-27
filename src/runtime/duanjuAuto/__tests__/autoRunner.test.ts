import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDuanjuRun, runDuanjuAuto, type DuanjuAutoDeps, type DuanjuProgress } from '../autoRunner'

const chapters = Array.from({ length: 8 }, (_, i) => `第${i + 1}章 标题${i + 1}`)

/** 假世界：模型按指令推进执行进度与剧本；可让某类指令失败或保存 blocked。 */
function world(options: { review?: boolean; fail?: RegExp; failTimes?: number; blocked?: RegExp; episodesPerBatch?: number; stopAfter?: number; staleScripts?: number[] } = {}) {
  const sent: string[] = []
  const scripts = new Map<number, string>()
  for (const episode of options.staleScripts ?? []) scripts.set(episode, '旧稿')
  let progress: DuanjuProgress | undefined
  let failures = 0
  let saved: unknown
  const deps: DuanjuAutoDeps = {
    async send(text) {
      sent.push(text)
      if (options.fail?.test(text) && failures < (options.failTimes ?? 1)) { failures += 1; return }
      if (options.blocked?.test(text)) { progress = { ...(progress as DuanjuProgress), status: 'blocked', reason: '原文第3章缺失' }; return }
      const range = text.match(/「([^」]+)」至「([^」]+)」/)
      const span = range ? chapters.slice(chapters.indexOf(range[1]), chapters.indexOf(range[2]) + 1) : []
      if (/资料】/.test(text) && range) progress = { stage: 'materials', status: 'running', chapters: span.map(chapter_heading => ({ source_path: 'x', chapter_heading })) }
      if (/规划】/.test(text) && range) progress = { ...(progress as DuanjuProgress), stage: 'scheme', planned_through: range[2], status: /本批最后一段/.test(text) && /审阅/.test(text) ? 'review' : 'running' }
      if (/切分】/.test(text)) {
        const first = Number(text.match(/集号从(\d+)起/)![1])
        progress = { ...(progress as DuanjuProgress), stage: 'cuts', status: 'running', episodes: Array.from({ length: options.episodesPerBatch ?? 2 }, (_, i) => first + i) }
      }
      const episode = text.match(/【全自动改编·第(\d+)集】/)
      if (episode) scripts.set(Number(episode[1]), `第${episode[1]}集新稿${sent.length}`)
      if (/收尾】/.test(text)) progress = { ...(progress as DuanjuProgress), stage: 'complete', status: 'completed' }
    },
    async readProgress() { return progress },
    async readScript(episode) { return scripts.get(episode) },
    async save(state) { saved = JSON.parse(JSON.stringify(state)) },
    async awaitReview() { return 'approved' },
    shouldStop: () => options.stopAfter !== undefined && sent.length >= options.stopAfter,
  }
  return { deps, sent, scripts, saved: () => saved }
}

const config = { sourcePath: 'wiki/原始材料/作品/原文.md', chapters, batchSize: 4, readSize: 2, review: true }
const kind = (text: string) => text.match(/【全自动改编·([^】]+)】/)![1].replace(/第\d+集/, '写作')

test('two batches run materials, plans, review, cuts, every episode and finish, then the next batch continues episode numbers', async () => {
  const w = world()
  let reviews = 0
  w.deps.awaitReview = async () => { reviews += 1; return 'approved' }
  const state = await runDuanjuAuto(createDuanjuRun(config), w.deps)
  assert.equal(state.status, 'done')
  assert.equal(reviews, 2)
  assert.deepEqual(w.sent.map(kind), ['资料', '规划', '规划', '切分', '写作', '写作', '收尾', '资料', '规划', '规划', '切分', '写作', '写作', '收尾'])
  assert.match(w.sent[0], /「第1章 标题1」至「第4章 标题4」/)
  assert.match(w.sent[1], /「第1章 标题1」至「第2章 标题2」/)
  assert.match(w.sent[2], /「第3章 标题3」至「第4章 标题4」[\s\S]*本批最后一段[\s\S]*审阅/)
  assert.match(w.sent[7], /「第5章 标题5」至「第8章 标题8」/)
  assert.match(w.sent[3], /集号从1起/)
  assert.match(w.sent[10], /集号从3起/)
  assert.deepEqual([...w.scripts.keys()].sort(), [1, 2, 3, 4])
})

test('review off does not pause and does not ask the plan to wait', async () => {
  const w = world()
  let reviews = 0
  w.deps.awaitReview = async () => { reviews += 1; return 'approved' }
  const state = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4), review: false }), w.deps)
  assert.equal(state.status, 'done')
  assert.equal(reviews, 0)
  assert.doesNotMatch(w.sent[2], /审阅/)
})

test('a step is retried once, then the run pauses with the reason; a blocked checkpoint pauses at once', async () => {
  const once = world({ fail: /切分】/, failTimes: 1 })
  assert.equal((await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4) }), once.deps)).status, 'done')
  assert.equal(once.sent.filter(text => /切分】/.test(text)).length, 2)
  const twice = world({ fail: /切分】/, failTimes: 2 })
  const paused = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4) }), twice.deps)
  assert.equal(paused.status, 'blocked')
  assert.match(paused.reason ?? '', /切分/)
  const blocked = world({ blocked: /规划】/ })
  const stopped = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4) }), blocked.deps)
  assert.equal(stopped.status, 'blocked')
  assert.match(stopped.reason ?? '', /原文第3章缺失/)
  assert.equal(blocked.sent.filter(text => /规划】/.test(text)).length, 1)
})

test('stopping saves the position and resuming does not redo finished steps', async () => {
  const w = world({ stopAfter: 5 })
  const stopped = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4) }), w.deps)
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(w.sent.map(kind), ['资料', '规划', '规划', '切分', '写作'])
  w.deps.shouldStop = () => false
  const resumed = await runDuanjuAuto(stopped, w.deps)
  assert.equal(resumed.status, 'done')
  assert.deepEqual(w.sent.slice(5).map(kind), ['写作', '收尾'])
  assert.match(w.sent[5], /第2集/)
})

test('an episode counts as written only when its script changed during this run', async () => {
  const w = world({ staleScripts: [1] })
  const send = w.deps.send
  w.deps.send = async text => { if (!/第1集】/.test(text)) await send(text) }
  const state = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4) }), w.deps)
  assert.equal(state.status, 'blocked')
  assert.match(state.reason ?? '', /第1集/)
})
