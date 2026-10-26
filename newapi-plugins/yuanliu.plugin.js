// NewAPI Task Plugin v1 — 源流 AI OpenAPI 视频型号。
// 上游协议为异步视频创建、查询和鉴权内容下载，直接由 NewAPI openai_video 宿主承载。
// 型号、素材上限、时长与画幅来自用户 2026-10-26 提供的源流模型中心截图；售价见 yuanliu-pricing.json。
// 计费：按次型号用 calls；按秒型号用 seconds，多画质型号再按 resolution 分档。
// 面板目录：标记之间必须是纯 JSON，可用性服务按标记截取下发创作面板。改型号只改这里；
// 公开名 → 上游 ID 与插件校验都由它推导，渠道后台映射留空也能发上游 ID。
export const catalog = /*jc-catalog*/{
  "schema": "jc-catalog-v1",
  "models": [
    { "name": "Seedance 2.5(HD)", "upstream": "yl_seedance-2-5_6caffaca7390", "task": "video", "group": "源流 AI",
      "ratios": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["720p"], "duration": { "min": 10, "max": 30, "default": 10 },
      "refs": { "images": 10, "videos": 0, "audios": 0 }, "billing": "request", "price": "¥6/次" },
    { "name": "Seedance 2.5 (LJ-02)", "upstream": "yl_g7zy_seedance_v2_5_s", "task": "video", "group": "源流 AI",
      "ratios": ["auto", "1:1", "3:4", "4:3", "9:16", "16:9", "21:9"], "resolutions": ["720p"], "duration": { "min": 5, "max": 30, "default": 5 },
      "refs": { "images": 30, "videos": 0, "audios": 0 }, "billing": "second", "price": "¥0.5/秒" },
    { "name": "Seedance 2.5 720p (QN-12)", "upstream": "yl_pp_mj_sd25_30010", "task": "video", "group": "源流 AI",
      "ratios": ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"], "resolutions": ["480p", "720p", "1080p"], "duration": { "min": 4, "max": 30, "default": 5 },
      "refs": { "images": 30, "videos": 0, "audios": 10 }, "billing": "second", "price": "480p/720p ¥0.6/秒 · 1080p ¥1/秒" },
    { "name": "Seedance 2.5 (RK-02)", "upstream": "yl_cm_73", "task": "video", "group": "源流 AI",
      "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480p", "720p"], "duration": { "min": 4, "max": 30, "default": 5 },
      "refs": { "images": 30, "videos": 10, "audios": 10 }, "billing": "second", "price": "480p ¥0.6/秒 · 720p ¥0.8/秒" },
    { "name": "Seedance2.0 720P (YC-02)", "upstream": "yl_zh_tt_sedanco_2_0_720", "task": "video", "group": "源流 AI",
      "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720p"], "duration": { "min": 5, "max": 15, "default": 5 },
      "refs": { "images": 9, "videos": 3, "audios": 3 }, "billing": "second", "price": "¥0.4/秒" },
    { "name": "Seedance2.0(HD)", "upstream": "yl_seedance-2-0_ba0687ff09f2", "task": "video", "group": "源流 AI",
      "ratios": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["720p"], "duration": { "values": [10, 15], "default": 10 },
      "refs": { "images": 9, "videos": 0, "audios": 0 }, "billing": "request", "price": "¥4/次" }
  ]
}/*end-jc-catalog*/
const PUBLIC_NAMES = Object.fromEntries(catalog.models.map(model => [model.name, model.upstream]))
const MODEL_SPECS = Object.fromEntries(catalog.models.map(model => [model.upstream, {
  refs: [model.refs.images, model.refs.videos, model.refs.audios],
  unit: model.billing === 'request' ? 'call' : 'second',
  min: model.duration.min,
  max: model.duration.max,
  durations: model.duration.values,
  ratios: model.ratios,
  resolutions: model.resolutions,
}]))
const DEFAULT_RESOLUTION = '480p'

const UPSTREAM_STATUS = {
  queued: 'QUEUED',
  in_progress: 'IN_PROGRESS',
  completed: 'SUCCESS',
  failed: 'FAILURE',
  unknown: 'UNKNOWN',
}

const HOST_STATUS = {
  QUEUED: 'queued',
  SUBMITTED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

export const meta = {
  apiVersion: 1,
  key: 'yuanliu',
  name: '源流 AI',
  version: '0.3.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Yuanliu AI Seedance and Wan video generation',
    zh: '源流 AI Seedance 六个视频型号',
  },
  models: Object.keys(PUBLIC_NAMES),
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // Public docs expose /openapi/v1/videos; channel Base URL includes /openapi.
  baseUrl: 'https://www.yuanliuai.com/openapi',
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Video task count', zh: '视频任务数' },
    },
    seconds: { type: 'number', unit: 'second', description: { en: 'Billable video seconds', zh: '计费秒数，按次型号为 0' } },
    resolution: { enum: ['480p', '720p', '1080p'], description: { en: 'Video resolution', zh: '视频分辨率' } },
  },
  usageExamples: [
    { label: '按次任务', facts: { calls: 1, seconds: 0, resolution: '480p' } },
    { label: '720p 10 秒', facts: { calls: 0, seconds: 10, resolution: '720p' } },
  ],
}

function fail(message) {
  throw new Error(message)
}

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

function mediaUrls(source, keys) {
  const raw = firstDefined(source, keys)
  if (raw === undefined) return []
  const entries = Array.isArray(raw) ? raw : [raw]
  const urls = []
  for (const entry of entries) {
    const value = entry && typeof entry === 'object' ? entry.url : entry
    if (typeof value !== 'string' || !value.trim()) fail('Reference media must be accessible by URL')
    const url = value.trim()
    urls.push(url)
  }
  return urls
}

function requestInputs(body) {
  return {
    images: mediaUrls(body, ['images', 'imageUrls', 'image_urls', 'imageUrl', 'image_url', 'image']),
    videos: mediaUrls(body, ['videos', 'videoUrls', 'video_urls', 'videoUrl', 'video_url', 'video']),
    audios: mediaUrls(body, ['audios', 'audioUrls', 'audio_urls', 'audioUrl', 'audio_url', 'audio']),
  }
}

function promptOf(body) {
  return String(body.prompt || '').trim()
}

function durationOf(body) {
  const raw = firstDefined(body, ['duration', 'seconds'])
  const duration = Number(raw)
  if (!Number.isInteger(duration) || duration <= 0) fail('duration must be a positive integer')
  return duration
}

function specOf(ctx) {
  const model = String((ctx && (ctx.upstreamModel || ctx.model)) || objectOf(ctx && ctx.requestBody).model || '')
  return MODEL_SPECS[upstreamModel(model)] || {}
}

function upstreamModel(value) {
  return PUBLIC_NAMES[value] || value
}

function billedResolution(source, spec) {
  const raw = firstDefined(source, ['resolution'])
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const allowed = spec.resolutions || []
  if (allowed.includes(value)) return value
  return allowed[0] || value || DEFAULT_RESOLUTION
}

export const protocols = {
  openai_video: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      const spec = MODEL_SPECS[upstreamModel(model)]
      if (!spec) fail(`Unsupported model: ${model || '(missing)'}`)
      if (!promptOf(body)) fail('prompt is required')
      const duration = durationOf(body)
      if (spec.durations ? !spec.durations.includes(duration) : duration < spec.min || duration > spec.max) {
        fail(`${model} duration must be ${spec.durations ? spec.durations.join(' or ') : spec.min + '-' + spec.max} seconds`)
      }
      const ratio = firstDefined(body, ['aspect_ratio', 'aspectRatio', 'ratio'])
      if (ratio !== undefined && ratio !== null && String(ratio).trim() && !spec.ratios.includes(String(ratio).trim())) fail(`${model} aspect_ratio must be one of ${spec.ratios.join(', ')}`)
      const raw = firstDefined(body, ['resolution'])
      if (raw !== undefined && raw !== null && String(raw).trim() && !spec.resolutions.includes(String(raw).trim().toLowerCase())) {
        fail(`${model} resolution must be one of ${spec.resolutions.join(', ')}`)
      }

      const inputs = requestInputs(body)
      const [images, videos, audios] = spec.refs
      for (const [kind, limit] of [['images', images], ['videos', videos], ['audios', audios]]) {
        if (inputs[kind].length > limit) fail(`${kind} accepts at most ${limit} references for ${model}`)
      }

      return {
        kind: 'submit',
        model: ctx.model,
        action: inputs.images.length || inputs.videos.length || inputs.audios.length ? 'image_to_video' : 'text_to_video',
        requestBody: body,
      }
    },
    render(ctx, task) {
      const artifacts = objectOf(ctx && ctx.artifacts)
      const video = objectOf(artifacts.video)
      const view = {
        id: task.task_id,
        object: 'video',
        model: task.model || '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
      if (video.url) view.video_url = String(video.url)
      const snapshot = objectOf(task && task.data)
      const error = objectOf(snapshot.error)
      if (error.message) view.error = String(error.message)
      return view
    },
  },
}

export function buildSubmitRequest(ctx) {
  const source = objectOf(ctx.requestBody)
  const spec = specOf(ctx)
  const inputs = requestInputs(source)
  const body = {
    model: upstreamModel(String(ctx.upstreamModel || ctx.model)),
    prompt: promptOf(source),
    duration: durationOf(source),
  }

  const aspectRatio = firstDefined(source, ['aspect_ratio', 'aspectRatio', 'ratio'])
  if (typeof aspectRatio === 'string' && aspectRatio.trim()) body.aspect_ratio = aspectRatio.trim()
  body.resolution = billedResolution(source, spec)
  for (const kind of ['images', 'videos', 'audios']) {
    if (inputs[kind].length) body[kind] = inputs[kind]
  }

  const requestId = firstDefined(source, ['client_request_id', 'request_id'])
  if (requestId !== undefined && requestId !== null && String(requestId).trim()) {
    const value = String(requestId).trim()
    if (value.length > 100) fail('client_request_id must be at most 100 characters')
    body.client_request_id = value
  }

  return {
    url: ctx.baseUrl + '/v1/videos',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + ctx.apiKey,
    },
    body,
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, response) {
  const body = objectOf(response && response.body)
  const taskId = body.task_id || body.id
  if (!taskId) fail('Yuanliu API did not return a task id')
  return { taskId: String(taskId), taskData: body }
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.taskId),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  const snapshot = objectOf(body)
  const raw = String(snapshot.status || '').toLowerCase()
  const status = UPSTREAM_STATUS[raw]
  if (!status) return { status: 'UNKNOWN', reason: `Unknown Yuanliu task status: ${raw || '(empty)'}` }
  const result = { status }
  if (status === 'FAILURE') {
    const error = objectOf(snapshot.error)
    result.reason = String(error.message || snapshot.message || 'Yuanliu video generation failed')
  }
  return result
}

export function listArtifacts(task) {
  return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content',
    method: ctx.clientRequest.method,
    headers: { Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function extractUsage(ctx) {
  const source = objectOf(ctx && ctx.requestBody)
  const spec = specOf({ ...ctx, requestBody: source })
  const raw = Number(firstDefined(source, ['duration', 'seconds']))
  return {
    calls: 1,
    seconds: spec.unit === 'second' && Number.isInteger(raw) && raw > 0 ? raw : 0,
    resolution: billedResolution(source, spec),
  }
}

// 完成态沿用同一份事实，避免按秒型号被零用量退款；上游给出实际时长时按实际结算。
export function extractUsageOnComplete(ctx, task, body) {
  const usage = extractUsage(ctx)
  if (!usage.seconds) return usage
  const actual = Number(firstDefined(objectOf(body), ['duration', 'seconds']))
  return Number.isInteger(actual) && actual > 0 ? { ...usage, seconds: actual } : usage
}
