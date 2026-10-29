// NewAPI Task Plugin v1 —— Fk 图片 / 视频渠道（ai.fanke2026.xyz）
//
// 图片使用 openai_image 协议并由 NewAPI 主机轮询；视频使用 openai_video 协议。
// 上游 Key 由 NewAPI 渠道配置提供，源码不保存密钥。Base URL: https://ai.fanke2026.xyz
// Seedance 2.0/2.5 使用 /api/open/v1/video/generate 与 /video/status?jobId=。
// 成片的上游签名 videoUrl 直接透传给客户端下载（2026-10-26 用户确认可暴露上游地址）；
// 没有签名地址时由宿主 content 代理免鉴权回收。旧任务仅保留历史兼容查询；H3 同样走标准接口。
// 事实源：用户提供的 FK 官方视频文档与公开模型映射。价格在 NewAPI Task Usage 中配置。
// 按次型号使用 calls；按秒型号使用 seconds 或对应分辨率 seconds_480p/seconds_720p/seconds_768p/seconds_1080p。
// 按次但按画质定价的型号用 calls_720p / calls_1080p 分别计量一次调用，表达式不能只写 u("calls")。
// 官方型号有参考视频时完成用量使用 video_reference_tokens，需同步更新定价表达式。

const LEGACY_VIDEO_IDS = [
  'ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563',
  'ft-video-v1-69ef4c70291248a25c8198cd1c7c9c1f',
  'ft-video-v1-7393b0529b788d532d031dcac5e820cb',
  'ft-video-v1-9f4e77de6c05f3c360c1c0b9938a44a4',
]
// 面板目录：标记之间必须是纯 JSON，可用性服务不执行插件代码，按标记截取后下发创作面板。
// 改型号只改这里；下方插件校验与公开名映射都由它推导。price 仅在 NewAPI 表达式无法换算时显示。
export const catalog = /*jc-catalog*/{
  "schema": "jc-catalog-v1",
  "models": [
    { "name": "特价渠道 MiniMax H3 480p-1080p", "upstream": "ft-video-v1-1eb6d53a32efa02adf7ae338f3239628", "task": "video", "group": "FK · H3",
      "ratios": ["16:9", "9:16"], "resolutions": ["480p", "720p", "768p", "1080p"], "duration": { "min": 4, "max": 30, "default": 5 },
      "refs": { "images": 9, "videos": 1, "audios": 3 }, "billing": "second", "price": "480p ¥0.06/秒 · 720p/768p ¥0.07/秒 · 1080p ¥0.25/秒" },
    { "name": "特价渠道 Seedance 2.5 满血 720p（可过真人）", "upstream": "ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["720p"], "duration": { "values": [30], "default": 30 },
      "refs": { "images": 9, "videos": 0, "audios": 0 }, "billing": "request", "price": "¥5/次" },
    { "name": "Seedance 2.5 满血 480-720p", "upstream": "ft-video-v1-b8a797753dd4c6bf8e5a69820b293848", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["480p", "720p"], "duration": { "min": 4, "max": 30, "default": 5 },
      "refs": { "images": 30, "videos": 10, "audios": 10 }, "promptMax": 10000, "billing": "second", "price": "480p ¥0.4/秒 · 720p ¥0.5/秒" },
    { "name": "XN2-Seedance 2.5 满血 480-720p", "upstream": "ft-video-v1-756e0feb4b3e1f893726314109762123", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16", "4:3", "3:4", "1:1"], "resolutions": ["480p", "720p"], "duration": { "min": 15, "max": 30, "default": 15 },
      "refs": { "images": 30, "videos": 0, "audios": 10 }, "promptMax": 10000, "billing": "second", "price": "480p ¥0.4/秒 · 720p ¥0.5/秒" },
    { "name": "特价渠道 Seedance 2.0 满血 480p (933)", "upstream": "ft-video-v1-43644108aaba72b7cbad4cd322737f6c", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"], "resolutions": ["480p"], "duration": { "min": 4, "max": 15, "default": 15 },
      "refs": { "images": 9, "videos": 3, "audios": 3 }, "billing": "request", "price": "¥2/次" },
    { "name": "特价渠道 Seedance 2.5 满血 720p（9图）", "upstream": "ft-video-v1-1795bf4b67ce998dbfd8ab55cf838d93", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16"], "resolutions": ["720p"], "duration": { "values": [15], "default": 15 },
      "refs": { "images": 9, "videos": 0, "audios": 0 }, "billing": "request", "price": "¥2/次" },
    { "name": "特价渠道 Seedance 2.5 满血 480p（10图）", "upstream": "ft-video-v1-d69cdf94c9ed6d80ef7ec6ebf00f74ff", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["480p"], "duration": { "min": 4, "max": 30, "default": 30 },
      "refs": { "images": 10, "videos": 0, "audios": 3 }, "billing": "request", "price": "¥3.5/次" },
    { "name": "特价渠道 Seedance 2.5 满血 720-1080p（全能参考）", "upstream": "ft-video-v1-22c418bc12d30fcc1bde650b2bc9727b", "task": "video", "group": "FK · Seedance 2.5",
      "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["720p", "1080p"], "duration": { "min": 4, "max": 30, "default": 30 },
      "refs": { "images": 30, "videos": 10, "audios": 10 }, "billing": "request", "price": "720p ¥8/次 · 1080p ¥12/次" }
  ]
}/*end-jc-catalog*/
const VIDEO_SPECS = Object.fromEntries(catalog.models.map(model => [model.upstream, {
  min: model.duration.min,
  max: model.duration.max,
  durations: model.duration.values,
  refs: [model.refs.images, model.refs.videos, model.refs.audios],
  ratios: model.ratios,
  resolutions: model.resolutions,
  promptMax: model.promptMax,
  unit: model.billing === 'request' ? 'request' : undefined,
  // 按次但多画质定价的型号按画质各计一次调用。
  callTiers: model.billing === 'request' && model.resolutions.length > 1 ? model.resolutions : undefined,
  tokenWithVideo: model.billing === 'token-with-video',
}]))
const VIDEO_MODEL_IDS = Object.keys(VIDEO_SPECS)
const VIDEO_MODEL_ALIASES = Object.fromEntries(catalog.models.map(model => [model.name, model.upstream]))

function videoModel(value) {
  const model = String(value || '')
  return VIDEO_MODEL_ALIASES[model] || model
}

function compatibilityVideo(ctx) {
  const model = videoModel(ctx.upstreamModel || ctx.model || snapshot(ctx.requestBody).model)
  const data = snapshot(ctx.data)
  return LEGACY_VIDEO_IDS.includes(model) || !data.jobId && Boolean(data.id || data.job_id || data.task_id)
}

// 来自账号可用模型目录；这些模型走 /api/open/v1/image/generate。
const IMAGE_MODEL_IDS = [
  'ft-image-v1-211f28f47b0355abb1798f72eb65f22d',
  'ft-image-v1-186289ba9d3263010c69372f8939dd94',
  'ft-image-v1-eb47192eb578f340043911005a06fb6e',
  'ft-image-v1-3432bdee1a22da4ce8ff2bbfc6ef4c1d',
  'ft-image-v1-80fa79934b03dcdc7a54dacdb1ad7f82',
  'ft-image-v1-d51c811d3d74a5b2433e6916ab564db9',
]

const IMAGE_LIMITS = {
  'ft-image-v1-211f28f47b0355abb1798f72eb65f22d': 10,
  'ft-image-v1-186289ba9d3263010c69372f8939dd94': 10,
  'ft-image-v1-eb47192eb578f340043911005a06fb6e': 10,
  'ft-image-v1-3432bdee1a22da4ce8ff2bbfc6ef4c1d': 10,
  'ft-image-v1-80fa79934b03dcdc7a54dacdb1ad7f82': 8,
  'ft-image-v1-d51c811d3d74a5b2433e6916ab564db9': 8,
}
const IMAGE_RATIOS = ['auto', '1:1', '9:16', '16:9', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']

const MODEL_IDS = [...VIDEO_MODEL_IDS, ...Object.keys(VIDEO_MODEL_ALIASES), ...IMAGE_MODEL_IDS]

export const meta = {
  apiVersion: 1,
  key: 'fk',
  name: 'Fk渠道',
  version: '0.7.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Image and video generation via ai.fanke2026.xyz',
    zh: 'Fk渠道图片与 Seedance / MiniMax H3 视频生成',
  },
  models: MODEL_IDS,
  fetchMode: 'per_task',
  // Task Plugin v1 接收协议名字符串；具体按模型 ID 在各 hook 中分流。
  protocols: ['openai_video', 'openai_image'],
  baseUrl: 'https://ai.fanke2026.xyz',
  usageSchema: {
    calls: { type: 'number', unit: 'count', description: { en: 'Billable video requests', zh: '按次视频计费次数' } },
    video_reference_tokens: { type: 'number', unit: 'token', description: { en: 'Settled official video reference tokens', zh: '官方视频参考实际结算 Token' } },
    upstream_cost_yuan: { type: 'number', unit: 'count', unitLabel: { en: 'CNY', zh: '元' }, description: { en: 'Settled upstream cost in CNY', zh: '上游实际结算人民币，仅作账单核对' } },
    calls_720p: {
      type: 'number', unit: 'count', unitLabel: { en: 'call', zh: '次' },
      description: { en: '720p per-request calls', zh: '720p 按次计费次数' },
    },
    calls_1080p: {
      type: 'number', unit: 'count', unitLabel: { en: 'call', zh: '次' },
      description: { en: '1080p per-request calls', zh: '1080p 按次计费次数' },
    },
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Billable video seconds', zh: '固定单价模型计费秒数' },
    },
    seconds_480p: {
      type: 'number',
      unit: 'second',
      description: { en: '480p video seconds', zh: '480p 计费秒数' },
    },
    seconds_720p: {
      type: 'number',
      unit: 'second',
      description: { en: '720p video seconds', zh: '720p 计费秒数' },
    },
    seconds_768p: { type: 'number', unit: 'second', description: { en: '768p video seconds', zh: '768p 计费秒数' } },
    seconds_1080p: {
      type: 'number', unit: 'second',
      description: { en: '1080p video seconds', zh: '1080p 计费秒数' },
    },
    image_count: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'image', zh: '张' },
      description: { en: 'Generated image count', zh: '生成图片张数' },
    },
  },
  usageExamples: [
    { label: '固定单价视频 5 秒', facts: { seconds: 5, seconds_480p: 0, seconds_720p: 0, image_count: 0 } },
    { label: 'XN 480p 视频 5 秒', facts: { seconds: 0, seconds_480p: 5, seconds_720p: 0, image_count: 0 } },
    { label: 'XN 720p 视频 5 秒', facts: { seconds: 0, seconds_480p: 0, seconds_720p: 5, image_count: 0 } },
    { label: '图片 1 张', facts: { seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 1 } },
    { label: '图片 4 张', facts: { seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 4 } },
  ].map(example => ({ ...example, facts: { calls: 0, video_reference_tokens: 0, upstream_cost_yuan: 0, ...example.facts } })).concat([
    { label: '按次视频', facts: { calls: 1, video_reference_tokens: 0, upstream_cost_yuan: 0, seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 0 } },
    { label: '按次 720p 全能参考', facts: { calls_720p: 1, calls: 0, video_reference_tokens: 0, upstream_cost_yuan: 0, seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 0 } },
    { label: '按次 1080p 全能参考', facts: { calls_1080p: 1, calls: 0, video_reference_tokens: 0, upstream_cost_yuan: 0, seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 0 } },
    { label: '官方视频参考结算', facts: { calls: 0, video_reference_tokens: 1000000, upstream_cost_yuan: 31.5, seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 0 } },
  ]).map(example => ({ ...example, facts: { seconds_768p: 0, seconds_1080p: 0, calls_720p: 0, calls_1080p: 0, ...example.facts } })),
}

const HOST_STATUS = {
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}
const UPSTREAM_STATUS = {
  queued: 'QUEUED',
  submitted: 'SUBMITTED',
  pending: 'SUBMITTED',
  in_progress: 'IN_PROGRESS',
  processing: 'IN_PROGRESS',
  running: 'IN_PROGRESS',
  completed: 'SUCCESS',
  succeeded: 'SUCCESS',
  success: 'SUCCESS',
  failed: 'FAILURE',
  failure: 'FAILURE',
  canceled: 'FAILURE',
  cancelled: 'FAILURE',
  error: 'FAILURE',
}

function fail(message) {
  throw new Error(message)
}

function snapshot(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function mediaUrls(body, keys) {
  let value
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null &&
      !(Array.isArray(body[key]) && body[key].length === 0) && body[key] !== '') {
      value = body[key]
      break
    }
  }
  if (value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map(function (item) {
    const url = item && typeof item === 'object' ? item.url : item
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) fail('reference media must be a public HTTPS URL')
    return url
  })
}

function normalizeRequest(body, fileRefs = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = videoModel(body.model)
  if (!VIDEO_MODEL_IDS.includes(model)) fail('Unsupported video model: ' + (model || '(missing)'))
  if (!String(body.prompt || '').trim()) fail('prompt is required')

  const spec = VIDEO_SPECS[model]
  const payload = {
    model,
    prompt: String(body.prompt),
    ratio: String(body.ratio || body.aspect_ratio || '16:9'),
    duration: Number(body.duration === undefined ? body.seconds : body.duration),
    resolution: String(body.resolution || (spec ? spec.resolutions[0] : '768p')),
  }

  const images = mediaUrls(body, ['imageUrls', 'images', 'image_urls', 'imageUrl', 'image_url', 'image'])
  const videos = mediaUrls(body, ['videoUrls', 'videos', 'video_urls', 'video_url', 'videoUrl', 'video'])
  const audios = mediaUrls(body, ['audioUrls', 'audios', 'audio_urls', 'audio_url', 'audioUrl', 'audio'])
  if (images.length) payload.imageUrls = images
  if (videos.length) payload.videoUrls = videos
  if (audios.length) payload.audioUrls = audios
  if (spec) {
    if (!spec.ratios.includes(payload.ratio)) fail('Unsupported Fk video ratio: ' + payload.ratio)
    if (!spec.resolutions.includes(payload.resolution)) fail('Unsupported Fk video resolution: ' + payload.resolution)
    if (!Number.isInteger(payload.duration) || (spec.durations ? !spec.durations.includes(payload.duration) : payload.duration < spec.min || payload.duration > spec.max)) fail('Unsupported Fk video duration: ' + payload.duration)
    if (spec.promptMax && payload.prompt.length > spec.promptMax) fail('prompt accepts at most ' + spec.promptMax + ' characters')
    ;['images', 'videos', 'audios'].forEach((kind, index) => {
      const urls = [images, videos, audios][index]
      const files = fileRefs.filter(file => file.name === kind)
      if (urls.length + files.length > spec.refs[index]) fail(kind + ' accepts at most ' + spec.refs[index])
    })
  }
  if (fileRefs.length && (images.length || videos.length || audios.length)) fail('Files and media URLs cannot be combined')
  if (fileRefs.length) payload.fileRefs = fileRefs
  return payload
}

function normalizedDuration(body) {
  const request = snapshot(body)
  const duration = Number(request.duration === undefined ? request.seconds : request.duration)
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function usageFacts(ctx, duration, body) {
  const request = snapshot(ctx && ctx.requestBody)
  const result = snapshot(body)
  const seconds = Number(duration)
  const validSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : normalizedDuration(request)
  const resolution = String(result.resolution || request.resolution || '').toLowerCase()
  const spec = compatibilityVideo(ctx) ? undefined : VIDEO_SPECS[videoModel(ctx.upstreamModel || ctx.model || request.model)]
  const billing = snapshot(result.billing)
  const token = billing.mode === 'token' && billing.settled === true
  const byRequest = Boolean(spec && spec.unit === 'request')
  const callTier = byRequest && spec.callTiers ? spec.callTiers.find(item => resolution.includes(item.replace('p', ''))) || spec.callTiers[0] : ''
  const billableSeconds = byRequest || token ? 0 : validSeconds
  return {
    calls: byRequest && !callTier ? 1 : 0,
    calls_720p: callTier === '720p' ? 1 : 0,
    calls_1080p: callTier === '1080p' ? 1 : 0,
    video_reference_tokens: token ? Number(snapshot(billing.usage).total_tokens) : 0,
    upstream_cost_yuan: Number.isFinite(Number(billing.charged_cost_cents)) ? Number(billing.charged_cost_cents) / 100 : 0,
    seconds: billableSeconds,
    seconds_480p: resolution.includes('480') ? billableSeconds : 0,
    seconds_720p: resolution.includes('720') ? billableSeconds : 0,
    seconds_768p: resolution.includes('768') ? billableSeconds : 0,
    seconds_1080p: resolution.includes('1080') ? billableSeconds : 0,
    image_count: 0,
  }
}

function isImageModel(ctx) {
  const candidates = [ctx && ctx.upstreamModel, ctx && ctx.model, ctx && ctx.requestBody && ctx.requestBody.model]
  return candidates.some(model => Boolean(resolveImageModel(model)))
}

function imageModel(ctx, fallback) {
  const candidates = [ctx && ctx.upstreamModel, ctx && ctx.model, fallback]
  for (const candidate of candidates) {
    const model = resolveImageModel(candidate)
    if (model) return model
  }
  return ''
}

function resolveImageModel(value) {
  const model = String(value || '')
  return IMAGE_MODEL_IDS.includes(model) ? model : ''
}

function imageApiBase(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return base.endsWith('/api/open/v1') ? base : base + '/api/open/v1'
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || !['json', 'multipart'].includes(ctx.body.kind)) fail('JSON or multipart video request required')
      const values = ctx.body.kind === 'json' ? snapshot(ctx.body.value) : formValues(ctx.body.fields)
      const files = ctx.body.kind === 'multipart' && Array.isArray(ctx.body.files) ? ctx.body.files : []
      const fileRefs = files.map(file => {
        const name = file.field
        if (!['images', 'videos', 'audios'].includes(name) || !file.ref) fail('Unsupported video file field: ' + name)
        return { name, ref: file.ref, filename: file.filename }
      })
      const payload = normalizeRequest({ ...values, model: ctx.upstreamModel || ctx.model || values.model }, fileRefs)
      const hasReference = Boolean(
        (payload.imageUrls && payload.imageUrls.length) ||
        (payload.videoUrls && payload.videoUrls.length) ||
        (payload.audioUrls && payload.audioUrls.length) || fileRefs.length,
      )
      return {
        kind: 'submit',
        model: ctx.model,
        action: hasReference ? 'image_to_video' : 'text_to_video',
        requestBody: payload,
      }
    },
    render: function (ctx, task) {
      const view = {
        id: task.task_id,
        object: 'video',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
      if (task.status === 'FAILURE') {
        const data = snapshot(task.data)
        view.error = imageError(data)
      }
      const data = snapshot(task.data)
      const signed = videoResultUrl(data) || videoResultUrl(snapshot(data.data))
      const artifacts = snapshot(ctx && ctx.artifacts)
      if (task.status === 'SUCCESS' && signed) {
        // 服务器出口只有 2.5 Mbps，经宿主转发的大视频会断；上游文档也推荐直接用签名地址。
        view.video_url = signed
      } else if (task.status === 'SUCCESS' && artifacts.video && artifacts.video.url) {
        view.video_url = String(artifacts.video.url)
      }
      return view
    },
  },
  openai_image: {
    decodeRequest: function (ctx) {
      const requestedModel = String(ctx.model || '')
      const model = imageModel(ctx, requestedModel)
      if (!model) fail('Unsupported Fk image model: ' + (requestedModel || '(missing)'))
      if (!ctx.body || !['json', 'multipart'].includes(ctx.body.kind)) fail('JSON or multipart image request required')
      const values = ctx.body.kind === 'json' ? snapshot(ctx.body.value) : formValues(ctx.body.fields)
      const prompt = String(firstValue(values, ['prompt']) || '').trim()
      if (!prompt) fail('prompt is required')

      const files = ctx.body.kind === 'multipart' && Array.isArray(ctx.body.files) ? ctx.body.files : []
      const imageUrls = imageUrlList(values)
      const imageRefs = files.map(file => ({ ref: file.ref, filename: file.filename }))
      const size = String(firstValue(values, ['size']) || '')
      const ratio = String(firstValue(values, ['ratio', 'aspect_ratio', 'aspectRatio']) || ratioFromSize(size) || 'auto')
      const imageSize = normalizeImageSize(firstValue(values, ['imageSize', 'image_size', 'resolution', 'quality']))
      if (!IMAGE_RATIOS.includes(ratio)) fail('Unsupported Fk image ratio: ' + ratio)
      if (imageRefs.length + imageUrls.length > IMAGE_LIMITS[model]) fail('Reference images accepts at most ' + IMAGE_LIMITS[model])
      if (imageRefs.length && imageUrls.length) fail('Files and image URLs cannot be combined')
      if (values.mask !== undefined) fail('Fk does not support mask edits')

      return {
        kind: 'submit',
        model: ctx.model,
        action: imageRefs.length || imageUrls.length ? 'image_to_image' : 'text_to_image',
        requestBody: { model, prompt, ratio, imageSize, imageUrls, imageRefs },
      }
    },
    render: function (ctx, task) {
      const data = snapshot(task && task.data)
      const urls = imageResultUrls(data)
      if (!urls.length) fail('Fk image task completed without result URLs')
      return { data: urls.map(url => ({ url })) }
    },
  },
}

export function buildSubmitRequest(ctx) {
  const body = Object.assign({}, ctx.requestBody)
  if (isImageModel(ctx)) {
    const model = imageModel(ctx, body.model)
    if (!model) fail('Unsupported Fk image model: ' + String(ctx.model || body.model || '(missing)'))
    const request = {
      model,
      prompt: String(body.prompt || ''),
      ratio: String(body.ratio || 'auto'),
    }
    if (body.imageSize) request.imageSize = String(body.imageSize)
    if (Array.isArray(body.imageUrls) && body.imageUrls.length) request.imageUrls = body.imageUrls
    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + ctx.apiKey,
      'X-Public-Model-Ids': '1',
    }
    const url = imageApiBase(ctx.baseUrl) + '/image/generate'
    const imageRefs = Array.isArray(body.imageRefs) ? body.imageRefs : []
    if (imageRefs.length) {
      const parts = [
        { name: 'model', value: model },
        { name: 'prompt', value: request.prompt },
        { name: 'ratio', value: request.ratio },
      ]
      if (request.imageSize) parts.push({ name: 'imageSize', value: request.imageSize })
      imageRefs.forEach(file => parts.push({ name: 'images', fileRef: String(file.ref), filename: String(file.filename || 'reference.png') }))
      return { url, method: 'POST', headers, bodyType: 'multipart', parts, action: ctx.action }
    }
    return {
      url,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: request,
      action: ctx.action,
    }
  }
  body.model = videoModel(ctx.upstreamModel || ctx.model || body.model)
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey }
  const url = compatibilityVideo(ctx) ? String(ctx.baseUrl).replace(/\/+$/, '') + '/v1/videos' : imageApiBase(ctx.baseUrl) + '/video/generate'
  if (!compatibilityVideo(ctx)) headers['X-Public-Model-Ids'] = '1'
  const fileRefs = body.fileRefs || []
  delete body.fileRefs
  if (fileRefs.length) {
    const parts = Object.keys(body).map(name => ({ name, value: String(body[name]) }))
    fileRefs.forEach(file => parts.push({ name: file.name, fileRef: String(file.ref), filename: String(file.filename || 'reference') }))
    return { url, method: 'POST', headers, bodyType: 'multipart', parts, action: ctx.action }
  }
  return {
    url,
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body,
    action: ctx.action,
  }
}

function formValues(fields) {
  const output = {}
  for (const key of Object.keys(fields || {})) {
    const values = fields[key]
    output[key] = Array.isArray(values) && values.length === 1 ? values[0] : values
  }
  return output
}

function firstValue(values, keys) {
  for (const key of keys) {
    const value = values && values[key]
    if (Array.isArray(value)) {
      if (value.length) return value[0]
    } else if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return undefined
}

function imageUrlList(values) {
  let value
  for (const key of ['imageUrls', 'image_urls', 'images', 'image', 'imageUrl', 'image_url']) {
    const candidate = values && values[key]
    if (Array.isArray(candidate) ? candidate.length > 0 : candidate !== undefined && candidate !== null && candidate !== '') {
      value = candidate
      break
    }
  }
  if (value === undefined) return []
  const items = Array.isArray(value) ? value : [value]
  return items.map(item => {
    const url = item && typeof item === 'object' ? item.url : item
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) fail('reference images must be public HTTPS URLs')
    return url
  })
}

function normalizeImageSize(value) {
  const text = String(value || '').trim().toUpperCase()
  if (text && !['1K', '2K', '4K'].includes(text)) fail('Unsupported Fk imageSize: ' + text)
  return text
}

function ratioFromSize(size) {
  const match = /^(\d+)x(\d+)$/i.exec(String(size || '').trim())
  if (!match) return ''
  const ratio = Number(match[1]) / Number(match[2])
  const supported = ['1:1', '9:16', '16:9', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']
  return supported.reduce((best, item) => {
    const parts = item.split(':').map(Number)
    const delta = Math.abs(ratio - parts[0] / parts[1])
    return !best || delta < best.delta ? { item, delta } : best
  }, null)?.item || ''
}

function imageResultUrls(body) {
  const data = snapshot(body && body.data)
  const values = Array.isArray(body && body.resultUrls) ? body.resultUrls
    : Array.isArray(data.resultUrls) ? data.resultUrls
      : Array.isArray(body && body.result_urls) ? body.result_urls
        : Array.isArray(data.data) ? data.data.map(item => item && item.url).filter(Boolean)
          : []
  return values.map(item => typeof item === 'string' ? item : item && item.url).filter(url => typeof url === 'string' && /^https:\/\//i.test(url))
}

function imageError(body) {
  const error = snapshot(body.error)
  return String(body.errorMessage || error.message || (typeof body.error === 'string' ? body.error : '') || body.fail_reason || body.message || 'Fk request failed')
}

export function parseSubmitResponse(ctx, resp) {
  const body = snapshot(resp && resp.body)
  if (isImageModel(ctx)) {
    if (body.success === false) fail(imageError(body))
    const status = String(body.status || '').toLowerCase()
    const taskId = body.jobId || body.job_id
    if (!taskId) fail('Fk image generation did not return a jobId')
    if (status === 'failed') {
      return {
        taskId: String(taskId),
        taskData: body,
        immediate: { status: 'FAILURE', reason: imageError(body) },
      }
    }
    // openai_image 的即时终态不保留结果；查询原 jobId 后完成，复用宿主持久化。
    return { taskId: String(taskId), taskData: body }
  }
  if (!compatibilityVideo(ctx)) {
    if (body.success === false) fail(imageError(body))
    if (!body.jobId) fail('Fk video generation did not return a jobId')
    return { taskId: String(body.jobId), taskData: body }
  }
  const data = snapshot(body.data)
  const taskId = body.id || body.job_id || body.task_id || data.id || data.job_id || data.task_id
  if (!taskId) fail('Fk did not return a task ID')
  return { taskId: String(taskId), taskData: body }
}

export function buildQueryRequest(ctx) {
  if (isImageModel(ctx)) {
    const separator = ctx.baseUrl.includes('?') ? '&' : '?'
    return {
      url: imageApiBase(ctx.baseUrl) + '/image/status' + separator + 'jobId=' + encodeURIComponent(ctx.taskId) + '&_t=' + Date.now(),
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey, 'X-Public-Model-Ids': '1' },
    }
  }
  if (!compatibilityVideo(ctx)) {
    return {
      url: imageApiBase(ctx.baseUrl) + '/video/status?jobId=' + encodeURIComponent(ctx.taskId) + '&_t=' + Date.now(),
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey, 'X-Public-Model-Ids': '1' },
    }
  }
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.taskId),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  if (isImageModel(ctx)) {
    const value = snapshot(body)
    if (value.success === false) fail(imageError(value))
    const status = String(value.status || '').toLowerCase()
    if (status === 'submitted') return { status: 'IN_PROGRESS', progress: '0%' }
    if (status === 'success') {
      if (value.resultAvailable !== true || !imageResultUrls(value).length) {
        return { status: 'IN_PROGRESS', progress: '100%' }
      }
      return { status: 'SUCCESS', progress: '100%' }
    }
    if (status === 'failed') {
      return { status: 'FAILURE', reason: imageError(value) }
    }
    return { status: 'UNKNOWN', reason: 'Unknown Fk image task status: ' + (status || '(empty)') }
  }
  const data = snapshot(body && body.data)
  const result = Object.keys(data).length ? data : snapshot(body)
  if (result.success === false) fail(imageError(result))
  const raw = String(result.status || result.state || '').toLowerCase()
  const status = UPSTREAM_STATUS[raw]
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'SUCCESS' && !compatibilityVideo(ctx)) {
    const billing = snapshot(result.billing)
    const spec = VIDEO_SPECS[videoModel(ctx.upstreamModel || ctx.model || snapshot(ctx.requestBody).model)]
    const request = snapshot(ctx.requestBody)
    const tokenExpected = spec && spec.tokenWithVideo && ((request.videoUrls || []).length || (request.fileRefs || []).some(file => file.name === 'videos'))
    if (!videoResultUrl(result) || (billing.mode === 'token' || tokenExpected) && !settledTokenBilling(billing)) {
      return { status: 'IN_PROGRESS', progress: '100%' }
    }
    out.url = videoResultUrl(result)
  }
  if (status === 'FAILURE') {
    out.reason = imageError(result)
  }
  return out
}

function videoResultUrl(body) {
  const url = String(body.videoUrl || body.contentUrl || body.video_url || body.url || '')
  return /^https:\/\//i.test(url) ? url : ''
}

function settledTokenBilling(billing) {
  const tokens = snapshot(billing.usage).total_tokens
  const cents = billing.charged_cost_cents
  return billing.mode === 'token' && billing.settled === true && typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 0 && typeof cents === 'number' && Number.isFinite(cents) && cents >= 0
}

export function listArtifacts(task) {
  if (task.status !== 'SUCCESS') return []
  if (task.action === 'text_to_image' || task.action === 'image_to_image') {
    return imageResultUrls(task.data).map((url, index) => ({ key: 'image_' + index, type: 'image' }))
  }
  return [{ key: 'video', type: 'video', mimeType: 'video/mp4' }]
}

export function buildContentRequest(ctx) {
  if (ctx.action === 'text_to_image' || ctx.action === 'image_to_image') {
    const match = /^image_(0|[1-9][0-9]*)$/.exec(ctx.artifactKey)
    const url = match && imageResultUrls(ctx.data)[Number(match[1])]
    if (!url) fail('artifact_not_found')
    return { url, method: ctx.clientRequest.method, credentialless: true }
  }
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  const data = snapshot(ctx.data)
  const url = videoResultUrl(data) || videoResultUrl(snapshot(data.data))
  if (url) return { url, method: ctx.clientRequest.method, credentialless: true }
  if (!compatibilityVideo(ctx)) fail('artifact_not_found')
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content',
    method: ctx.clientRequest.method,
    headers: { Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function extractUsage(ctx) {
  const request = snapshot(ctx && ctx.requestBody)
  if (isImageModel(ctx)) {
    return { seconds: 0, seconds_480p: 0, seconds_720p: 0, seconds_1080p: 0, image_count: 1 }
  }
  return usageFacts(ctx, normalizedDuration(request), request)
}

export function extractUsageOnComplete(ctx, task, body) {
  if (isImageModel(ctx)) {
    const count = imageResultUrls(snapshot(body)).length
    return count > 0 ? { image_count: count, seconds_1080p: 0 } : null
  }
  const data = snapshot(body && body.data)
  const result = Object.keys(data).length ? data : snapshot(body)
  const billing = snapshot(result.billing)
  if (billing.mode === 'token' && !settledTokenBilling(billing)) return null
  if (!compatibilityVideo(ctx)) {
    const request = snapshot(ctx.requestBody)
    const spec = VIDEO_SPECS[videoModel(ctx.upstreamModel || ctx.model || request.model)]
    const duration = normalizedDuration(result) || normalizedDuration(request)
    if (spec && spec.unit === 'request' || settledTokenBilling(billing)) return usageFacts(ctx, duration, result)
    // 完成响应和宿主上下文可能都缺少计费字段；返回 null 保留预扣，不能按零用量退款。
    if (!duration || !spec) return null
    const resolution = String(result.resolution || request.resolution || '').toLowerCase()
    if (spec.resolutions && spec.resolutions.length > 1 && !spec.resolutions.includes(resolution)) return null
    return usageFacts(ctx, duration, result)
  }
  const actualDuration = Number(result.duration || result.seconds)
  if (Number.isFinite(actualDuration) && actualDuration > 0) return usageFacts(ctx, actualDuration, result)
  return null
}
