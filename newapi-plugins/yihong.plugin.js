// NewAPI Task Plugin v1 — 易红 API Seedance 视频模型。
// 上游协议为异步视频创建、查询和鉴权内容下载，由 NewAPI openai_video 宿主承载。
const MODELS = {
  'seedance2.5 super': {
    durationField: 'seconds', minSeconds: 5, maxSeconds: 30, defaultSeconds: 5,
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], images: 30, videos: 10, audios: 10,
  },
  'seedance2.5 cheap': {
    durationField: 'seconds', minSeconds: 4, maxSeconds: 30, defaultSeconds: 15,
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], images: 30, videos: 0, audios: 0,
  },
  'seedance-2.5-max': {
    durationField: 'duration', minSeconds: 30, maxSeconds: 30, defaultSeconds: 30,
    ratios: [], images: 30, videos: 0, audios: 0,
  },
  'seedance-2.5-Muse': {
    durationField: 'seconds', minSeconds: 5, maxSeconds: 30, defaultSeconds: 30,
    ratios: ['16:9', '9:16'], images: 9, videos: 0, audios: 0,
  },
}

const UPSTREAM_STATUS = {
  queued: 'QUEUED',
  in_progress: 'IN_PROGRESS',
  completed: 'SUCCESS',
  failed: 'FAILURE',
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
  key: 'yihong',
  name: '易红 API',
  version: '0.1.1',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Yihong API Seedance video generation',
    zh: '易红 API Seedance 2.5 视频生成',
  },
  models: Object.keys(MODELS),
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  baseUrl: 'https://yihongapi.com',
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Video task count', zh: '视频任务数' },
    },
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Requested video duration', zh: '请求的视频时长' },
    },
  },
  usageExamples: [
    { label: '单次视频任务', facts: { calls: 1, seconds: 5 } },
    { label: '30 秒视频任务', facts: { calls: 1, seconds: 30 } },
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
  return entries.map(entry => {
    const value = entry && typeof entry === 'object' ? entry.url : entry
    if (typeof value !== 'string' || !value.trim()) fail('Reference media must be accessible by URL')
    return value.trim()
  })
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

function secondsOf(body, config) {
  if (config.durationField === 'duration' && config.minSeconds === config.maxSeconds) return config.defaultSeconds
  const raw = firstDefined(body, ['seconds', 'duration'])
  const seconds = raw === undefined ? config.defaultSeconds : Number(raw)
  if (!Number.isInteger(seconds) || seconds < config.minSeconds || seconds > config.maxSeconds) {
    fail(`seconds must be an integer from ${config.minSeconds} to ${config.maxSeconds}`)
  }
  return seconds
}

function configOf(model) {
  const config = MODELS[model]
  if (!config) fail(`Unsupported model: ${model || '(missing)'}`)
  return config
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = String(body.model || '')
  const config = configOf(model)
  if (!promptOf(body)) fail('prompt is required')
  const seconds = secondsOf(body, config)
  const inputs = requestInputs(body)
  for (const kind of ['images', 'videos', 'audios']) {
    if (inputs[kind].length > config[kind]) fail(`${kind} accepts at most ${config[kind]} references for ${model}`)
  }
  const ratio = firstDefined(body, ['ratio', 'aspect_ratio', 'aspectRatio'])
  if (config.ratios.length && ratio !== undefined && !config.ratios.includes(String(ratio))) {
    fail(`Unsupported ratio for ${model}: ${String(ratio)}`)
  }
  return { model, config, seconds, inputs, ratio }
}

export const protocols = {
  openai_video: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const validated = validateRequest(ctx.body.value)
      const { inputs } = validated
      return {
        kind: 'submit',
        model: ctx.model,
        action: inputs.images.length || inputs.videos.length || inputs.audios.length ? 'image_to_video' : 'text_to_video',
        requestBody: ctx.body.value,
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
  const model = String(ctx.upstreamModel || ctx.model)
  const { config, seconds, inputs, ratio } = validateRequest({ ...source, model })
  const body = {
    model,
    prompt: promptOf(source),
    [config.durationField]: seconds,
  }
  if (config.ratios.length && typeof ratio === 'string' && ratio.trim()) body.ratio = ratio.trim()
  if (inputs.images.length) body.image_urls = inputs.images
  if (inputs.videos.length) body.video_urls = inputs.videos
  if (inputs.audios.length) body.audio_urls = inputs.audios
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
  const taskId = body.id || body.task_id
  if (!taskId) fail('Yihong API did not return a task id')
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
  if (!status) return { status: 'UNKNOWN', reason: `Unknown Yihong task status: ${raw || '(empty)'}` }
  const result = { status }
  if (status === 'FAILURE') {
    const error = objectOf(snapshot.error)
    result.reason = String(error.message || snapshot.message || 'Yihong video generation failed')
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
  const body = objectOf(ctx && ctx.requestBody)
  const model = String(body.model || ctx && ctx.model || '')
  const config = configOf(model)
  const seconds = secondsOf(body, config)
  return { calls: 1, seconds }
}

export function extractUsageOnComplete() {
  return { calls: 1 }
}
