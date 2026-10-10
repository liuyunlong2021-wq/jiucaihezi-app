import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFile, writeFile, rename, mkdir, stat, link, unlink, readdir, statfs } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assertCreationSchema, validateCreationParams, canonicalCreationJson } from '../../shared/creation-schema.mjs'

const terminal = new Set(['succeeded', 'failed', 'cancelled'])
const hash = value => createHash('sha256').update(value).digest('hex')
const idPattern = /^[A-Za-z0-9._:-]{1,120}$/
const error = (status, code, message) => Object.assign(new Error(message), { status, code })
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)) }
const pick = (data, path) => path ? String(path).split('.').reduce((value, key) => value?.[key], data) : data
const outputSpecs = adapter => Array.isArray(adapter.outputs) ? adapter.outputs : [adapter.outputs]
const publicCapability = entry => structuredClone(entry.capability)
async function responseJson(response) {
  const reader = response.body?.getReader()
  if (!reader) throw error(502, 'empty_response', '上游响应为空')
  const chunks = []; let size = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 64 * 1024 * 1024) throw error(502, 'response_too_large', '上游响应过大，已保留原任务；请核实结果')
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw error(502, 'invalid_response', '上游没有返回有效 JSON') }
  } finally { if (size > 64 * 1024 * 1024) await reader.cancel().catch(() => {}); reader.releaseLock() }
}
// Server-only data templates compose established public NewAPI protocols. Values
// come solely from the validated params/owned asset URLs; no JS execution.
function composeBody(template, params, slots, model, asset, depth = 0) {
  if (depth > 24) throw error(503, 'adapter_invalid', '适配模板嵌套过深')
  if (Array.isArray(template)) return template.map(item => composeBody(item, params, slots, model, asset, depth + 1))
  if (!template || typeof template !== 'object') return template
  if (Object.hasOwn(template, '$param')) return params[template.$param]
  if (Object.hasOwn(template, '$model')) return model
  if (Object.hasOwn(template, '$asset')) return asset
  if (Object.hasOwn(template, '$slot')) return slots[template.$slot] || []
  if (Object.hasOwn(template, '$map_slot')) return (slots[template.$map_slot] || []).map(url => composeBody(template.item, params, slots, model, url, depth + 1))
  if (Object.hasOwn(template, '$concat')) return template.$concat.flatMap(item => composeBody(item, params, slots, model, asset, depth + 1))
  return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, composeBody(value, params, slots, model, asset, depth + 1)]))
}
function publicTask(task) {
  const { owner, fingerprint, adapter, sourceOutputs, upstreamId, inputs, params, outputModalities, ...output } = task
  return output
}
async function atomicJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx', flush: true })
  await rename(temporary, path)
}
async function createJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(data), {mode:0o600, flag:'wx', flush:true})
  try { await link(temporary, path) } finally { await unlink(temporary) }
}
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function body(req, max = 1_048_576) {
  let size = 0
  const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > max) throw error(413, 'body_too_large', '请求或素材过大'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
function pathForAdapter(path, id) {
  const result = String(path || '').replace('{id}', encodeURIComponent(id || ''))
  if (!/^\/(?:v1|v2|rh|suno|mj|api\/seedance)\//.test(result) || result.startsWith('/v1/creation/') || result.includes('..') || /[\r\n?#]/.test(result)) throw error(503, 'adapter_invalid', '执行适配路径无效')
  return result
}
export function assertCreationCapabilityEntry(entry) {
  const c = entry.capability, a = entry.adapter
  if (!c || c.protocol_version !== '1.0' || c.schema_profile !== 'creation-params-v1' || !c.capability_id || !c.revision || !c.model || !c.display_name || !['available','temporarily_unavailable','retired'].includes(c.availability)) throw new Error('无效能力身份或协议')
  if (!Array.isArray(c.input_modalities) || !Array.isArray(c.output_modalities) || !c.output_modalities.length || !Array.isArray(c.asset_slots) || !c.execution) throw new Error('能力类型/素材合同不完整')
  assertCreationSchema(c.parameter_schema)
  if (!a || !a.submit || !a.outputs || !['json', 'multipart'].includes(a.submit.encoding || 'json')) throw new Error('缺少服务端适配合同')
  pathForAdapter(a.submit.path)
  if (outputSpecs(a).length > 10) throw new Error('输出适配器数量过多')
  for (const output of outputSpecs(a)) {
    if (!output || !c.output_modalities.includes(output.text_path ? 'text' : output.modality) || typeof output.mime_type !== 'string' || !/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(output.mime_type)) throw new Error('输出适配器不符合能力类型')
    if (output.binary && outputSpecs(a).length !== 1) throw new Error('二进制响应只能有一个输出描述')
  }
  if (a.poll) { pathForAdapter(a.poll.path, 'example'); if (!a.poll.status_path || !Array.isArray(a.poll.succeeded_states) || !a.poll.succeeded_states.length) throw new Error('异步适配器必须声明真实终态') }
  if (c.execution.supports_cancel !== Boolean(a.cancel)) throw new Error('远程取消声明不符合适配器')
  if (a.cancel) pathForAdapter(a.cancel.path, 'example')
  for (const slot of c.asset_slots) if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(slot.name) || !Array.isArray(slot.modalities) || !Number.isInteger(slot.max) || slot.max < 0 || slot.max > 100 || (slot.min ?? 0) < 0 || (slot.min ?? 0) > slot.max) throw new Error('素材槽位合同无效')
}
// Artifact URLs are never returned to the App. Only exact administrator-approved
// HTTPS domains may be fetched, without API credentials; reject private DNS and redirects.
function publicAddress(address) {
  if (address.includes(':')) return !/^(?:::|fc|fd|fe[89ab])/i.test(address) && !address.toLowerCase().includes('::ffff:')
  const [a,b] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 198 && b >= 18 && b <= 19) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)))
}
export async function createCreationProtocolServer(config) {
  if (typeof config.secret !== 'string' || config.secret.length < 32) throw new Error('执行服务需要至少 32 字符的内部密钥')
  const root = resolve(config.root), manifestPath = resolve(config.manifest)
  await mkdir(root, { recursive: true, mode: 0o700 })
  let cachedBytes = 0
  for (const name of await readdir(root)) if (name.endsWith('.bin')) cachedBytes += (await stat(join(root, name))).size
  let manifest
  let manifestStamp = ''
  const busy = new Set()
  const locks = new Map()
  async function locked(key, operation) {
    const previous = locks.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(operation)
    locks.set(key, next)
    try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
  }
  async function cacheOutput(path, data) {
    return locked('output-cache-capacity', async () => {
      const limit = config.maxCacheBytes || 10 * 1024 * 1024 * 1024
      const disk = await statfs(root)
      if (cachedBytes + data.length > limit || disk.bavail * disk.bsize < data.length + 1024 * 1024 * 1024) throw error(507, 'output_storage_full', '结果缓存空间不足，请保留任务 ID 联系管理员')
      await writeFile(path, data, {mode:0o600, flag:'wx', flush:true})
      cachedBytes += data.length
    })
  }
  async function catalog() {
    const stamp = await stat(manifestPath)
    const nextStamp = `${stamp.mtimeMs}:${stamp.size}`
    if (nextStamp !== manifestStamp) {
      const next = await readJson(manifestPath)
      if (!Array.isArray(next.entries) || next.entries.length > 10_000) throw new Error('无效能力目录')
      const identities = new Set(), currentIds = new Set()
      for (const entry of next.entries) { assertCreationCapabilityEntry(entry); const key = `${entry.capability.capability_id}@${entry.capability.revision}`; if (identities.has(key)) throw new Error('重复合同版本'); identities.add(key); if (entry.current !== false) { if (currentIds.has(entry.capability.capability_id)) throw new Error('同一能力只能有一个当前版本'); currentIds.add(entry.capability.capability_id) } }
      // Publishing a changed definition under the same revision is forbidden even across restarts.
      const revisionsPath = join(root, 'revisions.json')
      let revisions = Object.create(null)
      try { revisions = await readJson(revisionsPath) } catch (e) { if (e.code !== 'ENOENT') throw e }
      for (const entry of next.entries) {
        const key = hash(`${entry.capability.capability_id}@${entry.capability.revision}`), digest = hash(canonicalCreationJson({ capability: entry.capability, adapter: entry.adapter }))
        if (revisions[key] && revisions[key] !== digest) throw new Error('已发布 revision 不允许原地修改')
        revisions[key] = digest
      }
      await atomicJson(revisionsPath, revisions)
      manifest = { ...next, catalog_revision: hash(canonicalCreationJson(next)) }
      manifestStamp = nextStamp
    }
    return manifest
  }
  async function authenticate(req) {
    const claim = Buffer.from(String(req.headers['x-jc-creation-secret'] || '')), expected = Buffer.from(config.secret)
    if (claim.length !== expected.length || !timingSafeEqual(claim, expected)) throw error(401, 'unauthorized', '请求必须经过 NewAPI 鉴权')
    const identity = String(req.headers['x-jc-creation-identity'] || '')
    if (!/^\d+:\d+$/.test(identity) || !req.headers.authorization?.startsWith('Bearer ')) throw error(401, 'unauthorized', '调用身份无效')
    let models
    try { models = JSON.parse(String(req.headers['x-jc-creation-models'] || '')) } catch { throw error(403, 'permission_unknown', '无法核实模型权限') }
    if (!Array.isArray(models) || !models.every(value => typeof value === 'string')) throw error(403, 'permission_unknown', '无法核实模型权限')
    return { owner: hash(identity), authorization: req.headers.authorization, models: new Set(models), clientIP: String(req.headers['x-jc-creation-client-ip'] || '') }
  }
  async function upstream(auth, path, init = {}) {
    const response = await fetch(`${config.newapiBase.replace(/\/$/, '')}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(660_000), headers: { ...init.headers, Authorization: auth.authorization, 'X-Forwarded-For': auth.clientIP } })
    if (!response.ok) throw error(response.status, 'upstream_http_error', `NewAPI 执行 HTTP ${response.status}`)
    return response
  }
  const taskFile = id => { if (!idPattern.test(id)) throw error(404, 'task_not_found', '未找到任务'); return join(root, `${id}.json`) }
  async function loadTask(id, auth) {
    let task
    try { task = await readJson(taskFile(id)) } catch (e) { if (e.code === 'ENOENT') throw error(404, 'task_not_found', '未找到任务'); throw e }
    if (task.owner !== auth.owner) throw error(404, 'task_not_found', '未找到任务')
    return task
  }
  async function saveTask(task) { task.updated_at = new Date().toISOString(); await atomicJson(taskFile(task.task_id), task) }
  async function extract(task, payload, response) {
    if (payload?.error || payload?.success === false) throw error(502, 'upstream_failed', '上游返回执行错误')
    const state = task.adapter.poll?.status_path ? pick(payload, task.adapter.poll.status_path) : undefined
    if (task.adapter.poll?.failed_states?.includes(String(state))) throw error(502, 'upstream_failed', '上游生成失败')
    if (task.adapter.poll?.cancelled_states?.includes(String(state))) { task.status = 'cancelled'; return }
    const hasState = task.adapter.poll?.status_path && state !== undefined
    if (task.upstreamId && task.adapter.poll?.status_path && state === undefined) return
    if (hasState && !task.adapter.poll.succeeded_states?.includes(String(state))) return
    const outputs = [], sources = []
    for (const [specIndex, spec] of outputSpecs(task.adapter).entries()) {
      const rows = spec.items_path ? pick(payload, spec.items_path) : [payload]
      if (Array.isArray(rows) && rows.length > 100) throw error(502, 'output_invalid', '输出数量超过协议限制')
      const values = response && spec.binary ? [null] : Array.isArray(rows) ? rows : rows ? [rows] : []
      for (const [index, row] of values.entries()) {
        const outputId = `out_${specIndex + 1}_${index + 1}`, modality = spec.modality
        if (spec.text_path) {
          const text = pick(row, spec.text_path)
          if (typeof text === 'string' && text.trim()) outputs.push({ output_id: outputId, kind: 'text', text, mime_type: spec.mime_type || 'text/plain' })
        } else {
          const url = spec.url_path ? pick(row, spec.url_path) : undefined, b64 = spec.base64_path ? pick(row, spec.base64_path) : undefined
          if (response && spec.binary) {
            const data = Buffer.from(await response.arrayBuffer())
            if (!data.length || data.length > (config.maxOutputBytes || 512 * 1024 * 1024)) throw error(502, 'output_invalid', '文件为空或过大')
            await cacheOutput(join(root, `${task.task_id}_${outputId}.bin`), data)
            sources.push({ output_id: outputId, local: true })
          } else if (typeof b64 === 'string' && b64.length) {
            if (b64.length > 72_000_000 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw error(502, 'output_invalid', '结果编码无效或过大')
            const data = Buffer.from(b64, 'base64')
            if (!data.length) continue
            await cacheOutput(join(root, `${task.task_id}_${outputId}.bin`), data)
            sources.push({ output_id: outputId, local: true })
          } else if (typeof url === 'string' && url) sources.push({ output_id: outputId, url })
          else if (task.upstreamId && spec.content_path) sources.push({ output_id: outputId, path: pathForAdapter(spec.content_path, task.upstreamId) })
          else continue
          outputs.push({ output_id: outputId, kind: 'file', modality, mime_type: spec.mime_type, filename: `result-${index + 1}.${spec.extension || 'bin'}` })
        }
      }
    }
    if (outputs.length) { task.error = undefined; task.outputs = outputs; task.sourceOutputs = sources; task.status = 'succeeded' }
    else if (hasState && task.adapter.poll.succeeded_states?.includes(String(state))) throw error(502, 'empty_output', '上游完成但没有有效输出')
    else if (!task.upstreamId && !task.adapter.poll) throw error(502, 'empty_output', '同步请求没有返回有效输出')
  }
  async function submitUpstream(task, auth) {
    // A persistent execution claim is created before the durable running marker.
    // Even after a process crash or an accidental second replica, it cannot submit again.
    try { await writeFile(join(root, `${task.task_id}.claim`), '', {mode:0o600, flag:'wx', flush:true}) }
    catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (task.status === 'queued') { task.status='running'; task.error={code:'submission_unknown', message:'存在原提交记录，请核实上游状态；不会再次付费提交', retryable:true, request_id:task.request_id}; await saveTask(task) }
      return
    }
    const a = task.adapter.submit
    let payload = { ...(a.defaults || {}), ...task.params, model: task.model }
    const slotUrls = {}
    for (const [from, to] of Object.entries(a.rename || {})) if (Object.hasOwn(payload, from)) { payload[to] = payload[from]; delete payload[from] }
    for (const [slot, assets] of Object.entries(task.inputs)) {
      const urls = []
      for (const item of assets) {
        const asset = await readJson(join(root, `${item.asset_id}.json`))
        if (asset.owner !== auth.owner || asset.expires_at <= Date.now()) throw error(422, 'asset_expired', '素材已过期或不属于此身份')
        urls.push(asset.url)
      }
      slotUrls[slot] = urls
      payload[a.rename?.[slot] || slot] = a.scalar_slots?.includes(slot) ? urls[0] : urls
    }
    if (a.body_template) payload = composeBody(a.body_template, task.params, slotUrls, task.model)
    let requestBody, headers
    if (a.encoding === 'multipart') {
      const form = new FormData()
      for (const [key, value] of Object.entries(payload)) {
        if (Object.hasOwn(task.inputs, key) || Object.entries(a.rename || {}).some(([slot, field]) => field === key && Object.hasOwn(task.inputs, slot))) {
          for (const url of Array.isArray(value) ? value : [value]) {
            // Only platform-issued upload URLs. Original asset metadata is checked above.
            const assetResponse = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
            if (!assetResponse.ok) throw error(422, 'asset_unavailable', '无法读取参考素材')
            form.append(key, await assetResponse.blob(), 'reference')
          }
        } else if (value !== undefined) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
      }
      requestBody = form; headers = {}
    } else { requestBody = JSON.stringify(payload); headers = { 'Content-Type': 'application/json' } }
    task.status = 'running'
    await saveTask(task) // Durable ledger precedes every paid upstream request.
    const response = await upstream(auth, pathForAdapter(a.path), { method: 'POST', body: requestBody, headers })
    const data = outputSpecs(task.adapter).some(output => output.binary) ? undefined : await responseJson(response)
    const idPath = task.adapter.poll?.id_path || a.id_path
    const upstreamId = idPath ? pick(data, idPath) : undefined
    if (upstreamId !== undefined) { task.upstreamId = String(upstreamId); await saveTask(task) }
    await extract(task, data, response)
    if (task.status === 'running' && task.adapter.poll && !task.upstreamId) throw error(502, 'missing_upstream_id', '上游未返回恢复任务 ID')
    await saveTask(task)
  }
  async function poll(task, auth) {
    if (task.status === 'queued' && !busy.has(task.task_id)) {
      busy.add(task.task_id)
      void submitUpstream(task, auth).catch(async e => {
        task.error = {code:'submission_unknown', message:'提交结果未知，请保留 request_id，勿重复生成', retryable:true, request_id:task.request_id}
        if (e.status && e.status < 500 && ![408,429].includes(e.status)) {task.status='failed'; task.error={code:e.code,message:e.message,retryable:false,request_id:task.request_id}}
        await saveTask(task)
      }).catch(() => {}).finally(() => busy.delete(task.task_id))
      return task
    }
    if (!busy.has(task.task_id) && task.status === 'running' && !task.upstreamId && !task.error) {
      task.error = {code:'submission_unknown', message:'提交响应已丢失，请保留请求 ID 核实；不会再次付费提交', retryable:true, request_id:task.request_id}
      await saveTask(task)
    }
    if (terminal.has(task.status) || !task.upstreamId || !task.adapter.poll || busy.has(task.task_id)) return task
    const interval = Math.max(2, task.recommended_poll_seconds || 3) * 1000
    if (task.last_polled_at && Date.now() - task.last_polled_at < interval) return task
    busy.add(task.task_id)
    try {
      const response = await upstream(auth, pathForAdapter(task.adapter.poll.path, task.upstreamId))
      task.last_polled_at = Date.now()
      await extract(task, await responseJson(response))
      await saveTask(task)
    } catch (e) {
      if (['upstream_failed', 'empty_output'].includes(e.code)) { task.status = 'failed'; task.error = { code: e.code, message: e.message, retryable: false, request_id: task.request_id }; await saveTask(task) }
      // Transient read failures do not erase task identity or trigger another paid submit.
      else if (e.status === 429) throw e
    } finally { busy.delete(task.task_id) }
    return task
  }
  async function handler(req, res) {
    try {
      const auth = await authenticate(req)
      const url = new URL(req.url, 'http://executor'), parts = url.pathname.slice('/v1/creation/'.length).split('/').map(decodeURIComponent)
      if (!url.pathname.startsWith('/v1/creation/')) throw error(404, 'not_found', '未找到接口')
      const list = await catalog()
      const permitted = entry => auth.models.has(entry.capability.model)
      const current = list.entries.filter(entry => entry.current !== false && permitted(entry))
      if (req.method === 'GET' && parts[0] === 'capabilities') {
        if (parts.length > 1) {
          const revision = url.searchParams.get('revision')
          const available = (revision ? list.entries.filter(item => item.capability.revision === revision) : current).filter(permitted)
          const name = parts.slice(1).join('/')
          let entry = available.find(item => item.capability.capability_id === name)
          if (!entry) {
            const aliases = available.filter(item => item.capability.model === name)
            if (aliases.length > 1) throw error(409, 'capability_ambiguous', '同一模型有多个模式，请从目录选择 capability_id')
            entry = aliases[0]
          }
          if (!entry) throw error(404, 'capability_not_found', '未找到有权使用的能力')
          return json(res, 200, publicCapability(entry), { 'Cache-Control': 'private, max-age=0' })
        }
        const query = (url.searchParams.get('query') || '').toLowerCase()
        const filtered = current.filter(({capability:c}) => (!query || `${c.capability_id} ${c.model} ${c.display_name}`.toLowerCase().includes(query)) && (!url.searchParams.get('input_modality') || c.input_modalities.includes(url.searchParams.get('input_modality'))) && (!url.searchParams.get('output_modality') || c.output_modalities.includes(url.searchParams.get('output_modality')))).sort((a,b) => a.capability.capability_id.localeCompare(b.capability.capability_id))
        const viewRevision = hash(`${list.catalog_revision}:${auth.owner}:${canonicalCreationJson([...auth.models].sort())}:${url.searchParams.get('query') || ''}:${url.searchParams.get('input_modality') || ''}:${url.searchParams.get('output_modality') || ''}`)
        let offset = 0
        if (url.searchParams.get('cursor')) {
          let cursor; try { cursor = JSON.parse(Buffer.from(url.searchParams.get('cursor'), 'base64url').toString()) } catch { throw error(409, 'catalog_revision_conflict', '请重新查询目录') }
          if (cursor.revision !== viewRevision || !Number.isInteger(cursor.offset) || cursor.offset < 0) throw error(409, 'catalog_revision_conflict', '目录或权限已更新，请重新查询')
          offset = cursor.offset
        }
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20))
        const items = filtered.slice(offset, offset + limit).map(entry => { const {parameter_schema, asset_slots, execution, ...summary} = publicCapability(entry); return summary })
        const result = { protocol_version: '1.0', catalog_revision: viewRevision, items, next_cursor: offset + limit < filtered.length ? Buffer.from(JSON.stringify({revision:viewRevision, offset:offset+limit})).toString('base64url') : null }
        const etag = `"${hash(canonicalCreationJson(result))}"`
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=0' }); return res.end() }
        return json(res, 200, result, { ETag: etag, 'Cache-Control': 'private, max-age=0' })
      }
      if (req.method === 'POST' && parts.join('/') === 'assets') {
        const bytes = await body(req, 21 * 1024 * 1024)
        const form = await new Request('http://executor/assets', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] || '' }, body: bytes }).formData()
        const file = form.get('file')
        if (!(file instanceof Blob) || !file.size || file.size > 20 * 1024 * 1024 || !/^(image|video|audio)\//.test(file.type)) throw error(422, 'asset_invalid', '素材类型或大小不受支持')
        const forwarded = new FormData(); forwarded.append('file', file, 'reference')
        const uploaded = await responseJson(await upstream(auth, '/api/creations/uploads', { method: 'POST', body: forwarded }))
        if (typeof uploaded.url !== 'string' || !/^https:\/\/api\.jiucaihezi\.studio\/media\/creation\/[a-f0-9]{32}$/.test(uploaded.url)) throw error(502, 'asset_invalid', '平台素材地址无效')
        const asset = { asset_id: `asset_${randomUUID()}`, owner: auth.owner, url: uploaded.url, mime_type: file.type, size_bytes: file.size, expires_at: Number(uploaded.expires_at) * 1000 }
        await atomicJson(join(root, `${asset.asset_id}.json`), asset)
        const {owner, url:privateUrl, ...result} = asset
        return json(res, 200, result)
      }
      if (req.method === 'POST' && parts.join('/') === 'tasks') {
        let input; try { input = JSON.parse((await body(req)).toString()) } catch (e) { if (e.status) throw e; throw error(422, 'params_invalid', '请求必须是有效 JSON') }
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.request_id !== 'string' || !idPattern.test(input.request_id) || !input.params || typeof input.params !== 'object' || Array.isArray(input.params)) throw error(422, 'params_invalid', '请求 ID 或参数无效')
        const requestKey = hash(`${auth.owner}:${input.request_id}`)
        return await locked(requestKey, async () => {
          const fingerprint = hash(canonicalCreationJson(input)), indexPath = join(root, `request_${requestKey}.json`)
          try {
            const index = await readJson(indexPath), previous = await loadTask(index.task_id, auth)
            if (previous.fingerprint !== fingerprint) throw error(409, 'idempotency_conflict', '同一 request_id 已用于不同内容')
            return json(res, 200, publicTask(previous))
          } catch (e) { if (e.code !== 'ENOENT') throw e }
          try {
            const orphan = await loadTask(`ctask_${requestKey}`, auth)
            if (orphan.fingerprint !== fingerprint) throw error(409, 'idempotency_conflict', '同一请求 ID 内容冲突')
            await atomicJson(indexPath, {task_id:orphan.task_id})
            return json(res, 200, publicTask(orphan))
          } catch (e) { if (e.code !== 'task_not_found') throw e }
          const entry = current.find(item => item.capability.capability_id === input.capability_id)
          if (!entry) throw error(403, 'capability_forbidden', '当前 Key 无权使用此能力')
          if (busy.size >= 4) throw error(429, 'creation_busy', '当前创作提交繁忙，请保留原请求 ID 稍后再试')
          const c = entry.capability
          if (c.revision !== input.revision) throw error(409, 'capability_revision_conflict', '能力合同已更新，请重新读取参数')
          if (c.availability !== 'available') throw error(503, 'capability_unavailable', '能力当前不可用')
          if (c.asset_slots.some(slot => Object.hasOwn(input.params, slot.name))) throw error(422, 'params_invalid', '素材必须通过 inputs 提交')
          const errors = validateCreationParams(c.parameter_schema, input.params)
          if (errors.length) throw error(422, 'params_invalid', errors.join('；'))
          const inputs = input.inputs || {}
          if (typeof inputs !== 'object' || Array.isArray(inputs)) throw error(422, 'slot_invalid', 'inputs 必须是对象')
          if (Object.keys(inputs).some(name => !c.asset_slots.some(slot => slot.name === name))) throw error(422, 'slot_invalid', '未声明的素材槽位')
          for (const slot of c.asset_slots) {
            const assets = inputs[slot.name] || []
            if (!Array.isArray(assets) || assets.length < (slot.min || 0) || assets.length > slot.max) throw error(422, 'asset_count_invalid', '素材数量不符合合同')
            for (const item of assets) {
              if (!item || typeof item.asset_id !== 'string' || !/^asset_[a-f0-9-]{36}$/.test(item.asset_id)) throw error(422, 'asset_invalid', '素材 ID 无效')
              let asset; try { asset = await readJson(join(root, `${item.asset_id}.json`)) } catch { throw error(422, 'asset_invalid', '素材不存在') }
              if (asset.owner !== auth.owner || asset.expires_at <= Date.now() || !slot.modalities.includes(asset.mime_type.split('/')[0])) throw error(422, 'asset_invalid', '素材已过期、类型不符或无权使用')
            }
          }
          const task = { task_id:`ctask_${requestKey}`, request_id:input.request_id, capability_id:c.capability_id, revision:c.revision, model:c.model, owner:auth.owner, fingerprint, params:input.params, inputs, adapter:entry.adapter, outputModalities:c.output_modalities, status:'queued', created_at:new Date().toISOString(), recommended_poll_seconds:c.execution.recommended_poll_seconds || 3, billing:{status:'unknown'}, outputs:[] }
          task.updated_at = task.created_at
          try { await createJson(taskFile(task.task_id), task) }
          catch (e) {
            if (e.code !== 'EEXIST') throw e
            const concurrent = await loadTask(task.task_id, auth)
            if (concurrent.fingerprint !== fingerprint) throw error(409, 'idempotency_conflict', '请求 ID 内容冲突')
            return json(res, 200, publicTask(concurrent))
          }
          await atomicJson(indexPath, {task_id:task.task_id})
          busy.add(task.task_id)
          void submitUpstream(task, auth).catch(async e => {
            // A lost response is ambiguous; never blindly re-submit or mark refunded.
            if (e.status && ![408,429,500,502,503,504].includes(e.status) || ['upstream_failed','empty_output','missing_upstream_id'].includes(e.code)) task.status = 'failed'
            task.error = { code:task.status === 'failed' ? e.code || 'upstream_failed' : 'submission_unknown', message:task.status === 'failed' ? e.message : '提交结果未知，已保留请求 ID；请勿重新扣费提交', retryable:task.status !== 'failed', request_id:task.request_id }
            await saveTask(task)
          }).catch(() => { /* keep the pre-submit durable record; no secrets in logs */ }).finally(() => busy.delete(task.task_id))
          return json(res, 202, publicTask(task))
        })
      }
      if (parts[0] === 'tasks' && parts[1] === 'by-request' && req.method === 'GET') {
        if (!idPattern.test(parts[2] || '')) throw error(404, 'task_not_found', '未找到任务')
        let index; try { index = await readJson(join(root, `request_${hash(`${auth.owner}:${parts[2]}`)}.json`)) } catch (e) { if (e.code === 'ENOENT') throw error(404, 'task_not_found', '未登记该请求'); throw e }
        return json(res, 200, publicTask(await poll(await loadTask(index.task_id, auth), auth)))
      }
      if (parts[0] === 'tasks' && parts[1]) {
        const task = await loadTask(parts[1], auth)
        if (req.method === 'GET' && parts.length === 2) return json(res, 200, publicTask(await poll(task, auth)))
        if (req.method === 'POST' && parts[2] === 'cancel') {
          if (busy.has(task.task_id)) throw error(409, 'task_busy', '任务正在提交或查询，请稍后请求取消')
          if (!task.adapter.cancel) throw error(409, 'cancel_unsupported', '此能力不支持远程取消；停止跟踪不表示取消或退款')
          if (!terminal.has(task.status)) {
            if (!task.upstreamId) throw error(409, 'submission_unknown', '尚未取得上游任务 ID，不能宣称已取消')
            await upstream(auth, pathForAdapter(task.adapter.cancel.path, task.upstreamId), {method:'POST'})
            task.status = 'cancel_requested'; await saveTask(task)
          }
          return json(res, 200, publicTask(task))
        }
        if ((req.method === 'GET' || req.method === 'HEAD') && parts[2] === 'outputs' && parts[4] === 'content') {
          const output = task.outputs.find(item => item.output_id === parts[3]), source = task.sourceOutputs?.find(item => item.output_id === parts[3])
          if (task.status !== 'succeeded' || !output || !source) throw error(404, 'output_not_found', '没有可下载的输出')
          let response
          if (source.local) {
            const data = await readFile(join(root, `${task.task_id}_${output.output_id}.bin`))
            res.writeHead(200, {'Content-Type':output.mime_type, 'Content-Length':String(data.length), 'Cache-Control':'private, no-store'})
            return res.end(req.method === 'HEAD' ? undefined : data)
          } else if (source.path) response = await upstream(auth, source.path, {method:req.method, headers:req.headers.range ? {Range:req.headers.range} : {}})
          else {
            const destination = new URL(source.url)
            if (destination.protocol !== 'https:' || destination.username || destination.password || destination.port && destination.port !== '443' || !(config.outputHosts || []).includes(destination.hostname)) throw error(502, 'output_host_forbidden', '结果域名尚未列入服务端下载白名单')
            const addresses = isIP(destination.hostname) ? [{address:destination.hostname}] : await lookup(destination.hostname, {all:true})
            if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw error(502, 'output_address_forbidden', '禁止读取私网结果地址')
            response = await new Promise((resolveResponse, reject) => {
              const outgoing = httpsRequest(destination, { method:req.method, signal:AbortSignal.timeout(120_000), headers:req.headers.range ? {Range:req.headers.range} : {},
                lookup(_hostname, options, callback) {
                  const normalized = addresses.map(item => ({address:item.address, family:isIP(item.address)}))
                  if (options.all) callback(null, normalized)
                  else callback(null, normalized[0].address, normalized[0].family)
                },
              }, incoming => {
                const headers = new Headers()
                for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value)
                resolveResponse(new Response(req.method === 'HEAD' ? null : Readable.toWeb(incoming), {status:incoming.statusCode, headers}))
              })
              outgoing.on('error', reject); outgoing.end()
            })
            if (!response.ok) throw error(response.status, 'output_unavailable', '上游文件暂不可读取')
          }
          const headers = {'Content-Type':output.mime_type, 'Cache-Control':'private, no-store'}
          for (const name of ['content-length','content-range','accept-ranges']) if (response.headers.get(name)) headers[name] = response.headers.get(name)
          res.writeHead(response.status, headers)
          if (req.method === 'HEAD') return res.end()
          if (!response.body) throw error(502, 'empty_output', '输出文件为空')
          await pipeline(Readable.fromWeb(response.body), res)
          return
        }
      }
      throw error(404, 'not_found', '未找到影音接口')
    } catch (e) {
      if (res.headersSent) { res.destroy(); return }
      json(res, e.status || 503, {code:e.code || 'creation_service_error', message:e.status ? e.message : '影音执行服务暂不可用', retryable:!e.status || e.status >= 500}, e.status === 429 ? {'Retry-After':'5'} : {})
    }
  }
  await catalog() // fail closed on invalid schema/manifest before accepting requests
  return createServer(handler)
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const server = await createCreationProtocolServer({ secret:process.env.JC_CREATION_EXECUTOR_SECRET, root:process.env.JC_CREATION_DATA_DIR || '/data/creation-protocol', manifest:process.env.JC_CREATION_MANIFEST || '/data/creation-protocol/capabilities.json', newapiBase:process.env.JC_NEWAPI_INTERNAL_URL || 'http://127.0.0.1:3000', outputHosts:(process.env.JC_CREATION_OUTPUT_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean) })
  server.listen(Number(process.env.PORT || 8791), process.env.JC_CREATION_BIND || '127.0.0.1')
}
