import { safeFetch } from '@/utils/httpClient'
import { getApiKey, initApiKey } from '@/services/newApiClient'
import { isAllowedCreationResultUrl } from '@/utils/urlSafety'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { getCreationApiBase } from '@/api/media-generation'
import { assertCreationSchema, validateCreationParams, canonicalCreationJson } from '../../../shared/creation-schema.mjs'
import type { CreationRunPlan, CreationOutputModality } from './creationMediaTypes'
import type { MediaResult } from '@/api/media-generation'

export interface CreationCapability {
  protocol_version: string
  schema_profile: string
  capability_id: string
  revision: string
  model: string
  display_name: string
  availability: 'available' | 'temporarily_unavailable' | 'retired'
  input_modalities: string[]
  output_modalities: string[]
  parameter_schema: Record<string, unknown>
  asset_slots: Array<{ name: string; modalities: string[]; min?: number; max?: number }>
  execution: { supports_cancel: boolean; recommended_poll_seconds?: number }
  pricing?: unknown
  presentation?: { featured?: boolean }
}
export interface CreationProtocolSnapshot {
  requestId: string
  capabilityId: string
  revision: string
  identity: string
  base: string
  params: Record<string, unknown>
  inputs: Record<string, Array<{ asset_id: string }>>
  prepared: boolean
  supportsCancel: boolean
  outputModality: CreationOutputModality
  declaredOutputModalities: string[]
  pollSeconds: number
  fingerprint: string
  assetSlots: CreationCapability['asset_slots']
}
interface ProtocolTask {
  task_id: string
  request_id: string
  capability_id: string
  revision: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled'
  outputs?: Array<{ output_id: string; kind: 'text' | 'file'; text?: string; modality?: string; mime_type: string; filename?: string }>
  error?: { code: string; message: string; retryable: boolean }
  recommended_poll_seconds?: number
}
export class CreationProtocolError extends Error {
  terminalCreationTask: boolean
  constructor(public status: number, public code: string, message: string, public retryAfter = 0) { super(message); this.terminalCreationTask = status >= 400 && status < 500 && ![408, 429].includes(status) }
}
export async function creationIdentity(base = getCreationApiBase(), key = getApiKey()): Promise<string> {
  const bytes = new TextEncoder().encode(`${base}\n${key}`)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}
const catalogCache = new Map<string, { etag: string; data: unknown }>()
async function request<T>(base: string, path: string, key: string, options: RequestInit = {}): Promise<T> {
  if (!key) throw new CreationProtocolError(401, 'missing_key', '请先配置模型调用 Key')
  const cacheKey = `${await creationIdentity(base, key)}:${path}`
  const cached = !options.method && path.startsWith('/v1/creation/capabilities') ? catalogCache.get(cacheKey) : undefined
  const response = await safeFetch(`${base}${path}`, {
    ...options, headers: { Authorization: `Bearer ${key}`, ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(cached ? { 'If-None-Match': cached.etag } : {}), ...options.headers },
  })
  if (response.status === 304 && cached) return cached.data as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const retry = response.headers.get('Retry-After') || ''
    const seconds = Number(retry) || Math.max(0, (Date.parse(retry) - Date.now()) / 1000) || 0
    throw new CreationProtocolError(response.status, data.code || data.error?.code || 'creation_http_error', data.message || data.error?.message || `影音服务 HTTP ${response.status}`, Math.min(300, seconds))
  }
  if (!options.method && path.startsWith('/v1/creation/capabilities') && response.headers.get('ETag')) {
    if (catalogCache.size > 100) catalogCache.clear()
    catalogCache.set(cacheKey, { etag: response.headers.get('ETag')!, data })
  }
  return data as T
}
export async function listDynamicCreationCapabilities(params: Record<string, unknown> = {}) {
  await initApiKey()
  const base = getCreationApiBase(), key = getApiKey()
  const query = new URLSearchParams()
  for (const name of ['cursor', 'query', 'input_modality', 'output_modality']) if (params[name]) query.set(name, String(params[name]))
  query.set('limit', String(Math.min(100, Math.max(1, Number(params.limit) || 20))))
  const result = await request<{ protocol_version: string; catalog_revision: string; items: Array<Omit<CreationCapability, 'parameter_schema' | 'asset_slots' | 'execution'>>; next_cursor: string | null }>(base, `/v1/creation/capabilities?${query}`, key)
  if (result.protocol_version !== '1.0' || !Array.isArray(result.items)) throw new Error('影音服务目录协议不受支持')
  return result
}
export async function getDynamicCreationCapability(id: string, revision?: string): Promise<CreationCapability> {
  await initApiKey()
  const capability = await request<CreationCapability>(getCreationApiBase(), `/v1/creation/capabilities/${encodeURIComponent(id)}${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`, getApiKey())
  if (capability.protocol_version !== '1.0' || capability.schema_profile !== 'creation-params-v1') throw new Error('该能力使用的协议或参数合同需要更新 App')
  assertCreationSchema(capability.parameter_schema)
  return capability
}
export async function buildDynamicCreationPlan(capability: CreationCapability, requestId: string, params: Record<string, unknown>): Promise<CreationRunPlan> {
  if (capability.availability !== 'available') throw new Error('该影音能力当前不可执行')
  const declared = capability.output_modalities[0]!
  const output = (['image', 'video', 'audio', 'model3d', 'text'].includes(declared) ? declared : 'file') as CreationOutputModality
  if (!capability.output_modalities.length) throw new Error('能力缺少输出类型')
  const normalized = { ...params }
  for (const slot of capability.asset_slots) delete normalized[slot.name]
  const errors = validateCreationParams(capability.parameter_schema, normalized)
  if (errors.length) throw new Error(errors.join('；'))
  for (const slot of capability.asset_slots) {
    const values = params[slot.name] === undefined ? [] : Array.isArray(params[slot.name]) ? params[slot.name] as unknown[] : [params[slot.name]]
    if (values.length < (slot.min || 0) || values.length > (slot.max ?? 100)) throw new Error(`${slot.name} 素材数量超出合同限制`)
    if (values.some(value => typeof value !== 'string' && !(value && typeof value === 'object' && typeof (value as { asset_id?: unknown }).asset_id === 'string'))) throw new Error(`${slot.name} 需要素材引用或 asset_id`)
  }
  const base = getCreationApiBase()
  return {
    modelId: capability.capability_id, model: capability.model, label: capability.display_name,
    task: output === 'text' || output === 'file' ? 'ai-app' : output, source: 'newapi-direct', route: 'newapi-direct',
    upstreamFamily: 'unknown', apiStyle: 'creation-protocol', mode: 'workflow', contractStatus: 'partial',
    endpoint: '/v1/creation/tasks', usesRhAdapter: false, pollKind: 'newapi-task', assetFlow: 'newapi-upload', mediaInputTransport: 'url',
    submitSummary: capability.display_name,
    debug: { referenceImageCount: 0, referenceVideoCount: 0, referenceAudioCount: 0, normalizedParams: params },
    protocol: {
      requestId, capabilityId: capability.capability_id, revision: capability.revision, base, identity: await creationIdentity(base),
      assetSlots: structuredClone(capability.asset_slots), params: normalized, inputs: {}, prepared: capability.asset_slots.every(slot => params[slot.name] === undefined),
      supportsCancel: capability.execution.supports_cancel, outputModality: output, declaredOutputModalities: capability.output_modalities,
      pollSeconds: Math.min(60, Math.max(2, capability.execution.recommended_poll_seconds || 3)),
      fingerprint: await creationIdentity('request-body', canonicalCreationJson({ capability: capability.capability_id, revision: capability.revision, params })),
    },
  }
}
export async function prepareDynamicInputs(plan: CreationRunPlan, key: string, signal?: AbortSignal): Promise<CreationProtocolSnapshot> {
  const snapshot = structuredClone(plan.protocol!)
  if (snapshot.prepared) return snapshot
  for (const slot of snapshot.assetSlots) {
    const value = plan.debug.normalizedParams[slot.name]
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
    snapshot.inputs[slot.name] = []
    for (const reference of values) {
      if (reference && typeof reference === 'object' && typeof (reference as { asset_id?: unknown }).asset_id === 'string') {
        snapshot.inputs[slot.name].push(reference as { asset_id: string }); continue
      }
      let media = reference
      if (typeof media === 'string' && media.startsWith('https://') && isAllowedCreationResultUrl(media)) {
        if (isTauriRuntime()) {
          const { downloadCreationMediaBase64 } = await import('@/utils/creationMediaCache')
          const downloaded = await downloadCreationMediaBase64(media, undefined, signal)
          if (downloaded.status !== 200 || !downloaded.data_base64) throw new Error('参考素材下载失败')
          const mime = downloaded.headers['content-type'] || downloaded.headers['Content-Type'] || 'application/octet-stream'
          media = `data:${mime.split(';')[0]};base64,${downloaded.data_base64}`
        } else {
          const downloaded = await safeFetch(media, {signal})
          if (!downloaded.ok) throw new Error('参考素材下载失败')
          const blob = await downloaded.blob()
          if (blob.size > 20 * 1024 * 1024) throw new Error('参考素材不能超过 20 MB')
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
          media = `data:${blob.type};base64,${btoa(binary)}`
        }
      }
      if (typeof media !== 'string' || !media.startsWith('data:')) throw new Error('动态影音素材需要本机路径、data URL、公共 HTTPS URL 或 asset_id')
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(media)
      if (!match || media.length > 72_000_000) throw new Error('素材格式无效或过大')
      const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
      if (bytes.length > 20 * 1024 * 1024 || !slot.modalities.includes(match[1]!.split('/')[0]!)) throw new Error('素材大小或类型不符合能力合同')
      const body = new FormData()
      body.append('file', new Blob([bytes], { type: match[1] }), 'reference')
      const asset = await request<{ asset_id: string }>(snapshot.base, '/v1/creation/assets', key, { method: 'POST', body, signal })
      if (!asset.asset_id) throw new Error('素材上传未返回 asset_id')
      snapshot.inputs[slot.name].push({ asset_id: asset.asset_id })
    }
  }
  snapshot.prepared = true
  return snapshot
}
const taskPath = (id: string) => `/v1/creation/tasks/${encodeURIComponent(id)}`
async function wait(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('已停止跟踪', 'AbortError')); return }
    const aborted = () => { clearTimeout(timer); reject(new DOMException('已停止跟踪', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve() }, ms)
    signal?.addEventListener('abort', aborted, { once: true })
  })
}
export async function executeDynamicCreation(snapshot: CreationProtocolSnapshot, key: string, onSubmitted: (result: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>, onProgress?: (elapsed: number, status: string) => void, signal?: AbortSignal, upstreamId?: string): Promise<MediaResult> {
  if (await creationIdentity(snapshot.base, key) !== snapshot.identity) throw new Error('该任务需要原提交身份的 Key')
  let task: ProtocolTask
  if (upstreamId) task = await request(snapshot.base, taskPath(upstreamId), key, { signal })
  else {
    try { task = await request(snapshot.base, `/v1/creation/tasks/by-request/${encodeURIComponent(snapshot.requestId)}`, key, { signal }) }
    catch (error) {
      if (!(error instanceof CreationProtocolError) || error.status !== 404) throw error
      if (!snapshot.prepared) throw new Error('提交结果未登记且素材未准备完成，请使用原 requestId 和素材恢复')
      task = await request(snapshot.base, '/v1/creation/tasks', key, { method: 'POST', body: JSON.stringify({ request_id: snapshot.requestId, capability_id: snapshot.capabilityId, revision: snapshot.revision, params: snapshot.params, inputs: snapshot.inputs }), signal })
    }
  }
  function assertTask(value: ProtocolTask) {
    if (!value || !/^[A-Za-z0-9._:-]{1,120}$/.test(value.task_id) || !['queued','running','succeeded','failed','cancel_requested','cancelled'].includes(value.status) || value.request_id !== snapshot.requestId || value.capability_id !== snapshot.capabilityId || value.revision !== snapshot.revision) throw new Error('影音任务响应不符合冻结合同')
  }
  assertTask(task)
  if (!task.task_id || task.request_id !== snapshot.requestId || task.capability_id !== snapshot.capabilityId || task.revision !== snapshot.revision) throw new Error('影音任务身份不符合冻结合同')
  const pollKind = snapshot.outputModality === 'model3d' || snapshot.outputModality === 'file' ? 'video' : snapshot.outputModality
  await onSubmitted({ taskId: task.task_id, pollUrl: taskPath(task.task_id), pollKind })
  const start = Date.now()
  while (!['succeeded', 'failed', 'cancelled'].includes(task.status)) {
    if (task.error?.code === 'submission_unknown') throw new Error(task.error.message)
    if (Date.now() - start > 3_600_000) throw new Error('已保留任务，稍后恢复查询')
    onProgress?.((Date.now() - start) / 1000, task.status === 'queued' ? '排队中' : task.status === 'cancel_requested' ? '等待远程取消' : '生成中')
    await wait(Math.min(300, Math.max(2, task.recommended_poll_seconds || snapshot.pollSeconds)) * 1000, signal)
    try { task = await request(snapshot.base, taskPath(task.task_id), key, { signal }); assertTask(task) }
    catch (error) {
      if (!(error instanceof CreationProtocolError) || error.status !== 429) throw error
      await wait(Math.max(3, error.retryAfter) * 1000, signal)
    }
  }
  if (task.status === 'cancelled') throw new CreationProtocolError(409, 'remote_cancelled', task.error?.message || '上游已取消')
  if (task.status !== 'succeeded') throw Object.assign(new Error(task.error?.message || '上游执行失败'), { terminalCreationTask: true })
  const outputs = task.outputs || []
  if (!outputs.length || outputs.length > 100) throw new Error('影音任务没有有效输出或输出过多')
  const results = outputs.map(output => {
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(output.output_id)) throw new Error('结果缺少稳定 output_id')
    if (output.kind === 'text' && snapshot.declaredOutputModalities.includes('text') && output.text?.trim()) return { outputId: output.output_id, type: 'text' as const, url: '', text: output.text, mimeType: output.mime_type }
    if (output.kind !== 'file' || !output.modality || !snapshot.declaredOutputModalities.includes(output.modality)) throw new Error('结果类型不符合能力合同')
    const type = (['image', 'video', 'audio', 'model3d'].includes(output.modality) ? output.modality : 'file') as CreationOutputModality
    return { outputId: output.output_id, type, mimeType: output.mime_type, url: `${snapshot.base}${taskPath(task.task_id)}/outputs/${encodeURIComponent(output.output_id)}/content` }
  })
  if (new Set(results.map(result => result.outputId)).size !== results.length) throw new Error('结果 output_id 重复')
  return { ...results[0]!, taskId: task.task_id, outputs: results }

}

export async function cancelDynamicCreation(snapshot: CreationProtocolSnapshot, taskId: string, key: string): Promise<{ status: string }> {
  if (!snapshot.supportsCancel) throw new Error('此能力不支持远程取消；可停止跟踪，但不表示退款')
  if (await creationIdentity(snapshot.base, key) !== snapshot.identity) throw new Error('取消任务需要原提交身份')
  return request(snapshot.base, `${taskPath(taskId)}/cancel`, key, { method: 'POST', body: '{}' })
}
