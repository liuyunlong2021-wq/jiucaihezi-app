import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useCanvasStore } from '@/components/canvas/canvasStore'
import { buildCreationRunPlan } from './creationMediaPlan'
import { getCreationModelSpec, listCreationModels } from './creationModelRegistry'
import { useMediaTaskStore, type MediaTask, type TaskMediaType } from '@/stores/mediaTaskStore'
import { useProjectStore } from '@/stores/projectStore'
import { useMcpStore } from '@/stores/mcpStore'
import { buildMemoryDesktopToolDefinitions } from '@/runtime/direct/creativeToolContract'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { callMcpTool } from '@/services/mcpClient'
import type { Scene3DDocument } from '@/runtime/memory/scene3d'
import { detectImageMimeFromBytes } from '@/utils/imageContracts'
import { listDynamicCreationCapabilities, getDynamicCreationCapability, buildDynamicCreationPlan, CreationProtocolError, creationIdentity } from './creationProtocolClient'
import { canonicalCreationJson } from '../../../shared/creation-schema.mjs'
import { isTauriRuntime } from '@/utils/tauriEnv'

interface BridgeEvent {
  requestId: string
  operation: string
  params: Record<string, unknown>
}

const submissions = new Map<string, string>()
const submissionBodies = new Map<string, string>()
const pendingSubmissions = new Map<string, { fingerprint: string; promise: Promise<unknown> }>()
let sceneRecorder: ((document: Scene3DDocument) => Promise<Blob>) | undefined

export function setHarnessSceneRecorder(recorder?: (document: Scene3DDocument) => Promise<Blob>) {
  sceneRecorder = recorder
}

function currentContext() {
  const project = useProjectStore()
  const canvas = useCanvasStore()
  const owner = isTauriRuntime() ? project.projectDir.value : project.webProjectId.value
  const canvasPath = canvas.canvasPath
  const canvasId = canvas.canvasId
  return {
    ready: Boolean(owner),
    project: { owner, name: project.projectName.value },
    canvas: canvasPath ? { path: canvasPath, id: canvasId } : null,
    contextVersion: JSON.stringify([owner, canvasPath, canvasId]),
  }
}

function publicTask(task: MediaTask) {
  const localPath = task.assetUri?.startsWith('/') || /^[A-Za-z]:[\\/]/.test(task.assetUri || '')
    ? task.assetUri
    : task.directory && task.projectPath
      ? `${task.directory.replace(/[\\/]+$/, '')}/${task.projectPath}`
      : undefined
  return {
    taskId: task.id,
    status: task.status,
    mediaType: task.type,
    model: task.model,
    modelLabel: task.modelLabel,
    prompt: task.prompt,
    progress: task.progress,
    progressText: task.progressText,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    projectPath: task.projectPath,
    localPath,
    assetStatus: task.assetStatus,
    downloadState: task.downloadState,
    downloadBytes: task.downloadBytes,
    downloadTotal: task.downloadTotal,
    error: task.errorMsg || task.error?.message,
    requestId: task.planSnapshot?.protocol?.requestId,
    capabilityId: task.planSnapshot?.protocol?.capabilityId,
    revision: task.planSnapshot?.protocol?.revision,
    canvasWriteStatus: task.canvasWriteStatus,
    outputs: task.outputTasks,
    parentTaskId: task.parentTaskId,
    outputId: task.protocolOutputId,
  }
}

function requireString(params: Record<string, unknown>, key: string, max = 20_000): string {
  const value = String(params[key] || '').trim()
  if (!value) throw new Error(`${key} 不能为空`)
  if (value.length > max) throw new Error(`${key} 超过 ${max} 字符`)
  return value
}

function optionalAbsoluteDirectory(params: Record<string, unknown>): string | undefined {
  const raw = params.directory
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined
  const value = String(raw).trim()
  if (value.length > 4000) throw new Error('directory 超过 4000 字符')
  if (value.includes('\0')) throw new Error('directory 不能包含 NUL 字符')
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/])/.test(value)) throw new Error('directory 必须是本机绝对目录路径')
  return value
}

function isAbsolutePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/])/.test(value)
}

function imageMimeForPath(path: string, bytes: Uint8Array): string {
  const detected = detectImageMimeFromBytes(bytes)
  if (detected) return detected
  const extension = path.split(/[\\/.]/).pop()?.toLowerCase()
  return extension === 'jpg' || extension === 'jpeg'
    ? 'image/jpeg'
    : extension === 'webp'
      ? 'image/webp'
      : extension === 'gif'
        ? 'image/gif'
        : 'image/png'
}

async function resolveReferenceImages(params: Record<string, unknown>, slotNames: string[] = []): Promise<Record<string, unknown>> {
  if (!isTauriRuntime()) return params
  const keys = [...new Set(['images', 'image', 'imageUrl', 'imageUrls', 'videos', 'audios', ...slotNames])]
  const output = { ...params }
  for (const key of keys) {
    const value = params[key]
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
    if (!values.length) continue
    const resolved = await Promise.all(values.map(async item => {
      const reference = String(item || '').trim()
      if (!isAbsolutePath(reference) || reference.startsWith('data:') || /^https?:\/\//i.test(reference)) return item
      const file = await invoke<{ base64: string; truncated: boolean }>('dev_read_external_file', {
        input: { path: reference, maxBytes: 50_000_000 },
      })
      if (!file?.base64 || file.truncated) throw new Error(`参考图不可读取或超过 50 MB：${reference}`)
      const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))
      const extension = reference.split('.').pop()?.toLowerCase() || ''
      const mediaMime: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }
      return `data:${mediaMime[extension] || imageMimeForPath(reference, bytes)};base64,${file.base64}`
    }))
    output[key] = Array.isArray(value) ? resolved : resolved[0]
  }
  return output
}

function mediaTypeFor(modelId: string): TaskMediaType {
  const output = getCreationModelSpec(modelId)?.capabilities.outputModalities[0]
  return output === 'video' || output === 'audio' || output === 'model3d' || output === 'text'
    ? output
    : 'image'
}

function capabilities(params: Record<string, unknown>): string[] {
  return Array.isArray(params.capabilities) ? params.capabilities.map(String) : []
}

async function creationModels(params: Record<string, unknown>) {
  if (capabilities(params).length && !capabilities(params).includes('av')) throw new Error('当前入口未授权影音能力')
  try {
    const directory = await listDynamicCreationCapabilities(params)
    return { source: 'dynamic', models: directory.items.map(item => ({ ...item, id: item.capability_id })), ...directory,
      localModels: listCreationModels({ source: 'local-comfy', includeDisabled: true }) }
  } catch (error) {
    // Only a missing protocol allows the old adapters. Permission/network errors never broaden access.
    if (error instanceof CreationProtocolError && error.code === 'missing_key') return { source: 'local', models: listCreationModels({ source: 'local-comfy', includeDisabled: true }), next_cursor: null }
    if (!(error instanceof CreationProtocolError) || ![404, 405].includes(error.status)) return { source: 'local', models: listCreationModels({ source: 'local-comfy', includeDisabled: true }), warning: error instanceof Error ? error.message : '远程目录暂不可用', next_cursor: null }
    const models = listCreationModels({ includeDisabled: true }).filter(model => model.contractStatus !== 'broken')
    const offset = Math.max(0, Number(params.cursor) || 0), limit = Math.min(100, Math.max(1, Number(params.limit) || 20))
    const filtered = models.filter(model => !params.query || `${model.id} ${model.label}`.toLowerCase().includes(String(params.query).toLowerCase()))
    return { source: 'legacy', warning: '服务端尚未发布动态合同，仅现有适配可执行', models: filtered.slice(offset, offset + limit), next_cursor: offset + limit < filtered.length ? String(offset + limit) : null }
  }
}

function harnessToolCatalog(params: Record<string, unknown>) {
  const mcpServerId = String(params.mcpServerId || '')
  if (mcpServerId) return useMcpStore().allMcpTools
    .filter(tool => tool.serverId === mcpServerId)
    .map(tool => ({
      name: tool.originalName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }))

  const selected = capabilities(params)
  const names = new Set([
    ...(selected.includes('media')
      ? ['export_markdown_png', 'create_document', 'create_html', 'export_markdown_slides']
      : []),
    ...(selected.includes('3d')
      ? ['create_3d_scene', 'edit_3d_scene', 'export_3d_scene_video']
      : []),
  ])
  return buildMemoryDesktopToolDefinitions()
    .filter(tool => names.has(tool.function.name))
    .map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters,
    }))
}

async function callHarnessTool(params: Record<string, unknown>) {
  const name = requireString(params, 'name', 200)
  if (!harnessToolCatalog(params).some(tool => tool.name === name)) throw new Error(`未授权工具: ${name}`)
  const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
    ? params.arguments as Record<string, unknown>
    : {}
  const mcpServerId = String(params.mcpServerId || '')
  if (mcpServerId) return { content: await callMcpTool(mcpServerId, name, args) }

  const owner = currentContext().project.owner
  const result = await createDesktopProjectToolExecutor({ projectDir: owner, recordSceneVideo: sceneRecorder })({
    id: crypto.randomUUID(),
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  })
  return { content: result.content }
}

async function handleBridgeRequestUnchecked(operation: string, params: Record<string, unknown>): Promise<unknown> {
  const store = useMediaTaskStore()
  if (operation === 'get_creation_context') return currentContext()
  if (operation === 'list_creation_models') return creationModels(params)
  if (operation === 'get_creation_model') {
    const id = requireString(params, 'modelId', 200)
    const catalog = getCreationModelSpec(id)?.source === 'local-comfy' ? { source: 'local' } : await creationModels(params)
    if (catalog.source === 'dynamic' && getCreationModelSpec(id)?.source !== 'local-comfy') return getDynamicCreationCapability(id, typeof params.revision === 'string' ? params.revision : undefined)
    const spec = getCreationModelSpec(id)
    if (!spec || spec.contractStatus === 'broken' || (catalog.source === 'local' && spec.source !== 'local-comfy')) throw new Error('未找到当前可执行能力')
    return spec
  }
  if (operation === 'list_harness_tools') return { tools: harnessToolCatalog(params) }
  if (operation === 'call_harness_tool') return callHarnessTool(params)

  await store.init()
  if (operation === 'get_creation_task') {
    const task = store.getTask(requireString(params, 'taskId', 120))
    if (!task || task.source !== 'creation') throw new Error('未找到创作任务')
    if (task.planSnapshot?.protocol?.prepared && !store.isTaskActive(task.id) && (task.status === 'pending' || task.status === 'running')) void store.refreshTaskResult(task.id).catch(() => {})
    return publicTask(task)
  }
  if (operation === 'list_creation_history') {
    const offset = Math.max(0, Number(params.offset) || 0)
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20))
    const all = store.tasks.filter(task => task.source === 'creation')
    return {
      total: all.length,
      offset,
      items: all.slice(offset, offset + limit).map(publicTask),
      hasMore: offset + limit < all.length,
    }
  }
  if (operation === 'cancel_creation_task') {
    const taskId = requireString(params, 'taskId', 120)
    if (params.remote === true) return store.cancelRemoteTask(taskId)
    const stopped = await store.cancelTask(taskId)
    return { cancelled: stopped, stoppedTracking: stopped, remoteCancellation: false }
  }
  if (operation === 'retry_media_persistence') {
    return { persisted: await store.retryMediaPersistence(requireString(params, 'taskId', 120)) }
  }
  if (operation === 'add_creation_result_to_canvas') {
    const context = currentContext()
    if (params.contextVersion !== context.contextVersion) throw new Error('项目或画布已切换，请重新获取创作上下文')
    if (!context.canvas || !context.project.owner) throw new Error('请先在韭菜盒子中打开项目画布')
    return {
      added: await store.addTaskResultToCanvas(requireString(params, 'taskId', 120), {
        canvasId: context.canvas.id,
        canvasPath: context.canvas.path,
        owner: context.project.owner,
        operation: 'append',
        referenceNodeIds: [],
      }),
    }
  }
  if (operation === 'submit_creation_task') {
    const context = currentContext()
    if (params.contextVersion !== context.contextVersion) throw new Error('项目或画布已切换，请重新获取创作上下文')
    const directory = optionalAbsoluteDirectory(params)
    if (!context.project.owner && !directory) throw new Error('请先在韭菜盒子中选择项目，或传入 directory')
    const requestId = requireString(params, 'requestId', 120)
    const submissionScope = `${await creationIdentity()}:${requestId}`
    const existing = submissions.get(submissionScope)
    if (existing) {
      if (submissionBodies.get(submissionScope) !== canonicalCreationJson(params)) throw new Error('requestId 已用于不同参数或项目')
      return { taskId: existing, duplicate: true }
    }
    const modelId = requireString(params, 'modelId', 200)
    const catalog = getCreationModelSpec(modelId)?.source === 'local-comfy' ? { source: 'local' } : await creationModels(params)
    const rawParams = params.params && typeof params.params === 'object' && !Array.isArray(params.params)
      ? params.params as Record<string, unknown>
      : {}
    if (catalog.source !== 'dynamic') {
      const spec = getCreationModelSpec(modelId)
      if (!spec || spec.contractStatus === 'broken' || (catalog.source === 'local' && spec.source !== 'local-comfy')) throw new Error('该能力当前不可执行')
    }
    const dynamic = catalog.source === 'dynamic' && getCreationModelSpec(modelId)?.source !== 'local-comfy'
    const capability = dynamic ? await getDynamicCreationCapability(modelId, typeof params.revision === 'string' ? params.revision : undefined) : undefined
    const resolvedParams = await resolveReferenceImages(rawParams, capability?.asset_slots.map(slot => slot.name))
    const plan = capability
      ? await buildDynamicCreationPlan(capability, requestId, resolvedParams)
      : buildCreationRunPlan({ modelId, params: resolvedParams })
    if (plan.protocol) {
      plan.protocol.fingerprint = await creationIdentity('local-submit', canonicalCreationJson({ fingerprint: plan.protocol.fingerprint, context: context.contextVersion, directory: directory || '' }))
      const persisted = store.tasks.find(task => !task.parentTaskId && task.planSnapshot?.protocol?.identity === plan.protocol!.identity && task.planSnapshot.protocol.requestId === requestId)
      if (persisted) {
        if (persisted.planSnapshot!.protocol!.fingerprint !== plan.protocol.fingerprint) throw new Error('requestId 已用于不同参数，请创建新的 requestId')
        if (!store.isTaskActive(persisted.id) && persisted.status === 'pending') {
          if (persisted.planSnapshot!.protocol!.prepared) void store.refreshTaskResult(persisted.id).catch(() => {})
          else await store.resumeDynamicSubmission(persisted.id, plan)
        }
        return { taskId: persisted.id, duplicate: true }
      }
    }
    if (context.contextVersion !== currentContext().contextVersion) throw new Error('项目或画布已切换，请重新获取创作上下文')
    const type = plan.protocol?.outputModality || mediaTypeFor(modelId)
    const canvasTarget = context.canvas && context.project.owner && (!directory || directory === context.project.owner)
      && (plan.protocol ? plan.protocol.declaredOutputModalities.some(modality => ['image', 'video', 'audio'].includes(modality)) : type !== 'model3d' && type !== 'text' && type !== 'file')
      ? { canvasId: context.canvas.id, canvasPath: context.canvas.path, owner: context.project.owner,
          operation: 'append' as const, referenceNodeIds: [],
          outputAspectRatio: String(resolvedParams.aspect_ratio || resolvedParams.aspectRatio || resolvedParams.ratio || resolvedParams.ar || '') }
      : undefined
    const taskId = await store.submitTask({
      type,
      canvasTarget,
      model: plan.model,
      modelLabel: plan.label,
      prompt: typeof resolvedParams.prompt === 'string' ? resolvedParams.prompt : dynamic ? plan.label : requireString(resolvedParams, 'prompt'),
      referenceImages: Array.isArray(resolvedParams.images) ? resolvedParams.images.map(String) : [],
      referenceVideos: Array.isArray(resolvedParams.videos) ? resolvedParams.videos.map(String) : [],
      source: 'creation',
      directory: directory || (isTauriRuntime() ? context.project.owner : undefined),
      memory: true,
      plan,
    })
    submissions.set(submissionScope, taskId)
    submissionBodies.set(submissionScope, canonicalCreationJson(params))
    return { taskId, duplicate: false }
  }
  throw new Error('未知创作操作')
}

async function handleBridgeRequest(operation: string, params: Record<string, unknown>): Promise<unknown> {
  if (operation !== 'submit_creation_task') return handleBridgeRequestUnchecked(operation, params)
  const scope = `${await creationIdentity()}:${requireString(params, 'requestId', 120)}`
  const fingerprint = canonicalCreationJson(params)
  const pending = pendingSubmissions.get(scope)
  if (pending) {
    if (pending.fingerprint !== fingerprint) throw new Error('同一 requestId 正在提交不同内容')
    return pending.promise
  }
  const promise = handleBridgeRequestUnchecked(operation, params)
  pendingSubmissions.set(scope, { fingerprint, promise })
  try { return await promise } finally { pendingSubmissions.delete(scope) }
}

export async function registerCreationMcpBridge(): Promise<() => void> {
  if (!isTauriRuntime()) return () => {}
  return listen<BridgeEvent>('creation-mcp:request', event => {
    const request = event.payload
    void handleBridgeRequest(request.operation, request.params || {}).then(
      result => invoke('creation_mcp_complete', { requestId: request.requestId, result }),
      error => invoke('creation_mcp_complete', {
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  })
}

export const __creationMcpBridgeForTests = { currentContext, handleBridgeRequest, submissions, resolveReferenceImages, harnessToolCatalog }
