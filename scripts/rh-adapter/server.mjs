/**
 * rh-adapter — RunningHub ↔ NewAPI 适配器
 *
 * 部署: /opt/rh-adapter/server.mjs (systemd)
 * 端口: 8789 (默认, 环境变量 PORT)
 * 默认监听 127.0.0.1，可通过 RH_ADAPTER_HOST 指定 Docker bridge 供 NewAPI 容器访问。
 *
 * 协议:
 *   POST /v1/images/generations  → 提交图片任务 → {id, status:"pending"}
 *   GET  /v1/images/generations/:id → 查询结果 → {status, data}
 *   POST /v1/videos               → 提交视频任务
 *   GET  /v1/videos/:id           → 查询视频结果
 *   POST /v1/audio/generations    → 提交音频任务
 *   GET  /v1/audio/generations/:id → 查询音频结果
 */

import http from 'node:http'

const PORT = parseInt(process.env.PORT || '8789', 10)
const HOST = process.env.RH_ADAPTER_HOST || process.env.HOST || '127.0.0.1'
const RH_API_KEY = process.env.RUNNINGHUB_API_KEY || ''
const RH_ADAPTER_SECRET = process.env.RH_ADAPTER_SECRET || ''
const RH_BASE = 'https://www.runninghub.cn'
const TASK_TTL_MS = 30 * 60 * 1000 // 30 分钟超时
const MAX_BODY_BYTES = parseInt(process.env.RH_ADAPTER_MAX_BODY_BYTES || String(20 * 1024 * 1024), 10)
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.RH_ADAPTER_UPSTREAM_TIMEOUT_MS || '120000', 10)
const QUERY_ERROR_LIMIT = parseInt(process.env.RH_ADAPTER_QUERY_ERROR_LIMIT || '5', 10)
const MIN_SECRET_LENGTH = 24

if (!RH_API_KEY) {
  console.error('[rh-adapter] FATAL: RUNNINGHUB_API_KEY not set')
  process.exit(1)
}

if (!RH_ADAPTER_SECRET || RH_ADAPTER_SECRET.length < MIN_SECRET_LENGTH) {
  console.error('[rh-adapter] FATAL: RH_ADAPTER_SECRET must be configured for internal NewAPI channel auth')
  process.exit(1)
}

// ─── 内存任务存储 ───
/** @type {Map<string, {model:string, kind:string, createdAt:number, queryErrors?:number, lastQueryError?:string}>} */
const tasks = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [id, t] of tasks) {
    if (now - t.createdAt > TASK_TTL_MS) tasks.delete(id)
  }
}, 60_000).unref()

// ─── 模型 → RH endpoint 映射 ───
const MODEL_MAP = {
  // 图片
  'rh-pro-image':    { endpoint: '/openapi/v2/rhart-image-n-pro/text-to-image', kind: 'image' },
  'rh-gpt2-image':   { endpoint: '/openapi/v2/rhart-image-g-2/image-to-image', kind: 'image' },
  'rh-gpt2-text':    { endpoint: '/openapi/v2/rhart-image-g-2/text-to-image', kind: 'image' },
  // 视频
  'rh-seedance2':        { endpoint: '/openapi/v2/rhart-video-sd2/text-to-video', kind: 'video' },
  'rh-video-v31-fast':   { endpoint: '/openapi/v2/rhart-video-v3.1-fast/text-to-video', kind: 'video' },
  'rh-grok-text-video':  { endpoint: '/openapi/v2/rhart-video-g/text-to-video', kind: 'video' },
  'rh-grok-image-video': { endpoint: '/openapi/v2/rhart-video-g/image-to-video', kind: 'video' },
  'rh-grok-video-edit':  { endpoint: '/openapi/v2/rhart-video-g-official/edit-video', kind: 'video' },
  'grok-video-3':        { endpoint: '/openapi/v2/rhart-video-g/text-to-video', kind: 'video' },
  // 工作流型 (nodeInfoList)
  'rh-mimic':              { endpoint: '/openapi/v2/workflow/run', kind: 'video' },
  'rh-digital-human-fast': { endpoint: '/openapi/v2/workflow/run', kind: 'video' },
  'rh-digital-human':      { endpoint: '/openapi/v2/workflow/run', kind: 'video' },
  'rh-voice-clone':        { endpoint: '/openapi/v2/workflow/run', kind: 'audio' },
  'rh-voice-design':       { endpoint: '/openapi/v2/workflow/run', kind: 'audio' },
}

// ─── 工具函数 ───

/** @param {string} dataUri */
function dataUriToBlob(dataUri) {
  const [meta, b64] = dataUri.split(',')
  const mime = (meta.match(/:(.*?);/) || ['', 'application/octet-stream'])[1]
  return { buffer: Buffer.from(b64, 'base64'), mime, ext: mime.split('/')[1] || 'png', name: `upload.${mime.split('/')[1] || 'png'}` }
}

/** 手动构建 multipart/form-data（兼容 Node.js 18+） */
function buildMultipartBody(fields) {
  const boundary = '----RhAdapter' + Date.now().toString(36)
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    if (value && typeof value === 'object' && value.buffer) {
      // 文件字段
      parts.push(Buffer.from(`--${boundary}\r\n`))
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="${value.name}"\r\n`))
      parts.push(Buffer.from(`Content-Type: ${value.mime}\r\n\r\n`))
      parts.push(value.buffer)
      parts.push(Buffer.from('\r\n'))
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), boundary }
}

/** @param {{buffer:Buffer, mime:string, ext:string, name:string}} blob */
async function uploadToRH(blob) {
  const { body, boundary } = buildMultipartBody({ file: blob })
  const res = await fetchWithTimeout(`${RH_BASE}/openapi/v2/media/upload/binary`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RH_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(`RH 上传失败: ${data.message || JSON.stringify(data)}`)
  return data.data.download_url
}

/**
 * 上传所有 base64 data URI 到 RH，返回 RH URL 列表
 * @param {string[]} uris
 * @returns {Promise<string[]>}
 */
async function resolveImages(uris) {
  if (!uris?.length) return []
  const urls = []
  for (const uri of uris) {
    if (uri.startsWith('data:')) {
      urls.push(await uploadToRH(dataUriToBlob(uri)))
    } else if (uri.startsWith('http')) {
      urls.push(uri)
    }
  }
  return urls
}

/**
 * 从 body 中提取所有 data: URI（递归检查）
 * @param {object} body
 * @returns {string[]}
 */
function extractDataUris(body) {
  const uris = []
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return
    if (typeof obj === 'string' && obj.startsWith('data:')) {
      uris.push(obj)
      return
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item)
    } else {
      for (const v of Object.values(obj)) walk(v)
    }
  }
  walk(body)
  return uris
}

/**
 * 将 body 中的 data: URI 替换为已上传的 RH URL
 * @param {object} body 会被原地修改
 * @param {string[]} urls 上传后的 URL 列表（顺序对应 extractDataUris）
 */
function replaceDataUris(body, urls) {
  let idx = 0
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (typeof obj[i] === 'string' && obj[i].startsWith('data:')) {
          obj[i] = urls[idx++] || obj[i]
        } else {
          walk(obj[i])
        }
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string' && obj[key].startsWith('data:')) {
          obj[key] = urls[idx++] || obj[key]
        } else {
          walk(obj[key])
        }
      }
    }
  }
  walk(body)
}

/** @param {string} path */
async function rhCall(path, body) {
  console.log(`[rh-adapter] POST ${path}`, JSON.stringify(body).slice(0, 200))
  const res = await fetchWithTimeout(`${RH_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RH_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.errorCode) {
    throw new Error(data.errorMessage || data.message || `RH HTTP ${res.status}`)
  }
  return data
}

/** @param {string} taskId */
async function rhQuery(taskId) {
  const res = await fetchWithTimeout(`${RH_BASE}/openapi/v2/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RH_API_KEY}`,
    },
    body: JSON.stringify({ taskId }),
  })
  return res.json()
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── 请求处理 ───

/**
 * 构建 RH 原生请求体
 * @param {string} model
 * @param {object} body 前端传来的请求体
 */
function buildRhBody(model, body) {
  const mapping = MODEL_MAP[model]
  if (!mapping) throw new Error(`未知模型: ${model}`)

  // 工作流型直接透传 nodeInfoList
  if (body.nodeInfoList) return body

  const rh = { prompt: body.prompt || '' }

  // 比例
  if (body.aspect_ratio || body.ratio) {
    rh.aspectRatio = body.aspect_ratio || body.ratio
    rh.ratio = body.aspect_ratio || body.ratio
  }

  // 分辨率
  if (body.resolution || body.size) {
    rh.resolution = body.resolution || body.size
  }

  // 时长 (视频)
  if (body.duration != null) rh.duration = parseInt(body.duration, 10) || 5

  // 图片 URL
  if (body.images?.length) rh.imageUrls = body.images
  if (body.image && !rh.imageUrls) rh.imageUrls = [body.image]

  // 视频编辑
  if (body.video) rh.videoUrl = body.video

  // 音频
  if (body.audio) rh.audio_url = body.audio
  if (body.text) rh.text = body.text
  if (body.ref_text) rh.refText = body.ref_text
  if (body.voice_prompt) rh.voicePrompt = body.voice_prompt
  if (body.language) rh.language = body.language
  if (body.start_time) rh.startTime = body.start_time
  if (body.end_time) rh.endTime = body.end_time

  // 工作流专有
  if (body.width != null) rh.width = body.width
  if (body.height != null) rh.height = body.height
  if (body.value != null) rh.value = body.value

  return rh
}

/**
 * POST /v1/{path} — 提交异步任务
 */
async function handleSubmit(req, res, kind) {
  try {
    const raw = await readBody(req)
    const model = raw.model || ''
    const mapping = MODEL_MAP[model]
    if (!mapping) {
      json(res, 400, { error: { message: `不支持的 RH 模型: ${model}` } })
      return
    }
    if (mapping.kind !== kind) {
      json(res, 400, { error: { message: `模型 ${model} 不支持 ${kind} 端点` } })
      return
    }

    // 上传 base64 图片
    const dataUris = extractDataUris(raw)
    if (dataUris.length) {
      console.log(`[rh-adapter] 上传 ${dataUris.length} 张图片到 RH...`)
      const uploadedUrls = await resolveImages(dataUris)
      // 替换 body 中的 data: URI
      replaceDataUris(raw, uploadedUrls)
    }

    // 构建 RH 请求
    const rhBody = buildRhBody(model, raw)

    // 提交到 RH
    const rhData = await rhCall(mapping.endpoint, rhBody)
    const taskId = rhData.taskId
    if (!taskId) throw new Error('RH 未返回 taskId')

    // 存储任务
    tasks.set(taskId, { model, kind, createdAt: Date.now() })
    console.log(`[rh-adapter] 任务已提交: ${taskId} (${model})`)

    json(res, 200, { id: taskId, status: 'pending' })
  } catch (e) {
    console.error('[rh-adapter] submit error:', e.message)
    json(res, 500, { error: { message: e.message } })
  }
}

/**
 * GET /v1/{path}/:id — 查询任务状态
 */
async function handleQuery(req, res, taskId, kind) {
  try {
    const task = tasks.get(taskId)
    if (!task) {
      json(res, 404, { error: { message: '任务不存在或已过期' } })
      return
    }
    if (task.kind !== kind) {
      json(res, 400, { error: { message: `任务 ${taskId} 不属于 ${kind} 类型` } })
      return
    }

    const rhData = await rhQuery(taskId)
    task.queryErrors = 0
    task.lastQueryError = ''
    const status = rhData.status

    if (status === 'SUCCESS') {
      const url = rhData.results?.[0]?.url || ''
      tasks.delete(taskId)
      console.log(`[rh-adapter] 任务完成: ${taskId} → ${url.slice(0, 80)}`)
      json(res, 200, {
        id: taskId,
        status: 'completed',
        data: [{ url }],
      })
      return
    }

    if (status === 'FAILED' || status === 'ERROR') {
      tasks.delete(taskId)
      const msg = rhData.errorMessage || rhData.failedReason?.message || 'RH 任务失败'
      console.log(`[rh-adapter] 任务失败: ${taskId} → ${msg}`)
      json(res, 200, {
        id: taskId,
        status: 'failed',
        error: { message: msg },
      })
      return
    }

    // QUEUED / RUNNING
    json(res, 200, { id: taskId, status: 'pending' })
  } catch (e) {
    console.error('[rh-adapter] query error:', e.message)
    const task = tasks.get(taskId)
    if (task) {
      task.queryErrors = (task.queryErrors || 0) + 1
      task.lastQueryError = e.message || 'RH 查询失败'
      if (task.queryErrors >= QUERY_ERROR_LIMIT) {
        tasks.delete(taskId)
        json(res, 200, {
          id: taskId,
          status: 'failed',
          error: { message: `RH 查询连续失败: ${task.lastQueryError}` },
        })
        return
      }
    }
    json(res, 200, { id: taskId, status: 'pending' }) // 短暂查询错误继续轮询
  }
}

// ─── HTTP 服务器 ───

/** @param {http.IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body too large, limit ${MAX_BODY_BYTES} bytes`))
        req.destroy()
        return
      }
      data += chunk
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) }
      catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function isAuthorized(req) {
  const auth = String(req.headers.authorization || '')
  const apiKey = String(req.headers['x-api-key'] || '')
  return auth === `Bearer ${RH_ADAPTER_SECRET}` || apiKey === RH_ADAPTER_SECRET
}

/** @param {http.ServerResponse} res */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://api.jiucaihezi.studio')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  try {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: { message: 'Unauthorized' } })
    }
    // 图片提交
    if (req.method === 'POST' && path === '/v1/images/generations') {
      return handleSubmit(req, res, 'image')
    }
    // 图片查询
    const imgMatch = path.match(/^\/v1\/images\/generations\/(.+)$/)
    if (req.method === 'GET' && imgMatch) {
      return handleQuery(req, res, imgMatch[1], 'image')
    }

    // 视频提交
    if (req.method === 'POST' && path === '/v1/videos') {
      return handleSubmit(req, res, 'video')
    }
    // 视频查询
    const vidMatch = path.match(/^\/v1\/videos\/(.+)$/)
    if (req.method === 'GET' && vidMatch) {
      return handleQuery(req, res, vidMatch[1], 'video')
    }

    // 音频提交
    if (req.method === 'POST' && path === '/v1/audio/generations') {
      return handleSubmit(req, res, 'audio')
    }
    // 音频查询
    const audMatch = path.match(/^\/v1\/audio\/generations\/(.+)$/)
    if (req.method === 'GET' && audMatch) {
      return handleQuery(req, res, audMatch[1], 'audio')
    }

    // 健康检查
    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, { status: 'ok', tasks: tasks.size })
    }

    json(res, 404, { error: { message: 'Not found' } })
  } catch (e) {
    console.error('[rh-adapter] unhandled error:', e)
    json(res, 500, { error: { message: e.message } })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[rh-adapter] RunningHub 适配器已启动 → http://${HOST}:${PORT}`)
  console.log(`[rh-adapter] RH_API_KEY = ${RH_API_KEY.slice(0, 6)}...`)
  console.log(`[rh-adapter] INTERNAL_AUTH = ${RH_ADAPTER_SECRET ? 'enabled' : 'disabled'}`)
  console.log(`[rh-adapter] 已注册 ${Object.keys(MODEL_MAP).length} 个模型`)
})
