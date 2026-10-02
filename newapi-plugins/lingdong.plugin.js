// NewAPI Task Plugin v1 —— 灵动 API（直连厂商，不经过任何本地服务）
//
// 存在理由和 comfy / dola / shanhai 逐字相同：面板把 `ratio` / `resolution` / `duration`
// 发在顶层，这几个字段不在旧渠道 `TaskSubmitReq` 的白名单里，走旧渠道会被整段丢掉，
// 上游只能落回自己的默认值（画幅错、时长错）。插件通道里 body 由 `decodeRequest` 决定，
// 所以这里自己挑字段、自己拼上游请求。
//
// 与 shanhai / boluo 的关键差别：**这条线没有适配器**。灵动自己的接口就是
//   POST /v1/videos  →  GET /v1/videos/{id}  →  GET /v1/videos/{id}/content（支持 HEAD 与 Range）
// 与宿主 `openai_video` 的协议绑定（`docs/plugin-api/v1.md` 的 Host protocols）逐字相同，
// 插件直接把渠道 Key 打在厂商端点上，中间没有任何一跳。
//
// 事实源（两处，冲突时以官方插件为准）：
// 1. 公开文档 https://www.lingdongapi.com/docs/api/?v=20260517
// 2. 官方字字动画插件 `zizi-lingdong-video-plugin/video_plugin_lingdong/main.py`（1.1.0）
//    文档写查询走 `GET /v1/video/generations/{id}`，官方插件用的是 `GET /v1/videos/{id}`；
//    实测（2026-10-02）两条都是别名、都能通，这里跟官方插件，宿主协议也对得上。
//
// 有意未接（都不是"忘了"）：
// - 参考视频 / 参考音频：灵动支持 `videos[]` / `audios[]`，但面板目前只有图片链路，
//   收不到这两类素材，声明了也没人发；
// - 本地素材上传：灵动有 `POST /v1/media/uploads`，但面板走网关 `/api/creations/uploads`
//   换成公开直链，插件不碰字节（插件本来也没有网络与文件系统权限）；
// - `prompt_extend` / `generate_audio`：官方插件 1.1.0 会发，但公开文档的字段表里没有，
//   没实测过的字段不往上打 —— 少发顶多损失默认行为，发错会被参数校验直接拒。
export const meta = {
  apiVersion: 1,
  key: 'lingdong',
  name: '灵动 API',
  version: '0.2.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'Lingdong API video (direct vendor endpoint)',
    zh: '直连灵动 API 生成视频',
  },
  // 面板 `creationModelRegistry` 里 `newapi/lingdong/*` 的 `model` 字段逐字等于这几个名字，
  // 渠道模型列表也必须逐字一致（可用性服务拿它匹配渠道）。
  // 2026-10-02 用户换线：去掉按次的两条（`cvk` / `满血-480p`），换成 `SD-2.5-特价`（定死 30 秒）
  // 与 `sd2.5-a`（按秒）。换完必须**重传插件并同步改渠道模型列表**：渠道上留着插件没收的名字会开始报 unsupported。
  models: ['SD-2.5-特价', 'sd2.5-a', 'cvk-2.5-480', 'cvk-2.5-720', 'cvk-2.5-1080'],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // type 61 渠道把 Base URL 留空时用这个默认值；灵动是公网 HTTPS，不需要隧道
  baseUrl: 'https://www.lingdongapi.com',
  // 两类计费口径：`cvk` / `满血-480p` 按次，`cvk-2.5-*` 按秒（`/api/pricing` 的
  // `billing_unit` 就是 request / second）。两个 key 都声明，两种表达式才都能存进定价页。
  // 宿主硬校验：表达式里的 `u("key")` 必须是这里声明过的名字。
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Per-task price', zh: '按次单价' },
    },
    seconds: {
      type: 'number',
      unit: 'second',
      description: { en: 'Per-second price', zh: '按秒单价' },
    },
  },
  // 宿主硬校验：**每个例子都要带齐所有声明的 key**，少一个上传即被拒
  // （同族实测报错：plugin meta usageExamples[0] facts missing key "seconds"）
  usageExamples: [
    { label: '按次模型 5 秒', facts: { calls: 1, seconds: 5 } },
    { label: '按秒模型 4 秒 · 下限', facts: { calls: 1, seconds: 4 } },
    { label: '按秒模型 30 秒 · 上限', facts: { calls: 1, seconds: 30 } },
  ],
}

// 灵动任务状态（文档 + 官方插件 `_task_status`）：processing / completed / failed。
// 官方插件还兼容 complete / success / succeeded / finish 与 cancelled / canceled，多留别名只是兜底。
const UPSTREAM_STATUS = {
  queued: 'QUEUED',
  pending: 'QUEUED',
  submitted: 'SUBMITTED',
  processing: 'IN_PROGRESS',
  running: 'IN_PROGRESS',
  generating: 'IN_PROGRESS',
  completed: 'SUCCESS',
  complete: 'SUCCESS',
  success: 'SUCCESS',
  succeeded: 'SUCCESS',
  finished: 'SUCCESS',
  finish: 'SUCCESS',
  failed: 'FAILURE',
  failure: 'FAILURE',
  error: 'FAILURE',
  cancelled: 'FAILURE',
  canceled: 'FAILURE',
}

// 宿主认的状态词只有这四个
const HOST_STATUS = {
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'completed',
  FAILURE: 'failed',
}

// 面板对按秒模型必带 `duration`；真没带时按 10 秒预留（官方插件 `_DEFAULT_PARAMS.duration`
// 就是 10），宁可少扣也不误伤 —— 报 0 会静默扣不到钱，报 30 会在用户没选时长时多扣。
const USAGE_FALLBACK_SECONDS = 10

// 只有文档字段表里的名字才往上游打（`duration` 要转成数字，单独处理）。面板会残留别的
// 模型的字段（历史上 `resolution: '2k'` 打断过另一条线路），白名单是这条线唯一的防线。
const SUBMIT_FIELDS = ['ratio', 'resolution']

function fail(message) {
  throw new Error(message)
}

function snapshotOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstText(source, keys) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

// 参考图只认公开 HTTP(S) 直链：灵动自己去抓，data URL 与本地路径送过去只会挂任务。
// 张数上限交给上游校验（超出它会明确报错），插件重复一遍只会两处漂移。
function imageUrls(source) {
  // 面板多图发 `images`、单图发 `imageUrl`（历史坑：只认 `images` 会静默丢参考图），
  // 复数 `imageUrls` 与 `image` 是其它线路的别名，一起收；空数组不算给了素材。
  const candidates = [source.images, source.imageUrls, source.imageUrl, source.image]
  let raw
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    if (Array.isArray(candidate) && candidate.length === 0) continue
    raw = candidate
    break
  }
  const items = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  const urls = []
  for (const item of items) {
    const url = item && typeof item === 'object' ? item.url : item
    const text = typeof url === 'string' ? url.trim() : ''
    if (text && urls.indexOf(text) === -1) urls.push(text)
  }
  return urls
}

function hasImageInput(source) {
  return imageUrls(source).length > 0
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调一次，选中后再调一次。
    // 这里不做归一化，只做「能不能接」的判断 —— 字段翻译放在 buildSubmitRequest。
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') fail('JSON body required')
      const body = ctx.body.value
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request body must be an object')
      const model = String(body.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      if (!String(body.prompt || '').trim()) fail('prompt is required')
      return {
        kind: 'submit',
        model: ctx.model,
        action: hasImageInput(body) ? 'image_to_video' : 'text_to_video',
        requestBody: body,
      }
    },
    // 成片由**宿主的 artifact 通道**下发（`GET /v1/videos/:task_id/content` 走下面的
    // `buildContentRequest`），这里不透上游地址：灵动回的是它自己域名下的
    // `/v1/videos/{id}/content`，透出去等于把厂商任务号与取件路径暴露给客户端。
    // 形状与已验证过的 comfy / shanhai 插件一致（render 不带 url）。
    render: function (ctx, task) {
      const view = {
        id: task.task_id,
        object: 'video',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
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
  const source = snapshotOf(ctx.requestBody)
  // 不发入参本身：宿主实际用的是这里返回的副本
  const body = {
    model: String(ctx.upstreamModel || ctx.model),
    prompt: String(source.prompt || '').trim(),
  }
  const images = imageUrls(source)
  if (images.length) body.images = images
  for (const field of SUBMIT_FIELDS) {
    const text = firstText(source, field === 'ratio' ? ['ratio', 'aspect_ratio', 'aspectRatio'] : [field])
    if (text) body[field] = text
  }
  const duration = Math.trunc(Number(source.duration !== undefined ? source.duration : source.seconds))
  if (Number.isFinite(duration) && duration > 0) body.duration = duration
  // 灵动默认就不加水印，这里显式写死，免得将来上游改默认值把带水印的成片发给用户
  body.watermark = false
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
  // 文档示例用 `task_id`，官方插件 `_task_id` 两个都读，这里跟着读
  const taskId = body.id || body.task_id
  if (!taskId) fail('lingdong did not return a task id')
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
  const raw = String((body && body.status) || (body && body.state) || '').toLowerCase()
  const status = UPSTREAM_STATUS[raw]
  // 不认识的**不能**当 IN_PROGRESS —— 宿主把 UNKNOWN / 空 / hook 抛错都算轮询失败。
  // 另外：灵动对**不存在的任务号**也会回 200 `{status: "processing"}`（假 key 实测），
  // 所以"一直处理中"不等于任务存在，卡住时先核对 taskId 而不是等下去。
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'FAILURE') {
    const error = body && body.error && typeof body.error === 'object' ? body.error : {}
    out.reason = String(
      (body && (body.fail_reason || body.message || error.message || error.code)) ||
        `lingdong status: ${raw}`,
    )
  }
  return out
}

// 宿主**强制**要求声明了 `openai_video` 的插件同时导出这两个 hook —— 少了会被直接拒收：
// 「plugin <key> protocol "openai_video" is missing driver hook "listArtifacts"」。
export function listArtifacts(task) {
  return task.status === 'SUCCESS' ? [{ key: 'video', type: 'video', mimeType: 'video/mp4' }] : []
}

// 成片要带渠道 Key 才能从灵动取（`Authorization: Bearer`），且它对 `/content` 原生支持
// HEAD 与 Range，所以这里只透客户端的方法、不做 `credentialless` 直取。
export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== 'video') fail('artifact_not_found')
  return {
    url: ctx.baseUrl + '/v1/videos/' + encodeURIComponent(ctx.upstreamTaskId) + '/content',
    method: ctx.clientRequest.method,
    headers: { Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function extractUsage(ctx) {
  // 宿主要求**每个声明的 key 都有值**：按次模型报 1 次、按秒模型靠 seconds 结算，
  // 两个都给，哪种表达式都能取到自己要的那个字段。
  const body = snapshotOf(ctx && ctx.requestBody)
  const raw = body.duration !== undefined ? body.duration : body.seconds
  const seconds = Math.trunc(Number(raw))
  return {
    calls: 1,
    seconds: Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? seconds : USAGE_FALLBACK_SECONDS,
  }
}

export function extractUsageOnComplete(ctx, task, body) {
  // 补全事实会**逐 key 覆盖**提交时的快照，没给的 key 保留提交值 —— 所以只回真正确定的
  // `calls`，让 seconds 保持提交时那个数（灵动的任务视图里没有实际时长）。
  return { calls: 1 }
}
