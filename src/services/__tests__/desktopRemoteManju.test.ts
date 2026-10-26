import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref, shallowRef } from 'vue'
import {
  buildRemoteAutoRunConfig,
  manjuAutoProjection,
  runManjuCommand,
  setDesktopManjuAuto,
  type ManjuAutoController,
} from '@/services/desktopRemoteManju'
import { modelLimits } from '@/runtime/manjuAuto/autoRunner'
import type { ManjuAutoDraft } from '@/composables/useManjuAuto'

const owner = '/Users/someone/擦边'

const draft: ManjuAutoDraft = {
  wikiRoot: 'wiki',
  episodes: [1, 2, 3],
  ratio: '9:16',
  advice: { needed: [], skipped: [] },
  imageModels: [{ id: 'img-a', label: '生图 A', price: '0.2元/张' }, { id: 'img-b', label: '生图 B' }],
  videoModels: [{ id: 'vid-a', label: 'Seedance 2.5', price: '720p ¥0.5元/秒 · 480p ¥0.2元/秒',
    resolutions: ['720P', '480P'], duration: { max: 15 }, maxImages: 6 }],
}

function controller(overrides: Partial<ManjuAutoController> = {}) {
  const calls: unknown[][] = []
  const value: ManjuAutoController = {
    owner: () => owner,
    run: ref(null), draft: ref(draft), review: shallowRef(null), reviewBusy: ref({}), reviewErrors: ref({}),
    error: ref(''), preparing: ref(false),
    prepare: async (...args) => { calls.push(['prepare', ...args]) },
    start: async (...args) => { calls.push(['start', ...args]); await new Promise(() => undefined) },
    stop: (...args) => { calls.push(['stop', ...args]) },
    approveReview: (...args) => { calls.push(['approve', ...args]) },
    regenerate: async (...args) => { calls.push(['regenerate', ...args]) },
    loadPrompt: async id => `提示词 ${id}`,
    cancelDraft: () => { calls.push(['cancel']) },
    ...overrides,
  }
  return { value, calls }
}

test('全自动·参数：手机只给选择，电脑按确认卡同一规则拼出启动参数', () => {
  const config = buildRemoteAutoRunConfig(draft, {
    episodes: [3, 1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'first', budget: 30,
  })
  assert.deepEqual(config, {
    episodes: [1, 3],
    videoModel: 'Seedance',
    limits: modelLimits('Seedance', draft.videoModels[0]!),
    imageModelId: 'img-a',
    videoModelId: 'vid-a',
    ratio: '9:16',
    review: true,
    reviewMode: 'first',
    budgetPerEpisode: 30,
    imagePrice: '0.2元/张',
    videoResolution: '480P',
    videoPrice: '0.2/秒',
  }, '默认最低分辨率并按该档计价，集数排序')
  const h3 = buildRemoteAutoRunConfig(draft, {
    episodes: [2], imageModelId: 'img-b', videoModelId: 'vid-a', reviewMode: 'off', route: 'H3', videoResolution: '720P',
  })
  assert.equal(h3.videoModel, 'H3')
  assert.equal(h3.review, false)
  assert.equal(h3.budgetPerEpisode, undefined)
  assert.equal(h3.videoPrice, '0.5/秒')
  // 与电脑确认卡一致（2026-10-26）：有未完成运行时也可换路线重新开始；续做由 resumeAutoRun 强制沿用原路线。
  const saved = { ...draft, saved: { version: 1, status: 'stopped', reviewed: false, episodes: {},
    config: { videoModel: 'H3' } } } as unknown as ManjuAutoDraft
  assert.equal(buildRemoteAutoRunConfig(saved, { episodes: [1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'new', route: 'Seedance' }).videoModel, 'Seedance')
})

test('全自动·参数：项目风格建议纯文生时，手机启动同样按纯文生（max_refs 为 0）', () => {
  const config = buildRemoteAutoRunConfig({ ...draft, advice: { mode: 'pure', needed: [], skipped: [] } }, {
    episodes: [1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'off',
  })
  assert.deepEqual(config.limits, { ...modelLimits('Seedance', draft.videoModels[0]!), max_refs: 0 })
})

test('全自动·参数：不在确认卡里的集数或模型、没确认比例，一律拒绝', () => {
  for (const choice of [
    { episodes: [9], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'new' },
    { episodes: [], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'new' },
    { episodes: [1], imageModelId: 'evil', videoModelId: 'vid-a', reviewMode: 'new' },
    { episodes: [1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'sometimes' },
    { episodes: [1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'new', videoResolution: '8K' },
  ]) assert.throws(() => buildRemoteAutoRunConfig(draft, choice as never), /MANJU_CONFIG_INVALID/, JSON.stringify(choice))
  assert.throws(() => buildRemoteAutoRunConfig({ ...draft, ratio: undefined },
    { episodes: [1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'new' }), /MANJU_CONFIG_INVALID/)
})

test('全自动·状态：手机看到确认卡、进度与待审图，图片给项目内相对路径，不给绝对路径', () => {
  const { value } = controller()
  value.run.value = { version: 1, status: 'running', reviewed: false, config: {} as never,
    episodes: { 1: { phase: 'review', output: `${owner}/out.mp4` }, 2: { phase: 'blocked', reason: '预算超了' } } }
  value.review.value = { ids: ['角色-陈小满', '场景-公路'], images: {
    '角色-陈小满': `${owner}/.raw/jc-media/图片/陈小满.png`, '场景-公路': '/elsewhere/公路.png' } }
  value.reviewBusy.value = { '场景-公路': true }
  value.reviewErrors.value = { '角色-陈小满': '上游超时' }
  setDesktopManjuAuto(value)
  try {
    const projection = manjuAutoProjection(owner)!
    assert.deepEqual(projection.run, { status: 'running', episodes: { 1: { phase: 'review' }, 2: { phase: 'blocked', reason: '预算超了' } } })
    assert.deepEqual(projection.review, [
      { id: '角色-陈小满', path: '.raw/jc-media/图片/陈小满.png', busy: false, error: '上游超时' },
      { id: '场景-公路', path: null, busy: true, error: '' },
    ])
    assert.deepEqual(projection.draft?.episodes, [1, 2, 3])
    assert.equal(projection.draft?.videoModels[0]?.resolutions?.[0], '720P')
    assert.doesNotMatch(JSON.stringify(projection), /\/Users\/someone|wikiRoot|out\.mp4/)
    assert.equal(manjuAutoProjection('/Users/someone/别的项目'), null, '只对这个项目的手机说')
  } finally { setDesktopManjuAuto(null) }
})

test('全自动·操作：开始不等整场跑完就回执；运行中不能再开始', async () => {
  const { value, calls } = controller()
  setDesktopManjuAuto(value)
  try {
    const choice = { episodes: [1], imageModelId: 'img-a', videoModelId: 'vid-a', reviewMode: 'new' }
    assert.deepEqual(await runManjuCommand(owner, 'manju.start', { choice, resume: false }), { started: true })
    assert.equal(calls[0]?.[0], 'start')
    assert.deepEqual((calls[0]?.[1] as { episodes: number[] }).episodes, [1])
    assert.equal(calls[0]?.[2], false)
    value.run.value = { version: 1, status: 'running', reviewed: false, config: {} as never, episodes: {} }
    await assert.rejects(() => runManjuCommand(owner, 'manju.start', { choice, resume: false }), /MANJU_RUNNING/)
    await runManjuCommand(owner, 'manju.stop', {})
    await runManjuCommand(owner, 'manju.prepare', {})
    await runManjuCommand(owner, 'manju.cancel', {})
    assert.deepEqual(calls.slice(1).map(call => call[0]), ['stop', 'prepare', 'cancel'])
  } finally { setDesktopManjuAuto(null) }
})

test('全自动·审图：确认、重新生成、改提示词都只认当前待审的图；有图在生成时不能确认', async () => {
  const { value, calls } = controller()
  value.review.value = { ids: ['道具-旧剑'], images: { '道具-旧剑': `${owner}/.raw/jc-media/图片/剑.png` } }
  setDesktopManjuAuto(value)
  try {
    assert.deepEqual(await runManjuCommand(owner, 'manju.prompt', { id: '道具-旧剑' }), { prompt: '提示词 道具-旧剑' })
    await runManjuCommand(owner, 'manju.regenerate', { id: '道具-旧剑', prompt: '更旧一点的剑' })
    await runManjuCommand(owner, 'manju.regenerate', { id: '道具-旧剑' })
    assert.deepEqual(calls.filter(call => call[0] === 'regenerate'), [['regenerate', '道具-旧剑', '更旧一点的剑'], ['regenerate', '道具-旧剑', undefined]])
    await assert.rejects(() => runManjuCommand(owner, 'manju.regenerate', { id: '别的图' }), /MANJU_REVIEW_ITEM_INVALID/)
    value.reviewBusy.value = { '道具-旧剑': true }
    await assert.rejects(() => runManjuCommand(owner, 'manju.approve', {}), /MANJU_REVIEW_BUSY/)
    value.reviewBusy.value = {}
    await runManjuCommand(owner, 'manju.approve', {})
    assert.ok(calls.some(call => call[0] === 'approve'))
    value.review.value = null
    await assert.rejects(() => runManjuCommand(owner, 'manju.approve', {}), /MANJU_REVIEW_NONE/)
  } finally { setDesktopManjuAuto(null) }
})

test('全自动·操作：电脑没打开工作台或是别的项目时拒绝', async () => {
  await assert.rejects(() => runManjuCommand(owner, 'manju.stop', {}), /MANJU_UNAVAILABLE/)
  const { value } = controller()
  setDesktopManjuAuto(value)
  try {
    await assert.rejects(() => runManjuCommand('/Users/someone/别的项目', 'manju.stop', {}), /MANJU_UNAVAILABLE/)
    await assert.rejects(() => runManjuCommand(owner, 'manju.delete', {}), /UNSUPPORTED_MESSAGE/)
  } finally { setDesktopManjuAuto(null) }
})
