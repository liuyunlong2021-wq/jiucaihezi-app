const VIDEO_MODEL = 'grok-imagine-video-1.5'
const IMAGE_MODELS = [
    'gpt-image-2-1k',
    'gpt-image-2-超分',
    'gpt-image-2.5-1k',
    'gpt-image-2.5-flare-1k',
    'gpt-image-2.5-sunburst-1k',
    'gpt-image-2.5-官方',
    'gpt-image-2.5-flare-官方',
    'gpt-image-2.5-sunburst-官方',
    'gpt-image-2.5-flare-CF-超分',
    'gpt-image-2.5-sunburst-CF-超分',
    'grok-imagine-image-2.0',
    'grok-imagine-image',
  ]

// NewAPI Task Plugin v1 — Xiaoyi OpenAI Images
// Xiaoyi's asynchronous image endpoints are polled by the NewAPI rc40 openai_image host protocol.
// The host returns an OpenAI ImageResponse; the client then downloads the returned URL as usual.
export const meta = {
  apiVersion: 1,
  key: 'xiaoyi-image',
  name: '小易图片与视频',
  version: '0.2.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'GPT Image, Grok images and Grok Video 1.5 via Xiaoyi asynchronous APIs',
    zh: '通过小易异步接口生成 GPT Image、Grok图片与Grok Video 1.5',
  },
  baseUrl: 'https://image.xiaoyiapi.xyz',
  models: [...IMAGE_MODELS, VIDEO_MODEL],
  fetchMode: 'per_task',
  protocols: [{ name: 'openai_image', models: IMAGE_MODELS }, { name: 'openai_video', models: [VIDEO_MODEL] }],
  usageSchema: {
    seconds: { type: 'number', unit: 'second', description: { en: 'Requested video seconds', zh: '请求视频秒数' } },
    resolution: { enum: ['none', '480p', '720p', '1080p'], description: { en: 'Video resolution', zh: '视频分辨率；图片为none' } },
    image_count: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'image', zh: '张' },
      description: { en: 'Requested image count', zh: '请求生成的图片数量' },
    },
  },
  usageExamples: [
    { label: '生成 1 张', facts: { image_count: 1, seconds: 0, resolution: 'none' } },
    { label: '720p视频6秒', facts: { image_count: 0, seconds: 6, resolution: '720p' } },
    { label: '生成 4 张', facts: { image_count: 4, seconds: 0, resolution: 'none' } },
  ],
}

const MODEL_MAP = {
  'gpt-image-2-1k': 'gpt-image-2',
  'gpt-image-2-超分': 'gpt-image-2.5-CF',
  'gpt-image-2.5-1k': 'gpt-image-2.5',
  'gpt-image-2.5-flare-1k': 'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst-1k': 'gpt-image-2.5-sunburst',
  'gpt-image-2.5-官方': 'gpt-image-2.5',
  'gpt-image-2.5-flare-官方': 'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst-官方': 'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare-CF-超分': 'gpt-image-2.5-flare-CF',
  'gpt-image-2.5-sunburst-CF-超分': 'gpt-image-2.5-sunburst-CF',
}

function fail(message) {
  throw new Error(message)
}

function snapshotOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function first(fields, key, fallback) {
  const value = fields && fields[key]
  if (Array.isArray(value)) return value.length ? value[0] : fallback
  return value === undefined || value === null ? fallback : value
}

function requestedCount(value) {
  const count = value === undefined || value === null ? 1 : Number(value)
  if (!Number.isSafeInteger(count) || count < 1) fail('n must be a positive integer')
  return count
}

function validateGrokSize(body, model) {
  if (!model.startsWith('grok-imagine-image')) return
  const size = String(body.size || '1024x1024')
  const dimensions = /^(\d+)x(\d+)$/i.exec(size)
  if (!dimensions || Number(dimensions[1]) < 1 || Number(dimensions[2]) < 1) fail('Grok size must be explicit pixel dimensions')
  if (body.ratio === undefined) return
  const ratios = ['1:1', '16:9', '9:16', '3:2', '2:3']
  if (!ratios.includes(String(body.ratio))) fail('Unsupported Grok aspect_ratio')
  const [width, height] = body.ratio.split(':').map(Number)
  // Pixel dimensions may round one edge by one pixel.
  if (Math.abs(Number(dimensions[1]) * height - Number(dimensions[2]) * width) > Math.max(width, height)) fail('Grok size conflicts with aspect_ratio')
}

function resultOf(value) {
  const payload = snapshotOf(value)
  return snapshotOf(payload.result || (payload.data && payload.data.result) || payload)
}

function imageEntries(value) {
  const result = resultOf(value)
  return (Array.isArray(result.data) ? result.data : []).filter(entry => {
    const image = snapshotOf(entry)
    return (typeof image.url === 'string' && image.url.trim()) || (typeof image.b64_json === 'string' && image.b64_json.trim())
  })
}

function modelOf(ctx) {
  const model = String(ctx.model || '')
  if (!IMAGE_MODELS.includes(model)) fail(`Unsupported Xiaoyi image model: ${model || '(missing)'}`)
  return model
}

function requestValues(ctx) {
  if (!ctx.body || !['json', 'multipart'].includes(ctx.body.kind)) {
    fail('JSON generation or multipart image edit required')
  }
  const values = ctx.body.kind === 'json'
    ? snapshotOf(ctx.body.value)
    : ctx.body.fields || {}
  const prompt = String(first(values, 'prompt', '') || '').trim()
  if (!prompt) fail('prompt is required')
  return { values, prompt }
}

function isVideo(ctx) {
  return [ctx && ctx.upstreamModel, ctx && ctx.model, ctx && ctx.requestBody && ctx.requestBody.model].includes(VIDEO_MODEL)
}

function videoRequest(value) {
  const body = snapshotOf(value)
  if (body.model !== VIDEO_MODEL) fail('Unsupported Xiaoyi video model')
  const prompt = String(body.prompt || '').trim()
  if (!prompt) fail('prompt is required')
  const seconds = Number(body.seconds === undefined ? (body.duration === undefined ? 6 : body.duration) : body.seconds)
  if (![6, 10].includes(seconds)) fail('seconds must be 6 or 10')
  if (body.seconds !== undefined && body.duration !== undefined && Number(body.duration) !== seconds) fail('seconds conflicts with duration')
  const resolution = String(body.resolution || '720p').toLowerCase()
  if (!['480p', '720p', '1080p'].includes(resolution)) fail('Unsupported video resolution')
  const ratio = String(body.aspect_ratio || body.ratio || body.aspectRatio || '16:9')
  if (!['16:9', '9:16'].includes(ratio)) fail('Unsupported video aspect_ratio')
  for (const key of ['aspect_ratio', 'ratio', 'aspectRatio']) {
    if (body[key] !== undefined && String(body[key]) !== ratio) fail('Conflicting video aspect ratios')
  }
  let references = []
  for (const key of ['image', 'images', 'imageUrl', 'imageUrls', 'image_url', 'image_urls']) {
    const raw = body[key]
    if (raw !== undefined && raw !== null && raw !== '' && !(Array.isArray(raw) && !raw.length)) {
      references = Array.isArray(raw) ? raw : [raw]
      break
    }
  }
  if (references.length > 1) fail('Grok video accepts at most one reference image')
  const image = references.length ? (typeof references[0] === 'object' ? references[0].url : references[0]) : undefined
  if (image !== undefined && (typeof image !== 'string' || !/^https:\/\//i.test(image))) fail('Video reference image must be an HTTPS URL')
  for (const key of ['video', 'videos', 'videoUrls', 'audio', 'audios', 'audioUrls']) {
    const raw = body[key]
    if (raw && (!Array.isArray(raw) || raw.length)) fail('Grok video does not support reference video or audio')
  }
  return { model: VIDEO_MODEL, prompt, seconds: String(seconds), aspect_ratio: ratio, resolution, ...(image ? { image } : {}) }
}

function renderVideo(ctx, task) {
  const view = { id: task.task_id, object: 'video', model: VIDEO_MODEL,
    status: { QUEUED: 'queued', SUBMITTED: 'queued', IN_PROGRESS: 'in_progress', SUCCESS: 'completed', FAILURE: 'failed' }[task.status] || 'unknown',
    progress: Number(String(task.progress || '0').replace('%', '')), created_at: task.created_at }
  const video = snapshotOf(snapshotOf(ctx && ctx.artifacts).video)
  if (video.url) view.video_url = String(video.url)
  const error = snapshotOf(snapshotOf(task.data).error)
  if (error.message) view.error = String(error.message)
  return view
}

export const protocols = {
  openai_video: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON video body required')
      const requestBody = videoRequest({ ...snapshotOf(ctx.body.value), model: ctx.model })
      return { kind: 'submit', model: ctx.model, action: requestBody.image ? 'image_to_video' : 'text_to_video', requestBody }
    },
    render: renderVideo,
  },
  openai_image: {
    decodeRequest: function (ctx) {
      const model = modelOf(ctx)
      const { values, prompt } = requestValues(ctx)
      const files = ctx.body.kind === 'multipart' && Array.isArray(ctx.body.files) ? ctx.body.files : []
      if (ctx.operation === 'edit' && !files.length) fail('multipart image edit requires at least one image file')
      const references = ['image', 'images', 'image_url', 'image_urls', 'imageUrl', 'imageUrls', 'input_reference']
      if (ctx.body.kind === 'json' && references.some(key => {
        const value = values[key]
        return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ''
      })) fail('Reference images require multipart image edit')
      const requestBody = {
        model,
        prompt,
        n: requestedCount(first(values, 'n', 1)),
        imageRefs: files.map(file => ({ ref: file.ref, filename: file.filename })),
      }
      const size = first(values, 'size', undefined)
      const quality = first(values, 'quality', undefined)
      const ratio = first(values, 'aspect_ratio', first(values, 'aspectRatio', first(values, 'ratio', undefined)))
      if (size !== undefined && size !== null) requestBody.size = size
      if (quality !== undefined && quality !== null) requestBody.quality = quality
      if (ratio !== undefined && ratio !== null) requestBody.ratio = ratio
      for (const key of ['background', 'output_format']) {
        const value = first(values, key, undefined)
        if (value !== undefined && value !== null) requestBody[key] = String(value)
      }
      validateGrokSize(requestBody, model)
      return {
        kind: 'submit',
        model: ctx.model,
        action: ctx.operation === 'edit' ? 'image_to_image' : 'text_to_image',
        requestBody,
      }
    },
    render: function (ctx, task) {
      const result = resultOf(task && task.data)
      const entries = imageEntries(result)
      const data = entries.map(item => {
        const image = snapshotOf(item)
        const entry = {}
        if (image.url) entry.url = String(image.url)
        if (image.b64_json) entry.b64_json = String(image.b64_json)
        if (image.revised_prompt) entry.revised_prompt = String(image.revised_prompt)
        return entry
      }).filter(item => item.url || item.b64_json)
      if (!data.length) fail('Xiaoyi image task completed without an image URL or Base64 result')
      const created = Number(result.created)
      return created > 0 ? { created, data } : { data }
    },
  },
}

export function buildSubmitRequest(ctx) {
  if (isVideo(ctx)) return {
    url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos', method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
    body: videoRequest({ ...snapshotOf(ctx.requestBody), model: ctx.upstreamModel || ctx.model }), action: ctx.action,
  }
  const body = snapshotOf(ctx.requestBody)
  const publicModel = String(ctx.model || body.model || '')
  const requestedModel = String(ctx.upstreamModel || publicModel)
  const model = requestedModel === publicModel
    ? (MODEL_MAP[publicModel] || publicModel)
    : requestedModel
  if (!model) fail('model is required for Xiaoyi image generation')
  const headers = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + ctx.apiKey,
  }
  const isGrok = model.startsWith('grok-imagine-image')
  const common = {
    model,
    prompt: String(body.prompt || ''),
    size: String(body.size || '1024x1024'),
    n: requestedCount(body.n),
    response_format: 'url',
  }
  if (isGrok && body.ratio) common.aspect_ratio = String(body.ratio)
  if (!isGrok && body.quality) common.quality = String(body.quality)
  for (const key of ['background', 'output_format']) {
    if (body[key] !== undefined) common[key] = String(body[key])
  }
  validateGrokSize(body, model)

  if (ctx.action === 'image_to_image') {
    const files = Array.isArray(body.imageRefs) ? body.imageRefs : []
    if (!files.length) fail('multipart image edit requires at least one image file')
    const parts = [
      { name: 'model', value: model },
      { name: 'prompt', value: common.prompt },
      { name: 'size', value: common.size },
      { name: 'n', value: String(common.n) },
      { name: 'response_format', value: 'url' },
    ]
    if (common.aspect_ratio) parts.push({ name: 'aspect_ratio', value: common.aspect_ratio })
    if (common.quality) parts.push({ name: 'quality', value: common.quality })
    for (const key of ['background', 'output_format']) {
      if (common[key] !== undefined) parts.push({ name: key, value: common[key] })
    }
    const field = files.length > 1 ? 'image[]' : 'image'
    files.forEach(file => parts.push({ name: field, fileRef: String(file.ref), filename: String(file.filename || 'reference.png') }))
    return {
      url: ctx.baseUrl.replace(/\/$/, '') + '/v1/images/edits/async',
      method: 'POST',
      headers,
      bodyType: 'multipart',
      parts,
      action: ctx.action,
    }
  }

  return {
    url: ctx.baseUrl.replace(/\/$/, '') + '/v1/images/generations/async',
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: common,
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, response) {
  const body = snapshotOf(response && response.body)
  const taskId = body.task_id || body.id
  if (!taskId) fail('Xiaoyi image submission did not return a task id')
  return { taskId: String(taskId), taskData: isVideo(ctx) ? { ...body, model: VIDEO_MODEL } : body }
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl.replace(/\/$/, '') + (isVideo(ctx) ? '/v1/videos/' : '/v1/images/tasks/') + encodeURIComponent(ctx.taskId),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  const snapshot = snapshotOf(body)
  const raw = String(snapshot.status || '').toLowerCase()
  if (isVideo(ctx)) {
    const status = { queued: 'QUEUED', in_progress: 'IN_PROGRESS', completed: 'SUCCESS', failed: 'FAILURE' }[raw]
    if (!status) return { status: 'UNKNOWN', reason: 'Unknown Xiaoyi video task status: ' + raw }
    if (status === 'FAILURE') return { status, reason: String(snapshotOf(snapshot.error).message || snapshot.message || 'Xiaoyi video generation failed') }
    return { status, progress: String(snapshot.progress || 0) + '%' }
  }
  if (['queued', 'pending', 'running', 'processing', 'in_progress'].includes(raw)) {
    return { status: 'IN_PROGRESS', progress: String(snapshot.progress || '') }
  }
  if (['success', 'succeeded', 'completed', 'complete'].includes(raw)) {
    if (!imageEntries(snapshot).length) return { status: 'UNKNOWN', reason: 'Xiaoyi task reported success without image results' }
    return { status: 'SUCCESS', progress: '100%' }
  }
  if (['failed', 'failure', 'error'].includes(raw)) {
    const error = snapshotOf(snapshot.error)
    const reason = typeof snapshot.error === 'string' ? snapshot.error : error.message
    return { status: 'FAILURE', reason: String(reason || snapshot.message || 'Xiaoyi image generation failed') }
  }
  return { status: 'UNKNOWN', reason: `Unknown Xiaoyi image task status: ${raw || '(empty)'}` }
}

export function extractUsage(ctx) {
  const body = snapshotOf(ctx.requestBody)
  if (isVideo(ctx)) {
    const request = videoRequest({ ...body, model: VIDEO_MODEL })
    return { image_count: 0, seconds: Number(request.seconds), resolution: request.resolution }
  }
  return { image_count: requestedCount(body.n), seconds: 0, resolution: 'none' }
}

export function extractUsageOnComplete(task, result, data) {
  const images = imageEntries(data).length
  return images > 0 ? { image_count: images } : null
}


export function listArtifacts(task) {
  return task.status === 'SUCCESS' && (task.model === VIDEO_MODEL || snapshotOf(task.data).model === VIDEO_MODEL)
    ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  return { url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content',
    method: ctx.clientRequest.method, headers: { Authorization: 'Bearer ' + ctx.apiKey } }
}
