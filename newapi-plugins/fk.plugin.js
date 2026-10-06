// NewAPI Task Plugin v1 —— Fk 视频渠道（ai.fanke2026.xyz）
//
// 按 openai_video 协议提交任务；上游 Key 由 NewAPI 渠道配置提供，源码不保存密钥。
// Base URL: https://ai.fanke2026.xyz
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

const MODEL_IDS = [
  'ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563',
  'ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70',
  'ft-video-v1-bdf45387433ac0a9042ebab3fae0299d',
  'ft-video-v1-69ef4c70291248a25c8198cd1c7c9c1f',
  'ft-video-v1-7393b0529b788d532d031dcac5e820cb',
  'ft-video-v1-9f4e77de6c05f3c360c1c0b9938a44a4',
  'ft-video-v1-451adae35b0c4a3d275c2c46394abc98',
  'ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746',
]

export const meta = {
  apiVersion: 1,
  key: 'fk',
  name: 'Fk渠道',
  version: '0.1.1',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Seedance video generation via ai.fanke2026.xyz',
    zh: 'Fk渠道 Seedance / MiniMax H3 视频生成',
  },
  models: MODEL_IDS,
  fetchMode: 'per_task',
  protocols: ['openai_video'],
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
  },
  usageExamples: [
    { label: '固定单价视频 5 秒', facts: { seconds: 5, seconds_480p: 0, seconds_720p: 0 } },
    { label: 'XN 480p 视频 5 秒', facts: { seconds: 0, seconds_480p: 5, seconds_720p: 0 } },
    { label: 'XN 720p 视频 5 秒', facts: { seconds: 0, seconds_480p: 0, seconds_720p: 5 } },
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
  if (!MODEL_IDS.includes(model)) fail('Unsupported model: ' + (model || '(missing)'))
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
  }
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
}

export function buildSubmitRequest(ctx) {
  const body = Object.assign({}, ctx.requestBody)
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

export function parseSubmitResponse(ctx, resp) {
  const body = snapshot(resp && resp.body)
  const data = snapshot(body.data)
  const taskId = body.id || body.job_id || body.task_id || data.id || data.job_id || data.task_id
  if (!taskId) fail('Fk did not return a task ID')
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
  return usageFacts(ctx, normalizedDuration(request), request)
}

export function extractUsageOnComplete(ctx, task, body) {
  const data = snapshot(body && body.data)
  const result = Object.keys(data).length ? data : snapshot(body)
  const actualDuration = Number(result.duration || result.seconds)
  if (Number.isFinite(actualDuration) && actualDuration > 0) return usageFacts(ctx, actualDuration, result)
  return null
}
