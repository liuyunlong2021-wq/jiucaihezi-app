import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CREATION_MODEL_ROUTES,
  buildCreationModelAvailability,
  publicErrorPayload,
  parseChannelRows,
  sanitizeErrorForLog,
} from '../server.mjs'

const RH_TARGET_MODELS = [
  'rh-pro-image',
  'rh-image-v2',
  'rh-gpt2-official',
  'rh-gpt2-image',
  'rh-gpt2-text',
  'z-image-turbo',
  'rh-video-v31-fast',
  'rh-3d-text',
  'rh-3d-image',
  'rh-seedance2-text-video',
  'rh-seedance2-image-video',
  'rh-seedance2-multimodal-video',
  'grok-video-3',
  'rh-grok-text-video',
  'rh-grok-image-video',
  'rh-aiapp-fast-digital-human',
  'rh-suno-v55-single',
  'rh-suno-v55-custom',
  'rh-suno-lyrics',
]

test('FK 中文请求仅匹配登记了中文公开名的渠道，真实 ID 不替代公开名路由', () => {
  const name = 'Seedance 2.5 满血 480-720p'
  for (const model of [name, 'ft-video-v1-b8a797753dd4c6bf8e5a69820b293848']) {
    const result = buildCreationModelAvailability([{ id: 1, name: 'FK', status: 1, models: [model] }])
    assert.equal(result.find(item => item.id === name)?.status, model === name ? 'enabled' : 'disabled')
  }
})

const REMOVED_RH_MODELS = [
  'rh-kling-v30-pro',
  'rh-veo-31-fast',
  'rh-veo-31-pro',
  'rh-seedance2',
  'rh-grok-video-edit',
  'rh-mimic',
  'rh-digital-human-fast',
  'rh-digital-human',
  'rh-voice-design',
]

test('parseChannelRows reads NewAPI channel rows', () => {
  const rows = parseChannelRows('55\tRH-图片\t1\thttp://172.17.0.1:8789\trh-pro-image,rh-gpt2-text\n')

  assert.deepEqual(rows, [
    {
      id: 55,
      name: 'RH-图片',
      status: 1,
      baseUrl: 'http://172.17.0.1:8789',
      models: ['rh-pro-image', 'rh-gpt2-text'],
    },
  ])
})

test('buildCreationModelAvailability marks configured status from NewAPI channels', () => {
  const models = buildCreationModelAvailability([
    { id: 88, name: '1k', status: 1, baseUrl: 'x', models: ['gpt-image-2-1k'] },
    { id: 91, name: 'low', status: 1, baseUrl: 'x', models: ['gpt-image-2-低质量'] },
    { id: 92, name: 'medium', status: 1, baseUrl: 'x', models: ['gpt-image-2-中质量'] },
    { id: 115, name: 'vip', status: 1, baseUrl: 'x', models: ['gpt-image-2-vip'] },
    { id: 116, name: 'official', status: 1, baseUrl: 'x', models: ['gpt-image-2-官方'] },
    { id: 117, name: '2.5 official', status: 1, baseUrl: 'x', models: ['gpt-image-2.5-官方', 'gpt-image-2.5-flare-官方', 'gpt-image-2.5-sunburst-官方'] },
    { id: 16, name: 't8', status: 1, baseUrl: 'x', models: ['nano-banana-pro-4k'] },
    { id: 55, name: 'RH-图片', status: 1, baseUrl: 'x', models: ['rh-pro-image', 'rh-gpt2-text'] },
    { id: 56, name: 'RH-视频', status: 3, baseUrl: 'x', models: ['rh-grok-text-video'] },
    { id: 66, name: 'Seed Audio', status: 1, baseUrl: 'x', models: ['seed-audio-1.0'] },
  ], new Date('2026-05-31T00:00:00Z'))

  const byId = Object.fromEntries(models.map(model => [model.id, model]))

  assert.equal(byId['gpt-image-2-1k'].status, 'enabled')
  assert.equal(byId['gpt-image-2-低质量'].status, 'enabled')
  assert.equal(byId['gpt-image-2-中质量'].status, 'enabled')
  assert.equal(byId['gpt-image-2-vip'].status, 'enabled')
  assert.equal(byId['gpt-image-2-官方'].status, 'enabled')
  assert.equal(byId['gpt-image-2.5-官方'].status, 'enabled')
  assert.equal(byId['gpt-image-2.5-flare-官方'].status, 'enabled')
  assert.equal(byId['gpt-image-2.5-sunburst-官方'].status, 'enabled')
  assert.equal(byId['nano-banana-4k'].status, 'enabled')
  assert.equal(byId['rh-pro-image'].status, 'enabled')
  assert.equal(byId['grok-video-3'].status, 'disabled')
  assert.equal(byId['grok-video-3'].reason, 'NewAPI 渠道已自动禁用')
  assert.equal(byId['rh-grok-text-video'].status, 'disabled')
  assert.equal(byId['rh-grok-text-video'].reason, 'NewAPI 渠道已自动禁用')
  assert.equal(byId['seed-audio-1.0'].status, 'enabled')
})

test('buildCreationModelAvailability keeps GPT Image 2 route models isolated', () => {
  const models = buildCreationModelAvailability([
    { id: 91, name: 'low', status: 1, baseUrl: 'x', models: ['gpt-image-2-低质量'] },
  ])

  assert.equal(models.find(model => model.id === 'gpt-image-2-低质量')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'gpt-image-2-1k')?.status, 'disabled')
  assert.equal(models.find(model => model.id === 'gpt-image-2-中质量')?.status, 'disabled')
  assert.equal(models.find(model => model.id === 'gpt-image-2-vip')?.status, 'disabled')
  assert.equal(models.find(model => model.id === 'gpt-image-2-官方')?.status, 'disabled')
})

test('buildCreationModelAvailability keeps channel 61 RH GPT Image 2 separate from direct GPT Image 2', () => {
  const models = buildCreationModelAvailability([
    { id: 61, name: 'RH image', status: 1, baseUrl: 'x', models: ['rh-gpt2-official'] },
  ])

  assert.equal(models.find(model => model.id === 'rh-gpt2-official')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'gpt-image-2-1k')?.status, 'disabled')
})

test('buildCreationModelAvailability keeps the three Yihong image aliases isolated', () => {
  const models = buildCreationModelAvailability([
    { id: 61, name: 'Yihong image', status: 1, baseUrl: 'x', models: ['yihong-gpt-image-2.5-flare'] },
  ])

  assert.equal(models.find(model => model.id === 'newapi/yihong/yihong-gpt-image-2.5-flare')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'newapi/yihong/yihong-gpt-image-2')?.status, 'disabled')
  assert.equal(models.find(model => model.id === 'newapi/yihong/yihong-gpt-image-2.5-sunburst')?.status, 'disabled')
})

test('buildCreationModelAvailability detects channel 94 Gemini image models', () => {
  const models = buildCreationModelAvailability([
    { id: 94, name: 'Gemini image', status: 1, baseUrl: 'x', models: ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'] },
  ])

  assert.equal(models.find(model => model.id === 'gemini-3-pro-image-preview')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'gemini-3.1-flash-image-preview')?.status, 'enabled')
})

test('buildCreationModelAvailability tracks Xiaoyi MiniMax H3 channels', () => {
  const models = buildCreationModelAvailability([
    { id: 120, name: 'Xiaoyi H3', status: 1, baseUrl: 'x', models: ['MiniMaxH3-2k-pro-sec', 'MiniMaxH3-2k-sec'] },
  ])

  assert.equal(models.find(model => model.id === 'newapi/xiaoyi/MiniMaxH3-2k-pro-sec')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'newapi/xiaoyi/MiniMaxH3-2k-sec')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'newapi/xiaoyi/MiniMaxH3-720p-sec')?.status, 'disabled')
})

test('buildCreationModelAvailability tracks both Boluo reference-video channels', () => {
  const models = buildCreationModelAvailability([
    {
      id: 130,
      name: 'Boluo 参考生',
      status: 1,
      baseUrl: 'x',
      models: ['minimax_h3_image_audio_to_video_v2_15s', 'minimax_h3_zm_u24'],
    },
  ])

  assert.equal(models.find(model => model.id === 'newapi/boluo/minimax_h3_image_audio_to_video_v2_15s')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'newapi/boluo/minimax_h3_zm_u24')?.status, 'enabled')
})

// ponytail: 两条路由的 aliases 分别是各自的模型名，渠道只配一条时另一条必须是 disabled，
// 否则面板会把没配的模型显示成可用。这条用例就是钉住这个边界。
test('buildCreationModelAvailability keeps the two Boluo models isolated', () => {
  const models = buildCreationModelAvailability([
    { id: 131, name: 'Boluo 增强版', status: 1, baseUrl: 'x', models: ['minimax_h3_zm_u24'] },
  ])

  assert.equal(models.find(model => model.id === 'newapi/boluo/minimax_h3_zm_u24')?.status, 'enabled')
  assert.equal(
    models.find(model => model.id === 'newapi/boluo/minimax_h3_image_audio_to_video_v2_15s')?.status,
    'disabled',
  )
})

test('buildCreationModelAvailability detects channel 82 Veo video models', () => {
  const models = buildCreationModelAvailability([
    { id: 82, name: 'Veo', status: 1, baseUrl: 'x', models: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview'] },
  ])

  assert.equal(models.find(model => model.id === 'veo-3.1-generate-preview')?.status, 'enabled')
  assert.equal(models.find(model => model.id === 'veo-3.1-fast-generate-preview')?.status, 'enabled')
})

test('creation model availability tracks the complete active RH model set', () => {
  const routeIds = CREATION_MODEL_ROUTES.map(route => route.id)
  const rhRouteIds = routeIds.filter(id => RH_TARGET_MODELS.includes(id))

  assert.deepEqual(rhRouteIds.sort(), RH_TARGET_MODELS.toSorted())
  for (const removed of REMOVED_RH_MODELS) {
    assert.equal(routeIds.includes(removed), false)
  }
})

test('buildCreationModelAvailability can disable every target RH model from NewAPI channel state', () => {
  const models = buildCreationModelAvailability([
    { id: 55, name: 'RH', status: 3, baseUrl: 'x', models: RH_TARGET_MODELS },
  ], new Date('2026-06-03T00:00:00Z'))
  const byId = Object.fromEntries(models.map(model => [model.id, model]))

  for (const model of RH_TARGET_MODELS) {
    assert.equal(byId[model].status, 'disabled')
    assert.equal(byId[model].reason, 'NewAPI 渠道已自动禁用')
  }
})

test('publicErrorPayload does not expose internal exception details', () => {
  assert.deepEqual(publicErrorPayload(new Error('PGPASSWORD leaked stack detail'), () => {}), {
    success: false,
    error: {
      message: '模型可用性服务暂不可用',
    },
  })
})

test('sanitizeErrorForLog redacts password-bearing command details', () => {
  const safe = sanitizeErrorForLog({
    message: 'command failed: docker exec -e PGPASSWORD=secret-value postgres psql',
    stack: 'Error: failed\n    at queryChannels\nPGPASSWORD=another-secret',
    cmd: 'docker exec -e PGPASSWORD=secret-value postgres psql',
  })

  assert.ok(!safe.includes('secret-value'))
  assert.ok(!safe.includes('another-secret'))
  assert.ok(safe.includes('PGPASSWORD=***'))
})

// 小易 0.3.0 起渠道里的公开名带 xy- 前缀；面板 id 仍是历史内部名。
// 路由只登记旧名时，创作面板会把四个 GPT 1K 型号判成「未配置该模型渠道」并禁用发送。
test('buildCreationModelAvailability recognizes the Xiaoyi xy- public names for the four GPT 1K routes', () => {
  const models = buildCreationModelAvailability([
    {
      id: 167,
      name: '小易图片',
      status: 1,
      baseUrl: 'x',
      models: [
        'xy-gpt-image-2.5-1k',
        'xy-gpt-image-2.5-flare-1k',
        'xy-gpt-image-2.5-sunburst-1k',
        'xy-gpt-image-2-1k',
      ],
    },
  ])

  for (const id of ['gpt-image-2.5-1k', 'gpt-image-2.5-flare-1k', 'gpt-image-2.5-sunburst-1k', 'gpt-image-2-1k']) {
    assert.equal(models.find(model => model.id === id)?.status, 'enabled', `${id} 应匹配 xy- 公开名`)
  }
})

test('buildCreationModelAvailability still accepts the legacy Xiaoyi names', () => {
  const models = buildCreationModelAvailability([
    { id: 168, name: '小易图片旧名', status: 1, baseUrl: 'x', models: ['gpt-image-2.5-1k'] },
  ])

  assert.equal(models.find(model => model.id === 'gpt-image-2.5-1k')?.status, 'enabled')
})

test('calibrated yihong, yuanliu and FK official routes match exact public channel names', () => {
  const cases = [
    ['newapi/yihong/yh-minimax H3', 'yh-minimax H3'],
    ['newapi/yihong/yh-seedance2.5 Ultra', 'yh-seedance2.5 Ultra'],
    ['newapi/yihong/yh-wan3.0-video', 'yh-wan3.0-video'],
    ['newapi/yuanliu/yl_seedance-2-5_6caffaca7390', 'Seedance 2.5(HD)'],
    ['newapi/yuanliu/yl_pp_mj_sd25_30010', 'Seedance 2.5 720p (QN-12)'],
    ['newapi/yuanliu/yl_g7zy_seedance_v2_5_s', 'Seedance 2.5 (LJ-02)'],
    ['官方渠道-Seedance 2.5 满血 720p', '官方渠道-Seedance 2.5 满血 720p'],
  ]
  for (const [id, model] of cases) {
    assert.equal(buildCreationModelAvailability([{ id: 1, name: 'fixture', status: 1, models: [model] }]).find(item => item.id === id)?.status, 'enabled')
    assert.equal(buildCreationModelAvailability([]).find(item => item.id === id)?.status, 'disabled')
  }
})

test('插件面板目录：只按标记截取 JSON，不执行插件代码', async () => {
  const { extractPluginCatalog } = await import('../server.mjs')
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../../../newapi-plugins/fk.plugin.js', import.meta.url), 'utf8')
  const { catalog } = await import('../../../newapi-plugins/fk.plugin.js')
  assert.deepEqual(extractPluginCatalog(source), catalog)
  const body = /\/\*jc-catalog\*\/([\s\S]*?)\/\*end-jc-catalog\*\//.exec(source)[1]
  assert.deepEqual(extractPluginCatalog(body), catalog, 'SQL 已截取正文时同样可解析')
  assert.equal(extractPluginCatalog('export const meta = {}'), null)
  assert.equal(extractPluginCatalog('/*jc-catalog*/{"schema":"other","models":[]}/*end-jc-catalog*/'), null)
  assert.equal(extractPluginCatalog('/*jc-catalog*/globalThis.x = 1/*end-jc-catalog*/'), null)
})

test('NewAPI 计费表达式换算为面板价格，复杂表达式返回空', async () => {
  const { priceFromExpression } = await import('../server.mjs')
  assert.equal(priceFromExpression('tier("base", u("calls") * 5)'), '¥5/次')
  assert.equal(priceFromExpression('tier("base", u("seconds") * 0.2)'), '¥0.2/秒')
  assert.equal(priceFromExpression('tier("base", u("seconds_480p") * 0.5 + u("seconds_720p") * 0.5)'), '¥0.5/秒')
  assert.equal(priceFromExpression('tier("base", u("seconds_480p") * 0.08 + u("seconds_768p") * 0.08 + u("seconds_1080p") * 0.25)'), '480p/768p ¥0.08/秒 · 1080p ¥0.25/秒')
  assert.equal(priceFromExpression('tier("base", u("image_count") * 0.08)'), '¥0.08/张')
  assert.equal(priceFromExpression('u("seconds") > 0 ? tier("base", u("seconds") * 1) : tier("video_reference", u("upstream_cost_yuan"))'), '')
  assert.equal(priceFromExpression(''), '')
})

test('目录型号随可用性下发规格，价格以 NewAPI 实际表达式为准，同名静态路由不重复', async () => {
  const { buildCatalogModels } = await import('../server.mjs')
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../../../newapi-plugins/fk.plugin.js', import.meta.url), 'utf8')
  const real = '特价渠道 Seedance 2.5 满血 720p（可过真人）'
  const official = '官方渠道-Seedance 2.5 满血 720p'
  const catalogModels = buildCatalogModels(
    [{ key: 'fk', version: '0.5.0', catalog: /\/\*jc-catalog\*\/([\s\S]*?)\/\*end-jc-catalog\*\//.exec(source)[1] }, { key: 'other', version: '1', catalog: null }],
    {
      'billing_setting.plugin_billing_expr': JSON.stringify({ [`fk::${real}`]: 'tier("base", u("calls") * 6)' }),
      'billing_setting.billing_expr': JSON.stringify({ 'Wan 3.0 720-1080p': 'tier("base", u("seconds_720p") * 0.3 + u("seconds_1080p") * 0.4)' }),
    },
  )
  assert.equal(catalogModels.length, 7)
  const channels = [{ id: 1, name: 'fk', status: 1, baseUrl: '', models: [real, 'Wan 3.0 720-1080p'] }]
  const models = buildCreationModelAvailability(channels, new Date('2026-10-25T00:00:00Z'), catalogModels)
  const byId = new Map(models.map(model => [model.id, model]))
  assert.equal(models.filter(model => model.id === 'Wan 3.0 720-1080p').length, 1)
  assert.equal(byId.get(real).status, 'enabled')
  assert.equal(byId.get(real).spec.channel, 'fk')
  assert.equal(byId.get(real).spec.price, '¥6/次')
  assert.deepEqual(byId.get(real).spec.duration, { values: [15, 30], default: 15 })
  assert.equal(byId.get('Wan 3.0 720-1080p').spec.price, '720p ¥0.3/秒 · 1080p ¥0.4/秒')
  assert.equal(byId.get(official).status, 'disabled')
  assert.equal(byId.get(official).spec.price, '¥1/秒 · 视频参考 ¥31.5/百万Token')
  assert.ok(byId.get('newapi/yihong/yh-minimax H3'), '非目录渠道保持原静态路由')
  assert.deepEqual(buildCreationModelAvailability(channels).map(model => model.id), CREATION_MODEL_ROUTES.map(route => route.id))
})

test('按画质分档的条件表达式也换算为面板价格', async () => {
  const { priceFromExpression } = await import('../server.mjs')
  assert.equal(priceFromExpression('u("resolution") == "1080p" ? tier("1080p", u("seconds") * 1) : u("resolution") == "720p" ? tier("720p", u("seconds") * 0.6) : tier("480p", u("seconds") * 0.6)'), '480p/720p ¥0.6/秒 · 1080p ¥1/秒')
  assert.equal(priceFromExpression('u("resolution") == "720p" ? tier("720p", u("seconds") * 0.8) : tier("480p", u("seconds") * 0.6)'), '480p ¥0.6/秒 · 720p ¥0.8/秒')
  assert.equal(priceFromExpression('u("resolution") == "720p" ? tier("720p", u("seconds") * 0.8) : tier("base", u("calls") * 1)'), '')
})

test('源流目录随可用性下发', async () => {
  const { buildCatalogModels } = await import('../server.mjs')
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../../../newapi-plugins/yuanliu.plugin.js', import.meta.url), 'utf8')
  const models = buildCatalogModels([{ key: 'yuanliu', version: '0.3.0', catalog: source }], {})
  assert.deepEqual(models.map(model => model.channel), Array(6).fill('yuanliu'))
  assert.equal(models.find(model => model.name === 'Seedance 2.5 (RK-02)').price, '480p ¥0.6/秒 · 720p ¥0.8/秒')
  const channels = [{ id: 9, name: '源流', status: 1, baseUrl: '', models: ['Seedance 2.5 (RK-02)'] }]
  const ids = buildCreationModelAvailability(channels, new Date(), models).map(model => model.id)
  assert.ok(ids.includes('Seedance 2.5 (RK-02)'))
  assert.ok(!ids.includes('newapi/yuanliu/yl_cm_73'), '目录已覆盖的静态路由不重复下发')
})
