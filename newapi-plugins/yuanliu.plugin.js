// NewAPI Task Plugin v1 — 源流 AI OpenAPI Seedance 视频模型。
// 上游协议为异步视频创建、查询和鉴权内容下载，直接由 NewAPI openai_video 宿主承载。
const MODEL_LIMITS = {
  'yl_seedance-2-5_6caffaca7390': { images: 30, videos: 0, audios: 0 },
  'yl_seedance-2-5_0fab2f1b1f10': { images: 30, videos: 10, audios: 10 },
}

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
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Yuanliu AI Seedance video generation',
    zh: '源流 AI Seedance 2.5 视频生成',
  },
  models: Object.keys(MODEL_LIMITS),
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // Public docs expose /openapi/v1/videos; channel Base URL includes /openapi.
  baseUrl: 'https://test.yuanliuai.tsyzai.com/openapi',
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Video task count', zh: '视频任务数' },
    },
  },
  usageExamples: [
    { label: '一次视频任务', facts: { calls: 1 } },
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

export const protocols = {
  openai_video: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      const limits = MODEL_LIMITS[model]
      if (!limits) fail(`Unsupported model: ${model || '(missing)'}`)
      if (!promptOf(body)) fail('prompt is required')
      durationOf(body)

      const inputs = requestInputs(body)
      for (const kind of ['images', 'videos', 'audios']) {
        if (inputs[kind].length > limits[kind]) fail(`${kind} accepts at most ${limits[kind]} references for ${model}`)
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
  const inputs = requestInputs(source)
  const body = {
    model: String(ctx.upstreamModel || ctx.model),
    prompt: promptOf(source),
    duration: durationOf(source),
  }

  const aspectRatio = firstDefined(source, ['aspect_ratio', 'aspectRatio', 'ratio'])
  if (typeof aspectRatio === 'string' && aspectRatio.trim()) body.aspect_ratio = aspectRatio.trim()
  const resolution = firstDefined(source, ['resolution'])
  if (typeof resolution === 'string' && resolution.trim()) body.resolution = resolution.trim()
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

export function extractUsage() {
  return { calls: 1 }
}

export function extractUsageOnComplete() {
  return { calls: 1 }
}
