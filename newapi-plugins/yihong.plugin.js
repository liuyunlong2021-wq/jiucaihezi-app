// NewAPI Task Plugin v1 — 易红三个视频型号；无图片或 fast Zeus。
// 来源：用户提供的易红20261018文档与 seedance2.5 Ultra 补充合同。
// 素材必须已上传为URL；本插件不执行文件上传，不改查询频率或收费重试策略。
const MODELS = {
  'yh-minimax H3': { min: 4, max: 15, seconds: 10, resolutions: ['768P'], ratios: ['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9'], images: 9, videos: 3, audios: 3, layout: 'h3' },
  'yh-seedance2.5 Ultra': { min: 10, max: 30, seconds: 30, resolutions: ['720P', '480P', '1080P'], images: 14, videos: 0, audios: 10, layout: 'ultra' },
  'yh-wan3.0-video': { min: 2, max: 30, seconds: 5, resolutions: ['480P', '720P', '1080P'], ratios: ['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1'], images: 10, videos: 5, audios: 5, layout: 'wan' },
}
export const meta = {
  apiVersion: 1, key: 'yihong', name: '易红视频', version: '0.2.1',
  author: { name: 'jiucaihezi' },
  description: { en: 'Three Yihong video models with yh- aliases', zh: '易红三个yh-视频型号，公网URL参考，按次或按秒计费' },
  baseUrl: 'https://yihongapi.com',
  models: Object.keys(MODELS), fetchMode: 'per_task',
  protocols: [{ name: 'openai_video', models: Object.keys(MODELS) }],
  usageSchema: {
    calls: { type: 'number', unit: 'count', unitLabel: { en: 'call', zh: '次' }, description: { en: 'Video task count', zh: '视频任务数' } },
    seconds: { type: 'number', unit: 'second', description: { en: 'Requested duration', zh: '请求生成秒数' } },
    resolution: { enum: ['480P', '720P', '768P', '1080P'], description: { en: 'Video resolution', zh: '视频分辨率' } },
  },
  usageExamples: [
    { label: '720p 10秒', facts: { calls: 1, seconds: 10, resolution: '720P' } },
    { label: '480p 5秒', facts: { calls: 1, seconds: 5, resolution: '480P' } },
  ],
}
const GROUPS = {
  images: ['images', 'image_urls', 'imageUrls', 'imageUrl', 'image_url', 'image'],
  videos: ['videos', 'video_urls', 'videoUrls', 'videoUrl', 'video_url', 'video'],
  audios: ['audios', 'audio_urls', 'audioUrls', 'audioUrl', 'audio_url', 'audio'],
}
function fail(message) { throw new Error(message) }
function objectOf(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function configOf(model) {
  if (!Object.keys(MODELS).includes(model)) fail('Unsupported model: ' + model)
  return MODELS[model]
}
function oneOf(body, keys) {
  const present = keys.filter(key => body[key] !== undefined && body[key] !== null)
  if (present.length > 1 && present.some(key => JSON.stringify(body[key]) !== JSON.stringify(body[present[0]]))) fail('Conflicting fields: ' + present.join(', '))
  return present.length ? body[present[0]] : undefined
}
function entries(value) {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
}
function mediaURL(value, spec) {
  if (typeof value !== 'string' || !(spec.layout === 'ultra' ? /^https?:\/\/[^\s]+$/i : /^https:\/\/[^\s]+$/i).test(value)) fail('Reference media requires public ' + (spec.layout === 'ultra' ? 'HTTP(S)' : 'HTTPS') + ' URLs')
  return value
}
function urlOf(entry, spec) { return mediaURL(typeof entry === 'string' ? entry : objectOf(entry).url, spec) }
function common(body, model) {
  const spec = configOf(model)
  const prompt = String(body.prompt || '').trim()
  if (!prompt) fail('prompt is required')
  const rawSeconds = oneOf(body, ['seconds', 'duration'])
  const seconds = rawSeconds === undefined ? spec.seconds : Number(rawSeconds)
  if (!Number.isInteger(seconds) || seconds < spec.min || seconds > spec.max || (spec.allowed && !spec.allowed.includes(seconds))) fail('Unsupported seconds for ' + model)
  const resolution = String(body.resolution || spec.resolutions[0]).toUpperCase()
  if (!spec.resolutions.includes(resolution)) fail('Unsupported resolution for ' + model)
  const ratio = oneOf(body, ['ratio', 'aspect_ratio', 'aspectRatio'])
  if (ratio !== undefined && (typeof ratio !== 'string' || (spec.ratios && !spec.ratios.includes(ratio)))) fail('Unsupported ratio for ' + model)
  const groups = Object.fromEntries(Object.entries(GROUPS).map(([kind, keys]) => [kind, entries(oneOf(body, keys))]))
  for (const kind of Object.keys(groups)) {
    if (groups[kind].length > spec[kind]) fail(kind + ' accepts at most ' + spec[kind] + ' references')
    groups[kind].forEach(entry => urlOf(entry, spec))
  }
  const extras = spec.layout === 'h3' ? ['attachments', 'ai_enhance', 'seed', 'negative_prompt'] : spec.layout === 'love' ? ['content', 'input_reference', 'generate_audio', 'seed', 'watermark', 'camera_fixed', 'return_last_frame'] : spec.layout === 'wan' ? ['media', 'prompt_extend'] : spec.layout === 'super' ? ['media'] : []
  const allowed = ['model', 'prompt', 'seconds', 'duration', 'resolution', 'ratio', 'aspect_ratio', 'aspectRatio', ...Object.values(GROUPS).flat(), ...extras]
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail('Unsupported field for ' + model + ': ' + key)
  return { spec, prompt, seconds, resolution, ratio, groups }
}
function typedMedia(body, spec, groups) {
  if (body.media !== undefined && !Array.isArray(body.media)) fail('media must be an array')
  if (body.media !== undefined && Object.values(groups).some(list => list.length)) fail('media cannot be combined with URL arrays')
  const media = body.media === undefined ? Object.entries(groups).flatMap(([kind, list]) => list.map(entry => ({
    type: { images: 'reference_image', videos: 'reference_video', audios: 'reference_audio' }[kind],
    ...(typeof entry === 'string' ? { url: entry } : entry),
  }))) : body.media.map(entry => ({ ...objectOf(entry) }))
  const limits = { reference_image: spec.images, reference_video: spec.videos, reference_audio: spec.audios, first_frame: 1, last_frame: 1 }
  const counts = {}
  const totals = { reference_video: 0, reference_audio: 0 }
  for (const entry of media) {
    if (!Object.keys(limits).includes(entry.type)) fail('Unsupported media type')
    mediaURL(entry.url, spec)
    counts[entry.type] = (counts[entry.type] || 0) + 1
    if (counts[entry.type] > limits[entry.type]) fail('Too many ' + entry.type)
    for (const key of Object.keys(entry)) if (!['type', 'url', 'duration_seconds'].includes(key)) fail('Unsupported media field: ' + key)
    if (spec.layout === 'wan' && (entry.type === 'reference_video' || (entry.type === 'reference_audio' && entry.duration_seconds !== undefined))) {
      const duration = Number(entry.duration_seconds)
      if (!Number.isFinite(duration) || duration <= 0 || (entry.type === 'reference_video' && duration < 1) || duration > 15) fail('media requires valid duration_seconds, video 1–15, audio >0–15')
      entry.duration_seconds = duration
      totals[entry.type] += duration
      if (totals[entry.type] > 15) fail('media total duration exceeds 15 seconds')
    }
  }
  if (spec.layout === 'wan') {
    if (counts.last_frame && !counts.first_frame) fail('last_frame requires first_frame')
    if ((counts.first_frame || counts.last_frame) && (counts.reference_image || counts.reference_video || counts.reference_audio)) fail('frames cannot be combined with references')
  }
  return spec.layout === 'super' ? media.map(entry => ({ type: entry.type, url: entry.url })) : media
}
function loveContent(body, spec, groups) {
  if (body.content !== undefined && !Array.isArray(body.content)) fail('content must be an array')
  const first = entries(body.input_reference)
  if (first.length > 1) fail('input_reference accepts one first_frame')
  if (body.content !== undefined && (first.length || Object.values(groups).some(list => list.length))) fail('content cannot be combined with other references')
  if (first.length && groups.images.length) fail('input_reference cannot be combined with images')
  for (const audio of groups.audios) {
    if (typeof audio === 'object' && audio.duration_seconds !== undefined && (!Number.isFinite(audio.duration_seconds) || audio.duration_seconds < 2 || audio.duration_seconds > 15)) fail('Love audio duration_seconds must be from 2 to 15')
  }
  const content = body.content === undefined ? [
    ...groups.images.map(entry => ({ type: 'image_url', image_url: { url: urlOf(entry, spec) }, role: 'reference_image' })),
    ...first.map(entry => ({ type: 'image_url', image_url: { url: urlOf(entry, spec) }, role: 'first_frame' })),
    ...groups.audios.map(entry => ({ type: 'audio_url', audio_url: { url: urlOf(entry, spec) }, role: 'reference_audio' })),
  ] : body.content.map(entry => ({ ...objectOf(entry) }))
  const counts = { first_frame: 0, last_frame: 0, reference_image: 0, reference_audio: 0 }
  for (const entry of content) {
    const audio = entry.type === 'audio_url'
    if (!(audio ? entry.role === 'reference_audio' : entry.type === 'image_url' && ['first_frame', 'last_frame', 'reference_image'].includes(entry.role))) fail('Unsupported Love content')
    mediaURL(objectOf(entry[audio ? 'audio_url' : 'image_url']).url, spec)
    counts[entry.role] += 1
    if (counts[entry.role] > ({ first_frame: 1, last_frame: 1, reference_image: 9, reference_audio: 3 })[entry.role]) fail('Too many content references: ' + entry.role)
    if (Object.keys(entry).some(key => !['type', audio ? 'audio_url' : 'image_url', 'role'].includes(key))) fail('Unsupported Love content field')
  }
  if (counts.last_frame && !counts.first_frame) fail('last_frame requires first_frame')
  if ((counts.first_frame || counts.last_frame) && counts.reference_image) fail('frames cannot be combined with reference images')
  return { content, first }
}
function vendorBody(body, model) {
  const { spec, prompt, seconds, resolution, ratio, groups } = common(body, model)
  const request = { model: model.slice(3), prompt, seconds, resolution: spec.layout === 'wan' ? resolution : resolution.toLowerCase() }
  if (ratio !== undefined) request.ratio = ratio
  if (spec.layout === 'h3') {
    delete request.seconds
    request.duration = seconds
    if (groups.images.length) request.image_urls = groups.images.map(entry => urlOf(entry, spec))
    if (body.attachments !== undefined && (!Array.isArray(body.attachments) || groups.videos.length || groups.audios.length)) fail('attachments must be an array and cannot be combined with video/audio arrays')
    const attachments = body.attachments === undefined ? ['videos', 'audios'].flatMap(kind => groups[kind].map(entry => ({ type: kind === 'videos' ? 'video' : 'audio', ...(typeof entry === 'string' ? { url: entry } : entry) }))) : body.attachments
    const counts = { video: 0, audio: 0 }
    for (const entry of attachments) {
      if (!entry || !Object.hasOwn(counts, entry.type)) fail('Unsupported attachment type')
      mediaURL(entry.url, spec)
      if (++counts[entry.type] > 3) fail('Too many H3 attachments')
      if (Object.keys(entry).some(key => !['type', 'url', 'duration_seconds'].includes(key))) fail('Unsupported attachment field')
      if (entry.type === 'video' || entry.duration_seconds !== undefined) {
        if (typeof entry.duration_seconds !== 'number' || !Number.isFinite(entry.duration_seconds) || entry.duration_seconds < 2 || entry.duration_seconds > 15) fail('H3 attachments require duration_seconds from 2 to 15')
      }
    }
    if (groups.images.length + attachments.length > 10) fail('H3 accepts at most 10 total references')
    if (attachments.length) request.attachments = attachments
    if (body.ai_enhance !== undefined) {
      if (typeof body.ai_enhance !== 'boolean') fail('ai_enhance must be a boolean')
      request.ai_enhance = body.ai_enhance
    }
    if (body.seed !== undefined) {
      if (!Number.isSafeInteger(body.seed) || body.seed < 0) fail('seed must be a non-negative integer')
      request.seed = body.seed
    }
    if (body.negative_prompt !== undefined) {
      if (typeof body.negative_prompt !== 'string') fail('negative_prompt must be a string')
      request.negative_prompt = body.negative_prompt
    }
    return request
  }

  if (spec.layout === 'ultra' && groups.audios.length && !groups.images.length) fail('Ultra audio requires reference images')
  if ((spec.layout === 'super' && body.media !== undefined) || spec.layout === 'wan') {
    const media = typedMedia(body, spec, groups)
    if (media.length) request.media = media
  } else if (spec.layout === 'love') {
    const { content, first } = loveContent(body, spec, groups)
    if (body.content !== undefined || groups.audios.length) { if (content.length) request.content = content }
    else if (first.length) request.input_reference = urlOf(first[0], spec)
    else if (groups.images.length) request.images = groups.images.map(entry => urlOf(entry, spec))
    for (const key of ['generate_audio', 'watermark', 'camera_fixed', 'return_last_frame']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') fail(key + ' must be a boolean')
        request[key] = body[key]
      }
    }
    if (body.seed !== undefined) {
      if (!Number.isSafeInteger(body.seed) || body.seed < 0) fail('seed must be a non-negative integer')
      request.seed = body.seed
    }
  } else {
    for (const kind of Object.keys(groups)) if (groups[kind].length) request[{ images: 'image_urls', videos: 'video_urls', audios: 'audio_urls' }[kind]] = groups[kind].map(entry => urlOf(entry, spec))
  }
  if (spec.layout === 'wan' && body.prompt_extend !== undefined) {
    if (typeof body.prompt_extend !== 'boolean') fail('prompt_extend must be a boolean')
    request.prompt_extend = body.prompt_extend
  }
  return request
}
function modelOf(ctx) {
  const model = String(ctx.model || objectOf(ctx.requestBody).model || '')
  configOf(model)
  const upstream = String(ctx.upstreamModel || model)
  if (![model, model.slice(3)].includes(upstream)) fail('Unsupported model mapping for ' + model)
  return model
}
export const protocols = {
  openai_video: {
    decodeRequest(ctx) {
      if (ctx.body?.kind !== 'json') fail('JSON body required; upload reference files to URLs first')
      const source = objectOf(ctx.body.value)
      const model = modelOf(ctx)
      if (source.model !== undefined && source.model !== model) fail('Conflicting request model')
      const request = vendorBody(source, model)
      const hasReferences = ['image_urls', 'video_urls', 'audio_urls', 'images', 'content', 'media', 'attachments'].some(key => request[key]?.length) || Boolean(request.input_reference)
      return { kind: 'submit', model, action: hasReferences ? 'image_to_video' : 'text_to_video', requestBody: { ...source, model, resolution: request.resolution.toUpperCase() } }
    },
    render(ctx, task) {
      const view = { id: task.task_id, object: 'video', model: task.model || '', status: { QUEUED: 'queued', SUBMITTED: 'queued', IN_PROGRESS: 'in_progress', SUCCESS: 'completed', FAILURE: 'failed' }[task.status] || 'unknown', progress: Number(String(task.progress || '0').replace('%', '')), created_at: task.created_at }
      const video = objectOf(objectOf(ctx?.artifacts).video)
      if (video.url) view.video_url = String(video.url)
      const snapshot = objectOf(task.data)
      if (snapshot.error) view.error = typeof snapshot.error === 'string' ? snapshot.error : String(objectOf(snapshot.error).message || '')
      return view
    },
  },
}
export function buildSubmitRequest(ctx) {
  const model = modelOf(ctx)
  return { url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey }, body: vendorBody(objectOf(ctx.requestBody), model), action: ctx.action }
}
export function parseSubmitResponse(ctx, response) {
  const body = objectOf(response?.body)
  const taskId = body.id || body.task_id
  if (!taskId) fail('Yihong API did not return a task id')
  return { taskId: String(taskId), taskData: body }
}
export function buildQueryRequest(ctx) {
  return { url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos/' + encodeURIComponent(ctx.taskId), method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey } }
}
export function parseTaskResult(ctx, body) {
  const snapshot = objectOf(body)
  const raw = String(snapshot.status || '').toLowerCase()
  const status = { queued: 'QUEUED', in_progress: 'IN_PROGRESS', completed: 'SUCCESS', failed: 'FAILURE' }[raw]
  if (!status) return { status: 'UNKNOWN', reason: 'Unknown Yihong task status: ' + raw }
  const result = { status }
  if (status === 'FAILURE') result.reason = typeof snapshot.error === 'string' ? snapshot.error : String(objectOf(snapshot.error).message || snapshot.message || 'Yihong video generation failed')
  return result
}
export function listArtifacts(task) { return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : [] }
export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  return { url: ctx.baseUrl.replace(/\/$/, '') + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content', method: ctx.clientRequest.method, headers: { Authorization: 'Bearer ' + ctx.apiKey } }
}
export function extractUsage(ctx) {
  const source = objectOf(ctx?.requestBody)
  const model = modelOf({ ...ctx, model: ctx?.model || source.model })
  const { seconds, resolution } = common(source, model)
  return { calls: 1, seconds, resolution }
}
export function extractUsageOnComplete() { return { calls: 1 } }
