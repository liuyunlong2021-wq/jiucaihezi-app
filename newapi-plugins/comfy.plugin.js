// NewAPI Task Plugin v1 —— 本机 ComfyUI（经 comfy-adapter）
//
// 存在理由只有一条：**让面板的自定义参数无损到达适配器**。
// 现在走 type 1 OpenAI 渠道时，NewAPI 只转发它 TaskSubmitReq 里认得的字段
// （model/prompt/images/duration/size/mode/seconds/input_reference/metadata），
// `aspect_ratio` 与 `extra_fields` 会被整段丢掉 —— 「面板选了 4:3 却出 9:16」、
// 「戏种选了没反应」都是这么来的。插件通道里 decodeRequest 拿到的是客户端原始 body，
// 由插件决定发什么，所以这里**原样透传**。
//
// comfy-adapter **不下岗**：它是执行器（模板渲染、ComfyUI 提交、Topaz、成片存储），
// 插件只是它的代理。适配器 `adp/template.py` 的 `normalize()` 会自己摊平
// `extra_fields` / `metadata` 里的标量并做 clamp/枚举校验，所以透传是安全的。
//
// 详见 docs/wiki/运维/本机ComfyUI接入NewAPI任务插件通道SDD-2026-10-01.md
export const meta = {
  apiVersion: 1,
  key: 'comfy',
  name: '本机 ComfyUI',
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Local ComfyUI via comfy-adapter',
    zh: '经 comfy-adapter 驱动本机 ComfyUI',
  },
  // 面板 body 里的 model 就是这两个对外名（creationModelRegistry 的 model 字段）：
  // 文生 / 首帧图生 / 首尾帧共用 `jc-minimax-h3`，参考生是 `jc-minimax-h3-ref2v`。
  // 渠道 model_mapping 再把它们换成适配器内部 id（minimax-h3 / minimax-h3-ref2v）。
  models: ['jc-minimax-h3', 'jc-minimax-h3-ref2v'],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // type 61 渠道把 Base URL 留空时用这个默认值（适配器只绑在 docker 网络内）
  baseUrl: 'http://frps:8796',
  usageSchema: {
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Video generation unit price', zh: '视频生成单价' },
    },
  },
  usageExamples: [
    { label: '文戏 5 秒', facts: { seconds: 5 } },
    { label: '文戏 28 秒 · 上限', facts: { seconds: 28 } },
  ],
}

// 适配器状态机：queued -> running -> succeeded / failed / cancelled（adp/tasks.py）
const ADAPTER_STATUS = {
  queued: 'SUBMITTED',
  running: 'IN_PROGRESS',
  succeeded: 'SUCCESS',
  failed: 'FAILURE',
  cancelled: 'FAILURE',
}

const HOST_STATUS = {
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

// 面板必带 duration；真没带时按保守值预留额度，结算用适配器归一化后的实际秒数纠正
const USAGE_FALLBACK_SECONDS = 5

function fail(message) {
  throw new Error(message)
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调一次，选中后再调一次。
    // 这里不重排字段、不改写名字 —— 适配器本来就认得面板发的那套形状。
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      if (!String(body.prompt || '').trim()) fail('prompt is required')
      // 时长只做粗校验：上限与 17n+5 帧对齐由适配器的 constraints 自己 clamp
      if (body.duration !== undefined && body.duration !== null) {
        const duration = body.duration
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
          fail('duration must be a positive number')
        }
      }
      const hasImage = Boolean(body.first_frame || body.last_frame || body.image ||
        (Array.isArray(body.images) && body.images.length))
      // 原样返回：返回值就是「归一化后的 requestBody」，再复制一份只会白拷 data URL。
      // 不动入参（宿主把 hook 参数当只读），文件占位符替换由宿主在副本上做。
      return {
        kind: 'submit',
        model: ctx.model,
        action: hasImage ? 'image_to_video' : 'text_to_video',
        requestBody: body,
      }
    },
    // 成片与状态由宿主渲染；这里不返回上游 URL —— 适配器给的是内网地址（frps:8796）。
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
  // 不改入参：返回的副本才是宿主实际要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 适配器吃的是内部 id（渠道映射后）；没配映射时退回对外名，别变成 undefined
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
  if (!body.id) fail('comfy-adapter did not return a task id')
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
  if (status === 'FAILURE') {
    out.reason = String(
      (body && (body.fail_reason || body.error || body.message)) || `comfy-adapter status: ${raw}`,
    )
  }
  return out
}

export function listArtifacts(task) {
  return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

// 适配器的 /content 支持 Range，客户端要什么就透什么（clientRequest.method 里带 GET/HEAD）
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

// 适配器任务视图的 params 就是模板归一化后的实际值（duration 已被 clamp 到 1~28）
export function extractUsageOnComplete(ctx, task, body) {
  if (!body || typeof body !== 'object') return null
  const raw = body.params && body.params.duration !== undefined ? body.params.duration : body.duration
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? { seconds } : null
}
