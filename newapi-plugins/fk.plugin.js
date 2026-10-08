// NewAPI Task Plugin v1 —— Fk 图片 / 视频渠道（ai.fanke2026.xyz）
//
// 图片使用 openai_image 协议并由 NewAPI 主机轮询；视频使用 openai_video 协议。
// 上游 Key 由 NewAPI 渠道配置提供，源码不保存密钥。Base URL: https://ai.fanke2026.xyz
// 上游端点：POST /v1/videos、GET /v1/videos/{id}、GET /v1/videos/{id}/content。
// 成片通过宿主 content 代理返回，避免把上游临时下载地址暴露给客户端。
//
// 用户面板显示名按模型顺序：
// 特价渠道-Seedance2.5满血720p(30图)；特价渠道Seedance2.5满血720p(可过真人)；
// 长期特惠Seedance2.5满血720p；XZ-Seedance 2.5 720p(9图参考)；
// XN1-Seedance 2.5满血 480-720p；XN2-Seedance 2.5满血 480-720p；
// 官方渠道-Seedance2.5满血720p；特价渠道 MiniMax H3-768p。
// XZ Seedance 2.0「933全参」不在本插件模型白名单中。
// 计费表达式在 NewAPI 定价页设置（按用户给出的人民币/秒费率）：
// 固定价模板：tier("base", u("seconds") * 费率)
// XN 480p 模板：tier("base", u("seconds_480p") * 0.5)
// XN1 720p 模板：tier("base", u("seconds_720p") * 1)
// XN2 720p 模板：tier("base", u("seconds_720p") * 0.8)
// 固定价模型依次用 0.1、0.4、0.2、0.1、1、0.08；XN1/XN2 两档分别为 0.5/1、0.5/0.8。
// 插件只提取用量事实，不设价格；XN1/XN2 的具体模型 ID 应按上游模型表在定价页确认。

const VIDEO_MODEL_IDS = [
  'ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563',
  'ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70',
  'ft-video-v1-bdf45387433ac0a9042ebab3fae0299d',
  'ft-video-v1-69ef4c70291248a25c8198cd1c7c9c1f',
  'ft-video-v1-7393b0529b788d532d031dcac5e820cb',
  'ft-video-v1-9f4e77de6c05f3c360c1c0b9938a44a4',
  'ft-video-v1-451adae35b0c4a3d275c2c46394abc98',
  'ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746',
]

// 来自账号可用模型目录；这些模型走 /api/open/v1/image/generate。
const IMAGE_MODEL_IDS = [
  'ft-image-v1-211f28f47b0355abb1798f72eb65f22d',
  'ft-image-v1-186289ba9d3263010c69372f8939dd94',
  'ft-image-v1-eb47192eb578f340043911005a06fb6e',
  'ft-image-v1-3432bdee1a22da4ce8ff2bbfc6ef4c1d',
  'ft-image-v1-80fa79934b03dcdc7a54dacdb1ad7f82',
  'ft-image-v1-d51c811d3d74a5b2433e6916ab564db9',
]

const MODEL_IDS = [...VIDEO_MODEL_IDS, ...IMAGE_MODEL_IDS]

export const meta = {
  apiVersion: 1,
  key: 'fk',
  name: 'Fk渠道',
  version: '0.2.0',
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
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Billable video seconds', zh: '固定单价模型计费秒数' },
    },
    seconds_480p: {
      type: 'number',
      unit: 'second',
      description: { en: 'XN 480p video seconds', zh: 'XN模型 480p 计费秒数' },
    },
    seconds_720p: {
      type: 'number',
      unit: 'second',
      description: { en: 'XN 720p video seconds', zh: 'XN模型 720p 计费秒数' },
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
  ],
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
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) fail('reference media must be a URL')
    return url
  })
}

function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = String(body.model || '')
  if (!VIDEO_MODEL_IDS.includes(model)) fail('Unsupported video model: ' + (model || '(missing)'))
  if (!String(body.prompt || '').trim()) fail('prompt is required')

  const payload = Object.assign({}, body)
  payload.model = model
  if (payload.ratio === undefined && payload.aspect_ratio !== undefined) payload.ratio = payload.aspect_ratio
  if (payload.duration === undefined && payload.seconds !== undefined) payload.duration = payload.seconds

  const images = mediaUrls(body, ['imageUrls', 'images', 'image_urls', 'imageUrl', 'image_url', 'image'])
  const videos = mediaUrls(body, ['videoUrls', 'video_urls', 'video_url', 'videoUrl', 'video'])
  const audios = mediaUrls(body, ['audioUrls', 'audio_urls', 'audio_url', 'audioUrl', 'audio'])
  ;['imageUrls', 'images', 'image_urls', 'imageUrl', 'image_url', 'image',
    'videoUrls', 'video_urls', 'video_url', 'videoUrl', 'video',
    'audioUrls', 'audio_urls', 'audio_url', 'audioUrl', 'audio']
    .forEach(function (key) { delete payload[key] })
  if (images.length) payload.imageUrls = images
  if (videos.length) payload.videoUrls = videos
  if (audios.length) payload.audioUrls = audios

  ;['aspect_ratio', 'seconds', 'images', 'image_urls', 'imageUrl', 'image_url', 'image',
    'video_urls', 'video_url', 'videoUrl', 'video', 'audio_urls', 'audio_url', 'audioUrl', 'audio']
    .forEach(function (key) { delete payload[key] })
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
  return {
    seconds: validSeconds,
    seconds_480p: resolution.includes('480') ? validSeconds : 0,
    seconds_720p: resolution.includes('720') ? validSeconds : 0,
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
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const payload = normalizeRequest(ctx.body.value)
      const hasReference = Boolean(
        (payload.imageUrls && payload.imageUrls.length) ||
        (payload.videoUrls && payload.videoUrls.length) ||
        (payload.audioUrls && payload.audioUrls.length),
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
        const error = snapshot(data.error)
        const reason = error.message || data.errorMessage || data.fail_reason || data.message
        if (reason) view.error = String(reason)
      }
      const artifacts = snapshot(ctx && ctx.artifacts)
      if (task.status === 'SUCCESS' && artifacts.video && artifacts.video.url) {
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
  body.model = ctx.upstreamModel || ctx.model
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
  return ['1K', '2K', '4K'].includes(text) ? text : ''
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

export function parseSubmitResponse(ctx, resp) {
  const body = snapshot(resp && resp.body)
  if (isImageModel(ctx)) {
    const status = String(body.status || '').toLowerCase()
    const urls = imageResultUrls(body)
    const taskId = body.jobId || body.job_id || ctx.publicTaskId || 'image-immediate'
    if (status === 'failed') {
      return {
        taskId: String(taskId),
        taskData: body,
        immediate: { status: 'FAILURE', reason: String(body.errorMessage || body.error || 'Fk image generation failed') },
      }
    }
    if (status === 'success' && urls.length) {
      return { taskId: String(taskId), taskData: body, immediate: { status: 'SUCCESS' } }
    }
    if (!body.jobId && !body.job_id) fail('Fk image generation did not return a jobId')
    return { taskId: String(body.jobId || body.job_id), taskData: body }
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
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.taskId),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  if (isImageModel(ctx)) {
    const value = snapshot(body)
    const status = String(value.status || '').toLowerCase()
    if (status === 'submitted') return { status: 'IN_PROGRESS', progress: '0%' }
    if (status === 'success') {
      if (value.resultAvailable === false || !imageResultUrls(value).length) {
        return { status: 'IN_PROGRESS', progress: '100%' }
      }
      return { status: 'SUCCESS', progress: '100%' }
    }
    if (status === 'failed') {
      return { status: 'FAILURE', reason: String(value.errorMessage || value.error || 'Fk image generation failed') }
    }
    return { status: 'UNKNOWN', reason: 'Unknown Fk image task status: ' + (status || '(empty)') }
  }
  const data = snapshot(body && body.data)
  const result = Object.keys(data).length ? data : snapshot(body)
  const raw = String(result.status || result.state || '').toLowerCase()
  const status = UPSTREAM_STATUS[raw]
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'FAILURE') {
    const error = snapshot(result.error)
    out.reason = String(error.message || result.errorMessage || result.fail_reason || result.message || ('Fk task ' + raw))
  }
  return out
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
  const request = snapshot(ctx && ctx.requestBody)
  if (isImageModel(ctx)) {
    return { seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 1 }
  }
  return usageFacts(ctx, normalizedDuration(request), request)
}

export function extractUsageOnComplete(ctx, task, body) {
  if (isImageModel(ctx)) {
    const count = imageResultUrls(snapshot(body)).length
    return count > 0 ? { image_count: count } : null
  }
  const data = snapshot(body && body.data)
  const result = Object.keys(data).length ? data : snapshot(body)
  const actualDuration = Number(result.duration || result.seconds)
  if (Number.isFinite(actualDuration) && actualDuration > 0) return usageFacts(ctx, actualDuration, result)
  return null
}
