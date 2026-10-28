import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DUANJU_PRESETS, createDuanjuRun, duanjuRunLabel, resolveSampleReview, runDuanjuAuto, type DuanjuAutoDeps, type DuanjuManifest, type DuanjuProgress } from '../autoRunner'

const chapters = Array.from({ length: 8 }, (_, i) => `第${i + 1}章 标题${i + 1}`)

/**
 * 假世界：规划回合读完指令里的章节、保存标注，程序组装体现在分集清单（planned_through、事件集号、切分卡计划）；
 * 样集/改编回合把指令里的集号记入 adapted；调速回合改 pace 并清空 adapted；收尾回合更新分集梗概。
 */
function world(options: { fail?: RegExp; failTimes?: number; blocked?: RegExp; stopAfter?: number; heavyEvent?: number; unfinishedAt?: (batch: number) => string | undefined; summaryCovers?: (assembled: number) => number } = {}) {
  const sent: string[] = []
  let progress: DuanjuProgress = { stage: 'source' }
  let manifest: DuanjuManifest = { rhythm: { name: '大场面奇幻', min: 90, target: 120, max: 150, pace: 1 }, events: [], adapted: [] }
  let summary: string | undefined
  let failures = 0, batch = 0, events = 0, episode = 0
  const deps: DuanjuAutoDeps = {
    async send(text) {
      sent.push(text)
      if (options.fail?.test(text) && failures < (options.failTimes ?? 1)) { failures += 1; return }
      if (options.blocked?.test(text)) { progress = { ...progress, status: 'blocked', reason: '原文第3章缺失' }; return }
      if (/from「([^」]+)」，to「([^」]+)」/.test(text)) batch += 1
      const range = text.match(/^【全自动改编·规划】「([^」]+)」至「([^」]+)」/)
      if (range) {
        events += 1
        episode += 2
        const heavy = options.heavyEvent === events
        const unfinished = /本批最后一段/.test(text) ? options.unfinishedAt?.(batch) : undefined
        manifest = { ...manifest, planned_through: range[2], events: [...manifest.events.filter(item => !item.unfinished),
          { event: `E${events}_事件`, episodes: [episode - 1, episode], rounds: [{ tier: heavy ? '细写' : '如实' }],
            plan: [{ episode: episode - 1, planned_s: 60, rounds: [0] }, { episode, planned_s: 130, rounds: [0] }] },
          ...(unfinished ? [{ event: `E${events}x_未完`, unfinished: true, start: { chapter_heading: unfinished } }] : [])] }
      }
      const adapt = text.match(/^【全自动改编·(?:样集|改编)】第([\d、]+)集/)
      if (adapt) manifest = { ...manifest, adapted: [...new Set([...(manifest.adapted ?? []), ...adapt[1].split('、').map(Number)])].sort((a, b) => a - b) }
      const tune = text.match(/^【全自动改编·调速】.*pace[^\d]*([\d.]+)/)
      if (tune) manifest = { ...manifest, rhythm: { ...manifest.rhythm!, pace: Number(tune[1]) }, adapted: [] }
      if (/^【全自动改编·收尾】/.test(text)) {
        const assembled = Math.max(0, ...manifest.events.flatMap(item => item.episodes ? [item.episodes[1]] : []))
        const covered = options.summaryCovers?.(assembled) ?? assembled
        summary = Array.from({ length: covered }, (_, i) => `第${i + 1}集：梗概`).join('\n')
      }
    },
    async readProgress() { return progress },
    async readManifest() { return manifest },
    async readSummary() { return summary },
    async save() {},
    shouldStop: () => options.stopAfter !== undefined && sent.length >= options.stopAfter,
  }
  return { deps, sent, manifest: () => manifest }
}

const rhythm = { name: '大场面奇幻', min: 90, target: 120, max: 150 }
const config = { sourcePaths: ['wiki/原始材料/作品/原文节点/0001-0100'], chapters, batchSize: 4, readSize: 2, rhythm, adapt: true, sample: false, adaptSize: 3 }
const kind = (text: string) => text.match(/^【全自动改编·([^】]+)】/)![1]

test('three presets follow the research and carry a per-episode time range in seconds', () => {
  assert.deepEqual(DUANJU_PRESETS.map(item => [item.name, item.min, item.target, item.max]), [['快节奏爽剧', 60, 75, 90], ['标准剧情', 75, 90, 120], ['大场面奇幻', 90, 120, 150]])
  assert.ok(DUANJU_PRESETS.every(item => item.suits))
})

test('each batch is reading rounds, then adaptation rounds of adaptSize episodes, then a finish round', async () => {
  const w = world()
  const state = await runDuanjuAuto(createDuanjuRun(config), w.deps)
  assert.equal(state.status, 'done')
  // 每批读2段各出2集 → 共4集：改编分成3+1两轮。
  assert.deepEqual(w.sent.map(kind), ['规划', '规划', '改编', '改编', '收尾', '规划', '规划', '改编', '改编', '收尾'])
  assert.match(w.sent[0], /chapter_range[\s\S]*from「第1章 标题1」，to「第4章 标题4」/)
  assert.match(w.sent[0], /adaptation_annotation[\s\S]*"min":90[\s\S]*"target":120[\s\S]*"max":150/)
  assert.match(w.sent[0], /回合[\s\S]*档位[\s\S]*跳过/)
  assert.match(w.sent[0], /角色[\s\S]*场景[\s\S]*道具/)
  assert.match(w.sent[2], /^【全自动改编·改编】第1、2、3集/)
  assert.match(w.sent[3], /^【全自动改编·改编】第4集/)
  assert.match(w.sent[2], /切分卡[\s\S]*adapted/)
  assert.match(w.sent[4], /分集清单[\s\S]*造型表[\s\S]*分集梗概/)
  assert.doesNotMatch(w.sent.join('\n'), /节拍|风格推荐|建议分集|切集】/)
})

test('the finish round is judged by whether the synopsis covers every assembled episode number', async () => {
  const short = world({ summaryCovers: assembled => Math.max(0, assembled - 1) })
  const state = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4), adapt: false }), short.deps)
  assert.equal(state.status, 'blocked')
  assert.match(state.reason ?? '', /收尾/)
  assert.equal(short.sent.filter(text => /^【全自动改编·收尾】/.test(text)).length, 2, '收尾重发一次')
})

test('adapt:false only cuts: no adaptation rounds', async () => {
  const w = world()
  const state = await runDuanjuAuto(createDuanjuRun({ ...config, adapt: false }), w.deps)
  assert.equal(state.status, 'done')
  assert.deepEqual([...new Set(w.sent.map(kind))], ['规划', '收尾'])
})

test('sample first: adapt episode 1 and the first heavy episode, wait for the user, then batch the rest while skipping the samples', async () => {
  const w = world({ heavyEvent: 2 })
  const paused = await runDuanjuAuto(createDuanjuRun({ ...config, sample: true }), w.deps)
  assert.equal(paused.status, 'review')
  assert.deepEqual(w.sent.map(kind), ['规划', '规划', '样集'])
  assert.match(w.sent[2], /^【全自动改编·样集】第1、3集/)
  assert.deepEqual(paused.sampleEpisodes, [1, 3])
  // 确认后继续：不再重改样集。
  const resumed = await runDuanjuAuto(resolveSampleReview(paused, 'continue'), w.deps)
  assert.equal(resumed.status, 'done')
  const adapts = w.sent.filter(text => /^【全自动改编·改编】/.test(text))
  assert.match(adapts[0], /^【全自动改编·改编】第2、4集/)
  assert.ok(w.manifest().adapted!.includes(1) && w.manifest().adapted!.includes(3))
  assert.equal(w.sent.filter(text => /^【全自动改编·样集】/.test(text)).length, 1)
})

test('feeling the pace is off retunes pace, redoes the samples and asks again', async () => {
  const w = world()
  const paused = await runDuanjuAuto(createDuanjuRun({ ...config, sample: true }), w.deps)
  assert.equal(paused.status, 'review')
  const tuned = await runDuanjuAuto(resolveSampleReview(paused, 'faster'), w.deps)
  assert.equal(tuned.status, 'review')
  assert.equal(w.manifest().rhythm?.pace, 1.2)
  assert.deepEqual(w.sent.map(kind), ['规划', '规划', '样集', '调速', '样集'])
  assert.match(w.sent[3], /replan[\s\S]*1\.2/)
  const slower = await runDuanjuAuto(resolveSampleReview(tuned, 'slower'), w.deps)
  assert.equal(slower.status, 'review')
  assert.equal(w.manifest().rhythm?.pace, 1.02)
  assert.equal(resolveSampleReview(slower, 'stop').status, 'stopped')
})

test('the next batch starts from the first chapter of an event left unfinished at the end of the batch', async () => {
  const w = world({ unfinishedAt: batch => batch === 1 ? '第4章 标题4' : undefined })
  const state = await runDuanjuAuto(createDuanjuRun({ ...config, adapt: false }), w.deps)
  assert.equal(state.status, 'done')
  const plans = w.sent.filter(text => /^【全自动改编·规划】/.test(text))
  assert.match(plans[1], /未完/)
  assert.match(plans[2], /from「第4章 标题4」，to「第7章 标题7」/)
  assert.match(plans.at(-1) ?? '', /from「第8章 标题8」，to「第8章 标题8」/)
})

test('an unfinished event that started at the first chapter of the batch cannot be deferred again', async () => {
  const w = world({ unfinishedAt: () => '第1章 标题1' })
  const state = await runDuanjuAuto(createDuanjuRun({ ...config, adapt: false, chapters: chapters.slice(0, 4) }), w.deps)
  assert.equal(state.status, 'blocked')
  assert.match(state.reason ?? '', /超过一整批|拆/)
})

test('a step is retried once, then the run pauses with the reason; a blocked checkpoint pauses at once', async () => {
  const small = { ...config, adapt: false, chapters: chapters.slice(0, 4) }
  const once = world({ fail: /^【全自动改编·规划】/, failTimes: 1 })
  assert.equal((await runDuanjuAuto(createDuanjuRun(small), once.deps)).status, 'done')
  const twice = world({ fail: /^【全自动改编·规划】/, failTimes: 2 })
  const paused = await runDuanjuAuto(createDuanjuRun(small), twice.deps)
  assert.equal(paused.status, 'blocked')
  assert.match(paused.reason ?? '', /规划/)
  const blocked = world({ blocked: /^【全自动改编·规划】/ })
  const stopped = await runDuanjuAuto(createDuanjuRun(small), blocked.deps)
  assert.equal(stopped.status, 'blocked')
  assert.match(stopped.reason ?? '', /原文第3章缺失/)
  const adaptFail = world({ fail: /^【全自动改编·改编】/, failTimes: 2 })
  const adaptPaused = await runDuanjuAuto(createDuanjuRun({ ...config, chapters: chapters.slice(0, 4) }), adaptFail.deps)
  assert.equal(adaptPaused.status, 'blocked')
  assert.match(adaptPaused.reason ?? '', /改编/)
})

test('stopping saves the position and resuming does not redo finished rounds', async () => {
  const w = world({ stopAfter: 2 })
  const stopped = await runDuanjuAuto(createDuanjuRun({ ...config, adapt: false, chapters: chapters.slice(0, 4) }), w.deps)
  assert.equal(stopped.status, 'stopped')
  w.deps.shouldStop = () => false
  const resumed = await runDuanjuAuto(stopped, w.deps)
  assert.equal(resumed.status, 'done')
  assert.deepEqual(w.sent.map(kind), ['规划', '规划', '收尾'])
})

test('the progress chip shows the batch, the phase, episodes assembled so far and elapsed time', () => {
  const state = { ...createDuanjuRun(config), elapsedMs: 5 * 60_000, assembled: 12 }
  assert.match(duanjuRunLabel(state), /第1批 · 读 第1章 标题1 至 第2章 标题2 · 已出12集 · 用时5分钟/)
  assert.match(duanjuRunLabel({ ...state, phase: 'adapt', status: 'running', adapted: 5 }), /改编 · 已改编5\/12集/)
  assert.match(duanjuRunLabel({ ...state, phase: 'review', status: 'review' }), /等你确认样集/)
})
