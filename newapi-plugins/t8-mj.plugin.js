// NewAPI Task Plugin v1 —— T8 Midjourney（直连，无适配器）
//
// MJ 代理不是 OpenAI 兼容面，但插件可以直接打它的协议：
//   POST {T8}/mj-relax/mj/submit/imagine   {prompt, base64Array}
//   GET  {T8}/mj-relax/mj/task/{id}/fetch
// 所以不需要部署任何服务；`fk` 插件同样直接访问供应商域名。
//
// 边界：T8 的 imagine 只收 `base64Array`，插件没有 fetch，拿不到面板上传的文件字节——
// 因此本插件只接文生图。垫图要等真正需要时再接（适配器或客户端转 base64）。
//
// 与 ZX 的 `mj_fast_imagine` 互不相干：不同渠道、不同 Key。
export const meta = {
  apiVersion: 1,
  key: 't8-mj',
  name: 'T8 Midjourney',
  version: '0.3.0',
  author: { name: 'jiucaihezi' },
  description: {
    en: 'T8 Midjourney relax imagine (direct, text-to-image)',
    zh: '直连 T8 的 Midjourney relax 模式（文生图）',
  },
  models: ['mj_relax_imagine'],
  fetchMode: 'per_task',
  protocols: ['openai_video'],
  // 本插件只服务 T8，所以固定用它；渠道里的 Base URL 一律忽略（留空即可，填错也不影响）
  baseUrl: 'https://ai.t8star.org',
  usageSchema: {
    calls: {
      type: 'number',
      unit: 'count',
      unitLabel: { en: 'call', zh: '次' },
      description: { en: 'Per-image price', zh: '单张生成单价' },
    },
  },
  // 宿主硬校验：每个例子都要带齐所有声明的 key
  usageExamples: [{ label: '一张 MJ 图', facts: { calls: 1 } }],
}

// T8 的 MJ 代理只有模式段不同：fast=`/mj-fast/mj`、relax=`/mj-relax/mj`。
const MJ_PATH = '/mj-relax/mj'

// MJ 自己的任务状态词（不是宿主的 queued/in_progress/completed）
const MJ_STATUS = {
  NOT_START: 'QUEUED',
  SUBMITTED: 'QUEUED',
  MODAL: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
}

const HOST_STATUS = {
  NOT_START: 'queued',
  SUBMITTED: 'queued',
  MODAL: 'in_progress',
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

// 宿主把 multipart 字段交成 `{ name: [values] }`，单值先摊平，与 fk / xiaoyi 插件同一处理。
function formValues(fields) {
  const output = {}
  for (const key of Object.keys(fields || {})) {
    const values = fields[key]
    output[key] = Array.isArray(values) && values.length === 1 ? values[0] : values
  }
  return output
}

// 渠道 Base URL 不参与拼装：这个插件只会打 T8，渠道里那一栏填什么都不该改变目标，
// 否则一个过期的内网地址就会变成 "do_request_failed"。
function baseOf() {
  return meta.baseUrl.replace(/\/+$/, '')
}

// 用户在提示词里自己写了 `--ar` 就不再追加，避免出现两个比例。
function withAspectRatio(prompt, ratio) {
  const value = String(ratio || '').trim()
  if (!/^\d{1,2}:\d{1,2}$/.test(value) || /(^|\s)--ar\s/i.test(prompt)) return prompt
  return `${prompt.replace(/\s+$/, '')} --ar ${value}`
}

function absoluteImageUrl(snapshot) {
  const direct = snapshot.imageUrl || snapshot.image_url
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return direct
  const metadata = snapshotOf(snapshot.metadata)
  return typeof metadata.url === 'string' && /^https?:\/\//i.test(metadata.url) ? metadata.url : ''
}

function failureReason(body) {
  const error = snapshotOf(body && body.error)
  return String(
    (body && (body.failReason || body.fail_reason || body.description || error.message || body.message)) || '',
  )
}

export const protocols = {
  openai_video: {
    // 解码器必须容忍重复调用：渠道选择前会对每个候选调一次，选中后再调一次。
    decodeRequest: function (ctx) {
      // 面板的图片任务固定发 multipart；直接调 API 的调用方可以发 JSON。
      if (!ctx.body || !['json', 'multipart'].includes(ctx.body.kind)) {
        fail('JSON or multipart image request required')
      }
      const values = ctx.body.kind === 'json' ? snapshotOf(ctx.body.value) : formValues(ctx.body.fields)
      const model = String(values.model || '')
      if (!meta.models.includes(model)) {
        fail(`Unsupported model: ${model || '(missing)'}; expected one of ${meta.models.join(', ')}`)
      }
      const prompt = String(values.prompt || '')
      if (!prompt.trim()) fail('prompt is required')
      // MJ 没有像素尺寸，比例只能写成 `--ar W:H`。只接受数字比例，避免把任意 MJ 参数塞进来。
      const ratio = String(values.ratio || '').trim()
      if (ratio && !/^\d{1,2}:\d{1,2}$/.test(ratio)) fail(`Unsupported ratio: ${ratio}`)
      // 上游只收 base64Array；插件拿不到文件字节，参考图会静默丢失，所以直接拒绝。
      const files = ctx.body.kind === 'multipart' && Array.isArray(ctx.body.files) ? ctx.body.files : []
      const dataUrl = [values.image, ...(Array.isArray(values.images) ? values.images : [])]
        .some(value => typeof value === 'string' && /^data:image\//i.test(value))
      if (files.length || dataUrl) {
        fail('T8 Midjourney relax 目前只支持文生图；请取消参考图后重试')
      }
      return {
        kind: 'submit',
        model: ctx.model,
        action: 'text_to_image',
        requestBody: { model, prompt, ratio },
      }
    },
    render: function (ctx, task) {
      const view = {
        id: task.task_id,
        object: 'image',
        model: '',
        status: HOST_STATUS[task.status] || 'unknown',
        progress: Number(String(task.progress || '0').replace('%', '')),
        created_at: task.created_at,
      }
      const snapshot = snapshotOf(task && task.data)
      const url = absoluteImageUrl(snapshot)
      if (url && task.status === 'SUCCESS') {
        view.url = url
        view.metadata = { url }
      }
      const reason = failureReason(snapshot)
      if (reason) view.error = reason
      return view
    },
  },
}

export function buildSubmitRequest(ctx) {
  const body = Object.assign({}, ctx.requestBody)
  return {
    url: baseOf() + MJ_PATH + '/submit/imagine',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 这枚就是渠道里填的 T8 Key；查询任务也用同一枚
      Authorization: 'Bearer ' + ctx.apiKey,
    },
    // 上游只认这两个字段：垫图为 data URL 数组，没有参考图时传空数组
    body: { prompt: withAspectRatio(String(body.prompt || ''), body.ratio), base64Array: [] },
    action: ctx.action,
  }
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {}
  const taskId = String(body.result || '')
  // `code: 1` 才是受理；22 是排队中；其它是错误
  if (body.code !== 1 || !taskId) fail(String(body.description || 'T8 Midjourney submit failed'))
  return { taskId, taskData: { id: taskId, status: 'SUBMITTED' } }
}

export function buildQueryRequest(ctx) {
  return {
    url: baseOf() + MJ_PATH + '/task/' + encodeURIComponent(ctx.taskId) + '/fetch',
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  }
}

export function parseTaskResult(ctx, body) {
  const raw = String((body && body.status) || '').toUpperCase()
  const status = MJ_STATUS[raw]
  // 不认识的**不能**当 IN_PROGRESS —— 宿主把 UNKNOWN / 空 / hook 抛错都算轮询失败
  if (!status) return { status: 'UNKNOWN' }
  const out = { status }
  if (status === 'SUCCESS') {
    const url = absoluteImageUrl(snapshotOf(body))
    if (!url) return { status: 'FAILURE', reason: 'T8 Midjourney completed without imageUrl' }
    out.url = url
  }
  if (status === 'FAILURE') out.reason = failureReason(body) || 'T8 Midjourney task failed'
  return out
}

// 宿主强制要求声明了 `openai_video` 的插件同时导出 listArtifacts。
export function listArtifacts(task) {
  if (task.status !== 'SUCCESS') return []
  return [{ key: 'image', type: 'image', mimeType: 'image/png' }]
}

// 成图是上游绝对直链：宿主只放 GET/HEAD、不带插件头。
export function buildContentRequest(ctx) {
  const snapshot = snapshotOf(ctx && ctx.data)
  if (String(ctx.artifactKey || '') !== 'image') fail('artifact_not_found')
  const url = absoluteImageUrl(snapshot)
  if (!url) fail('artifact_not_found')
  return { url, method: ctx.clientRequest.method, credentialless: true }
}

export function extractUsage() {
  // MJ 按张计费：一张图一笔调用，没有时长维度。
  return { calls: 1 }
}

export function extractUsageOnComplete() {
  return { calls: 1 }
}
