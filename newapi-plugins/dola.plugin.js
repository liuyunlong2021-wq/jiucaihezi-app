// NewAPI Task Plugin v1 —— Dola Seedance 2.5（经 dola-seedance-adapter）
//
// 存在理由和 comfy 一样：面板把画幅发在**顶层**的 `ratio` + `aspect_ratio`
// （`buildDirectVideoBody` 通用尾段），而 NewAPI 的 TaskSubmitReq 白名单里只有
// model/prompt/image/images/duration/size/mode/seconds/input_reference/metadata ——
// 两个 ratio 全被整段丢掉，适配器只能落回自己的 `16:9` 兜底：
// 面板选 9:16 出 16:9，一直是这条 Bug，不是偶发。
//
// dola-seedance-adapter **不下岗**，它是执行器，担着一件插件做不到的事：
// 上游创建接口**只吃 multipart/form-data**，规格原文写死「图片必须上传实际文件，
// 不能用图片 URL 或 Base64 文本代替」，而插件没有 fetch / fs，拿不到图片字节。
// 所以：插件负责把 ratio 送到适配器，适配器负责下载图片、拼 multipart、转给上游。
// 插件只做代理，不做任何归一化 —— 校验与 clamp 都留在适配器（`src/main.py`）。
//
// 事实源：`dola-seedance-adapter/src/main.py`；上游规格 `docs/wiki/运维/seedace25API接口说明.md`。
export const meta = {
  apiVersion: 1,
  key: 'dola',
  name: 'Dola Seedance 2.5',
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Dola Seedance 2.5 via dola-seedance-adapter',
    zh: '经 dola-seedance-adapter 驱动 Dola Seedance 2.5',
  },
  // 面板 body 的 model（creationModelRegistry 里 `newapi/dola/seedance2.5`）
  models: ['dola-seedance2.5'],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // 适配器容器加入 new-api-new_new-api-network 且不映射宿主端口，所以走服务名
  baseUrl: 'http://dola-seedance-adapter:8789',
  usageSchema: {
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Video generation unit price', zh: '视频生成单价' },
    },
  },
  usageExamples: [
    { label: '单笔任务（固定 30 秒）', facts: { seconds: 30 } },
  ],
}

// 适配器状态机（src/main.py）：下游查询只回这四种，
// 上游的 `succeeded` 会被适配器翻成 `completed`，两个都留着兜底。
const ADAPTER_STATUS = {
  queued: 'QUEUED',
  processing: 'IN_PROGRESS',
  completed: 'SUCCESS',
  succeeded: 'SUCCESS',
  failed: 'FAILURE',
  cancelled: 'FAILURE',
}

const HOST_STATUS = {
  NOT_START: 'queued',
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

// 上游规格：`seconds` 只支持 "30"，省略也按 30 秒创建；适配器把 "30" 写死，
// 面板 duration 也只放开 30（registry `allowedValues: [30]`）。
// 用秒做事实单位是为了对齐面板价签上的 `0.2/秒`：30 × 0.2 = 6 元/笔。
const SECONDS_PER_TASK = 30

function fail(message) {
  throw new Error(message)
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调一次，选中后再调一次。
    // 这里不改写任何字段名 —— 适配器本来就认得面板发的那套形状。
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      if (!String(body.prompt || '').trim()) fail('prompt is required')
      // 只做「有没有参考图」的判定，不校验张数 / 格式 / ratio 取值：
      // 那些适配器已经做了，失败也是 400 且不会建任务，插件重复一遍只会两处漂移。
      const hasImage = Boolean(
        (Array.isArray(body.images) && body.images.length) ||
        body.image ||
        body.imageUrl ||
        (Array.isArray(body.imageUrls) && body.imageUrls.length),
      )
      // 原样返回：返回值就是「归一化后的 requestBody」，再复制一份只会白拷 data URL。
      // 不动入参（宿主把 hook 参数当只读），文件占位符替换由宿主在副本上做。
      return {
        kind: 'submit',
        model: ctx.model,
        action: hasImage ? 'image_to_video' : 'text_to_video',
        requestBody: body,
      }
    },
    render: function (ctx, task) {
      const snapshot = task && task.data && typeof task.data === 'object' && !Array.isArray(task.data) ? task.data : {}
      const view = {
        id: task.task_id,
        object: 'video',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
      // ★ 只挑面板要的两个字段，**不整份转发快照**：
      // 适配器快照里的 `id` / `task_id` 是上游任务号，而面板的 `extractTaskId` 会优先读
      // 嵌套的 `data.task_id` / `data.id`，整份转发会让它拿着上游号去查 NewAPI 的公开任务号。
      // 成片地址是上游公开免签 URL（规格原文：不要把 Bearer 附到视频地址上），
      // 与旧 type 1 渠道回给面板的形状一致。
      if (snapshot.video_url) view.video_url = snapshot.video_url
      if (snapshot.error) view.error = snapshot.error
      return view
    },
  },
}

export function buildSubmitRequest(ctx) {
  // 不改入参：返回的副本才是宿主实际要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 适配器只认 `dola-seedance2.5`，渠道映射后用它；没配映射时退回对外名，别变成 undefined
  body.model = ctx.upstreamModel || ctx.model
  return {
    url: ctx.baseUrl + '/v1/videos',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 适配器把收到的 Bearer 原样转给上游，所以渠道密钥就是 Dola 用户令牌
      Authorization: 'Bearer ' + ctx.apiKey,
    },
    body,
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {}
  if (!body.id) fail('dola-seedance-adapter did not return a task id')
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
    // 上游 `url` / 适配器 `video_url` 都是成片的公开免签地址
    const url = (body && (body.video_url || body.url)) || ''
    if (url) out.url = String(url)
  }
  if (status === 'FAILURE') {
    out.reason = String((body && (body.error || body.message)) || `dola-seedance-adapter status: ${raw}`)
  }
  return out
}

// 宿主**强制**要求声明了 `openai_video` 的插件同时导出这两个 hook —— 少了会被直接拒收：
// 「plugin dola protocol "openai_video" is missing driver hook "listArtifacts"」。
// 适配器没有 `/content` 路由，成片是上游公开免签 URL（规格原文：不要把 Bearer 附到视频地址上），
// 所以直取上游地址并标 `credentialless` —— 宿主只放 GET/HEAD、不带插件头，并对每跳做 SSRF 检查。
export function listArtifacts(task) {
  return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  const snapshot = ctx.data && typeof ctx.data === 'object' && !Array.isArray(ctx.data) ? ctx.data : {}
  const url = String(snapshot.video_url || snapshot.url || '')
  if (!url) fail('artifact_not_found')
  return { url, method: ctx.clientRequest.method, credentialless: true }
}

export function extractUsage(ctx) {
  return { seconds: SECONDS_PER_TASK }
}

export function extractUsageOnComplete(ctx, task, body) {
  // 上游只有 30 秒一档，没有可读的实际时长；与预授权同值，避免估扣差额
  return { seconds: SECONDS_PER_TASK }
}
