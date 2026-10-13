// NewAPI Task Plugin v1 — 易红 API Seedance / Wan / Grok 与图片 视频模型。
// 上游协议为异步视频创建、查询和鉴权内容下载，由 NewAPI openai_video 宿主承载。
const MODELS = {
  'seedance2.5 super': {
    durationField: 'seconds', minSeconds: 5, maxSeconds: 30, defaultSeconds: 5,
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], images: 30, videos: 10, audios: 10, superMedia: true,
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
  'seedance-2.5-omni': {
    durationField: 'seconds', minSeconds: 4, maxSeconds: 29, defaultSeconds: 29,
    ratios: ['16:9', '9:16', '4:3', '3:4', '1:1'], images: 30, videos: 0, audios: 10,
    resolutions: ['720P'],
  },
  'seedance-2.5-pro': {
    durationField: 'seconds', minSeconds: 5, maxSeconds: 30, defaultSeconds: 30,
    ratios: ['16:9', '9:16'], images: 30, videos: 10, audios: 10,
    resolutions: ['720P'],
  },
  'seedance-2.0-mini-Muse': {
    durationField: 'seconds', minSeconds: 5, maxSeconds: 15, defaultSeconds: 15,
    ratios: ['16:9', '9:16'], images: 9, videos: 0, audios: 0,
    resolutions: ['720P'],
  },
  'Wan3.0 pro max': {
    durationField: 'seconds', minSeconds: 2, maxSeconds: 30, defaultSeconds: 30,
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'], images: 10, videos: 5, audios: 5,
    resolutions: ['480P'],
  },
  'wan3.0-video-prime': {
    durationField: 'seconds', minSeconds: 2, maxSeconds: 30, defaultSeconds: 5,
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'], images: 10, videos: 5, audios: 5,
    resolutions: ['480P', '720P', '1080P'], media: true,
  },
  'grok-imagine-video-1.5-preview': {
    durationField: 'seconds', minSeconds: 15, maxSeconds: 15, defaultSeconds: 15,
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2'], images: 7, videos: 0, audios: 0,
    resolutions: ['720P', '480P', '1080P'], grok: true,
  },
  'minimax H3': {
    durationField: 'duration', minSeconds: 4, maxSeconds: 15, defaultSeconds: 10,
    ratios: ['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9'], images: 9, videos: 3, audios: 3,
    resolutions: ['768P'], attachments: true,
  },
}

const GPT_SIZES = {
  '1K': ['1024x1024', '1536x864', '864x1536', '1536x1152', '1152x1536', '1536x1024', '1024x1536'],
  '2K': ['2048x2048', '2048x1152', '1152x2048', '2048x1536', '1536x2048'],
  '4K': ['3840x2160', '2160x3840'],
}
const IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gpt-image-2-1K-4K']
const IMAGE_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

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
  version: '0.1.4',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Yihong API Seedance, Wan, MiniMax and image generation',
    zh: '易红 API Seedance / Wan / Grok 与图片 视频生成',
  },
  models: [...Object.keys(MODELS), ...IMAGE_MODELS],
  fetchMode: 'per_task',
  protocols: [
    { name: 'openai_video', models: Object.keys(MODELS) },
    { name: 'openai_image', models: IMAGE_MODELS },
  ],
  baseUrl: 'https://yihongapi.com',
  usageSchema: {
    image_count: {
      type: 'number', unit: 'count',
      description: { en: 'Generated image count', zh: '生成图片数' },
    },
    resolution: {
      enum: ['480P', '720P', '768P', '1080P', '1K', '2K', '4K'],
      description: { en: 'Video resolution', zh: '视频分辨率' },
    },
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
    { label: '单次视频任务', facts: { calls: 1, seconds: 5, resolution: '720P', image_count: 0 } },
    { label: '30 秒视频任务', facts: { calls: 1, seconds: 30, resolution: '480P', image_count: 0 } },
    { label: '1K 图片', facts: { calls: 1, seconds: 0, resolution: '1K', image_count: 1 } },
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

function requestInputs(body, config) {
  if (config.grok) {
    const firstFrame = mediaUrls(body, ['image_url', 'imageUrl', 'image', 'input_reference'])
    const references = mediaUrls(body, ['reference_images', 'images', 'imageUrls', 'image_urls'])
    if (firstFrame.length > 1) fail('Grok accepts only one first frame')
    if (firstFrame.length && references.length) fail('Grok first frame and reference_images cannot be combined')
    return {
      images: firstFrame.length ? firstFrame : references,
      videos: mediaUrls(body, ['videos', 'video_urls']),
      audios: mediaUrls(body, ['audios', 'audio_urls']),
      firstFrame: firstFrame.length > 0,
    }
  }
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
  const raw = firstDefined(body, config.durationField === 'duration' ? ['duration', 'seconds'] : ['seconds', 'duration'])
  const seconds = raw === undefined ? config.defaultSeconds : Number(raw)
  if (!Number.isInteger(seconds) || seconds < config.minSeconds || seconds > config.maxSeconds) {
    fail(`seconds must be an integer from ${config.minSeconds} to ${config.maxSeconds}`)
  }
  return seconds
}

function configOf(model) {
  const config = MODELS[model]
  if (!Object.keys(MODELS).includes(model)) fail(`Unsupported model: ${model || '(missing)'}`)
  return config
}

function resolutionOf(body, config) {
  if (!config.resolutions) return '720P'
  const resolution = String(body.resolution || config.resolutions[0]).toUpperCase()
  if (!config.resolutions.includes(resolution)) fail(`Unsupported resolution: ${resolution}`)
  return resolution
}

function primeMedia(body) {
  if (body.media !== undefined && !Array.isArray(body.media)) fail('media must be an array')
  const media = (body.media || []).map(entry => ({ ...objectOf(entry) }))
  for (const [keys, type] of [
    [['images', 'imageUrls', 'image_urls', 'imageUrl', 'image_url', 'image'], 'reference_image'],
    [['videos', 'videoUrls', 'video_urls', 'videoUrl', 'video_url', 'video'], 'reference_video'],
    [['audios', 'audioUrls', 'audio_urls', 'audioUrl', 'audio_url', 'audio'], 'reference_audio'],
  ]) {
    const raw = firstDefined(body, keys)
    if (raw !== undefined) {
      for (const entry of Array.isArray(raw) ? raw : [raw]) {
        media.push(typeof entry === 'string' ? { type, url: entry } : { ...objectOf(entry), type })
      }
    }
  }
  const limits = { first_frame: 1, last_frame: 1, reference_image: 10, reference_video: 5, reference_audio: 5 }
  const counts = {}
  const totals = { reference_video: 0, reference_audio: 0 }
  for (const entry of media) {
    if (!Object.keys(limits).includes(entry.type)) fail(`Unsupported media type: ${entry.type}`)
    if (typeof entry.url !== 'string' || !/^https:\/\//i.test(entry.url)) fail('Wan Prime media requires HTTPS URLs')
    counts[entry.type] = (counts[entry.type] || 0) + 1
    if (counts[entry.type] > limits[entry.type]) fail(`Too many ${entry.type} references`)
    if (entry.type === 'reference_video' || (entry.type === 'reference_audio' && entry.duration_seconds !== undefined)) {
      const duration = Number(entry.duration_seconds)
      if (!Number.isFinite(duration) || duration < 1 || duration > 15) fail(`${entry.type} requires duration_seconds from 1 to 15`)
      entry.duration_seconds = duration
      totals[entry.type] += duration
      if (totals[entry.type] > 15) fail(`${entry.type} total duration must not exceed 15 seconds`)
    }
  }
  if ((counts.first_frame || counts.last_frame) && (counts.reference_image || counts.reference_video || counts.reference_audio)) {
    fail('First/last frames cannot be combined with reference media')
  }
  if (counts.last_frame && !counts.first_frame) fail('last_frame requires first_frame')
  return media
}

function superMedia(body) {
  if (!Array.isArray(body.media)) fail('media must be an array')
  if (Object.values(requestInputs(body, {})).some(entries => entries.length)) fail('media cannot be combined with URL arrays')
  const limits = { reference_image: 30, reference_video: 10, reference_audio: 10, first_frame: 1, last_frame: 1 }
  const counts = {}
  return body.media.map(entry => {
    if (!entry || !Object.keys(limits).includes(entry.type)) fail('Unsupported Super media type')
    if (typeof entry.url !== 'string' || !/^https:\/\//i.test(entry.url)) fail('Super media requires HTTPS URLs')
    counts[entry.type] = (counts[entry.type] || 0) + 1
    if (counts[entry.type] > limits[entry.type]) fail(`Too many ${entry.type} references`)
    return { type: entry.type, url: entry.url }
  })
}

function h3Attachments(body) {
  if (body.attachments !== undefined && !Array.isArray(body.attachments)) fail('attachments must be an array')
  const entries = (body.attachments || []).map(entry => ({ ...objectOf(entry) }))
  for (const [keys, type] of [[['videos', 'videoUrls', 'video_urls', 'videoUrl', 'video_url', 'video'], 'video'], [['audios', 'audioUrls', 'audio_urls', 'audioUrl', 'audio_url', 'audio'], 'audio']]) {
    const raw = firstDefined(body, keys)
    if (raw !== undefined) {
      for (const entry of Array.isArray(raw) ? raw : [raw]) entries.push(typeof entry === 'string' ? { type, url: entry } : { ...objectOf(entry), type })
    }
  }
  const counts = { video: 0, audio: 0 }
  for (const entry of entries) {
    if (!['video', 'audio'].includes(entry.type)) fail('attachments type must be video or audio')
    if (typeof entry.url !== 'string' || !/^https:\/\//i.test(entry.url)) fail('attachments require HTTPS URLs')
    counts[entry.type] += 1
    if (counts[entry.type] > 3) fail(`attachments accepts at most 3 ${entry.type} references`)
    if (entry.type === 'video' || entry.duration_seconds !== undefined) {
      const duration = Number(entry.duration_seconds)
      if (!Number.isFinite(duration) || duration < 2 || duration > 15) fail('attachments requires duration_seconds from 2 to 15')
      entry.duration_seconds = duration
    }
  }
  return entries
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = String(body.model || '')
  const config = configOf(model)
  if (!promptOf(body)) fail('prompt is required')
  const seconds = secondsOf(body, config)
  if (!config.media && !config.superMedia && body.media !== undefined) fail('media is not supported for this model; use URL arrays')
  if (body.last_frame_image_url !== undefined || body.first_frame_image_url !== undefined) fail('frame fields are not supported; use documented media format')
  if (!config.attachments && body.attachments !== undefined) fail('attachments is not supported for this model')
  const attachments = config.attachments ? h3Attachments(body) : []
  const inputs = config.media ? { images: [], videos: [], audios: [] } : requestInputs(body, config)
  if (config.attachments) { inputs.videos = []; inputs.audios = [] }
  const media = config.media ? primeMedia(body) : config.superMedia && body.media !== undefined ? superMedia(body) : []
  if (config.attachments && inputs.images.length + attachments.length > 10) fail('H3 reference items must not exceed 10')
  for (const url of [...inputs.images, ...inputs.videos, ...inputs.audios]) {
    if (!/^https:\/\//i.test(url) && !(config.grok && /^data:image\/[a-z0-9.+-]+;base64,/i.test(url))) fail('Reference media requires HTTPS URLs')
  }
  const resolution = resolutionOf(body, config)
  for (const kind of ['images', 'videos', 'audios']) {
    if (inputs[kind].length > config[kind]) fail(`${kind} accepts at most ${config[kind]} references for ${model}`)
  }
  const ratio = firstDefined(body, ['ratio', 'aspect_ratio', 'aspectRatio'])
  if (config.ratios.length && ratio !== undefined && !config.ratios.includes(String(ratio))) {
    fail(`Unsupported ratio for ${model}: ${String(ratio)}`)
  }
  return { model, config, seconds, inputs, ratio, resolution, media, attachments }
}

function imageRequest(body) {
  const model = String(body.model || '')
  if (!IMAGE_MODELS.includes(model)) fail(`Unsupported image model: ${model}`)
  if (!promptOf(body)) fail('prompt is required')
  if (promptOf(body).length > 12000) fail('prompt must not exceed 12000 characters')
  if (body.n !== undefined && Number(body.n) !== 1) fail('n must be 1')
  const gemini = model === 'gemini-nano-banana-2.1'
  const raw = firstDefined(body, ['images', 'imageUrls', 'image_urls', 'image', 'image_url'])
  const images = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw])
  // Nano 的参考图数量未在官方文档给出；面板采用 1 张的保守接入上限。
  if (images.length > (gemini ? 1 : 10)) fail(`Too many reference images for ${model}`)
  const size = String(body.size || '1024x1024')
  let resolution = String(body.resolution || body.imageSize || '1K').toUpperCase()
  if (!gemini) {
    resolution = Object.keys(GPT_SIZES).find(tier => GPT_SIZES[tier].includes(size))
    if (!resolution) fail(`Unsupported GPT image size: ${size}`)
  } else if (!['1K', '2K', '4K'].includes(resolution)) fail(`Unsupported Gemini imageSize: ${resolution}`)
  const ratio = String(firstDefined(body, ['ratio', 'aspect_ratio', 'aspectRatio']) || '1:1')
  if (gemini && !IMAGE_RATIOS.includes(ratio)) fail(`Unsupported Gemini aspectRatio: ${ratio}`)
  const references = images.map(entry => {
    if (entry && typeof entry === 'object' && entry.__fileRef) return entry
    const url = entry && typeof entry === 'object' ? (entry.image_url || entry.url) : entry
    if (typeof url !== 'string' || !/^(https:\/\/|data:image\/[a-z0-9.+-]+;base64,)/i.test(url)) fail('Image references require HTTPS or image data URLs')
    if (gemini && !url.startsWith('data:')) fail('Gemini references require multipart files or image data URLs')
    return url
  })
  return { model, prompt: promptOf(body), size, resolution, ratio, images: references }
}

function decodeImage(ctx) {
  if (!ctx.body || !['json', 'multipart'].includes(ctx.body.kind)) fail('JSON or multipart image body required')
  const body = ctx.body.kind === 'json' ? { ...objectOf(ctx.body.value) } : {}
  if (ctx.body.kind === 'multipart') {
    for (const [key, values] of Object.entries(ctx.body.fields || {})) body[key] = Array.isArray(values) ? values[0] : values
    const files = ctx.body.files || []
    body.images = files.map(file => ({ __fileRef: file.ref, encoding: 'dataUrl', mimeType: file.mimeType || 'image/png', maxBytes: 20 * 1024 * 1024 }))
    if (!files.length) fail('Image edit requires at least one image file')
  }
  body.model = ctx.model || body.model
  const normalized = imageRequest(body)
  if (ctx.operation === 'edit' && !normalized.images.length) fail('Image edit requires references')
  return { kind: 'submit', model: body.model, action: normalized.images.length ? 'image_to_image' : 'text_to_image', requestBody: body }
}

function buildImageSubmit(ctx, model) {
  const request = imageRequest({ ...objectOf(ctx.requestBody), model })
  let url = ctx.baseUrl.replace(/\/$/, '')
  let body
  if (model === 'gemini-nano-banana-2.1') {
    url += '/v1beta/models/' + encodeURIComponent(model) + ':generateContent'
    const parts = [{ text: request.prompt }]
    for (const reference of request.images) {
      if (typeof reference === 'object') {
        parts.push({ inline_data: { mime_type: reference.mimeType, data: { __fileRef: reference.__fileRef, encoding: 'base64', maxBytes: reference.maxBytes } } })
      } else {
        const match = reference.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
        if (!match) fail('Invalid Gemini image data URL')
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } })
      }
    }
    body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { candidateCount: 1, responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: request.resolution, aspectRatio: request.ratio } },
    }
  } else {
    url += request.images.length ? '/v1/images/edits' : '/v1/images/generations'
    body = { model, prompt: request.prompt, size: request.size, n: 1, response_format: 'b64_json' }
    if (request.images.length) body.images = request.images.map(image_url => ({ image_url }))
  }
  return { url, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey }, body, action: ctx.action }
}

function imageResult(model, body) {
  if (model === 'gemini-nano-banana-2.1') {
    const candidates = Array.isArray(body.candidates) ? body.candidates : []
    const parts = candidates.flatMap(candidate => objectOf(candidate.content).parts || [])
    return parts.map(part => objectOf(part.inlineData || part.inline_data)).filter(part => part.data).map(part => ({ b64_json: String(part.data) }))
  }
  return (Array.isArray(body.data) ? body.data : []).filter(entry => entry && (entry.url || entry.b64_json)).map(entry => entry.b64_json ? { b64_json: String(entry.b64_json) } : { url: String(entry.url) })
}

export const protocols = {
  openai_image: {
    decodeRequest: decodeImage,
    render(ctx, task) {
      const data = objectOf(task.data).data
      if (!Array.isArray(data) || !data.length) fail('Image result is empty')
      return { data }
    },
  },
  openai_video: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const validated = validateRequest(ctx.body.value)
      const { inputs, media, attachments } = validated
      return {
        kind: 'submit',
        model: ctx.model,
        action: attachments.length || media.length || inputs.images.length || inputs.videos.length || inputs.audios.length ? 'image_to_video' : 'text_to_video',
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
  if (IMAGE_MODELS.includes(model)) return buildImageSubmit(ctx, model)
  const { config, seconds, inputs, ratio, resolution, media, attachments } = validateRequest({ ...source, model })
  const body = {
    model,
    prompt: promptOf(source),
    [config.durationField]: seconds,
  }
  if (config.grok) delete body.seconds
  if (attachments.length) body.attachments = attachments
  if (config.attachments) {
    if (source.ai_enhance !== undefined) {
      if (typeof source.ai_enhance !== 'boolean') fail('ai_enhance must be a boolean')
      body.ai_enhance = source.ai_enhance
    }
    if (source.seed !== undefined) {
      if (!Number.isInteger(source.seed) || source.seed < 0) fail('seed must be a non-negative integer')
      body.seed = source.seed
    }
    if (source.negative_prompt !== undefined) body.negative_prompt = String(source.negative_prompt)
  }
  if (config.ratios.length && typeof ratio === 'string' && ratio.trim()) body[config.grok ? 'aspect_ratio' : 'ratio'] = ratio.trim()
  if (config.resolutions) body.resolution = config.media ? resolution : resolution.toLowerCase()
  if (media.length) body.media = media
  if (config.media && source.prompt_extend !== undefined) {
    if (typeof source.prompt_extend !== 'boolean') fail('prompt_extend must be a boolean')
    body.prompt_extend = source.prompt_extend
  }
  if (inputs.images.length) {
    if (config.grok && inputs.firstFrame) body.image_url = inputs.images[0]
    else body[config.grok ? 'reference_images' : 'image_urls'] = inputs.images
  }
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
  const model = String(ctx.upstreamModel || ctx.model || '')
  if (IMAGE_MODELS.includes(model)) {
    const data = imageResult(model, body)
    if (data.length !== 1) fail('Yihong must return exactly one image')
    return { taskId: String(ctx.publicTaskId || body.id || 'image-result'), taskData: { data }, immediate: { status: 'SUCCESS', progress: '100%' } }
  }
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
  if (IMAGE_MODELS.includes(model)) {
    const request = imageRequest({ ...body, model })
    return { calls: 1, seconds: 0, resolution: request.resolution, image_count: 1 }
  }
  const config = configOf(model)
  const seconds = secondsOf(body, config)
  return { calls: 1, seconds, resolution: resolutionOf(body, config), image_count: 0 }
}

export function extractUsageOnComplete(ctx, task, data) {
  const snapshot = objectOf(data)
  if (Array.isArray(snapshot.data)) return { calls: 1, image_count: snapshot.data.length }
  return { calls: 1 }
}
