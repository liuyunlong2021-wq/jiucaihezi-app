// NewAPI Task Plugin v1 —— RunningHub（经 rh-adapter）
//
// 与 comfy / dola 同构：**插件是代理，rh-adapter 是执行器**。适配器继续做模板/节点翻译、
// capabilities.json 校验、参考素材上传与 RH 原生代理，插件只负责一件事：
// 把客户端原始 body 原样送到适配器，不让 NewAPI 的 TaskSubmitReq 吃掉字段。
//
// 为什么必须换插件：面板提交 RH 时把画幅/分辨率放顶层 `aspectRatio` / `aspect_ratio` /
// `ratio` / `resolution`，把模型独有字段放 `extra_fields`，而 TaskSubmitReq 的白名单只有
// model/prompt/image/images/duration/size/mode/seconds/input_reference/metadata ——
// 前者全被整段丢掉。顺带说明：`metadata.rh_aiapp` 那层双重兜底就是当年为了绕过这个问题加的。
//
// ── 三件必须记住的 RH 事实（都会影响这个插件）──
// 1. **没有 ak|sk / JWT 签名**。上游就是 `Authorization: Bearer <key>` + body 里 `apikey`。
//    而且适配器用的是**自己环境变量里的** RUNNINGHUB_API_KEY，不看调用方 Authorization，
//    所以渠道密钥填什么都行（这里仍按惯例发 Bearer）。
// 2. **面板靠 `rh_task_id` 直连适配器轮询**（`extractTaskId` 优先读它，注释写明「永远直连
//    rh-adapter 轮询，NewAPI 只承担提交+计费」）。宿主会删掉 render 输出里的 legacy
//    `task_id`，所以任务号**必须放在 `rh_task_id`** 上，否则面板会拿着 `task_xxx` 去查适配器。
// 3. **接 AI App（`rh-aiapp`），不接音频**。AI App 的媒体节点只认 RH `fileName` 令牌，换令牌要
//    下载再上传（`rh_client.upload_ai_app_url`）—— **这一步在适配器里做，插件不需要下载能力**，
//    所以 aiapp 照样能走插件（只需把 `ai_app` 透出去，见 render）。音频链路没有宿主协议，不收。
//    （早先判定「aiapp 物理上做不到」是把「适配器要干的活」误当成「插件的阻断」：代理模式下
//    适配器仍在链路里，换令牌发生在它内部。）
//
// 事实源：`rh-adapter/src/main.py`（路由与响应）、`src/services/*`（翻译）、
// `src/runtime/creation/creationModelRegistry.ts`（面板对外模型名与 endpoint）。
export const meta = {
  apiVersion: 1,
  key: 'rh',
  name: 'RunningHub',
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'RunningHub standard OpenAPI via rh-adapter',
    zh: '经 rh-adapter 驱动 RunningHub 标准接口',
  },
  // 面板发的 model 裸名（registry 里 route: runninghub-adapter 且 apiStyle: rh-standard）
  models: [
    // image
    'rh-gpt2-image',
    'rh-gpt2-text',
    'rh-image-v2',
    'rh-pro-image',
    'rh-flux-klein-edit',
    'rh-flux-klein-text',
    'rh-flux-klein-lora',
    // video / model3d
    'rh-video-v31-fast',
    'rh-gemini-omni-text-video',
    'rh-gemini-omni-image-video',
    'rh-gemini-omni-video-edit',
    'rh-grok-text-video',
    'rh-grok-image-video',
    'rh-seedance2-mini',
    'rh-seedance2-fast',
    'rh-seedance2',
    'rh-seedance2-mini-text',
    'rh-seedance2-fast-text',
    'rh-seedance2-text',
    'rh-seedance2-mini-image',
    'rh-seedance2-fast-image',
    'rh-seedance2-image',
    'rh-seedance25-no-video-ref',
    'rh-seedance25-with-video-ref',
    'rh-sora2-text',
    'rh-sora2-image',
    'rh-sora2-character',
    'rh-ltx23-text-video',
    'rh-ltx23-image-video',
    'rh-3d-text',
    'rh-3d-image',
    // AI App（webappId 工作流）—— 换成 RH fileName 令牌那步在适配器里，插件只透传
    'rh-aiapp',
    'rh-aiapp-director',
    'rh-aiapp-digital-human',
    'rh-aiapp-fast-digital-human',
  ],
  fetchMode: 'per_task',
  protocols: ['openai_video', 'openai_image'],
  // 适配器容器与 NewAPI 同在 docker 网里（旧 Custom Channel 的 Proxy URL 就是这个）
  baseUrl: 'http://rh-adapter:8789',
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Per-task price', zh: '单次生成单价' },
    },
  },
  usageExamples: [{ label: '单次生成任务', facts: { calls: 1 } }],
}

// 图片走 /v1/images/generations，其余走 /v1/videos（registry `runninghubStandard` 的 endpoint 规则）
// `z-image-turbo` **有意不在表里**：它同时是本机 comfy 的模型名，收进 RH 插件会截胡那条链路。
const IMAGE_MODELS = [
  'rh-gpt2-image',
  'rh-gpt2-text',
  'rh-image-v2',
  'rh-pro-image',
  'rh-flux-klein-edit',
  'rh-flux-klein-text',
  'rh-flux-klein-lora',
]

// AI App（webappId 工作流）模型：它们只有 `GET /tasks/{id}?ai_app=true` 能查到
// （适配器自己转到 `/task/openapi/status`），标准口的 `/openapi/v2/query` 查不到
const AI_APP_MODELS = [
  'rh-aiapp',
  'rh-aiapp-director',
  'rh-aiapp-digital-human',
  'rh-aiapp-fast-digital-human',
]

// 适配器 `build_task_status_response` 已把上游大写翻成这三个（外加 QUEUED 之类原样透传）
const ADAPTER_STATUS = {
  queued: 'QUEUED',
  processing: 'IN_PROGRESS',
  running: 'IN_PROGRESS',
  completed: 'SUCCESS',
  success: 'SUCCESS',
  failed: 'FAILURE',
  cancelled: 'FAILURE',
}

const HOST_STATUS = {
  NOT_START: 'queued',
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'processing',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

function fail(message) {
  throw new Error(message)
}

function snapshotOf(task) {
  const data = task && task.data
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

// 适配器的失败原因是一个对象：{message, code}
function errorMessageOf(snapshot) {
  const error = snapshot.error
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error.message) return String(error.message)
  return ''
}

function decodeRequest(ctx) {
  if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
  const body = ctx.body.value
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
  const model = String(body.model || '')
  if (!meta.models.includes(model)) {
    fail(`Unsupported model: ${model || '(missing)'}; rh 插件只接标准链路，AI App / 音频见 docs`)
  }
  if (!String(body.prompt || '').trim()) fail('prompt is required')
  // 模态取自模型表，不看 ctx.protocol：两个协议共用这一个 decoder，行为才可预测。
  // 原样返回：返回值就是「归一化后的 requestBody」，不动入参（宿主把 hook 参数当只读）。
  return {
    kind: 'submit',
    model: ctx.model,
    action: IMAGE_MODELS.includes(model) ? 'image' : 'video',
    requestBody: body,
  }
}

export const protocols = {
  openai_video: {
    decodeRequest: decodeRequest,
    render: function (ctx, task) {
      const snapshot = snapshotOf(task)
      const view = {
        id: task.task_id,
        object: 'video',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress === undefined ? '0' : task.progress).replace('%', '')),
        created_at: task.created_at,
      }
      // ★ 面板靠 `rh_task_id` 直连适配器轮询；宿主会删 legacy `task_id`，所以放这个键上
      if (snapshot.task_id) view.rh_task_id = String(snapshot.task_id)
      // AI App 的任务只有带 `?ai_app=true` 才查得到，面板据它决定（`isAiAppTask`）
      if (snapshot.ai_app === true) view.ai_app = true
      if (snapshot.url) view.url = String(snapshot.url)
      const message = errorMessageOf(snapshot)
      if (message) view.error = message
      return view
    },
  },
  openai_image: {
    decodeRequest: decodeRequest,
    // openai_image 协议要求返回 OpenAI ImageResponse 形状；额外键允许并存
    render: function (ctx, task) {
      const snapshot = snapshotOf(task)
      const view = { created: Number(task.created_at) || 0, data: [] }
      if (snapshot.task_id) view.rh_task_id = String(snapshot.task_id)
      if (snapshot.url) view.data = [{ url: String(snapshot.url) }]
      const message = errorMessageOf(snapshot)
      if (message) view.error = message
      return view
    },
  },
}

export function buildSubmitRequest(ctx) {
  // 不改入参：返回的副本才是宿主实际要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 适配器按 MODEL_MAP 查 endpoint / site / webappId，所以模型名要用渠道映射后的内部名
  body.model = ctx.upstreamModel || ctx.model
  return {
    url: ctx.baseUrl + (ctx.action === 'image' ? '/v1/images/generations' : '/v1/videos'),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 适配器用自己环境里的 RUNNINGHUB_API_KEY，这里发什么都行，按惯例带上渠道密钥
      Authorization: 'Bearer ' + ctx.apiKey,
    },
    body,
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {}
  const taskId = body.task_id || body.id
  if (!taskId) fail('rh-adapter did not return a task id')
  return { taskId: String(taskId), taskData: body }
}

export function buildQueryRequest(ctx) {
  const model = String(ctx.upstreamModel || ctx.model || '')
  // AI App 的任务只有 `/tasks/{id}?ai_app=true` 查得到（适配器内部转到 /task/openapi/status）
  if (AI_APP_MODELS.includes(model)) {
    return {
      url: ctx.baseUrl + '/tasks/' + encodeURIComponent(ctx.taskId) + '?ai_app=true',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
    }
  }
  // 标准链路走适配器专为 NewAPI 准备的 Sora 兼容查询口，注释写明「NewAPI polls this with the real RH task id」
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
  if (status === 'SUCCESS' && body && body.url) out.url = String(body.url)
  if (status === 'FAILURE') out.reason = errorMessageOf(body || {}) || `rh-adapter status: ${raw}`
  return out
}

// 宿主**强制**要求声明了 `openai_video` 的插件同时导出这两个 hook —— 少了会被直接拒收：
// 「plugin rh protocol "openai_video" is missing driver hook "listArtifacts"」。
// RH 成片是公有 COS 直链（24 小时有效、无需鉴权），所以直取它并标 `credentialless` ——
// 宿主只放 GET/HEAD、不带插件头，并对每跳做 SSRF 检查。
export function listArtifacts(task) {
  return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  const snapshot = ctx.data && typeof ctx.data === 'object' && !Array.isArray(ctx.data) ? ctx.data : {}
  const url = String(snapshot.url || snapshot.video_url || '')
  if (!url) fail('artifact_not_found')
  return { url, method: ctx.clientRequest.method, credentialless: true }
}

export function extractUsage(ctx) {
  // 旧 Custom Channel 就是「按次计费；每个模型单独设置价格」，用量事实保持按次
  return { calls: 1 }
}

export function extractUsageOnComplete(ctx, task, body) {
  return { calls: 1 }
}
