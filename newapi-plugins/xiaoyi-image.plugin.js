// NewAPI Task Plugin v1 — 小易图片异步 API。
// https://xiaoyiapi.xyz/docs/api/images/  https://xiaoyiapi.xyz/docs/api/grok-images/
// 参考图通过宿主 fileRef 直接上传；结果向上游请求 Base64，不依赖浏览器下载外链。
const MODEL_MAP = {
  'xy-gpt-image-2-1k': 'gpt-image-2',
  'xy-gpt-image-2.5-1k': 'gpt-image-2.5',
  'xy-gpt-image-2.5-flare-1k': 'gpt-image-2.5-flare',
  'xy-gpt-image-2.5-sunburst-1k': 'gpt-image-2.5-sunburst',
  'xy-grok-imagine-image-2.0': 'grok-imagine-image-2.0',
}
const IMAGE_MODELS = Object.keys(MODEL_MAP)
// 用户确认仅允许既有画布预设；自定义尺寸在提交前拒绝，不自动缩小。
const SIZE_TIERS = {
  '1k': ['1024x1024', '1024x1536', '1536x1024', '1024x768', '768x1024', '1536x864', '864x1536', '2016x864', '864x2016'],
  '2k': ['2048x2048', '1360x2048', '2048x1360', '2048x1536', '1536x2048', '2048x1152', '1152x2048', '2688x1152', '1152x2688'],
  '4k': ['2880x2880', '2336x3520', '3520x2336', '3312x2480', '2480x3312', '3840x2160', '2160x3840', '3840x1648', '1648x3840'],
}

export const meta = {
  apiVersion: 1,
  key: 'xiaoyi-image',
  name: '小易图片',
  version: '0.3.0',
  author: { name: 'jiucaihezi' },
  description: { en: 'Five Xiaoyi image models via file uploads and asynchronous APIs', zh: '小易五个图片模型，参考图直接传文件，按张计费' },
  baseUrl: 'https://image.xiaoyiapi.xyz',
  models: IMAGE_MODELS,
  fetchMode: 'per_task',
  protocols: [{ name: 'openai_image', models: IMAGE_MODELS }],
  usageSchema: {
    image_count: { type: 'number', unit: 'count', unitLabel: { en: 'image', zh: '张' }, description: { en: 'Generated image count', zh: '生成图片张数' } },
  },
  usageExamples: [
    { label: '生成 1 张', facts: { image_count: 1 } },
    { label: '生成 4 张', facts: { image_count: 4 } },
  ],
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
  if (MODEL_MAP[model] !== 'grok-imagine-image-2.0' && model !== 'grok-imagine-image-2.0') return
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

function validateResolution(body, model) {
  const size = String(body.size || '1024x1024').toLowerCase()
  const dimensions = /^(\d+)x(\d+)$/.exec(size)
  if (!dimensions || dimensions.slice(1).some(value => !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) fail('size must be explicit positive pixel dimensions')
  const tier = Object.keys(SIZE_TIERS).find(key => SIZE_TIERS[key].includes(size))
  if (!tier) fail('Unsupported size: choose an allowed image size preset')
  const declared = body.resolution === undefined ? undefined : String(body.resolution).toLowerCase()
  const grok = MODEL_MAP[model] === 'grok-imagine-image-2.0'
  const allowed = grok ? ['1k', '2k'] : ['1k']
  if ((tier && !allowed.includes(tier)) || (declared && !allowed.includes(declared))) fail(grok ? 'Grok only supports 1K / 2K' : 'This GPT image model only supports 1K')
  if (declared && tier && declared !== tier) fail('size conflicts with resolution')
  return size
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

export const protocols = {
  openai_image: {
    decodeRequest: function (ctx) {
      const model = modelOf(ctx)
      const { values, prompt } = requestValues(ctx)
      const files = ctx.body.kind === 'multipart' && Array.isArray(ctx.body.files) ? ctx.body.files : []
      if (ctx.operation === 'edit' && !files.length) fail('multipart image edit requires at least one image file')
      if (files.some(file => !['image', 'image[]', 'images'].includes(file.field))) fail('Unsupported image file field')
      const references = ['image', 'image[]', 'images', 'image_url', 'image_urls', 'imageUrl', 'imageUrls', 'input_reference']
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
      const resolution = first(values, 'resolution', undefined)
      if (resolution !== undefined) requestBody.resolution = resolution
      if (size !== undefined && size !== null) requestBody.size = size
      if (quality !== undefined && quality !== null) requestBody.quality = quality
      if (ratio !== undefined && ratio !== null) requestBody.ratio = ratio
      for (const key of ['background', 'output_format']) {
        const value = first(values, key, undefined)
        if (value !== undefined && value !== null) requestBody[key] = String(value)
      }
      requestBody.size = validateResolution(requestBody, model)
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
  const body = snapshotOf(ctx.requestBody)
  const publicModel = String(ctx.model || body.model || '')
  const model = MODEL_MAP[publicModel]
  const requestedModel = String(ctx.upstreamModel || publicModel)
  if (!model || ![publicModel, model].includes(requestedModel)) fail('Unsupported Xiaoyi image model mapping: ' + publicModel)
  validateResolution(body, publicModel)
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
    response_format: 'b64_json',
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
      { name: 'response_format', value: 'b64_json' },
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
  return { taskId: String(taskId), taskData: body }
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl.replace(/\/$/, '') + '/v1/images/tasks/' + encodeURIComponent(ctx.taskId),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  const snapshot = snapshotOf(body)
  const raw = String(snapshot.status || '').toLowerCase()
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
  return { image_count: requestedCount(body.n) }
}

export function extractUsageOnComplete(task, result, data) {
  const images = imageEntries(data).length
  return images > 0 ? { image_count: images } : null
}
