import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useCanvasStore } from '@/components/canvas/canvasStore'
import { buildCreationRunPlan } from './creationMediaPlan'
import { getCreationModelSpec, listCreationPanelModels } from './creationModelRegistry'
import { useMediaTaskStore, type MediaTask, type TaskMediaType } from '@/stores/mediaTaskStore'
import { useProjectStore } from '@/stores/projectStore'
import { isTauriRuntime } from '@/utils/tauriEnv'

interface BridgeEvent {
  requestId: string
  operation: string
  params: Record<string, unknown>
}

const submissions = new Map<string, string>()

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
    error: task.errorMsg,
    canvasWriteStatus: task.canvasWriteStatus,
  }
}

function requireString(params: Record<string, unknown>, key: string, max = 20_000): string {
  const value = String(params[key] || '').trim()
  if (!value) throw new Error(`${key} 不能为空`)
  if (value.length > max) throw new Error(`${key} 超过 ${max} 字符`)
  return value
}

function mediaTypeFor(modelId: string): TaskMediaType {
  const output = getCreationModelSpec(modelId)?.capabilities.outputModalities[0]
  return output === 'video' || output === 'audio' || output === 'model3d' || output === 'text'
    ? output
    : 'image'
}

async function handleBridgeRequest(operation: string, params: Record<string, unknown>): Promise<unknown> {
  const store = useMediaTaskStore()
  if (operation === 'get_creation_context') return currentContext()
  if (operation === 'list_creation_models') return { models: listCreationPanelModels() }

  await store.init()
  if (operation === 'get_creation_task') {
    const task = store.getTask(requireString(params, 'taskId', 120))
    if (!task || task.source !== 'creation') throw new Error('未找到创作任务')
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
    return { cancelled: await store.cancelTask(requireString(params, 'taskId', 120)) }
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
    if (!context.project.owner) throw new Error('请先在韭菜盒子中选择项目')
    const requestId = requireString(params, 'requestId', 120)
    const existing = submissions.get(requestId)
    if (existing) return { taskId: existing, duplicate: true }
    const modelId = requireString(params, 'modelId', 200)
    const rawParams = params.params && typeof params.params === 'object' && !Array.isArray(params.params)
      ? params.params as Record<string, unknown>
      : {}
    const plan = buildCreationRunPlan({ modelId, params: rawParams })
    const taskId = await store.submitTask({
      type: mediaTypeFor(modelId),
      model: plan.model,
      modelLabel: plan.label,
      prompt: requireString(rawParams, 'prompt'),
      referenceImages: Array.isArray(rawParams.images) ? rawParams.images.map(String) : [],
      referenceVideos: Array.isArray(rawParams.videos) ? rawParams.videos.map(String) : [],
      source: 'creation',
      directory: isTauriRuntime() ? context.project.owner : undefined,
      plan,
    })
    submissions.set(requestId, taskId)
    return { taskId, duplicate: false }
  }
  throw new Error('未知创作操作')
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

export const __creationMcpBridgeForTests = { currentContext, handleBridgeRequest, submissions }
