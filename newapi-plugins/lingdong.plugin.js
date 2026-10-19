// NewAPI Task Plugin v1 — 灵动图片与视频。
// 合同：https://www.lingdongapi.com/docs/api/?v=20260517
// 图片使用 JSON + 公网 images URL；视频保留已验证的 /v1/videos 别名。
// 仅发布下列四个名称；上游请求自动移除「灵动-」，不必手工配置同名映射。
const VIDEO_MODELS = ['灵动-sd2.5-满血-301010', '灵动-sd2.5-满血-301010-2']
const IMAGE_MODELS = ['灵动-gpt-image-2.5-flare', '灵动-gpt-image-2.5-sunburst']

export const meta = {
  apiVersion: 1,
  key: 'lingdong',
  name: '灵动 API',
  version: '0.4.0',
  author: { name: 'jiucaihezi' },
  description: { en: 'Lingdong image and video API', zh: '灵动图片按张、视频按次计费' },
  models: [...VIDEO_MODELS, ...IMAGE_MODELS],
  fetchMode: 'per_task',
  protocols: [{ name: 'openai_video', models: VIDEO_MODELS }, { name: 'openai_image', models: IMAGE_MODELS }],
  baseUrl: 'https://www.lingdongapi.com',
  usageSchema: {
    calls: { type: 'number', unit: 'count', unitLabel: { en: 'call', zh: '次' }, description: { en: 'Video tasks', zh: '视频生成次数，不随时长增加' } },
    image_count: { type: 'number', unit: 'count', unitLabel: { en: 'image', zh: '张' }, description: { en: 'Generated images', zh: '生成图片张数' } },
  },
  usageExamples: [
    { label: '视频一次', facts: { calls: 1, image_count: 0 } },
    { label: '图片一张', facts: { calls: 0, image_count: 1 } },
    { label: '图片两张', facts: { calls: 0, image_count: 2 } },
  ],
}

const UPSTREAM_STATUS = {
  queued: 'QUEUED', pending: 'QUEUED', submitted: 'SUBMITTED',
  processing: 'IN_PROGRESS', running: 'IN_PROGRESS', generating: 'IN_PROGRESS',
  completed: 'SUCCESS', complete: 'SUCCESS', success: 'SUCCESS', succeeded: 'SUCCESS', finished: 'SUCCESS', finish: 'SUCCESS',
  failed: 'FAILURE', failure: 'FAILURE', error: 'FAILURE', cancelled: 'FAILURE', canceled: 'FAILURE',
}
const HOST_STATUS = { SUBMITTED: 'queued', QUEUED: 'queued', IN_PROGRESS: 'in_progress', SUCCESS: 'completed', FAILURE: 'failed' }

function fail(message) { throw new Error(message) }
function snapshotOf(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function isImage(ctx) { return IMAGE_MODELS.includes(String(ctx.model || snapshotOf(ctx.requestBody).model || '')) }
function firstText(source, keys) {
  for (const key of keys) if (typeof source[key] === 'string' && source[key].trim()) return source[key].trim()
  return ''
}

function mediaUrls(source, kind = 'image') {
  const candidates = [source[kind + 's'], source[kind + 'Urls'], source[kind + 'Url'], source[kind]]
  const raw = candidates.find(value => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length))
  const urls = []
  for (const item of raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) {
    const url = item && typeof item === 'object' ? item.url : item
    if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(url.trim())) fail('Reference media must be public HTTP(S) URLs; upload local files first')
    if (!urls.includes(url.trim())) urls.push(url.trim())
  }
  return urls
}

function imageCount(body) {
  const count = body.n === undefined ? 1 : Number(body.n)
  if (!Number.isSafeInteger(count) || count < 1) fail('n must be a positive integer')
  return count
}

function decode(ctx, models, image) {
  if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required; upload reference files to public URLs first')
  const body = ctx.body.value
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = String(ctx.model || body.model || '')
  if (!models.includes(model) || (body.model && body.model !== model)) fail('Unsupported model: ' + model)
  if (!String(body.prompt || '').trim()) fail('prompt is required')
  const images = mediaUrls(body)
  if (image) {
    imageCount(body)
    if (mediaUrls(body, 'video').length || mediaUrls(body, 'audio').length) fail('Image generation does not support reference video or audio')
  }
  return { kind: 'submit', model, action: image ? (images.length ? 'image_to_image' : 'text_to_image') : (images.length ? 'image_to_video' : 'text_to_video'), requestBody: body }
}

function imageResult(body) {
  const data = snapshotOf(body).data
  if (!Array.isArray(data) || !data.length || data.some(item => {
    const entry = snapshotOf(item)
    return !(typeof entry.url === 'string' && entry.url.trim()) && !(typeof entry.b64_json === 'string' && entry.b64_json.trim())
  })) fail('Lingdong did not return image results; task-only image responses require a documented image polling contract')
  return data.map(item => {
    const entry = {}
    if (item.url) entry.url = String(item.url)
    if (item.b64_json) entry.b64_json = String(item.b64_json)
    if (item.revised_prompt) entry.revised_prompt = String(item.revised_prompt)
    return entry
  })
}

export const protocols = {
  openai_video: {
    decodeRequest(ctx) { return decode(ctx, VIDEO_MODELS, false) },
    render(ctx, task) {
      const view = { id: task.task_id, object: 'video', model: task.model || '', status: HOST_STATUS[task.status] || 'unknown', progress: Number(String(task.progress || '0').replace('%', '')), created_at: task.created_at }
      const video = snapshotOf(snapshotOf(ctx.artifacts).video)
      if (video.url) view.video_url = String(video.url)
      const snapshot = snapshotOf(task.data)
      if (snapshot.fail_reason) view.error = String(snapshot.fail_reason)
      return view
    },
  },
  openai_image: {
    decodeRequest(ctx) { return decode(ctx, IMAGE_MODELS, true) },
    render(ctx, task) {
      const body = snapshotOf(task.data)
      return { ...(body.created ? { created: body.created } : {}), data: imageResult(body) }
    },
  },
}

export function buildSubmitRequest(ctx) {
  const source = snapshotOf(ctx.requestBody)
  const publicModel = String(ctx.model || source.model || '')
  if (!meta.models.includes(publicModel)) fail('Unsupported model: ' + publicModel)
  const requested = String(ctx.upstreamModel || publicModel)
  const body = { model: meta.models.includes(requested) ? requested.slice(3) : requested, prompt: String(source.prompt || '').trim() }
  const images = mediaUrls(source)
  if (images.length) body.images = images
  if (isImage(ctx)) {
    if (mediaUrls(source, 'video').length || mediaUrls(source, 'audio').length) fail('Image generation does not support reference video or audio')
    body.n = imageCount(source)
    if (source.size) body.size = String(source.size)
    body.response_format = 'url'
  } else {
    for (const kind of ['video', 'audio']) {
      const urls = mediaUrls(source, kind)
      if (urls.length) body[kind + 's'] = urls
    }
    for (const field of ['ratio', 'resolution']) {
      const text = firstText(source, field === 'ratio' ? ['ratio', 'aspect_ratio', 'aspectRatio'] : [field])
      if (text) body[field] = text
    }
    const duration = Math.trunc(Number(source.duration !== undefined ? source.duration : source.seconds))
    if (Number.isFinite(duration) && duration > 0) body.duration = duration
    body.watermark = false
  }
  return { url: ctx.baseUrl.replace(/\/$/, '') + (isImage(ctx) ? '/v1/images/generations' : '/v1/videos'), method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey }, body, action: ctx.action }
}

export function parseSubmitResponse(ctx, response) {
  const body = snapshotOf(response.body)
  if (isImage(ctx)) {
    // 沿用宿主同步图片结果合同；官方未说明图片任务查询路径，不伪造视频轮询。
    const data = imageResult(body)
    return { taskId: String(ctx.publicTaskId || body.id || 'image-result'), taskData: { ...(body.created ? { created: body.created } : {}), data }, immediate: { status: 'SUCCESS' } }
  }
  const taskId = body.id || body.task_id
  if (!taskId) fail('lingdong did not return a task id')
  return { taskId: String(taskId), taskData: body }
}

export function buildQueryRequest(ctx) {
  if (isImage(ctx)) fail('Lingdong image polling contract is not documented')
  return { url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos/' + encodeURIComponent(ctx.taskId), method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey } }
}

export function parseTaskResult(ctx, body) {
  const snapshot = snapshotOf(body)
  const raw = String(snapshot.status || snapshot.state || '').toLowerCase()
  const status = UPSTREAM_STATUS[raw]
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'FAILURE') {
    const error = snapshotOf(snapshot.error)
    out.reason = String(snapshot.fail_reason || snapshot.message || error.message || error.code || `lingdong status: ${raw}`)
  }
  return out
}

export function listArtifacts(task) {
  return task.status === 'SUCCESS' && VIDEO_MODELS.includes(task.model) ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  return { url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content', method: ctx.clientRequest.method, headers: { Authorization: 'Bearer ' + ctx.apiKey } }
}

export function extractUsage(ctx) {
  return isImage(ctx) ? { calls: 0, image_count: imageCount(snapshotOf(ctx.requestBody)) } : { calls: 1, image_count: 0 }
}

export function extractUsageOnComplete(ctx, task, body) {
  return Array.isArray(snapshotOf(body).data) ? { calls: 0, image_count: imageResult(body).length } : { calls: 1 }
}
