/**
 * api/media-generation.ts — 云端媒体生成（统一走 NewAPI）
 *
 * NewAPI 媒体路由表：
 * ┌─────────────────┬──────────────────────────────┬─────────────────────────────────┐
 * │ 模型            │ 提交                          │ 轮询                             │
 * ├─────────────────┼──────────────────────────────┼─────────────────────────────────┤
 * │ gpt-image-2     │ POST /v1/images/generations   │ 同步（无需轮询）                  │
 * │ gpt-image-2 编辑│ POST /v1/images/edits         │ 同步                             │
 * │ grok-video-3    │ POST /v1/videos                 │ GET /v1/videos/:id               │
 * │ veo             │ POST /v1/video/generations     │ GET /v1/video/generations/:id    │
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
  image?: string | string[]  // base64/data URL, or ordered reference images for image-to-image
  lora?: string
  lora_strength?: number
  outputFormat?: string
  responseFormat?: 'url' | 'b64_json'
  onSubmitted?: (payload: CreationTaskSubmitted) => void | Promise<void>
}

export interface VideoGenParams {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  duration?: string | number
  imageUrl?: string
  imageUrls?: string[]    // 多图（Grok 最多7张，prompt 中用 @img1 @img2...）
  videoUrl?: string
  audioUrl?: string
  text?: string
  width?: string | number
  height?: string | number
  value?: string | number
  onSubmitted?: (payload: CreationTaskSubmitted) => void | Promise<void>
}

export interface AudioGenParams {
  model?: string
  prompt: string
  title?: string
  tags?: string
  negativeTags?: string
  makeInstrumental?: boolean | string
  mv?: string
  audioUrl?: string
  startTime?: string
  endTime?: string
  refText?: string
  text?: string
  language?: string
  voicePrompt?: string
  onSubmitted?: (payload: CreationTaskSubmitted) => void | Promise<void>
}

export interface MediaResult {
  url: string
  type: 'image' | 'video' | 'audio' | 'text'
  text?: string
  taskId?: string
  /** 上游轮询路径（用于任务恢复） */
  pollUrl?: string
  pollKind?: 'image' | 'video' | 'audio' | 'text'
}

export interface CreationTaskSubmitted {
  taskId: string
  pollUrl: string
  pollKind: 'image' | 'video' | 'audio' | 'text'
}

const CREATION_TASK_POLL_INTERVAL_MS = Number((import.meta as any).env?.VITE_CREATION_TASK_POLL_INTERVAL_MS || 5000)

// ---- API Config ----

// BUG-11 修复: 统一使用 resolveApiConfig，不再独立读 localStorage
import { getMediaModel, getMediaModelAvailability, isRemovedMediaModelId } from '@/data/mediaModelCapabilities'
import { buildGatewayHeaders, DEFAULT_API_BASE_URL } from '@/services/newApiClient'
import { getApiKey } from '@/services/newApiAuth'
import { isAllowedCreationPollUrl } from '@/utils/urlSafety'

let _cachedConfig: { apiKey: string; apiBase: string } | null = null

async function ensureConfig(): Promise<{ apiKey: string; apiBase: string }> {
  if (_cachedConfig) return _cachedConfig
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('请先在设置中登录韭菜盒子账号')
  _cachedConfig = { apiKey, apiBase: DEFAULT_API_BASE_URL }
  setTimeout(() => { _cachedConfig = null }, 30000)
  return _cachedConfig
}

/**
 * 统一认证：使用主 NewAPI Token
 */function storedApiKey(): string {
  return getApiKey()
}

function getApiBase(): string {
  return _cachedConfig?.apiBase || DEFAULT_API_BASE_URL
}

/**
 * 构建认证头：统一主 NewAPI Token
 */
function authHeadersFor(model?: string): Record<string, string> {
  return buildGatewayHeaders({ 'Content-Type': 'application/json' })
}

function authHeaders(): Record<string, string> {
  return buildGatewayHeaders({ 'Content-Type': 'application/json' })
}

export function assertMediaModelExecutable(model: string, kind: 'image' | 'video' | 'audio'): void {
  const id = String(model || '').trim()
  if (!id) throw new Error('请先选择模型')
  if (isRemovedMediaModelId(id)) throw new Error(`模型 ${id} 已不可用，请重新选择模型。`)

  const capability = getMediaModel(id)
  if (!capability) throw new Error(`模型 ${id} 暂不可用，请重新选择模型。`)
  if (capability.enabled === false) throw new Error(`模型 ${id} 暂不可用，请重新选择模型。`)
  const availability = getMediaModelAvailability(capability.id) || getMediaModelAvailability(capability.model)
  if (availability?.status === 'disabled') {
    throw new Error(availability.reason || `模型 ${id} 暂不可用，请重新选择模型。`)
  }

  const matchesKind = kind === 'video'
    ? capability.task === 'video' || capability.task === 'digital-human'
    : capability.task === kind
  if (!matchesKind) {
    throw new Error(`模型 ${id} 不支持${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}生成，请重新选择模型。`)
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

function normalizeRhImageResolution(value?: string): string {
  const clean = String(value || '').trim().toLowerCase()
  return clean === '1k' || clean === '2k' || clean === '4k' ? clean : '1k'
}

function normalizeRhImageAspectRatio(value?: string): string {
  const clean = String(value || '').trim()
  if (!clean || /^(empty|auto|adaptive)$/i.test(clean)) return ''
  return clean
}

function mapImageSizeToAspectRatio(size?: string): string {
  switch (String(size || '').trim()) {
    case '1536x1024':
      return '3:2'
    case '1024x1536':
      return '2:3'
    case '2048x2048':
    case '1024x1024':
      return '1:1'
    default:
      return ''
  }
}

// ---- Extractors (V5 production-proven, deep recursive) ----

export function extractMediaUrl(payload: any, kind: 'image' | 'video' | 'audio' = 'image'): string {
  function pick(obj: any): string {
    if (!obj || typeof obj !== 'object') return ''
    const direct = obj.url || obj.video_url || obj.videoUrl ||
                   obj.audio_url || obj.audioUrl || obj.output ||
                   obj.image_url || obj.imageUrl
    if (typeof direct === 'string' && direct) return direct
    for (const key of ['video_url', 'audio_url', 'image_url', 'content']) {
      if (obj[key] && typeof obj[key] === 'object' && obj[key].url) return obj[key].url
    }
    for (const key of ['output', 'audio', 'video', 'image', 'result', 'file', 'metadata']) {
      if (obj[key] && typeof obj[key] === 'object') {
        const nested = pick(obj[key]); if (nested) return nested
      }
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

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const u = pick(item); if (u) return u
      if (item?.b64_json) return `data:${kind === 'audio' ? 'audio/mpeg' : kind === 'video' ? 'video/mp4' : 'image/png'};base64,${item.b64_json}`
    }
  }
  const data = payload?.data
  if (payload?.upstream) {
    const upstreamU = extractMediaUrl(payload.upstream, kind); if (upstreamU) return upstreamU
  }
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

export function extractMediaText(payload: any): string {
  const normalize = (value: string) => value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').trim()
  function pick(obj: any): string {
    if (!obj || typeof obj !== 'object') return ''
    if (typeof obj.text === 'string' && obj.text.trim()) return normalize(obj.text)
    if (typeof obj.content === 'string' && obj.content.trim()) return normalize(obj.content)
    if (typeof obj.output === 'string' && obj.output.trim() && !/^https?:\/\//i.test(obj.output)) return normalize(obj.output)
    for (const key of ['result', 'data', 'metadata', 'output']) {
      const nested = obj[key]
      if (nested && typeof nested === 'object') {
        const text = pick(nested)
        if (text) return text
      }
    }
    for (const arrKey of ['results', 'outputs', 'data']) {
      if (Array.isArray(obj[arrKey])) {
        for (const item of obj[arrKey]) {
          const text = typeof item === 'string' ? normalize(item) : pick(item)
          if (text) return text
        }
      }
    }
    return ''
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const text = typeof item === 'string' ? normalize(item) : pick(item)
      if (text) return text
    }
  }
  return pick(payload)
}

export function extractTaskId(data: any): string {
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

function isAiAppTask(data: any): boolean {
  const d = data?.data
  return Boolean(
    data?.ai_app === true ||
    data?.aiApp === true ||
    (d && !Array.isArray(d) && (d.ai_app === true || d.aiApp === true)) ||
    (Array.isArray(d) && d[0] && (d[0].ai_app === true || d[0].aiApp === true)),
  )
}

function buildRhTaskPollUrl(taskId: string, data: any): string {
  return `/rh/tasks/${taskId}${isAiAppTask(data) ? '?ai_app=true' : ''}`
}

function buildOfficialRhAiAppVideoNodeInfoList(params: VideoGenParams, images: string[]): any[] | undefined {
  const image = params.imageUrl || images[0] || ''
  switch (params.model) {
    case 'rh-aiapp-fast-digital-human':
      return [
        { nodeId: '3', fieldName: 'audio', fieldValue: params.audioUrl || '', description: 'audio' },
        { nodeId: '4', fieldName: 'image', fieldValue: image, description: 'image' },
        { nodeId: '10', fieldName: 'value', fieldValue: String(params.value || 832), description: 'value' },
      ]
    default:
      return undefined
  }
}

function extractStatus(data: any): string {
  const d = data?.data
  return String(
    (d && !Array.isArray(d) && d.status) ||
    (Array.isArray(d) && d[0]?.status) ||
    (Array.isArray(data) && data[0]?.status) ||
    data?.status || ''
  )
}

export async function uploadCreationAsset(value?: string): Promise<string> {
  const source = String(value || '').trim()
  if (!source) return source
  // 非 data: URL（如 NewAPI/CDN URL）直接透传，无需重上传
  if (!source.startsWith('data:')) return source
  await ensureConfig()
  const blob = dataUrlToBlob(source)
  const formData = new FormData()
  formData.append('file', blob, blob.type.startsWith('audio/') ? 'reference.wav' : blob.type.startsWith('video/') ? 'reference.mp4' : 'reference.png')
  const headers = buildGatewayHeaders({})
  delete headers['Content-Type']  // multipart 不设置 Content-Type
  const { signal, clear } = createTimeoutSignal(120)
  const res = await safeFetch(`${getApiBase()}/api/creations/uploads`, {
    method: 'POST',
    headers,
    body: formData,
    signal,
  })
  clear()
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`素材上传失败 (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const url = String(data.url || data.data?.url || data.raw?.url || data.raw?.data?.download_url || data.raw?.data?.url || '').trim()
  if (!url) throw new Error('素材上传成功但未返回 URL')
  return url
}
// ★ submitCreationTask 已废弃，所有 RH 模型统一走 rh-adapter + 标准 OpenAI 端点

// ---- Core Fetch Helpers ----

import { safeFetch } from '@/utils/httpClient'

/** 创建带超时的 AbortController（网页版 fallback） */
function createTimeoutSignal(timeoutSec = 180): { signal?: AbortSignal; clear: () => void } {
  if (typeof AbortController === 'undefined') return { clear: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

export async function apiCall(path: string, body: any | null, method = 'POST', model?: string): Promise<any> {
  await ensureConfig()
  const key = storedApiKey()
  if (!key) throw new Error('请先登录韭菜盒子账号')
  const headers = model ? authHeadersFor(model) : authHeaders()
  const opts: RequestInit = { method, headers }
  if (method !== 'GET' && body) opts.body = JSON.stringify(body)
  const base = getApiBase()
  const fullUrl = `${base}${path}`
  console.log('[apiCall]', method, fullUrl, 'model=', model, 'keyLen=', (key||'').length)
  // ★ 使用 safeFetch 而非裸 fetch：Tauri 走 Rust 桥，浏览器走原生（带超时）
  const { signal, clear } = createTimeoutSignal(method === 'GET' ? 60 : 180)
  if (signal) opts.signal = signal
  const res = await safeFetch(fullUrl, opts)
  clear()
  console.log('[apiCall] response status:', res.status)
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('请求过于频繁，请稍后再试')
    }
    if (res.status === 503) {
      const text = await res.text().catch(() => '')
      if (text.includes('model_not_found') || text.includes('无可用渠道')) {
        throw new Error('该模型对应的 NewAPI 渠道暂不可用或无可用渠道，请检查后台渠道状态后再试')
      }
      throw new Error(`服务暂时不可用 (503)，请稍后再试`)
    }
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json()
  console.log('[apiCall] response data keys:', Object.keys(json), 'data[0]:', json?.data?.[0] ? JSON.stringify(json.data[0]).slice(0,200) : 'no data')
  // ★ 检测上游返回的业务错误（HTTP 200 但实际失败）
  checkUpstreamError(json)
  return json
}

/**
 * 检测上游业务错误（T8/RunningHub 返回 200 但 body 含 errorCode）
 */
function checkUpstreamError(data: any) {
  if (!data) return
  // NewAPI 错误格式: { error: { code, message, type: "new_api_error" } }
  if (data.error && typeof data.error === 'object' && data.error.type === 'new_api_error') {
    throw new Error(data.error.message || data.error.code || 'NewAPI 上游错误')
  }
  if (data.success === false) {
    const message = data.message || data.error?.message || data.error || data.fail_reason || data.failReason || '上游任务失败'
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
  }
  const rawCode = data.code ?? data.status_code ?? data.statusCode
  const status = String(data.status || data.data?.status || '').toLowerCase()
  const nonErrorStatus = /^(queued|queueing|submitting|processing|pending|running|in_progress|completed|complete|success|succeeded|done)$/i.test(status)
  if (rawCode !== undefined && rawCode !== null && rawCode !== 0 && rawCode !== '0' && rawCode !== 200 && rawCode !== '200' && rawCode !== 'success' && !nonErrorStatus) {
    const message = data.message || data.error?.message || data.error || data.fail_reason || data.failReason
    throw new Error(message ? String(message) : `上游错误 (${rawCode})`)
  }
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

function summarizeMediaResponse(data: any): string {
  if (!data || typeof data !== 'object') return String(data ?? 'empty')
  const summary: Record<string, unknown> = {
    keys: Object.keys(data).slice(0, 12),
  }
  if ('status' in data) summary.status = data.status
  if ('code' in data) summary.code = data.code
  if ('message' in data) summary.message = data.message
  if ('error' in data) {
    summary.error = typeof data.error === 'string'
      ? data.error
      : data.error?.message || data.error?.code || 'object'
  }
  if (Array.isArray(data.data)) {
    summary.dataLength = data.data.length
    summary.firstDataKeys = data.data[0] && typeof data.data[0] === 'object'
      ? Object.keys(data.data[0]).slice(0, 12)
      : typeof data.data[0]
  } else if (data.data && typeof data.data === 'object') {
    summary.dataKeys = Object.keys(data.data).slice(0, 12)
  }
  return JSON.stringify(summary)
}

function emptyImageResultError(label: string, data: any): Error {
  return new Error(`${label}没有返回可用图片 URL 或 b64_json。响应摘要：${summarizeMediaResponse(data)}`)
}

export async function apiCallMultipart(path: string, fields: Record<string, string | Blob | Blob[]>): Promise<any> {
  await ensureConfig()
  const key = storedApiKey()
  if (!key) throw new Error('请先登录韭菜盒子账号')
  const formData = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      v.forEach((item, index) => formData.append(k, item, `image_${index + 1}.png`))
    } else if (v instanceof Blob) formData.append(k, v, 'image.png')
    else formData.append(k, v)
  }
  // ★ 使用 safeFetch + buildGatewayHeaders（含 x-api-key），补全鉴权头
  const headers = buildGatewayHeaders({})
  // multipart 不设置 Content-Type，让浏览器自动带 boundary
  delete headers['Content-Type']
  const { signal, clear } = createTimeoutSignal(180)
  const res = await safeFetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    signal,
  })
  clear()
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

/** 过滤安全图片 URL：仅允许 data: 和 http(s): 前缀 */
function filterSafeImageUrls(imageUrls?: string[], imageUrl?: string): string[] {
  const urls = imageUrls?.length ? [...imageUrls] : imageUrl ? [imageUrl] : []
  return urls.filter(url => {
    const s = String(url || '').trim()
    return s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/png'
  const byteString = atob(parts[1] || '')
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ---- Unified Task Poller (exported for task recovery) ----

export async function pollTask(
  pollPath: string,
  kind: 'image' | 'video' | 'audio' | 'text',
  onProgress?: (elapsed: number, status: string) => void,
  maxPollsSec = 600,
  intervalMs = 10000,
): Promise<string> {
  if (!isAllowedCreationPollUrl(pollPath)) throw new Error('任务轮询地址不安全，已阻止请求')
  const maxPolls = Math.ceil(maxPollsSec / (intervalMs / 1000))
  let consecutive521 = 0
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    let data: any
    try {
      data = await apiCall(pollPath, null, 'GET')
      consecutive521 = 0  // 成功请求，重置 521 计数
    } catch (e: any) {
      // 上游偶发 521 时不要立即判失败，继续轮询 3 分钟
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
    const progressMsg = data?.progress?.message || status || '生成中'
    onProgress?.(elapsed, progressMsg)
    if (/^(completed|complete|success|succeeded|done)$/i.test(status)) {
      if (kind === 'text') {
        const text = extractMediaText(data)
        if (text) return text
        console.warn('[pollTask] 状态完成但未提取到文本:', JSON.stringify(data).slice(0, 300))
      }
      const url = extractMediaUrl(data, kind === 'text' ? 'audio' : kind)
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
 * 生成图片 — gpt-image-2 / nano-banana-2k / nano-banana-4k / RH 模型
 *
 * gpt-image-2:
 *   文生图: POST /v1/images/generations (JSON)
 *   图生图: POST /v1/images/edits (multipart) — 日志验证: userId=5630, 200 OK, 60s
 *           JSON body 带 base64 会被 Cloudflare 524 超时，必须用 multipart
 *
 * RH 模型: 走 NewAPI → rh-adapter(127.0.0.1:8789) → RH 原生 API
 * Nano Banana: 走 NewAPI → /v1/images/generations (JSON)
 */
export async function generateImage(
  params: ImageGenParams,
  onProgress?: (elapsed: number, status: string) => void,
): Promise<MediaResult> {
  const { model, prompt, image, aspectRatio, resolution } = params
  assertMediaModelExecutable(model, 'image')
  await ensureConfig()

  const capability = getMediaModel(model)
  const isRh = capability?.provider === 'gateway-image' && capability.webappId

  // ── RH 图片: 标准 OpenAI 格式，rh-adapter 自动翻译 ──
  if (isRh) {
    onProgress?.(0, '提交 RunningHub...')
    const rhBody: any = { model, prompt }
    const isRhAiApp = /^\d+$/.test(String(capability?.webappId || ''))
    const rhAspectRatio = normalizeRhImageAspectRatio(aspectRatio) || mapImageSizeToAspectRatio(params.size)
    if (rhAspectRatio) {
      rhBody.aspectRatio = rhAspectRatio
      rhBody.aspect_ratio = rhAspectRatio
      rhBody.ratio = rhAspectRatio
    }
    const rhResolution = normalizeRhImageResolution(resolution)
    rhBody.resolution = rhResolution
    const rhExtraFields: Record<string, unknown> = {}
    if (rhAspectRatio) {
      rhExtraFields.aspectRatio = rhAspectRatio
      rhExtraFields.aspect_ratio = rhAspectRatio
      rhExtraFields.ratio = rhAspectRatio
    }
    if (rhResolution) rhExtraFields.resolution = rhResolution
    if (params.lora) rhExtraFields.lora = params.lora
    if (params.lora_strength !== undefined) rhExtraFields.lora_strength = params.lora_strength
    if (params.outputFormat) rhExtraFields.outputFormat = params.outputFormat
    if (Object.keys(rhExtraFields).length) rhBody.extra_fields = rhExtraFields
    if (isRhAiApp && params.size && params.size !== 'auto') rhBody.size = params.size
    if (image) {
      const imgs = Array.isArray(image) ? image.filter(Boolean) : [image].filter(Boolean) as string[]
      if (imgs.length) rhBody.images = imgs
    }
    const rhData = await apiCall('/v1/images/generations', rhBody, 'POST', model)
    const syncUrl = extractMediaUrl(rhData, 'image')
    if (syncUrl) return { url: syncUrl, type: 'image' }
    // 异步：rh-adapter 返回 {task_id, status:"processing"}，轮询走 /rh/tasks/ 直连 adapter
    const taskId = extractTaskId(rhData) || rhData.id
    if (taskId) {
      const pollUrl = buildRhTaskPollUrl(taskId, rhData)
      await params.onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
      const mediaUrl = await pollTask(pollUrl, 'image', onProgress, 600, CREATION_TASK_POLL_INTERVAL_MS)
      return { url: mediaUrl, type: 'image', taskId, pollUrl, pollKind: 'image' as const }
    }
    throw new Error('RH 图片多次尝试均未获取到结果')
  }

  const size = params.size || mapGptImageSize(aspectRatio || '1:1', resolution)
  const responseFormat = params.responseFormat || 'url'

  // ── Nano Banana → JSON /v1/images/generations ──
  if (model.startsWith('nano-banana')) {
    const body: any = { model: capability?.model || model, prompt, response_format: responseFormat }
    if (aspectRatio) body.aspect_ratio = aspectRatio
    const images = Array.isArray(image) ? image.filter(Boolean) : (image ? [image] : [])
    if (images.length) body.image = images

    // ★ 加重试：上游偶发返回空响应（HTTP 200 但无 data）
    let nanoData: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) onProgress?.(attempt * 30, image ? `第${attempt + 1}次尝试...` : '重试中...')
      else onProgress?.(0, image ? '上传图片中...' : '提交中')
      nanoData = await apiCall('/v1/images/generations', body, 'POST', model)
      const mediaUrl = extractMediaUrl(nanoData, 'image')
      if (mediaUrl) return { url: mediaUrl, type: 'image' }
      console.warn(`[Nano Banana] 第${attempt + 1}次返回空图，重试...`, nanoData)
    }
    throw new Error('Nano Banana 多次尝试均未获取到结果（上游可能繁忙，请稍后再试）')
  }

  // ── GPT Image 图生图 → multipart /v1/images/edits ──
  // ★ 自动重试：上游偶尔超时返回空图（completion_tokens=0 但 HTTP 200），最多重试 2 次
  if (image) {
    onProgress?.(0, '上传图片中...')
    const images = Array.isArray(image) ? image.filter(Boolean) : [image].filter(Boolean) as string[]
    if (!images.length) throw new Error('没有可用参考图片')
    const fields: Record<string, string | Blob | Blob[]> = {
      model, prompt, size, response_format: responseFormat,
    }
    const blobs: Blob[] = []
    for (const item of images) {
      if (item.startsWith('data:')) {
        blobs.push(dataUrlToBlob(item))
      } else {
        try { const imgRes = await safeFetch(item); blobs.push(await imgRes.blob()) }
        catch { throw new Error('无法加载参考图片') }
      }
    }
    fields.image = blobs

    let lastData: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) onProgress?.(attempt * 60, `第${attempt + 1}次尝试...`)
      lastData = await apiCallMultipart('/v1/images/edits', fields)
      const mediaUrl = extractMediaUrl(lastData, 'image')
      if (mediaUrl) return { url: mediaUrl, type: 'image' }
      console.warn(`[图生图] 第${attempt + 1}次返回空图，重试...`, lastData)
    }
    throw emptyImageResultError('GPT Image 2 图生图', lastData)
  }

  // ── GPT Image 文生图 → JSON /v1/images/generations ──
  // ★ 同样加重试保护
  const body: any = { model, prompt, n: 1, size, response_format: responseFormat }
  let lastGenData: any = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) onProgress?.(attempt * 30, `第${attempt + 1}次尝试...`)
    else onProgress?.(0, '提交中')
    lastGenData = await apiCall('/v1/images/generations', body, 'POST', model)
    const mediaUrl = extractMediaUrl(lastGenData, 'image')
    if (mediaUrl) return { url: mediaUrl, type: 'image' }
    console.warn(`[文生图] 第${attempt + 1}次返回空图，重试...`, lastGenData)
  }
  throw emptyImageResultError('GPT Image 2 文生图', lastGenData)
}

/**
 * 生成视频 — Grok 便利入口 / RunningHub 标准模型
 */
export async function generateVideo(
  params: VideoGenParams,
  onProgress?: (elapsed: number, status: string) => void,
): Promise<MediaResult> {
  const { model, prompt, aspectRatio, resolution, duration, imageUrl, imageUrls } = params
  assertMediaModelExecutable(model, 'video')
  const requestedCapability = getMediaModel(model)
  const upstreamModel = requestedCapability?.model || model
  await ensureConfig()

  // ── RunningHub 全系列 → rh-adapter 统一处理 ──
  // 适配器接收标准 OpenAI-格式 body，内部翻译为 RH 原生 API
  const initialImages = filterSafeImageUrls(imageUrls, imageUrl)
  const rhModel = model === 'grok-video-3'
    ? (initialImages.length ? 'rh-grok-image-video' : 'rh-grok-text-video')
    : model
  const rhCap = getMediaModel(rhModel)
  const isRhVideoModel = (rhCap?.provider === 'gateway-video' || rhCap?.provider === 'gateway-image') && rhCap.webappId
  if (isRhVideoModel || model === 'grok-video-3') {
    onProgress?.(0, '提交 RunningHub...')
    const rhBody: any = { model: rhModel, prompt }
    if (aspectRatio) { rhBody.ratio = aspectRatio; rhBody.aspect_ratio = aspectRatio }
    if (resolution) rhBody.resolution = resolution
    if (duration != null) rhBody.duration = String(duration)
    const allImages = initialImages
    if (allImages.length) rhBody.images = allImages
    if (params.videoUrl) rhBody.video = params.videoUrl
    if (params.audioUrl) rhBody.audio = params.audioUrl
    if (params.text) rhBody.text = params.text
    if (params.width) rhBody.width = params.width
    if (params.height) rhBody.height = params.height
    if (params.value) rhBody.value = params.value
    const officialNodeInfoList = buildOfficialRhAiAppVideoNodeInfoList(params, allImages)
    if (officialNodeInfoList) rhBody.nodeInfoList = officialNodeInfoList

    // RH 视频走 /rh/submit/ 直连 rh-adapter（绕过 NewAPI 异步包装，保留数字 task_id）
    const resData = await apiCall('/rh/submit/v1/videos', rhBody, 'POST', model)
    const syncUrl = extractMediaUrl(resData, 'video')
    if (syncUrl) return { url: syncUrl, type: 'video' }
    // rh-adapter 返回 {task_id: "数字", status: "processing"}，轮询走 /rh/tasks/ 直连
    const taskId = extractTaskId(resData)
    if (resData?.id || taskId) {
      const pollId = taskId || resData.id
      const pollUrl = buildRhTaskPollUrl(pollId, resData)
      await params.onSubmitted?.({ taskId: pollId, pollUrl, pollKind: 'video' })
      const mediaUrl = await pollTask(pollUrl, 'video', onProgress, 600, CREATION_TASK_POLL_INTERVAL_MS)
      return { url: mediaUrl, type: 'video', taskId: pollId, pollUrl, pollKind: 'video' as const }
    }
    throw new Error('RH 视频提交失败')
  }

  // ── Seedance 2.0 → NewAPI direct Seedance proxy, bypassing upstream progress parsing ──
  const isSeedanceVideo = upstreamModel === 'seedance-2-0-pro'
  if (isSeedanceVideo) {
    const body: any = {
      model: upstreamModel,
      prompt,
      duration: Number(duration || 5),
      ratio: aspectRatio || '16:9',
      generate_audio: true,
    }
    if (resolution) body.resolution = String(resolution).toLowerCase()
    const safeImages = filterSafeImageUrls(imageUrls, imageUrl).slice(0, 9)
    const uploadedImages = await Promise.all(safeImages.map(uploadCreationAsset))
    uploadedImages.forEach((url, index) => {
      body[`image_file_${index + 1}`] = url
    })

    const data = await apiCall('/api/seedance/v1/videos', body, 'POST', model)
    let mediaUrl = extractMediaUrl(data, 'video')
    const taskId = extractTaskId(data)
    const pollUrl = taskId ? `/api/seedance/v1/videos/${encodeURIComponent(taskId)}` : undefined
    if (taskId && pollUrl) await params.onSubmitted?.({ taskId, pollUrl, pollKind: 'video' })
    if (!mediaUrl && pollUrl) mediaUrl = await pollTask(pollUrl, 'video', onProgress, 600, CREATION_TASK_POLL_INTERVAL_MS)
    if (!mediaUrl) throw new Error('视频生成失败')
    return { url: mediaUrl, type: 'video', taskId, pollUrl, pollKind: 'video' as const }
  }

  // ── Veo / 其他 NewAPI 视频模型 → /v1/videos ──
  const body: any = { model: upstreamModel, prompt }
  if (aspectRatio) body.ratio = aspectRatio
  if (resolution) body.resolution = resolution.toUpperCase()
  if (duration) body.duration = Number(duration)
  const safeImages = filterSafeImageUrls(imageUrls, imageUrl)
  if (safeImages.length) body.images = safeImages
  if (params.videoUrl) body.video_url = params.videoUrl
  if (params.audioUrl) body.audio_url = params.audioUrl

  // DoubaoVideo (Seedance) 走 NewAPI 专用任务接口 /v1/video/generations
  const isDoubaoVideo = isDoubaoVideoModel(model, upstreamModel)
  if (isDoubaoVideo) {
    body.metadata = {
      ...(body.metadata || {}),
    }
    if (aspectRatio) body.metadata.ratio = aspectRatio
    if (resolution) body.metadata.resolution = String(resolution).toLowerCase()
  }
  const videoPath = isDoubaoVideo ? '/v1/video/generations' : '/v1/videos'

  const data = await apiCall(videoPath, body, 'POST', model)
  let mediaUrl = extractMediaUrl(data, 'video')
  const taskId = extractTaskId(data)
  if (!mediaUrl) {
    if (taskId) {
      const pollUrl = isDoubaoVideo
        ? `/v1/video/generations/${taskId}`
        : `/v1/videos/${taskId}`
      await params.onSubmitted?.({ taskId, pollUrl, pollKind: 'video' })
      mediaUrl = await pollTask(pollUrl, 'video', onProgress, 600, 10000)
    }
  }
  if (!mediaUrl) throw new Error('视频生成失败')
  return { url: mediaUrl, type: 'video', taskId, pollUrl: taskId ? (isDoubaoVideo ? `/v1/video/generations/${taskId}` : `/v1/videos/${taskId}`) : undefined, pollKind: 'video' as const }
}

function isDoubaoVideoModel(model: string, upstreamModel: string): boolean {
  const candidates = [model, upstreamModel].map(value => String(value || '').trim().toLowerCase())
  return candidates.some(value =>
    value.startsWith('doubao-') ||
    value === 'seedance-2.0' ||
    value === 'seedance-2.0-fast'
  )
}

/**
 * 生成音频 — Suno 自定义歌曲 / RunningHub 声音工作流
 * POST /suno/submit/music → GET /suno/fetch/:id
 */
export async function generateAudio(
  params: string | AudioGenParams,
  onProgress?: (elapsed: number, status: string) => void,
): Promise<MediaResult> {
  const audioParams: AudioGenParams = typeof params === 'string' ? { prompt: params } : params
  const model = audioParams.model || 'suno_music'
  assertMediaModelExecutable(model, 'audio')
  await ensureConfig()
  const key = storedApiKey()
  if (!key) throw new Error('请先登录韭菜盒子账号')

  const capability = getMediaModel(model)
  if (capability?.provider === 'gateway-audio' && capability.webappId?.startsWith('rhart-audio/')) {
    onProgress?.(0, '提交 RunningHub...')
    const makeInstrumental = String(audioParams.makeInstrumental ?? false)
    const rhBody: any = { model }
    if (model === 'rh-suno-v55-single') {
      rhBody.title = audioParams.title || '未命名歌曲'
      rhBody.description = audioParams.prompt
      rhBody.make_instrumental = makeInstrumental
    } else if (model === 'rh-suno-v55-custom') {
      rhBody.title = audioParams.title || '未命名歌曲'
      rhBody.lyrics = audioParams.prompt
      rhBody.tags = audioParams.tags || ''
      rhBody.negative_tags = audioParams.negativeTags || ''
      rhBody.make_instrumental = makeInstrumental
    } else if (model === 'rh-suno-lyrics') {
      rhBody.prompt = audioParams.prompt
    } else {
      rhBody.prompt = audioParams.prompt
    }

    const submitData = await apiCall('/v1/audio/speech', rhBody, 'POST', model)
    const taskId = extractTaskId(submitData) || submitData?.id
    const isLyrics = model === 'rh-suno-lyrics'
    const syncText = isLyrics ? extractMediaText(submitData) : ''
    if (syncText) return { url: '', text: syncText, type: 'text' }
    const syncUrl = extractMediaUrl(submitData, 'audio')
    if (syncUrl) return { url: syncUrl, type: 'audio' }
    if (!taskId) throw new Error('Suno 未返回任务 ID')
    const pollUrl = buildRhTaskPollUrl(String(taskId), submitData)
    const pollKind = isLyrics ? 'text' as const : 'audio' as const
    await audioParams.onSubmitted?.({ taskId: String(taskId), pollUrl, pollKind })
    const result = await pollTask(pollUrl, pollKind, onProgress, 600, CREATION_TASK_POLL_INTERVAL_MS)
    if (isLyrics) return { url: '', text: result, type: 'text', taskId: String(taskId), pollUrl, pollKind }
    return { url: result, type: 'audio', taskId: String(taskId), pollUrl, pollKind }
  }

  // Step 1: 提交 → NewAPI /suno/submit/music
  const body = {
    prompt: audioParams.prompt,
    mv: audioParams.mv || 'chirp-fenix',
    title: audioParams.title || '未命名歌曲',
    tags: audioParams.tags || '',
    negative_tags: audioParams.negativeTags || '',
    generation_type: 'TEXT',
  }
  const submitData = await apiCall('/suno/submit/music', body, 'POST', model)

  // 提取 task_id — NewAPI 透传的异步任务返回格式
  const taskId = extractTaskId(submitData)
  if (!taskId) {
    // 也尝试 clips 格式（兼容）
    const clips = submitData?.clips || submitData?.data?.clips || []
    if (clips.length === 0) throw new Error('Suno 未返回任务 ID 或 clips')
    const clipId = clips[0]?.id
    if (clipId) {
      return await pollSunoByClipId(clipId)
    }
    throw new Error('Suno 未返回有效的任务标识')
  }
  const pollUrl = `/suno/fetch/${taskId}`
  await audioParams.onSubmitted?.({ taskId, pollUrl, pollKind: 'audio' })

  // Step 2: 轮询 → NewAPI /suno/fetch/:id
  const audioUrl = await pollTask(pollUrl, 'audio', onProgress, 600, 5000)
  return { url: audioUrl, type: 'audio', taskId, pollUrl, pollKind: 'audio' as const }
}

/** Fallback: 用 clip ID 直接轮询（兼容旧 API） */
async function pollSunoByClipId(clipId: string): Promise<MediaResult> {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const data = await apiCall(`/suno/fetch/${clipId}`, null, 'GET')
    const url = extractMediaUrl(data, 'audio')
    if (url) return { url, type: 'audio' }
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
