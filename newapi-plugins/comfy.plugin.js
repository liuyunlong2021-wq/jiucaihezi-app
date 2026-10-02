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
// 图片模型（`jc-qwen-image-2.1`）走同一个适配器的 `/v1/images/generations`，但它是**同步**的：
// 一次请求就把图跑完并回来（模板没设 `default_async`），所以走宿主协议 `openai_image`，
// 不用查询/轮询。图片**必须以内联 `b64_json` 回** —— 适配器的 `public_base_url` 是 Docker
// 内网名（`http://frps:8796`），第三方与桌面端都解析不了，而客户端侧的 urlSafety 又禁止把
// 结果地址指向私有地址；这与当年 type 1 渠道下 `imageResultFormat: 'b64_json'` 完全一致。
//
// 显存口径（2026-10-02 实测）：H3 栈（UNET 19.53GB + 文本编码器 14.61GB + 8 个以上 LoRA +
// 上采样 1.29GB ≈ 40GB）与 Qwen 栈（UNET 6.63GB + 文本编码器 16.33GB ≈ 23GB）**不能同时常驻**，
// 但 ComfyUI 用完会卸（实测跑完 free 46.3GB），所以图/视频交替只是付一次重载的代价。
//
// 详见 docs/wiki/运维/本机ComfyUI接入NewAPI任务插件通道SDD-2026-10-01.md
export const meta = {
  apiVersion: 1,
  key: 'comfy',
  name: '本机 ComfyUI',
  version: '0.3.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Local ComfyUI via comfy-adapter',
    zh: '经 comfy-adapter 驱动本机 ComfyUI',
  },
  // 面板 body 里的 model 就是这三个对外名（creationModelRegistry 的 model 字段）：
  // 文生 / 首帧图生 / 首尾帧共用 `jc-minimax-h3`，参考生是 `jc-minimax-h3-ref2v`，
  // 图片（Qwen-Image 2.1）是 `jc-qwen-image-2.1`。
  // 渠道 model_mapping 再把它们换成适配器内部 id（minimax-h3 / minimax-h3-ref2v / qwen-image-2.1）。
  models: ['jc-minimax-h3', 'jc-minimax-h3-ref2v', 'jc-qwen-image-2.1'],
  fetchMode: 'per_task',
  // 视频走异步任务协议，图片走同步图片协议
  protocols: ['openai_video', 'openai_image'],
  // type 61 渠道把 Base URL 留空时用这个默认值（适配器只绑在 docker 网络内）
  baseUrl: 'http://frps:8796',
  usageSchema: {
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Video generation unit price', zh: '视频生成单价' },
    },
    // 图片按张计费。这个字段名是宿主认得的：用量日志里会记成 other.image_count
    image_count: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'image', zh: '张' },
      description: { en: 'Image generation unit price', zh: '图片生成单价' },
    },
  },
  // 宿主硬校验：**每个例子都要带齐所有声明的 key**，少一个上传即被拒收
  // （实测报 plugin meta usageExamples[0] facts missing key "seconds"）
  usageExamples: [
    { label: '文戏 5 秒', facts: { seconds: 5, image_count: 0 } },
    { label: '文戏 28 秒 · 上限', facts: { seconds: 28, image_count: 0 } },
    { label: '图片 1 张', facts: { seconds: 0, image_count: 1 } },
    { label: '图片 4 张 · 上限', facts: { seconds: 0, image_count: 4 } },
  ],
}

// 图片模型：客户端对外名与适配器内部 id 都收（渠道没配映射时发的是对外名）
const IMAGE_MODELS = ['jc-qwen-image-2.1', 'qwen-image-2.1']

// 适配器 meta 的 constraints.max_batch = 4；预约额度时不超它，结算再用实际张数纠正
const MAX_IMAGE_BATCH = 4

function isImageModel(name) {
  return IMAGE_MODELS.includes(String(name || ''))
}

// 图片协议里「有没有参考图」只用来定 action（文生图 / 图生图），张数与格式交给适配器校验
function hasImageInput(body) {
  if (!body || typeof body !== 'object') return false
  if (Array.isArray(body.images)) return body.images.length > 0
  return Boolean(body.image || body.first_frame || body.last_frame)
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

function snapshotOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
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
  // 图片协议：`openai_image` 是**同步**的（无模式），只需要 decodeRequest + render。
  // 宿主不会轮询；我们在 parseSubmitResponse 里直接判 SUCCESS。
  openai_image: {
    decodeRequest: function (ctx) {
      const model = String(ctx.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      if (!isImageModel(ctx.upstreamModel || model)) {
        fail(`Model ${model} is not an image model`)
      }
      const kind = ctx.body ? ctx.body.kind : 'none'
      if (kind === 'json') {
        const body = ctx.body.value
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
        if (!String(body.prompt || '').trim()) fail('prompt is required')
        // 参考图可以是 `image`（单）或 `images`（多），内容为 URL / data URL / 已上传文件名，
        // 适配器自己会分流；插件不重复校验它的张数与格式。
        return {
          kind: 'submit',
          model: ctx.model,
          action: hasImageInput(body) ? 'image_to_image' : 'text_to_image',
          requestBody: body,
        }
      }
      if (kind === 'multipart') {
        // `POST /v1/images/edits` 的 multipart 写法：把每个上传文件换成宿主认可的文件占位符，
        // 宿主会把它替换成 `data:<mime>;base64,...`，而适配器本来就收 data URL。
        const fields = ctx.body.fields || {}
        const prompt = String((fields.prompt || [''])[0] || '').trim()
        if (!prompt) fail('prompt is required')
        const files = Array.isArray(ctx.body.files) ? ctx.body.files : []
        if (!files.length) fail('multipart image edit requires at least one file')
        const body = {}
        for (const key of Object.keys(fields)) {
          const values = fields[key]
          body[key] = values && values.length === 1 ? values[0] : values
        }
        body.images = files.map(f => ({ __fileRef: f.ref, encoding: 'dataUrl' }))
        return { kind: 'submit', model: ctx.model, action: 'image_to_image', requestBody: body }
      }
      fail('JSON or multipart body required')
    },
    // 必须回 OpenAI ImageResponse 形状：`{ data: [{url|b64_json}] }`。
    // `created` 不写 —— 宿主会在缺失时自己补上（沙箱里能不碰 Date 就不碰）。
    render: function (ctx, task) {
      const snapshot = snapshotOf(task && task.data)
      const data = Array.isArray(snapshot.data) ? snapshot.data : []
      if (!data.length) fail('comfy-adapter 的图片响应里没有 data 数组')
      return {
        data: data.map(item => {
          const entry = {}
          if (item && item.b64_json) entry.b64_json = String(item.b64_json)
          else if (item && item.url) entry.url = String(item.url)
          if (item && item.revised_prompt) entry.revised_prompt = String(item.revised_prompt)
          return entry
        }),
      }
    },
  },
}

export function buildSubmitRequest(ctx) {
  // 不改入参：返回的副本才是宿主实际要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 适配器吃的是内部 id（渠道映射后）；没配映射时退回对外名，别变成 undefined
  body.model = ctx.upstreamModel || ctx.model
  if (isImageModel(ctx.upstreamModel || ctx.model)) {
    // 图片走同步入口。**不要**给请求体塞那个同步开关（它的点号写法被宿主的插件静态检查封了，
    // 实测上传直接报 `unsupported plugin syntax` 并拒收；宿主扫的是**整份源码，连注释也算**）。
    // 适配器侧本来也不需要显式传：`WorkflowTemplate.default_async` 在没有 `meta.default_async` 时
    // 回落到 `output_kind == "video"`，而图片模板的 `output_kind` 默认是 `image` → 同步。
    // 图片结果必须是**公网可取**的 URL，不能内联 base64：宿主把提交响应（含它派生的 `taskData`）
    // 落库时卡 **1 MiB**（`relay/channel/task/jsplugin/adaptor.go` 的
    // `maxTaskPluginPersistedJSONBytes = 1 << 20`，同名常量也是 plugin state 的上限），
    // 一张图 base64 就是 2–5 MB → 实测直接 502 `task submit response exceeds size limit`。
    // URL 前缀由适配器的 `public_base_url` 决定，必须是**客户端**能访问到的地址
    // （VPS nginx 把 `/files/` 反代到隧道出口）；写内网 `frps:8796` 客户端取不到图。
    body.response_format = 'url'
    return {
      url: ctx.baseUrl + '/v1/images/generations',
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
  if (isImageModel(ctx.upstreamModel || ctx.model)) {
    // 同步图片：没有上游任务号，直接判终态，宿主会调 openai_image.render 组装 ImageResponse
    if (!Array.isArray(body.data) || !body.data.length) {
      fail('comfy-adapter 的图片响应里没有 data 数组')
    }
    return {
      taskId: String(body.prompt_id || ctx.publicTaskId || 'immediate'),
      taskData: body,
      immediate: { status: 'SUCCESS' },
    }
  }
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
  if (task.status !== 'SUCCESS') return []
  // 图片是**内联 b64** 回的，没有可代理的产物；而同步图片结果又不落库（与 retainResult: false
  // 同义），task.data 可能是 null —— 所以除快照外再靠 action 兑一层。
  const snapshot = snapshotOf(task && task.data)
  if (isImageModel(snapshot.model) || String(task.action || '').includes('to_image')) return []
  return [{ key: 'video', type: 'video', mimeType: 'video/mp4' }]
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
  // 宿主要求**每个声明的 key 都有值**，所以两条路都要把另一个字段报 0
  const body = snapshotOf(ctx && ctx.requestBody)
  if (isImageModel(ctx && (ctx.upstreamModel || ctx.model))) {
    // 适配器的 batch 上限是 meta 的 constraints.max_batch；预约不超它，结算用实际张数纠正
    const n = Number(body.n)
    let imageCount = 1
    if (Number.isFinite(n) && n >= 1) imageCount = n > MAX_IMAGE_BATCH ? MAX_IMAGE_BATCH : n
    return { seconds: 0, image_count: imageCount }
  }
  // 面板必带 duration；真没带时按保守值预留额度，结算用适配器归一化后的实际秒数纠正
  const seconds = Number(body.duration)
  return {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : USAGE_FALLBACK_SECONDS,
    image_count: 0,
  }
}

// 适配器任务视图的 params 就是模板归一化后的实际值（duration 已被 clamp 到 1~28）
export function extractUsageOnComplete(ctx, task, body) {
  if (isImageModel(ctx && (ctx.upstreamModel || ctx.model))) {
    // 实际张数以响应里的 data 长度为准（适配器按 batch_size 出图，可能少于请求的 n）
    const count = body && Array.isArray(body.data) ? body.data.length : 0
    return count > 0 ? { image_count: count } : null
  }
  if (!body || typeof body !== 'object') return null
  const raw = body.params && body.params.duration !== undefined ? body.params.duration : body.duration
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? { seconds } : null
}
