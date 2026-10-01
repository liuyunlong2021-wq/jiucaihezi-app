// NewAPI Task Plugin v1 —— 山海画布（经 shanhai-adapter）
//
// 存在理由和 comfy / dola 逐字相同：面板把 `ratio` / `aspect_ratio` / `resolution` /
// `duration` 发在**顶层**，而这几个字段都不在 NewAPI `TaskSubmitReq` 的白名单里
// （白名单只有 model/prompt/image/images/duration/size/mode/seconds/input_reference/metadata），
// 走旧渠道会被整段丢掉，适配器只能落回自己 capabilities 里的默认值。
// 插件通道里 body 由 `decodeRequest` 决定，所以这里**原样透传**，不做归一化。
//
// shanhai-adapter **不下岗**，它担着两件插件做不到的事：
//   1. 参考素材要先经网关换成公开 HTTPS 地址（山海自己去抓，只吃公开直链）；
//   2. 成片在 `GET /media/runs/{id}` 上，**必须带同一枚山海 Key** 才能下载 ——
//      插件没有 fetch / fs，做不了这层带 Key 的字节代理。
//
// 事实源：`shanhai-adapter/src/main.py` 与 `shanhai-adapter/README.md`（端点、字段契约、
// 状态归一化、轮询语义都在那边写死；插件只做代理，不重复校验）。
export const meta = {
  apiVersion: 1,
  key: 'shanhai',
  name: '山海画布',
  version: '0.1.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Shanhai Canvas via shanhai-adapter',
    zh: '经 shanhai-adapter 驱动山海画布',
  },
  // 面板发的 `model` 是渠道里的**公开名**（registry `newapi/shanhai/oc-model-r5cfh8` 的
  // `model` 字段）；渠道配了 model_mapping 时插件看到的是映射后的上游 id。
  // 两种都收：适配器自己也有同一张别名表（MODEL_ALIASES），两条路都不会掉。
  models: [
    '海seedance2.5',
    '山seedance2.5',
    'oc-model-r5cfh8',
    'shanhai-dola-seedance-v2-5-30-9-0-7',
  ],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // 适配器容器加入 new-api-new_new-api-network 且不映射宿主端口，所以只能走服务名
  baseUrl: 'http://shanhai-adapter:8795',
  // 两条线路的计费口径不同：`海seedance2.5` 面板价签是 `0.2/秒`（30 秒一档），
  // 另一条是**按次**。两个 key 都声明，两种表达式才都能存进定价页。
  // 宿主硬校验：表达式里的 `u("key")` 必须是这里声明过的名字。
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
  // 宿主硬校验：**每个例子都要带齐所有声明的 key**，少一个上传即被拒
  // （实测报 plugin meta usageExamples[0] facts missing key "seconds"）
  usageExamples: [
    { label: '单笔 30 秒', facts: { calls: 1, seconds: 30 } },
    { label: '按次口径（无时长）', facts: { calls: 1, seconds: 0 } },
  ],
}

// 适配器状态机（`normalize_status`）：只回 processing / completed / failed，
// 上游的 queued / running / succeeded 都已经被它归一化过。多留几个别名只是兜底。
const ADAPTER_STATUS = {
  queued: 'QUEUED',
  pending: 'QUEUED',
  submitted: 'SUBMITTED',
  running: 'IN_PROGRESS',
  processing: 'IN_PROGRESS',
  completed: 'SUCCESS',
  succeeded: 'SUCCESS',
  failed: 'FAILURE',
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

// 面板注册表给这两条线路的时长只有 30 秒一档（`allowedValues: [30]`，默认值也是 30）；
// 请求里真没带时长时按它算，别报 0 —— 按秒表达式报 0 会静默扣不到钱。
const DEFAULT_SECONDS = 30

function fail(message) {
  throw new Error(message)
}

function snapshotOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调一次，选中后再调一次。
    // 这里不改写字段名、不重排 —— 适配器本来就认得面板发的那套形状。
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      if (!String(body.prompt || '').trim()) fail('prompt is required')
      // 只判「有没有参考图」，不校验张数与地址格式：适配器会拒（400 且不建任务），
      // 插件重复一遍只会两处漂移。参考音频同理 —— 适配器现在显式回 422，不静默丢。
      const hasImage = Boolean(
        (Array.isArray(body.images) && body.images.length) ||
        body.image ||
        body.imageUrl ||
        (Array.isArray(body.imageUrls) && body.imageUrls.length),
      )
      // 返回值就是「归一化后的 requestBody」，原样返回既不白拷 data URL 也不动入参
      return {
        kind: 'submit',
        model: ctx.model,
        action: hasImage ? 'image_to_video' : 'text_to_video',
        requestBody: body,
      }
    },
    // 成片由**宿主的 artifact 通道**下发（`GET /v1/videos/:task_id/content`，宿主协议绑定），
    // 不走这里透地址：适配器回的是 `/v1/videos/{id}/content` 这种**相对路径**，
    // 而里面的 `{id}` 是上游任务号 —— 直接透出去等于让客户端拿上游号去问宿主。
    // 形状与已验证过的 comfy 插件保持一致（render 不带 url）。
    render: function (ctx, task) {
      const view = {
        id: task.task_id,
        object: 'video',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
      // 宿主若注入了它自己的 artifact 地址就用它，没有就不写（与 comfy 同形）
      const artifacts = ctx && ctx.artifacts ? ctx.artifacts : {}
      const artifact = artifacts && artifacts.video ? artifacts.video : {}
      if (artifact && artifact.url) view.video_url = String(artifact.url)
      const snapshot = snapshotOf(task && task.data)
      if (snapshot.fail_reason) view.error = String(snapshot.fail_reason)
      return view
    },
  },
}

export function buildSubmitRequest(ctx) {
  // 不改入参：返回的副本才是宿主实际要用的值
  const body = Object.assign({}, ctx.requestBody)
  // 适配器公开名与上游 id 都认，所以映射前后哪个存在用哪个，别变成 undefined
  body.model = ctx.upstreamModel || ctx.model
  return {
    url: ctx.baseUrl + '/v1/videos',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 适配器把这枚 Bearer 原样转给山海（三个上游端点都要求同一枚 Key）
      Authorization: 'Bearer ' + ctx.apiKey,
    },
    body,
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {}
  if (!body.id) fail('shanhai-adapter did not return a task id')
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
    const error = body && body.error && typeof body.error === 'object' ? body.error : {}
    out.reason = String(
      (body && (body.fail_reason || error.message || body.message)) || `shanhai-adapter status: ${raw}`,
    )
  }
  return out
}

// 宿主**强制**要求声明了 `openai_video` 的插件同时导出这两个 hook —— 少了会被直接拒收：
// 「plugin <key> protocol "openai_video" is missing driver hook "listArtifacts"」。
export function listArtifacts(task) {
  return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

// 成片必须带渠道 Key 才能从山海取，所以打回适配器自己的 `/content` 代理口，不做 `credentialless`。
// 适配器的 `/content` 透传 Range（README 写明），播放与断点续传都保留。
export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content',
    method: ctx.clientRequest.method,
    headers: { Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function extractUsage(ctx) {
  // 宿主要求**每个声明的 key 都有值**，所以没有时长就报 0，而不是省略
  const body = snapshotOf(ctx && ctx.requestBody)
  const raw = body.duration !== undefined ? body.duration : body.seconds
  const seconds = Number(raw)
  return {
    calls: 1,
    seconds: Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? seconds : DEFAULT_SECONDS,
  }
}

export function extractUsageOnComplete(ctx, task, body) {
  // 补全事实会**逐 key 覆盖**提交时的快照，没给的 key 保留提交值 —— 所以这里只回
  // 真正确定的 `calls`，让 seconds 保持提交时那个数（适配器任务视图里没有实际时长）。
  return { calls: 1 }
}
