// NewAPI Task Plugin v1 —— ZX 视频（经 zx-video-adapter）
//
// 存在理由与 comfy / dola / shanhai 同一条：面板的画幅、分辨率、时长都在
// `TaskSubmitReq` 白名单之外，走旧渠道会被整段丢掉，适配器只能落回自己的默认值。
// 插件通道里 body 由 `decodeRequest` 决定，所以这里**原样透传**。
//
// zx-video-adapter **不下岗**，它担着插件做不到的活：
//   - Grok 有参考图时要把它转成 `input_reference` **文件字段**（multipart）；
//   - MJ 要把参考图变成 Base64 数组；
//   - 它自己记着 `TASK_AUTHORIZATIONS`，成片要带 Key 才能取。
//   插件没有 fetch / fs，这些都装不下。
//
// ★ 只收编 **6 个模型**，`doubao-seedance-2-5-260628` 有意不在表里：
// 面板把它发到 `/v1/video/generations`（registry 的 `endpoint`），而宿主的协议绑定表里
// `openai_video` 只有 `POST /v1/videos` 这一条 create 路径 —— `/v1/video/generations`
// 不是任何宿主协议的路径，type 61 渠道接不住它（原生路线还会被加上插件前缀）。
// 那个模型继续留在旧渠道上；要用插件接管得先改 App 的 endpoint，本波不做。
//
// 事实源：`zx-video-adapter/src/main.py` 与 `zx-video-adapter/README.md`。
export const meta = {
  apiVersion: 1,
  key: 'zx',
  name: 'ZX 视频',
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'ZX Grok / Omni / Midjourney via zx-video-adapter',
    zh: '经 zx-video-adapter 驱动 ZX 的 Grok / Omni / Midjourney',
  },
  // 面板 body 的 `model`（creationModelRegistry 的 `model` 字段）。
  // Seedance 有意缺席，理由见文件头。
  models: [
    'grok-1.5-video-6s',
    'grok-1.5-video-10s',
    'grok-1.5-video-15s',
    'omni-fast',
    'omni-v2v',
    'mj_fast_imagine',
  ],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // 适配器容器加入 new-api-new_new-api-network 且不映射宿主端口，所以只能走服务名
  baseUrl: 'http://zx-video-adapter:8789',
  // 三种计费口径：Grok/Omni/Seedance 按秒，MJ 是**图片任务**按次（请求里没有时长）。
  // 两个 key 都声明，两种表达式才都能存进定价页。
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Per-task price', zh: '单次生成单价' },
    },
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Video generation unit price', zh: '视频生成单价' },
    },
  },
  // 宿主硬校验：每个例子都要带齐所有声明的 key，少一个上传即被拒
  usageExamples: [
    { label: 'Grok 10 秒', facts: { calls: 1, seconds: 10 } },
    { label: '图片任务（无时长）', facts: { calls: 1, seconds: 0 } },
  ],
}

// Grok 的时长**写在模型名里**，请求体不带 duration，适配器也不发 `seconds`
// （README：「模型名决定时长，不发送 seconds」）—— 所以只能从模型名读。
const GROK_SECONDS = {
  'grok-1.5-video-6s': 6,
  'grok-1.5-video-10s': 10,
  'grok-1.5-video-15s': 15,
}

// Omni 两档固定 10 秒（registry `allowedValues: [10]`），请求里真没带就按它算
const OMNI_SECONDS = 10
const OMNI_MODELS = ['omni-fast', 'omni-v2v']

// MJ 是**图片**任务：适配器 `normalized_mj_task_response` 把成图放在 `metadata.url`，
// 而且把 `object` 也写成 `video`（适配器的历史形状），所以只能按模型名区分。
const IMAGE_RESULT_MODELS = ['mj_fast_imagine']

// 适配器状态机：三种形状（标准 / Seedance / MJ）都在适配器里归一化成这三个词
const ADAPTER_STATUS = {
  queued: 'QUEUED',
  pending: 'QUEUED',
  submitted: 'SUBMITTED',
  running: 'IN_PROGRESS',
  processing: 'IN_PROGRESS',
  in_progress: 'IN_PROGRESS',
  completed: 'SUCCESS',
  succeeded: 'SUCCESS',
  success: 'SUCCESS',
  failed: 'FAILURE',
  failure: 'FAILURE',
  cancelled: 'FAILURE',
  canceled: 'FAILURE',
}

const HOST_STATUS = {
  NOT_START: 'queued',
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

function fail(message) {
  throw new Error(message)
}

function snapshotOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isImageResult(model) {
  return IMAGE_RESULT_MODELS.includes(String(model || ''))
}

// 成片/成图的**绝对**地址：Grok 与 Seedance 是上游公开直链，MJ 在 `metadata.url`。
// Omni 不在此列 —— 适配器把它改写成 `/v1/videos/{id}/content`（相对路径、要带 Key），
// 那种地址只能由宿主的 artifact 通道转给适配器，不能透给客户端。
function absoluteMediaUrl(snapshot) {
  const candidates = []
  if (typeof snapshot.video_url === 'string') candidates.push(snapshot.video_url)
  if (typeof snapshot.url === 'string') candidates.push(snapshot.url)
  const metadata = snapshotOf(snapshot.metadata)
  if (typeof metadata.url === 'string') candidates.push(metadata.url)
  for (const value of candidates) {
    if (/^https?:\/\//i.test(value)) return value
  }
  return ''
}

function failureReason(body) {
  const error = snapshotOf(body && body.error)
  return String((body && (body.fail_reason || error.message || body.message)) || '')
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调一次，选中后再调一次。
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      if (!String(body.prompt || '').trim()) fail('prompt is required')
      // 张数、地址、size 这些由适配器校验（Grok 只接受 size=1280x720、最多 7 张参考图），
      // 插件重复一遍只会两处漂移 —— 适配器回 400 且不建任务，不会白扣费。
      const hasImage = Boolean(
        (Array.isArray(body.images) && body.images.length) ||
        body.image ||
        body.imageUrl ||
        (Array.isArray(body.imageUrls) && body.imageUrls.length) ||
        (Array.isArray(body.reference_images) && body.reference_images.length),
      )
      const hasVideo = Boolean(body.video_url || body.videoUrl || body.video ||
        (Array.isArray(body.videos) && body.videos.length))
      let action = hasImage || hasVideo ? 'image_to_video' : 'text_to_video'
      if (isImageResult(model)) action = hasImage ? 'image_to_image' : 'text_to_image'
      // 返回值就是「归一化后的 requestBody」，原样返回既不白拷 data URL 也不动入参
      return { kind: 'submit', model: ctx.model, action, requestBody: body }
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
      const snapshot = snapshotOf(task && task.data)
      // 宿主会把 `object` 覆盖成它自己的形状，这里只管把地址给对
      const url = absoluteMediaUrl(snapshot)
      if (url && task.status === 'SUCCESS') {
        if (isImageResult(snapshot.model)) {
          // MJ：成图走 OpenAI 的取法（面板的 extractor 先看 url，再看 metadata.url）
          view.object = 'image'
          view.url = url
          view.metadata = { url }
        } else {
          view.video_url = url
        }
      }
      // Omni 的成片要走宿主的 artifact 通道（`GET /v1/videos/:task_id/content`），
      // 宿主若注入了它自己的地址就用它；没有就不写（与已验证的 comfy 插件同形）
      if (!view.video_url && task.status === 'SUCCESS') {
        const artifacts = ctx && ctx.artifacts ? ctx.artifacts : {}
        const artifact = artifacts && (artifacts.video || artifacts.image) ? (artifacts.video || artifacts.image) : {}
        if (artifact && artifact.url) view.video_url = String(artifact.url)
      }
      const reason = failureReason(snapshot)
      if (reason) view.error = reason
      return view
    },
  },
}

export function buildSubmitRequest(ctx) {
  // 不改入参：返回的副本才是宿主实际要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 适配器只认这几个 `model` 名，渠道映射后用它；没配映射时退回对外名，别变成 undefined
  body.model = ctx.upstreamModel || ctx.model
  return {
    url: ctx.baseUrl + '/v1/videos',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 适配器把这枚 Bearer 原样转给 ZX（成片下载也用它）
      Authorization: 'Bearer ' + ctx.apiKey,
    },
    body,
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {}
  if (!body.id) fail('zx-video-adapter did not return a task id')
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
  const status = ADAPTER_STATUS[raw]
  // 不认识的**不能**当 IN_PROGRESS —— 宿主把 UNKNOWN / 空 / hook 抛错都算轮询失败
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'SUCCESS') {
    // 只有上游给的**绝对**地址才能直接当成品地址报出去（Grok / Seedance / MJ）
    const url = absoluteMediaUrl(snapshotOf(body))
    if (url) out.url = url
  }
  if (status === 'FAILURE') out.reason = failureReason(body) || `zx-video-adapter status: ${raw}`
  return out
}

// 宿主**强制**要求声明了 `openai_video` 的插件同时导出这两个 hook —— 少了会被直接拒收：
// 「plugin <key> protocol "openai_video" is missing driver hook "listArtifacts"」。
export function listArtifacts(task) {
  if (task.status !== 'SUCCESS') return []
  const snapshot = snapshotOf(task && task.data)
  if (isImageResult(snapshot.model)) {
    return [{ key: 'image', type: 'image', mimeType: 'image/png' }]
  }
  return [{ key: 'video', type: 'video', mimeType: 'video/mp4' }]
}

// 两种成片取法：
//   - 上游公开直链（Grok / Seedance / MJ 成图）→ `credentialless`，宿主只放 GET/HEAD、不带插件头；
//   - 适配器那个带 Key 的 `/v1/videos/{id}/content`（Omni）→ 打回适配器并带渠道 Key。
export function buildContentRequest(ctx) {
  const snapshot = snapshotOf(ctx && ctx.data)
  const key = String(ctx.artifactKey || '')
  if (key !== 'video' && key !== 'image') fail('artifact_not_found')
  const url = absoluteMediaUrl(snapshot)
  if (url) return { url, method: ctx.clientRequest.method, credentialless: true }
  if (key !== 'video') fail('artifact_not_found')
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content',
    method: ctx.clientRequest.method,
    headers: { Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function extractUsage(ctx) {
  // 宿主要求**每个声明的 key 都有值**，所以没有时长就报 0，而不是省略
  const body = snapshotOf(ctx && ctx.requestBody)
  const model = String((ctx && (ctx.upstreamModel || ctx.model)) || '')
  let seconds = 0
  if (GROK_SECONDS[model] !== undefined) {
    // 时长写在模型名里，请求体带的 duration 也不影响上游实际产出
    seconds = GROK_SECONDS[model]
  } else if (OMNI_MODELS.includes(model)) {
    const raw = Number(body.duration !== undefined ? body.duration : body.seconds)
    seconds = Number.isFinite(raw) && raw > 0 && raw <= 3600 ? raw : OMNI_SECONDS
  }
  // MJ 是图片任务：没有时长，定价必须用 `u("calls")`（用秒会真的扣 0）
  return { calls: 1, seconds }
}

export function extractUsageOnComplete(ctx, task, body) {
  // 补全事实逐 key 覆盖提交快照：这里只回真正确定的 `calls`，
  // seconds 保留提交时的值（适配器任务视图里没有「实际时长」这个字段）
  return { calls: 1 }
}
