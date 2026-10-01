// NewAPI Task Plugin v1 —— 菠萝 MiniMax（aimanplay.cn）
//
// 用途：取代 `boluo-minimax-adapter` 这个独立服务。适配器只做协议翻译（字段校验、
// 参考素材摊平成 ref_image_N / ref_audio_N、任务查询与成片代理），插件直接打上游，
// 宿主负责任务持久化、轮询、用量结算与成片代理。
//
// 事实源：boluo-minimax-adapter/src/main.py（2026-10-01 逐条搬过来）。
// 契约来源：docs/wiki/运维/菠萝MiniMaxapi.md、boluo-minimax-adapter/README.md。
//
// 与适配器的三处有意差异：
//   1. 任务号用上游真实 id（适配器当年是为了「响应不受上游快慢影响」自造本地 id，
//      现在宿主自己就持久化任务行，不需要这层间接）。
//   2. 参考素材仍然原样透传（App 已把它们换成公网 URL），不下载不转存。
//   3. 成片不返回上游 URL，走宿主的 /content 代理 —— 上游 URL 带临时 token，不能外泄。
//
// 部署：管理员页上传（或 POST /api/plugin/task），再建 type 61「Task Plugin」渠道，
// plugin key 选 `boluo`，Base URL `https://aimanplay.cn`，密钥填菠萝平台的 sk-... 令牌。
export const meta = {
  apiVersion: 1,
  key: 'boluo',
  name: '菠萝 MiniMax',
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'MiniMax H3 image+audio reference-to-video via aimanplay.cn',
    zh: '菠萝平台 MiniMax H3 图音参考生视频',
  },
  // 面板发的就是这两个裸模型名（creationModelRegistry 的 model 字段），不需要渠道映射
  models: ['minimax_h3_image_audio_to_video_v2_15s', 'minimax_h3_zm_u24'],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // type 61 渠道把 Base URL 留空时用这个默认值
  baseUrl: 'https://aimanplay.cn',
  usageSchema: {
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Video generation unit price', zh: '视频生成单价' },
    },
  },
  usageExamples: [
    { label: '旧版 15 秒 · 768p竖', facts: { seconds: 15 } },
    { label: '增强版 5 秒 · 768p竖', facts: { seconds: 5 } },
  ],
}

// 两个模型的请求字段完全相同（图 ≤9 + 音频 ≤3、时长 1~15），
// 只有分辨率枚举和默认时长不同；首尾帧与纯文生模型未接入。
const MODELS = {
  minimax_h3_image_audio_to_video_v2_15s: {
    defaultDuration: 15,
    resolutions: ['480p竖', '768p竖', '480p横', '768p横'],
  },
  minimax_h3_zm_u24: {
    defaultDuration: 5,
    resolutions: ['480p竖', '768p竖', '480p横', '768p横', '480p(1:1)', '768p(1:1)'],
  },
}

const MAX_DURATION = 15
const MAX_PROMPT_CHARS = 12000
const MAX_IMAGES = 9
const MAX_AUDIOS = 3
// 上游没有比例字段，方向完全写在 resolution 后缀里；ratio 只用于「没给分辨率」时推导
const RATIO_AXIS = { '16:9': '横', '9:16': '竖', '1:1': '(1:1)' }
const RESOLUTION_AXIS = [
  ['(1:1)', '1:1'],
  ['竖', '9:16'],
  ['横', '16:9'],
]
const DEFAULT_RESOLUTION = '768p竖'
// 面板必带 duration；真没带时按保守值预留额度，结算时用上游实际时长纠正
const USAGE_FALLBACK_SECONDS = 5

const HOST_STATUS = {
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

// 上游枚举：queued / in_progress / completed / failed，另有兼容值 unknown。
// 不认识的**不能**当 IN_PROGRESS —— 宿主把 UNKNOWN / 空 / hook 抛错都算轮询失败。
const UPSTREAM_STATUS = {
  queued: 'SUBMITTED',
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

function mediaUrls(body, keys) {
  let value
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) {
      value = body[key]
      break
    }
  }
  if (value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  const out = []
  for (const item of list) {
    const url = item && typeof item === 'object' ? item.url : item
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) fail('reference media must be a URL')
    out.push(url)
  }
  return out
}

function axisOf(resolution) {
  for (const [suffix, ratio] of RESOLUTION_AXIS) {
    if (resolution.endsWith(suffix)) return ratio
  }
  return ''
}

function resolveResolution(spec, model, body) {
  let resolution = String(body.resolution || '')
  const ratio = String(body.aspect_ratio || body.ratio || '')
  if (!resolution) {
    const axis = RATIO_AXIS[ratio]
    resolution = axis ? `768p${axis}` : DEFAULT_RESOLUTION
  } else if (RATIO_AXIS[ratio] && RATIO_AXIS[ratio] !== axisOf(resolution)) {
    // 两者矛盾时必须打回：不能让客户端拿到一个方向不对的视频
    fail(
      `resolution ${resolution} conflicts with aspect_ratio ${ratio} for ${model}：` +
        '这两个模型只认 resolution，请传带竖/横/(1:1) 后缀的分辨率',
    )
  }
  if (!spec.resolutions.includes(resolution)) {
    fail(`Unsupported resolution for ${model}: ${resolution}`)
  }
  return resolution
}

/**
 * 把客户端的 OpenAI 风格 body 归一化成菠萝的提交体。
 * 校验全部同步完成 —— 参数错误在渠道选择阶段就是 400，不会变成异步失败、也不占额度。
 */
function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = String(body.model || '')
  const spec = MODELS[model]
  if (!spec) {
    fail(`Unsupported model: ${model || '(missing)'}; expected one of ${Object.keys(MODELS).join(', ')}`)
  }
  const prompt = String(body.prompt || '').trim()
  if (!prompt) fail('prompt is required')
  if (prompt.length > MAX_PROMPT_CHARS) fail(`prompt must be at most ${MAX_PROMPT_CHARS} characters`)

  let duration = body.duration
  if (duration === undefined || duration === null) duration = body.seconds
  if (duration === undefined || duration === null) duration = spec.defaultDuration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION) {
    fail(`duration must be from 1 to ${MAX_DURATION} seconds`)
  }

  const resolution = resolveResolution(spec, model, body)
  const images = mediaUrls(body, ['images', 'image_urls', 'image'])
  const audios = mediaUrls(body, ['audios', 'audio_urls', 'audio'])
  if (images.length > MAX_IMAGES) fail(`At most ${MAX_IMAGES} reference images are allowed`)
  if (audios.length > MAX_AUDIOS) fail(`At most ${MAX_AUDIOS} reference audios are allowed`)

  const payload = { model, prompt, duration, resolution }
  if (body.seed !== undefined && body.seed !== null) {
    const seed = body.seed
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) {
      fail('seed must be a non-negative integer')
    }
    payload.seed = seed
  }
  images.forEach((url, index) => {
    payload[`ref_image_${index}`] = url
  })
  audios.forEach((url, index) => {
    payload[`ref_audio_${index}`] = url
  })
  return { payload, hasImage: images.length > 0 }
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调用一次，选中后再调一次
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const { payload, hasImage } = normalizeRequest(ctx.body.value)
      return {
        kind: 'submit',
        model: ctx.model,
        action: hasImage ? 'image_to_video' : 'text_to_video',
        requestBody: payload,
      }
    },
    render: function (ctx, task) {
      return {
        id: task.task_id,
        object: 'video',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
    },
  },
}

export function buildSubmitRequest(ctx) {
  // 不改入参：宿主把 hook 参数当只读，返回的副本才是它要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 上游吃的是机器身份（渠道映射后）；没配映射时就是对外名
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
  const body = resp.body || {}
  if (!body.id) fail('菠萝 did not return a task ID')
  return { taskId: String(body.id), taskData: body }
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.taskId),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  const raw = String((body && body.status) || '').toLowerCase()
  const status = UPSTREAM_STATUS[raw]
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'FAILURE') {
    const message = body && body.error && body.error.message
    out.reason = String(message || body.fail_reason || `菠萝 task ${raw}`)
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
  const seconds = ctx.requestBody && Number(ctx.requestBody.duration)
  return { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : USAGE_FALLBACK_SECONDS }
}

export function extractUsageOnComplete(ctx, task, body) {
  const seconds = body && Number(body.duration)
  return Number.isFinite(seconds) && seconds > 0 ? { seconds } : null
}
