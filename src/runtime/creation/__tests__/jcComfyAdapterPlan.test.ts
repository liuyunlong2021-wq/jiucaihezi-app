import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  JC_H3_RATIO_OPTIONS,
  JC_H3_RATIOS,
  JC_IMAGE_SIZE_OPTIONS,
  JC_IMAGE_SIZES,
  JC_VIDEO_SIZE_OPTIONS,
  JC_VIDEO_SIZES,
  isMediaModelEnabled,
} from '@/data/mediaModelCapabilities'
import { __resetApiKeyMemoryCacheForTests } from '@/services/newApiClient'
import {
  buildCreationSubmitRequest,
  executeCreationSubmitRequest,
} from '../creationMediaRuntime'
import { buildCreationRunPlan } from '../creationMediaPlan'
import {
  CREATION_MODEL_REGISTRY,
  creationModelFamily,
  getCreationModelSpec,
  listCreationPanelModels,
} from '../creationModelRegistry'

/** 本机 comfy-adapter 的五个面板项（渠道公开模型名只有三个）。 */
const JC_MODEL_IDS = [
  'jc-qwen-image-2.1',
  'jc-minimax-h3',
  'jc-minimax-h3-first-frame',
  'jc-minimax-h3-first-last',
  'jc-minimax-h3-ref2v',
]

function refs(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `https://cdn.example.test/ref-${index}.png`)
}

async function withImmediateTimers<T>(fn: () => Promise<T>): Promise<T> {
  const previousSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = (handler: (...args: unknown[]) => void) => {
    queueMicrotask(() => handler())
    return 0
  }
  try {
    return await fn()
  } finally {
    globalThis.setTimeout = previousSetTimeout
  }
}

test('本机 comfy-adapter 的模型在注册表和面板能力表里都在，且都带 jc- 前缀', () => {
  for (const id of JC_MODEL_IDS) {
    const spec = getCreationModelSpec(id)
    assert.ok(spec, `注册表缺少 ${id}`)
    // 面板下拉取自 mediaModelCapabilities，只加一边会出现「注册了但选不到」
    assert.equal(isMediaModelEnabled(id), true, `${id} 在创作面板里不可用`)
    assert.equal(spec.source, 'newapi-direct')
    assert.equal(spec.route, 'newapi-direct')
    assert.equal(creationModelFamily(spec), 'jc 本机')
  }

  const panel = listCreationPanelModels()
  for (const id of JC_MODEL_IDS) {
    const item = panel.find(entry => entry.id === id)
    assert.ok(item, `面板列表缺少 ${id}`)
    assert.match(item.label, /^jc-/, `面板显示名 ${item.label} 缺少 jc- 前缀`)
    // 价格未在 NewAPI 配置前不写死单价
    assert.equal(item.price, undefined)
  }
})

test('三个渠道模型名就是 NewAPI 里的公开模型名', () => {
  assert.equal(getCreationModelSpec('jc-qwen-image-2.1')?.model, 'jc-qwen-image-2.1')
  assert.equal(getCreationModelSpec('jc-minimax-h3')?.model, 'jc-minimax-h3')
  assert.equal(getCreationModelSpec('jc-minimax-h3-ref2v')?.model, 'jc-minimax-h3-ref2v')
  // 文生 / 首帧 / 首尾帧共用同一个渠道模型名，靠给哪个槽位区分模式
  assert.equal(getCreationModelSpec('jc-minimax-h3-first-frame')?.model, 'jc-minimax-h3')
  assert.equal(getCreationModelSpec('jc-minimax-h3-first-last')?.model, 'jc-minimax-h3')
})

test('尺寸表守住 comfy-adapter 的约束：图 8 的倍数、视频 32 的倍数', () => {
  const tables: Array<{ label: string; sizes: string[]; multiple: number }> = [
    { label: '图片 Qwen-Image 2.1', sizes: JC_IMAGE_SIZES, multiple: 8 },
    { label: '视频 MiniMax H3', sizes: JC_VIDEO_SIZES, multiple: 32 },
  ]
  for (const { label, sizes, multiple } of tables) {
    assert.ok(sizes.length > 0, `${label} 尺寸表为空`)
    for (const size of sizes) {
      const [width, height] = size.split('x').map(Number)
      assert.ok(Number.isFinite(width) && Number.isFinite(height), `${label} ${size} 格式不对`)
      assert.equal(width % multiple, 0, `${label} ${size} 宽度不是 ${multiple} 的倍数`)
      assert.equal(height % multiple, 0, `${label} ${size} 高度不是 ${multiple} 的倍数`)
      assert.ok(Math.max(width, height) <= 2048, `${label} ${size} 超过最长边 2048`)
      assert.ok(width * height <= 2_100_000, `${label} ${size} 超过 2100000 像素上限`)
    }
    assert.equal(new Set(sizes).size, sizes.length, `${label} 有重复尺寸`)
  }

  // 4K（长边 3840）越不过适配器的 2048 上限，所以只应有 1K/2K 两档
  assert.ok(JC_IMAGE_SIZES.every(size => !size.includes('3840')))
  // 用户常用的竖屏 2K：图是 1080×1920（8 的倍数），视频是 1088×1920（32 的倍数）
  assert.ok(JC_IMAGE_SIZES.includes('1080x1920'))
  assert.ok(JC_VIDEO_SIZES.includes('1088x1920'))
})

test('尺寸选项的标签是人话（档位 + 方位 + 比例 + 实际像素），value 就是真实像素', () => {
  const tables = [JC_IMAGE_SIZE_OPTIONS, JC_VIDEO_SIZE_OPTIONS]
  for (const table of tables) {
    for (const option of table) {
      const value = String(option.value)
      assert.match(value, /^\d+x\d+$/, `value ${value} 不是像素串`)
      // 标签里必须带上真实像素，否则用户看到的尺寸和产出会对不上
      assert.ok(option.label.includes(value), `标签「${option.label}」没写上实际像素 ${value}`)
      assert.ok(!option.label.includes('undefined'), `标签「${option.label}」有残留字段`)
    }
  }
})

test('参考生视频用比例代替档位：比例值就是 ResolutionSelector 的枚举，不能简写', () => {
  // 取值来自 comfy_extras/nodes_resolution.py 的 AspectRatio（带后缀，写错 ComfyUI 会直接报错）
  assert.deepEqual(JC_H3_RATIOS, [
    '16:9 (Widescreen)',
    '9:16 (Portrait Widescreen)',
    '1:1 (Square)',
    '4:3 (Standard)',
    '3:4 (Portrait Standard)',
    '3:2 (Photo)',
    '2:3 (Portrait Photo)',
    '21:9 (Ultrawide)',
  ])

  const ref2v = getCreationModelSpec('jc-minimax-h3-ref2v')
  assert.ok(ref2v)
  const keys = ref2v.fields.map(field => field.key)
  assert.ok(keys.includes('ratio'), '参考生视频应该有比例选择')
  assert.ok(!keys.includes('mode'), '档位不应再出现在界面上')
  assert.ok(!keys.includes('size'), '它不接受 width/height，所以不能给尺寸选择')
  assert.deepEqual(ref2v.capabilities.ratios, JC_H3_RATIOS, '面板的比例下拉要按规格里的 ratios 渲染')
  assert.equal(ref2v.fields.find(field => field.key === 'ratio')?.defaultValue, '16:9 (Widescreen)')

  // 比例标签是人话，不能把枚举后缀漏到界面上
  for (const option of JC_H3_RATIO_OPTIONS) {
    assert.ok(!String(option.label).includes('('), `标签「${option.label}」含枚举后缀`)
    assert.match(String(option.label), /\d+:\d+/)
  }
})

test('三个用显式像素的视频模型保留画幅、不给比例', () => {
  for (const id of ['jc-minimax-h3', 'jc-minimax-h3-first-frame', 'jc-minimax-h3-first-last']) {
    const spec = getCreationModelSpec(id)
    assert.ok(spec)
    const keys = spec.fields.map(field => field.key)
    assert.ok(keys.includes('size'), `${id} 应该有画幅选择`)
    assert.ok(!keys.includes('ratio'), `${id} 不该给比例（它绑的是 width/height）`)
    assert.deepEqual(spec.capabilities.ratios, [], `${id} 的 ratios 必须为空，否则会发多余参数`)
  }
})

test('本机适配器的图片结果走 b64 内联回收，其它图片模型不受牵连', () => {
  assert.equal(getCreationModelSpec('jc-qwen-image-2.1')?.imageResultFormat, 'b64_json')
  for (const id of JC_MODEL_IDS.filter(candidate => candidate !== 'jc-qwen-image-2.1')) {
    assert.equal(getCreationModelSpec(id)?.imageResultFormat, undefined, `${id} 不应设 imageResultFormat`)
  }

  const plan = buildCreationRunPlan({
    modelId: 'jc-qwen-image-2.1',
    params: { prompt: '一只戴墨镜的柴犬', size: '1080x1920' },
  })
  assert.equal(plan.normalizedParams.response_format, 'b64_json')
  const request = buildCreationSubmitRequest(plan)
  // 适配器返回的是 Docker 内网名（frps:8796）的 URL，客户端解析不了；
  // 改成 127.0.0.1 又会被 urlSafety 的私有地址拦截 —— 只能要字节。
  assert.equal(request.imageParams?.responseFormat, 'b64_json')
  assert.equal(request.imageParams?.size, '1080x1920')

  // 不显式给 size 时的默认值就是 2K 竖屏（用户常用），不是 1024×1024
  const defaultPlan = buildCreationRunPlan({
    modelId: 'jc-qwen-image-2.1',
    params: { prompt: '默认尺寸' },
  })
  assert.equal(defaultPlan.normalizedParams.size, '1080x1920')

  // 其它渠道的图片模型仍然是 url（上游给的是公网地址）
  const others = CREATION_MODEL_REGISTRY.filter(spec => spec.task === 'image' && !spec.id.startsWith('jc-'))
  assert.ok(others.length > 0, '没有对照组模型')
  for (const spec of others) {
    assert.notEqual(spec.imageResultFormat, 'b64_json', `${spec.id} 被误改成 b64`)
    assert.equal(spec.imageResultFormat, undefined, `${spec.id} 不应设 imageResultFormat`)
  }
})

test('Qwen 不给参考图走文生图，给参考图自动切到编辑端点', () => {
  const text = buildCreationRunPlan({
    modelId: 'jc-qwen-image-2.1',
    params: { prompt: '一只戴墨镜的柴犬', size: '1024x1024' },
  })
  assert.equal(text.apiStyle, 'openai-images')
  assert.equal(text.endpoint, '/v1/images/generations')
  assert.equal(text.pollKind, 'none')

  const textRequest = buildCreationSubmitRequest(text)
  assert.equal(textRequest.imageParams?.size, '1024x1024')
  // resolution 在适配器里是「参考图缩放基准」整数，别的模型的画质字符串不能混进来
  assert.equal((textRequest.imageParams as any)?.resolution, undefined)
  assert.equal((textRequest.imageParams as any)?.aspectRatio, undefined)

  const edit = buildCreationRunPlan({
    modelId: 'jc-qwen-image-2.1',
    params: { prompt: '把背景换成雪天', size: '1024x1024', images: refs(2) },
  })
  assert.equal(edit.apiStyle, 'openai-image-edits')
  assert.equal(edit.endpoint, '/v1/images/edits')
  // 编辑走 multipart，参考图不经过 NewAPI 转存
  assert.equal(edit.mediaInputTransport, 'multipart')
})

test('视频三项的参考图张数按适配器槽位卡死', () => {
  const plan = (id: string, images: string[]) =>
    buildCreationRunPlan({ modelId: id, params: { prompt: '镜头', images } })

  assert.throws(() => plan('jc-minimax-h3-first-frame', []), /参考图至少需要 1 个/)
  assert.doesNotThrow(() => plan('jc-minimax-h3-first-frame', refs(1)))
  assert.throws(() => plan('jc-minimax-h3-first-frame', refs(2)), /参考图最多支持 1 个/)

  assert.throws(() => plan('jc-minimax-h3-first-last', refs(1)), /参考图至少需要 2 个/)
  assert.doesNotThrow(() => plan('jc-minimax-h3-first-last', refs(2)))
  assert.throws(() => plan('jc-minimax-h3-first-last', refs(3)), /参考图最多支持 2 个/)

  assert.throws(() => plan('jc-minimax-h3-ref2v', []), /参考图至少需要 1 个/)
  assert.doesNotThrow(() => plan('jc-minimax-h3-ref2v', refs(6)))
  // 7 张以上会击穿 48GB 显存，适配器侧同样限制为 6
  assert.throws(() => plan('jc-minimax-h3-ref2v', refs(7)), /参考图最多支持 6 个/)

  // 文生视频不接受任何参考图
  assert.throws(() => plan('jc-minimax-h3', refs(1)), /参考图最多支持 0 个/)
})

test('视频提交体把画布参考图落到适配器声明的槽位', { concurrency: false }, async () => {
  __resetApiKeyMemoryCacheForTests('session-cloud')
  const previousFetch = globalThis.fetch
  const bodies: Record<string, any>[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos') && init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)))
      return Response.json({ id: 'task_test_1', status: 'queued' }, { status: 202 })
    }
    if (url.includes('/v1/videos/task_test_1')) {
      return Response.json({
        id: 'task_test_1',
        status: 'completed',
        metadata: { url: 'https://cdn.example.test/out.mp4' },
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  const cases: Array<{ id: string; images: string[]; duration: number; params?: Record<string, unknown> }> = [
    { id: 'jc-minimax-h3', images: [], duration: 5, params: { size: '1088x1920' } },
    { id: 'jc-minimax-h3-first-frame', images: refs(1), duration: 5 },
    { id: 'jc-minimax-h3-first-last', images: refs(2), duration: 5 },
    { id: 'jc-minimax-h3-ref2v', images: refs(3), duration: 3, params: { ratio: '9:16 (Portrait Widescreen)' } },
  ]

  const results: string[] = []
  try {
    for (const entry of cases) {
      const runPlan = buildCreationRunPlan({
        modelId: entry.id,
        params: { prompt: '镜头缓慢推进', duration: entry.duration, images: entry.images, ...entry.params },
      })
      const result = await withImmediateTimers(() =>
        executeCreationSubmitRequest(buildCreationSubmitRequest(runPlan)),
      )
      // 成片经 NewAPI 的 /v1/videos/{id}/content 回收，客户端不直连本机适配器
      results.push(result.url)
    }
  } finally {
    globalThis.fetch = previousFetch
    __resetApiKeyMemoryCacheForTests('')
  }

  assert.equal(bodies.length, 4)
  for (const body of bodies) {
    // 适配器的 resolution 是整数（参考图缩放基准），画质字符串一律不能出现
    assert.equal(body.resolution, undefined)
    assert.equal(body.ratio, undefined)
  }
  // 三个用显式像素的模型不能把 plan 兜底的 '16:9' 当成比例发给适配器
  for (const index of [0, 1, 2]) assert.equal(bodies[index].aspect_ratio, undefined)

  // 文生：不给任何图
  assert.equal(bodies[0].model, 'jc-minimax-h3')
  assert.equal(bodies[0].duration, 5)
  assert.equal(bodies[0].images, undefined)
  assert.equal(bodies[0].first_frame, undefined)
  // 选了画幅就透传，适配器按 multiple_of=32 解成 width/height
  assert.equal(bodies[0].size, '1088x1920')
  // 没选就用规格里的默认值（工作流原默认 1344×768），行为不变
  assert.equal(bodies[1].size, '1344x768')
  assert.equal(bodies[2].size, '1344x768')
  // ref2v 的模板没有 width/height 绑定，尺寸由工作流自己算 —— 不能传假参数
  assert.equal('size' in bodies[3], false)
  // 但它可以绑 ResolutionSelector 的 aspect_ratio（meta 里 bind.aspect_ratio -> 节点 29）
  assert.equal(bodies[3].aspect_ratio, '9:16 (Portrait Widescreen)')

  // 首帧：只填 first_frame
  assert.equal(bodies[1].first_frame, 'https://cdn.example.test/ref-0.png')
  assert.equal(bodies[1].last_frame, undefined)
  assert.equal(bodies[1].images, undefined)

  // 首尾帧：画布第 1 张是首帧、第 2 张是尾帧
  assert.equal(bodies[2].first_frame, 'https://cdn.example.test/ref-0.png')
  assert.equal(bodies[2].last_frame, 'https://cdn.example.test/ref-1.png')
  assert.equal(bodies[2].images, undefined)

  // 参考生：整组进 images，档位透传
  assert.equal(bodies[3].model, 'jc-minimax-h3-ref2v')
  assert.deepEqual(bodies[3].images, refs(3))
  assert.equal(bodies[3].first_frame, undefined)
  assert.equal(bodies[3].mode, '1')
  assert.equal(bodies[3].duration, 3)

  for (const url of results) assert.match(url, /\/v1\/videos\/task_test_1\/content$/)
})

test('本机视频模型的参考图必须先上传：asset.localhost 不能直接透传给适配器', { concurrency: false }, async () => {
  __resetApiKeyMemoryCacheForTests('session-cloud')
  const previousFetch = globalThis.fetch
  const seen: string[] = []
  let posted: Record<string, any> | null = null

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push(url)
    // 面板把本地字节传到网关，拿回一个远端可访问的短存 URL
    if (url.includes('/api/creations/uploads')) return Response.json({ url: 'https://cdn.example.test/uploaded-0.png' })
    // 本地 Tauri 资源地址：只有上传前读字节会走到这里
    if (url.startsWith('http://asset.localhost/')) {
      return new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
    }
    if (url.endsWith('/v1/videos') && init?.method === 'POST') {
      posted = JSON.parse(String(init.body))
      return Response.json({ id: 'task_test_1', status: 'queued' }, { status: 202 })
    }
    if (url.includes('/v1/videos/task_test_1')) {
      return Response.json({ id: 'task_test_1', status: 'completed', metadata: { url: 'https://cdn.example.test/out.mp4' } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'jc-minimax-h3-first-frame',
      params: {
        prompt: '镜头缓慢推进',
        duration: 5,
        images: ['http://asset.localhost/D%3A%5Cpics%5Cframe.png'],
      },
    })
    await withImmediateTimers(() => executeCreationSubmitRequest(buildCreationSubmitRequest(plan)))
  } finally {
    globalThis.fetch = previousFetch
    __resetApiKeyMemoryCacheForTests('')
  }

  assert.ok(seen.some(url => url.includes('/api/creations/uploads')), '参考图没有被上传，本地地址被直接透传了')
  assert.equal(posted?.first_frame, 'https://cdn.example.test/uploaded-0.png')
})

test('本地 comfy 视频时长单位是秒，帧数换算留给适配器', () => {
  const plan = buildCreationRunPlan({
    modelId: 'jc-minimax-h3',
    params: { prompt: '镜头', duration: 5 },
  })
  const request = buildCreationSubmitRequest(plan)
  // 面板只说秒；适配器按模板声明的 duration_fps 换成 H3 的 length 帧数
  assert.equal(request.videoParams?.duration, 5)
  assert.equal((request.videoParams as any)?.length, undefined)
  assert.equal(request.endpoint, '/v1/videos')
  assert.equal(request.pollKind, 'newapi-task')
})
