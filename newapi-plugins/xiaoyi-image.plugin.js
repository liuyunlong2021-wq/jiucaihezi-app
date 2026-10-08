// NewAPI Task Plugin v1 — Xiaoyi OpenAI Images
// Xiaoyi's asynchronous image endpoints are polled by the NewAPI rc40 openai_image host protocol.
// The host returns an OpenAI ImageResponse; the client then downloads the returned URL as usual.
export const meta = {
  apiVersion: 1,
  key: 'xiaoyi-image',
  name: '小易图片',
  version: '0.1.1',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'GPT Image and Grok Imagine via Xiaoyi asynchronous image APIs',
    zh: '通过小易异步图片接口生成 GPT Image 与 Grok Imagine 图片',
  },
  baseUrl: 'https://image.xiaoyiapi.xyz',
  models: [
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
  ],
  fetchMode: 'per_task',
  protocols: ['openai_image'],
  usageSchema: {
    image_count: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'image', zh: '张' },
      description: { en: 'Requested image count', zh: '请求生成的图片数量' },
    },
  },
  usageExamples: [
    { label: '生成 1 张', facts: { image_count: 1 } },
    { label: '生成 4 张', facts: { image_count: 4 } },
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

function modelOf(ctx) {
  const model = String(ctx.model || '')
  if (!meta.models.includes(model)) fail(`Unsupported Xiaoyi image model: ${model || '(missing)'}`)
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
      const requestBody = {
        model,
        prompt,
        n: first(values, 'n', 1),
        imageRefs: files.map(file => ({ ref: file.ref, filename: file.filename })),
      }
      const size = first(values, 'size', undefined)
      const quality = first(values, 'quality', undefined)
      const ratio = first(values, 'aspect_ratio', first(values, 'aspectRatio', first(values, 'ratio', undefined)))
      if (size !== undefined && size !== null) requestBody.size = size
      if (quality !== undefined && quality !== null) requestBody.quality = quality
      if (ratio !== undefined && ratio !== null) requestBody.ratio = ratio
      return {
        kind: 'submit',
        model: ctx.model,
        action: ctx.operation === 'edit' ? 'image_to_image' : 'text_to_image',
        requestBody,
      }
    },
    render: function (ctx, task) {
      const payload = snapshotOf(task && task.data)
      const result = snapshotOf(payload.result || (payload.data && payload.data.result) || payload)
      const entries = Array.isArray(result.data) ? result.data : []
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
    n: Number(body.n) > 0 ? Number(body.n) : 1,
    response_format: 'url',
  }
  if (isGrok && body.ratio) common.aspect_ratio = String(body.ratio)
  if (!isGrok && body.quality) common.quality = String(body.quality)

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
  if (['success', 'succeeded', 'completed', 'complete'].includes(raw)) return { status: 'SUCCESS', progress: '100%' }
  if (['failed', 'failure', 'error'].includes(raw)) {
    const error = snapshotOf(snapshot.error)
    const reason = typeof snapshot.error === 'string' ? snapshot.error : error.message
    return { status: 'FAILURE', reason: String(reason || snapshot.message || 'Xiaoyi image generation failed') }
  }
  return { status: 'UNKNOWN', reason: `Unknown Xiaoyi image task status: ${raw || '(empty)'}` }
}

export function extractUsage(ctx) {
  const body = snapshotOf(ctx.requestBody)
  const count = Number(body.n)
  return { image_count: Number.isFinite(count) && count > 0 ? Math.min(10, Math.floor(count)) : 1 }
}

export function extractUsageOnComplete(task, result, data) {
  const payload = snapshotOf(data)
  const output = snapshotOf(payload.result || (payload.data && payload.data.result) || payload)
  const images = Array.isArray(output.data) ? output.data.length : 0
  return images > 0 ? { image_count: images } : null
}
