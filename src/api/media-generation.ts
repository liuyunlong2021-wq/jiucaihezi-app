/**
 * api/media-generation.ts — 终极版（基于 NewAPI 源码验证）
 *
 * 路由表（来自 MYnewapi/router/ 源码验证）：
 * ┌─────────────────┬──────────────────────────────┬─────────────────────────────────┐
 * │ 模型            │ 提交                          │ 轮询                             │
 * ├─────────────────┼──────────────────────────────┼─────────────────────────────────┤
 * │ gpt-image-2     │ POST /v1/images/generations   │ 同步（无需轮询）                  │
 * │ gpt-image-2 编辑│ POST /v1/images/edits         │ 同步                             │
 * │ grok            │ POST /v2/videos/generations    │ GET /v2/videos/generations/:id   │
 * │ veo             │ POST /v1/video/generations     │ GET /v1/video/generations/:id    │
 * │ seedance        │ POST /v1/videos                │ GET /v1/videos/:id               │
 * │ suno            │ POST /suno/submit/music         │ GET /suno/fetch/:id              │
 * └─────────────────┴──────────────────────────────┴─────────────────────────────────┘
 */

// ---- Types ----
export interface ImageGenParams {
  model: string
  prompt: string
  size?: string
  aspectRatio?: string
  resolution?: string
  image?: string        // base64 data URL or File blob for image-to-image
}

export interface VideoGenParams {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  duration?: string | number
  imageUrl?: string       // 单图（Seedance 等）
  imageUrls?: string[]    // 多图（Grok 最多7张，prompt 中用 @img1 @img2...）
}

export interface MediaResult {
  url: string
  type: 'image' | 'video' | 'audio'
  taskId?: string
  /** 上游轮询路径（用于任务恢复） */
  pollUrl?: string
  pollKind?: 'image' | 'video' | 'audio'
}

// ---- API Config ----

// BUG-11 修复: 统一使用 resolveApiConfig，不再独立读 localStorage
import { resolveApiConfig as _resolveApiConfig } from '@/utils/api'

let _cachedConfig: { apiKey: string; apiBase: string } | null = null

async function ensureConfig(): Promise<{ apiKey: string; apiBase: string }> {
  if (_cachedConfig) return _cachedConfig
  const config = await _resolveApiConfig()
  _cachedConfig = { apiKey: config.apiKey, apiBase: config.apiBase }
  // 30秒后过期重新读取
  setTimeout(() => { _cachedConfig = null }, 30000)
  return _cachedConfig
}

function getApiKey(): string {
  // 同步读取（兼容旧调用），优先用缓存
  return _cachedConfig?.apiKey || localStorage.getItem('jcApiKey') || ''
}

function getApiBase(): string {
  return _cachedConfig?.apiBase || 'https://api.jiucaihezi.studio'
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getApiKey()}`,
  }
}

// ---- Size Mapping (V4/V5 verified) ----

function mapGptImageSize(ar: string, res?: string): string {
  const is4k = res === '4k'
  const is2k = res === '2k'
  let ratio = ar
  if (ratio === '3:2') ratio = '16:9'
  if (ratio === '2:3') ratio = '9:16'
  switch (ratio) {
    case '1:1': return (is2k || is4k) ? '2048x2048' : '1024x1024'
    case '16:9': return is4k ? '3840x2160' : (is2k ? '2048x1152' : '1536x1024')
    case '9:16': return is4k ? '2160x3840' : (is2k ? '1152x2048' : '1024x1536')
    default: return '1024x1024'
  }
}

// ---- Extractors (V5 production-proven, deep recursive) ----

function extractMediaUrl(payload: any, kind: 'image' | 'video' | 'audio' = 'image'): string {
  function pick(obj: any): string {
    if (!obj || typeof obj !== 'object') return ''
    const direct = obj.url || obj.video_url || obj.videoUrl ||
                   obj.audio_url || obj.audioUrl || obj.output ||
                   obj.image_url || obj.imageUrl
    if (typeof direct === 'string' && direct) return direct
    for (const key of ['video_url', 'audio_url', 'image_url', 'content']) {
      if (obj[key] && typeof obj[key] === 'object' && obj[key].url) return obj[key].url
    }
    if (Array.isArray(obj.content)) {
      for (const item of obj.content) { const u = pick(item); if (u) return u }
    }
    for (const arrKey of ['results', 'urls']) {
      if (Array.isArray(obj[arrKey])) {
        for (const item of obj[arrKey]) {
          if (typeof item === 'string' && item) return item
          const u = pick(item); if (u) return u
        }
      }
    }
    return ''
  }

  const data = payload?.data
  if (Array.isArray(data)) {
    for (const item of data) {
      const u = pick(item); if (u) return u
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
    }
  } else if (data) {
    const u = pick(data); if (u) return u
    if (data.b64_json) return `data:image/png;base64,${data.b64_json}`
    if (data.data && typeof data.data === 'object') {
      const nestedU = pick(data.data); if (nestedU) return nestedU
      if (Array.isArray(data.data.data)) {
        for (const item of data.data.data) {
          const u2 = pick(item); if (u2) return u2
          if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
        }
      }
    }
  }
  const payloadU = pick(payload); if (payloadU) return payloadU
  const choices = payload?.choices
  if (Array.isArray(choices) && choices[0]) {
    const parts = choices[0].message?.content
    if (Array.isArray(parts)) {
      for (const part of parts) { const u = pick(part); if (u) return u }
    }
  }
  return ''
}

function extractTaskId(data: any): string {
  if (typeof data?.data === 'string' && data.data.length > 0) return data.data
  const d = data?.data
  if (d && !Array.isArray(d)) {
    const v = d.task_id || d.taskId || d.id; if (v) return String(v)
  }
  if (Array.isArray(d) && d[0]) {
    const v = d[0].task_id || d[0].taskId || d[0].id; if (v) return String(v)
  }
  const direct = data?.task_id || data?.taskId || data?.id
  return direct ? String(direct) : ''
}

function extractStatus(data: any): string {
  const d = data?.data
  return String(
    (d && !Array.isArray(d) && d.status) ||
    (Array.isArray(d) && d[0]?.status) ||
    data?.status || ''
  )
}

// ---- Core Fetch Helpers ----

async function apiCall(path: string, body: any | null, method = 'POST'): Promise<any> {
  await ensureConfig()
  const key = getApiKey()
  if (!key) throw new Error('请先配置 API Key')
  const opts: RequestInit = { method, headers: authHeaders() }
  if (method !== 'GET' && body) opts.body = JSON.stringify(body)
  const res = await fetch(`${getApiBase()}${path}`, opts)
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('请求过于频繁，请稍后再试')
    }
    if (res.status === 503) {
      const text = await res.text().catch(() => '')
      if (text.includes('model_not_found') || text.includes('无可用渠道')) {
        throw new Error('该模型暂时不可用，服务维护中，请稍后再试')
      }
      throw new Error(`服务暂时不可用 (503)，请稍后再试`)
    }
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json()
  // ★ 检测上游返回的业务错误（HTTP 200 但实际失败）
  checkUpstreamError(json)
  return json
}

/**
 * 检测上游业务错误（T8/RunningHub 返回 200 但 body 含 errorCode）
 */
function checkUpstreamError(data: any) {
  if (!data) return
  const errCode = data.errorCode || data.error_code
  const errMsg = data.errorMessage || data.error_message || data.error?.message
  if (errCode && errCode !== '0' && errCode !== 0) {
    // errorCode 1001 = Invalid URL, 1000 = Unknown error
    const friendlyMap: Record<string, string> = {
      '1000': '上游服务临时故障，请重试',
      '1001': '上游接口链接无效，请联系管理员',
    }
    throw new Error(friendlyMap[String(errCode)] || `上游错误 (${errCode}): ${errMsg || '未知错误'}`)
  }
}

/**
 * 上传图片到服务器，返回 URL
 * 用于 Grok 等不支持 base64 的模型
 */
async function uploadImage(dataUrl: string): Promise<string> {
  await ensureConfig()
  const blob = dataUrlToBlob(dataUrl)
  const formData = new FormData()
  formData.append('file', blob, 'reference.png')
  formData.append('purpose', 'assistants')  // OpenAI files API 格式

  const key = getApiKey()
  if (!key) throw new Error('请先配置 API Key')

  const res = await fetch(`${getApiBase()}/v1/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`图片上传失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  // 尝试多种可能的 URL 字段
  const url = data.url || data.file?.url || data.data?.url || data.download_url
  if (!url) {
    throw new Error('上传成功但未返回 URL: ' + JSON.stringify(data).slice(0, 200))
  }
  return url
}

async function apiCallMultipart(path: string, fields: Record<string, string | Blob>): Promise<any> {
  await ensureConfig()
  const key = getApiKey()
  if (!key) throw new Error('请先配置 API Key')
  const formData = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) formData.append(k, v, 'image.png')
    else formData.append(k, v)
  }
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: formData,
  })
  if (!res.ok) {
    if (res.status === 503) {
      throw new Error('服务暂时不可用 (503)，请稍后再试')
    }
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json()
  checkUpstreamError(json)
  return json
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/png'
  const byteString = atob(parts[1] || '')
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ---- Seedance Direct Proxy (绕过 NewAPI progress 解析 bug) ----

const SEEDANCE_KEY = 'sk-jPyecdFMaINUthrYGSzPzdOWDXMyxCUwQySkSBWFwUfn23vY'

async function seedanceCall(path: string, body: any | null, method = 'POST'): Promise<any> {
  await ensureConfig()
  const base = getApiBase()
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SEEDANCE_KEY}`,
    },
  }
  if (method !== 'GET' && body) opts.body = JSON.stringify(body)
  const res = await fetch(`${base}${path}`, opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Seedance HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

/**
 * Seedance 专用轮询 — 直接解析上游格式
 * 状态: queued/submitting/queueing/processing/in_progress → 继续
 *       succeeded → 取 url
 *       failed → 抛错
 */
export async function pollSeedanceTaskById(
  taskId: string,
  onProgress?: (elapsed: number, status: string) => void,
): Promise<string> {
  return pollSeedanceTask(taskId, onProgress)
}

async function pollSeedanceTask(
  taskId: string,
  onProgress?: (elapsed: number, status: string) => void,
  maxPollsSec = 600,
  intervalMs = 10000,
): Promise<string> {
  const maxPolls = Math.ceil(maxPollsSec / (intervalMs / 1000))
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    let data: any
    try {
      data = await seedanceCall(`/api/seedance/videos/${taskId}`, null, 'GET')
    } catch (e: any) {
      if (e.message?.includes('521')) {
        const elapsed = (i + 1) * (intervalMs / 1000)
        onProgress?.(elapsed, '连接恢复中...')
        if (i * intervalMs < 180000) continue
      }
      if (e.message?.includes('401') || e.message?.includes('402')) throw e
      if (i < 3) continue
      throw e
    }
    // 上游格式: { status, url, progress: { message }, error, code }
    const status = String(data?.status || data?.data?.status || '').toLowerCase()
    const elapsed = (i + 1) * (intervalMs / 1000)
    const progressMsg = data?.progress?.message || status || '生成中'
    onProgress?.(elapsed, progressMsg)

    if (status === 'succeeded' || status === 'completed' || status === 'complete') {
      const url = data.url || data.data?.url || extractMediaUrl(data, 'video')
      if (url) return url
    }
    if (status === 'failed' || status === 'error') {
      const err = data.error || data.fail_reason || '视频生成失败'
      throw new Error(typeof err === 'string' ? err : JSON.stringify(err))
    }
  }
  throw new Error(`Seedance 生成超时 (${Math.round(maxPollsSec / 60)}分钟)`)
}

// ---- Unified Task Poller (exported for task recovery) ----

export async function pollTask(
  pollPath: string,
  kind: 'image' | 'video' | 'audio',
  onProgress?: (elapsed: number, status: string) => void,
  maxPollsSec = 600,
  intervalMs = 10000,
): Promise<string> {
  const maxPolls = Math.ceil(maxPollsSec / (intervalMs / 1000))
  let consecutive521 = 0
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    let data: any
    try {
      data = await apiCall(pollPath, null, 'GET')
      consecutive521 = 0  // 成功请求，重置 521 计数
    } catch (e: any) {
      // Seedance 文档: 遇到 521 不要立即判失败，继续轮询 3 分钟
      if (e.message?.includes('521')) {
        consecutive521++
        const elapsed = (i + 1) * (intervalMs / 1000)
        onProgress?.(elapsed, '连接恢复中...')
        if (consecutive521 * intervalMs < 180000) continue  // 3 分钟内继续
      }
      // BUG-14 修复: 明确的鉴权/配额错误不重试，立即告知用户
      if (e.message?.includes('401') || e.message?.includes('403') || e.message?.includes('400')) {
        throw e
      }
      // 其他临时网络错误重试（最多 3 次后放弃）
      if (i < maxPolls - 1 && i < 3) continue
      throw e
    }
    const status = extractStatus(data)
    const elapsed = (i + 1) * (intervalMs / 1000)
    // Seedance 进度信息
    const progressMsg = data?.progress?.message || status || '生成中'
    onProgress?.(elapsed, progressMsg)
    if (/^(completed|complete|success|succeeded|done)$/i.test(status)) {
      const url = extractMediaUrl(data, kind)
      if (url) return url
      // 状态完成但没有 URL，可能响应格式异常
      console.warn('[pollTask] 状态完成但未提取到 URL:', JSON.stringify(data).slice(0, 300))
    }
    if (/^(failed|failure|fail|error|cancelled|canceled)$/i.test(status)) {
      const err = data.fail_reason || data.failReason || data.error?.message ||
                  data.data?.fail_reason || data.data?.error || data.error || '生成失败'
      throw new Error(typeof err === 'string' ? err : JSON.stringify(err))
    }
    // 超过 5 分钟仍在处理，给用户更明确的反馈
    if (elapsed > 300) {
      onProgress?.(elapsed, `仍在处理 (${Math.round(elapsed / 60)}分钟)...`)
    }
  }
  throw new Error(`生成超时 (${Math.round(maxPollsSec / 60)}分钟)，上游服务可能繁忙，请稍后重试`)
}

// ======================================================================
// PUBLIC API
// ======================================================================

/**
 * 生成图片 — gpt-image-2 / grok-image
 *
 * gpt-image-2:
 *   文生图: POST /v1/images/generations (JSON)
 *   图生图: POST /v1/images/edits (multipart) — 日志验证: userId=5630, 200 OK, 60s
 *           JSON body 带 base64 会被 Cloudflare 524 超时，必须用 multipart
 *
 * grok-image (文档: T8grok.md 行12-97):
 *   文生图/图生图: POST /v1/images/generations (JSON)
 *   参数: aspect_ratio (下划线), image (数组)
 */
export async function generateImage(
  params: ImageGenParams,
  onProgress?: (elapsed: number, status: string) => void,
): Promise<MediaResult> {
  await ensureConfig()
  const { model, prompt, image, aspectRatio, resolution } = params
  const size = params.size || mapGptImageSize(aspectRatio || '1:1', resolution)

  // ── Grok Image → JSON /v1/images/generations (文档行72: aspect_ratio, 行73: image数组) ──
  if (model.startsWith('grok') && model.includes('image')) {
    const body: any = { model, prompt, response_format: 'url' }
    if (aspectRatio) body.aspect_ratio = aspectRatio
    if (image) body.image = [image]  // 数组格式（文档行73-76）

    onProgress?.(0, image ? '上传图片中...' : '提交中')
    const data = await apiCall('/v1/images/generations', body)
    const mediaUrl = extractMediaUrl(data, 'image')
    if (!mediaUrl) throw new Error('Grok 图片生成失败（响应: ' + JSON.stringify(data).slice(0, 200) + '）')
    return { url: mediaUrl, type: 'image' }
  }

  // ── GPT Image 图生图 → multipart /v1/images/edits ──
  // ★ 自动重试：上游偶尔超时返回空图（completion_tokens=0 但 HTTP 200），最多重试 2 次
  if (image) {
    onProgress?.(0, '上传图片中...')
    const fields: Record<string, string | Blob> = {
      model, prompt, size, response_format: 'url',
    }
    // 把 data URL 转成 Blob（NewAPI 要求 multipart file）
    if (image.startsWith('data:')) {
      fields.image = dataUrlToBlob(image)
    } else {
      // 如果是外部 URL，先下载再作为 blob
      try { const imgRes = await fetch(image); fields.image = await imgRes.blob() }
      catch { throw new Error('无法加载参考图片') }
    }

    let lastData: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) onProgress?.(attempt * 60, `第${attempt + 1}次尝试...`)
      lastData = await apiCallMultipart('/v1/images/edits', fields)
      const mediaUrl = extractMediaUrl(lastData, 'image')
      if (mediaUrl) return { url: mediaUrl, type: 'image' }
      console.warn(`[图生图] 第${attempt + 1}次返回空图，重试...`, lastData)
    }
    throw new Error('图生图多次尝试均未获取到结果（上游可能繁忙，请稍后再试）')
  }

  // ── GPT Image 文生图 → JSON /v1/images/generations ──
  // ★ 同样加重试保护
  const body: any = { model, prompt, n: 1, size, response_format: 'url' }
  let lastGenData: any = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) onProgress?.(attempt * 30, `第${attempt + 1}次尝试...`)
    else onProgress?.(0, '提交中')
    lastGenData = await apiCall('/v1/images/generations', body)
    const mediaUrl = extractMediaUrl(lastGenData, 'image')
    if (mediaUrl) return { url: mediaUrl, type: 'image' }
    console.warn(`[文生图] 第${attempt + 1}次返回空图，重试...`, lastGenData)
  }
  throw new Error('多次尝试均未获取到图像结果（上游可能繁忙，请稍后再试）')
}

/**
 * 生成视频 — grok-video-3 / veo3.1 / seedance
 *
 * grok → POST /v2/videos/generations → GET /v2/videos/generations/:id (文档验证)
 * veo → POST /v1/video/generations → GET /v1/video/generations/:id
 * seedance → POST /v1/videos → GET /v1/videos/:id
 */
export async function generateVideo(
  params: VideoGenParams,
  onProgress?: (elapsed: number, status: string) => void,
): Promise<MediaResult> {
  await ensureConfig()
  const { model, prompt, aspectRatio, resolution, duration, imageUrl } = params

  // ── Seedance 系列 → /api/seedance/videos (Nginx 直连代理，绕过 NewAPI progress 解析 bug) ──
  if (model.startsWith('seedance') || model.includes('seedance')) {
    const body: any = {
      model,
      prompt,
      duration: Number(duration) || 5,
      ratio: aspectRatio || '16:9',
      generate_audio: true,
    }
    // Pro 模型支持 resolution（文档: 480p/720p/1080p）
    // Fast 模型不传 resolution（文档: "当前不要传 resolution"）
    // Pro = 不含 'fast' 的 seedance 模型
    if (!model.includes('fast') && resolution) {
      body.resolution = resolution.toLowerCase()
    }
    // 图生视频：reference_mode + image_file_1
    if (imageUrl) {
      body.reference_mode = 'omni_reference'
      body.image_file_1 = imageUrl
    }

    onProgress?.(0, imageUrl ? '上传素材中...' : '提交任务...')
    const data = await seedanceCall('/api/seedance/videos', body)
    let mediaUrl = extractMediaUrl(data, 'video')
    if (!mediaUrl) {
      const taskId = extractTaskId(data)
      if (taskId) mediaUrl = await pollSeedanceTask(taskId, onProgress)
    }
    if (!mediaUrl) throw new Error('Seedance 视频生成失败')
    const seedTaskId = extractTaskId(data)
    return { url: mediaUrl, type: 'video', taskId: seedTaskId, pollUrl: seedTaskId ? `/api/seedance/videos/${seedTaskId}` : undefined, pollKind: 'video' as const }
  }

  // ── Grok 系列 → /v1/videos (NewAPI 统一端点，/v2/ 不支持) ──
  if (model.startsWith('grok-video')) {
    const body: any = { model, prompt }
    if (aspectRatio) body.ratio = aspectRatio
    if (resolution) body.resolution = resolution.toUpperCase()  // 720P / 1080P
    if (duration) body.duration = Number(duration)

    const { imageUrls, imageUrl: singleImageUrl } = params

    // T8grok.md: images 参数为 string[]，支持 URL 和 base64 data URI
    if (imageUrls && imageUrls.length > 0) {
      body.images = imageUrls
    } else if (singleImageUrl) {
      body.images = [singleImageUrl]
    }

    onProgress?.(0, '提交任务...')
    const data = await apiCall('/v1/videos', body)
    const taskId = extractTaskId(data)
    if (!taskId) throw new Error('Grok 未返回任务 ID')

    // 轮询 /v1/videos/:id
    const mediaUrl = await pollTask(`/v1/videos/${taskId}`, 'video', onProgress, 600, 10000)
    if (!mediaUrl) throw new Error('Grok 视频生成失败')
    return { url: mediaUrl, type: 'video', taskId, pollUrl: `/v1/videos/${taskId}`, pollKind: 'video' as const }
  }

  // ── Veo / 其他 → /v1/videos (NewAPI 统一视频端点) ──
  const body: any = { model, prompt }
  if (aspectRatio) body.ratio = aspectRatio
  if (resolution) body.resolution = resolution.toUpperCase()
  if (duration) body.duration = Number(duration)
  if (imageUrl) body.images = [imageUrl]

  const data = await apiCall('/v1/videos', body)
  let mediaUrl = extractMediaUrl(data, 'video')
  if (!mediaUrl) {
    const taskId = extractTaskId(data)
    if (taskId) mediaUrl = await pollTask(`/v1/videos/${taskId}`, 'video', onProgress, 600, 10000)
  }
  if (!mediaUrl) throw new Error('视频生成失败')
  const veoTaskId = extractTaskId(data)
  return { url: mediaUrl, type: 'video', taskId: veoTaskId, pollUrl: veoTaskId ? `/v1/videos/${veoTaskId}` : undefined, pollKind: 'video' as const }
}

/**
 * 生成音乐 — Suno 5.5
 * POST /suno/submit/music → GET /suno/fetch/:id
 */
export async function generateAudio(prompt: string): Promise<MediaResult> {
  await ensureConfig()
  const key = getApiKey()
  if (!key) throw new Error('请先配置 API Key')

  // Step 1: 提交 → /suno/submit/music (NewAPI relay-router.go:184)
  const body = { gpt_description_prompt: prompt, mv: 'chirp-fenix' }
  const submitRes = await fetch(`${getApiBase()}/suno/submit/music`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  })
  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '')
    throw new Error(`Suno 提交失败 (${submitRes.status}): ${errText.slice(0, 200)}`)
  }
  const submitData = await submitRes.json()

  // 提取 task_id — NewAPI 的 RelayTask 返回格式
  const taskId = extractTaskId(submitData)
  if (!taskId) {
    // 也尝试 clips 格式（兼容）
    const clips = submitData?.clips || submitData?.data?.clips || []
    if (clips.length === 0) throw new Error('Suno 未返回任务 ID 或 clips')
    // Fallback: 用 clips[0].id 轮询
    const clipId = clips[0]?.id
    if (clipId) {
      return await pollSunoByClipId(clipId)
    }
    throw new Error('Suno 未返回有效的任务标识')
  }

  // Step 2: 轮询 → /suno/fetch/:id (NewAPI relay-router.go:186)
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const pollRes = await fetch(`${getApiBase()}/suno/fetch/${taskId}`, {
      method: 'GET', headers: authHeaders(),
    })
    if (!pollRes.ok) continue
    const pollData = await pollRes.json()

    // RelayTaskFetch 可能返回单个对象或数组
    const items = Array.isArray(pollData) ? pollData
      : Array.isArray(pollData?.data) ? pollData.data
      : pollData?.data ? [pollData.data] : [pollData]

    for (const clip of items) {
      const status = String(clip.status || '').toLowerCase()
      if (status === 'complete' || status === 'completed' || status === 'success') {
        const audioUrl = clip.audio_url || clip.video_url || extractMediaUrl(clip, 'audio')
        if (audioUrl) return { url: audioUrl, type: 'audio' }
      }
      if (status === 'error' || status === 'failed') {
        throw new Error(clip.error_message || clip.fail_reason || 'Suno 生成失败')
      }
    }
  }
  throw new Error('Suno 生成超时（10分钟）')
}

/** Fallback: 用 clip ID 直接轮询（兼容旧 API） */
async function pollSunoByClipId(clipId: string): Promise<MediaResult> {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const res = await fetch(`${getApiBase()}/suno/fetch/${clipId}`, {
      method: 'GET', headers: authHeaders(),
    })
    if (!res.ok) continue
    const data = await res.json()
    const items = Array.isArray(data) ? data : data?.data ? [data.data] : [data]
    for (const clip of items) {
      if (clip.status === 'complete' || clip.status === 'completed') {
        const audioUrl = clip.audio_url || clip.video_url
        if (audioUrl) return { url: audioUrl, type: 'audio' }
      }
      if (clip.status === 'error' || clip.status === 'failed') {
        throw new Error(clip.error_message || 'Suno 生成失败')
      }
    }
  }
  throw new Error('Suno 生成超时')
}
