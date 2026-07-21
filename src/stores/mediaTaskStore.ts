/**
 * stores/mediaTaskStore.ts — 全局统一任务引擎 (Media Task Engine)
 *
 * 核心理念：
 *   无论从 ChatPanel 还是 CreationPanel 发起媒体生成，
 *   都统一通过 submitTask() 提交。
 *   任务状态是响应式的 (Pinia)，UI 自动更新。
 *   任务列表持久化到 IndexedDB kv_store，刷新页面不丢。
 *
 * 状态机:
 *   pending → running → success / failed
 *                     → cancelled (用户取消)
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem } from '@/utils/idb'
import {
  generateImage,
  generateVideo,
  generateAudio,
  pollTask,
} from '@/api/media-generation'
import type {
  AudioGenParams,
  ImageGenParams,
  VideoGenParams,
  MediaResult,
} from '@/api/media-generation'
import { emitEvent, emitEventAsync } from '@/utils/eventBus'
import { isAllowedCreationResultUrl } from '@/utils/urlSafety'
import { writeMediaAsset } from '@/utils/mediaFileWriter'
import { writeProjectMedia } from '@/utils/projectMediaWriter'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { useProjectStore } from '@/stores/projectStore'
import { validateMediaModelInputs } from '@/data/mediaModelInputValidation'
import { getApiKey, initApiKey } from '@/services/newApiClient'
import { useFileStore } from '@/composables/useFileStore'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { createProjectFileActions } from '@/services/projectFileActions'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { fetchCreationMediaBlob, webCreationMediaProjectPath } from '@/utils/creationMediaCache'
import {
  buildCreationSubmitRequest,
  executeCreationSubmitRequest,
} from '@/runtime/creation/creationMediaRuntime'
import type { CreationRunPlan } from '@/runtime/creation/creationMediaTypes'
import { writeCanvasTaskResult } from '@/components/canvas/canvasPersistence'
import type { CanvasTaskTarget } from '@/types/canvas'

// ─── Types ───

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
export type TaskMediaType = 'image' | 'video' | 'audio' | 'text'
export type TaskSource = 'chat' | 'creation'
export type CreationErrorCategory =
  | 'plan-validation'
  | 'upload'
  | 'newapi'
  | 'rh-adapter'
  | 'upstream-rh'
  | 'upstream-t8'
  | 'upstream-volcengine'
  | 'upstream-worldrouter'
  | 'upstream-trump'
  | 'persistence'
  | 'network'
  | 'result-extract'
  | 'unknown'
export type CreationErrorStage =
  | 'validation'
  | 'upload'
  | 'submit'
  | 'poll'
  | 'result-extract'
  | 'persistence'

export interface CreationTaskError {
  category: CreationErrorCategory
  stage: CreationErrorStage
  message: string
  upstreamCode?: string | number
  raw?: unknown
}

export interface CreationPlanSnapshot {
  modelId: string
  model: string
  label: string
  task: CreationRunPlan['task']
  source: CreationRunPlan['source']
  route: CreationRunPlan['route']
  upstreamFamily: CreationRunPlan['upstreamFamily']
  apiStyle: CreationRunPlan['apiStyle']
  mode: CreationRunPlan['mode']
  endpoint: string
  usesRhAdapter: boolean
  pollKind: CreationRunPlan['pollKind']
  assetFlow: CreationRunPlan['assetFlow']
  submitSummary: string
  warnings?: string[]
  normalizedParams: Record<string, unknown>
}

export interface MediaTask {
  id: string
  type: TaskMediaType
  model: string
  modelLabel: string
  prompt: string
  /** 参考图 URL / data URL 列表 */
  referenceImages: string[]
  /** 参考视频 URL / data URL 列表 */
  referenceVideos?: string[]
  status: TaskStatus
  progress: number // 0-100
  progressText: string
  createdAt: number
  completedAt?: number
  /** 生成成功后的结果 URL（远程 CDN URL，历史兼容，不可变） */
  resultUrl?: string
  /** 本地资产 URI（仅 Desktop 使用；Web 保持 projectPath 作为持久化引用） */
  assetUri?: string
  /** 本地化状态：pending=待下载, local=已落地, failed=Web 项目写入失败, remote-only=Desktop 累计失败 */
  assetStatus?: 'pending' | 'local' | 'failed' | 'remote-only'
  /** 下载失败重试次数 */
  assetRetryCount?: number
  errorMsg?: string
  /** 来源面板 */
  source: TaskSource
  /** Web 创作任务提交时冻结的项目归属，不能在完成时读取活动项目 */
  projectId?: string
  /** Web 创作任务落盘后的项目相对媒体路径，不保存临时 blob URL */
  projectPath?: string
  /** 来源对话的消息 ID（用于 ChatPanel 气泡渲染） */
  chatMessageId?: string
  /** Desktop ChatPanel 归属；只用于媒体任务投影，不属于 OpenCode 文本状态 */
  sessionId?: string
  directory?: string
  /** 生成参数快照 */
  params?: Record<string, unknown>
  route?: CreationRunPlan['route']
  upstreamFamily?: CreationRunPlan['upstreamFamily']
  apiStyle?: CreationRunPlan['apiStyle']
  mode?: CreationRunPlan['mode']
  planSnapshot?: CreationPlanSnapshot
  error?: CreationTaskError
  // ─── 任务恢复字段 ───
  /** 上游服务返回的任务 ID */
  upstreamTaskId?: string
  /** 上游轮询路径 (e.g. /v2/videos/generations/xxx) */
  pollUrl?: string
  /** 轮询媒体类型 */
  pollKind?: 'image' | 'video' | 'audio' | 'text'
  /** 文本类结果，例如歌词 */
  resultText?: string
  canvasTarget?: CanvasTaskTarget
  canvasWriteStatus?: 'pending' | 'written' | 'unwritten'
}

interface CanvasTaskWritePayload {
  target: CanvasTaskTarget
  owner: string
  taskId: string
  release?: () => void
}

function canvasTaskOwner(task: MediaTask): string | undefined {
  const owner = task.canvasTarget?.owner
  return typeof owner === 'string' && owner.length > 0 ? owner : undefined
}

function isTaskCancelled(task: MediaTask): boolean {
  return task.status === 'cancelled'
}

function isTaskSuccessful(task: MediaTask): boolean {
  return task.status === 'success'
}

export interface MediaTaskSettledPayload {
  taskId: string
  type: TaskMediaType
  status: TaskStatus
  source: TaskSource
  chatMessageId?: string
  url?: string
  text?: string
  model: string
  prompt: string
  errorMsg?: string
}

// ─── Persistence ───

const TASKS_KEY = 'jc_media_tasks_v1'

async function loadTasks(): Promise<MediaTask[]> {
  try {
    const raw = await getItem(TASKS_KEY)
    if (!raw) return []
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function saveTasks(tasks: MediaTask[]) {
  try {
    await setItem(TASKS_KEY, JSON.stringify(tasks))
  } catch (error) {
    console.error('[mediaTaskStore] failed to persist media tasks:', error)
    throw error
  }
}

let mediaTaskSaver: typeof saveTasks = saveTasks

export function __setMediaTaskSaverForTests(saver: typeof saveTasks | null) {
  mediaTaskSaver = saver || saveTasks
}

function assertSafeResultUrl(url: string): string {
  const clean = String(url || '').trim()
  if (!clean || !isAllowedCreationResultUrl(clean)) {
    console.error('[mediaTaskStore] URL BLOCKED:', clean.slice(0, 200))
    throw new Error('媒体结果地址不安全，已阻止展示')
  }
  return clean
}

function toPlanSnapshot(plan: CreationRunPlan): CreationPlanSnapshot {
  return {
    modelId: plan.modelId,
    model: plan.model,
    label: plan.label,
    task: plan.task,
    source: plan.source,
    route: plan.route,
    upstreamFamily: plan.upstreamFamily,
    apiStyle: plan.apiStyle,
    mode: plan.mode,
    endpoint: plan.endpoint,
    usesRhAdapter: plan.usesRhAdapter,
    pollKind: plan.pollKind,
    assetFlow: plan.assetFlow,
    submitSummary: plan.submitSummary,
    warnings: plan.warnings,
    normalizedParams: plan.debug.normalizedParams,
  }
}

function buildTaskError(
  error: unknown,
  fallback: { category: CreationErrorCategory; stage: CreationErrorStage },
): CreationTaskError {
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  return {
    category: fallback.category,
    stage: fallback.stage,
    message: message.slice(0, 200),
    raw: error,
  }
}

function classifyExecutionError(task: MediaTask, error: unknown): CreationTaskError {
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  const plan = task.planSnapshot
  if (/IndexedDB|localStorage|persist|写入失败|transaction|storage/i.test(message)) {
    return { category: 'persistence', stage: 'submit', message: message.slice(0, 200), raw: error }
  }
  if (/校验|缺少必填|不支持|不能小于|不能大于|必须是/.test(message)) {
    return {
      category: 'plan-validation',
      stage: 'validation',
      message: message.slice(0, 200),
      raw: error,
    }
  }
  if (/上传失败|无法加载参考图片|素材上传/.test(message)) {
    return { category: 'upload', stage: 'upload', message: message.slice(0, 200), raw: error }
  }
  if (/HTTP 4|HTTP 5|NewAPI|服务暂时不可用|请求过于频繁/.test(message)) {
    return { category: 'newapi', stage: 'submit', message: message.slice(0, 200), raw: error }
  }
  if (/解析失败|未返回可用结果|未返回任务 ID/.test(message)) {
    return {
      category: 'result-extract',
      stage: 'result-extract',
      message: message.slice(0, 200),
      raw: error,
    }
  }
  if (plan?.upstreamFamily === 'runninghub')
    return { category: 'upstream-rh', stage: 'submit', message: message.slice(0, 200), raw: error }
  if (plan?.upstreamFamily === 't8')
    return { category: 'upstream-t8', stage: 'submit', message: message.slice(0, 200), raw: error }
  if (plan?.upstreamFamily === 'volcengine')
    return {
      category: 'upstream-volcengine',
      stage: 'submit',
      message: message.slice(0, 200),
      raw: error,
    }
  if (plan?.upstreamFamily === 'worldrouter')
    return {
      category: 'upstream-worldrouter',
      stage: 'submit',
      message: message.slice(0, 200),
      raw: error,
    }
  if (plan?.upstreamFamily === 'trump')
    return {
      category: 'upstream-trump',
      stage: 'submit',
      message: message.slice(0, 200),
      raw: error,
    }
  return { category: 'unknown', stage: 'submit', message: message.slice(0, 200), raw: error }
}

function taskPrompt(params: MediaTaskSubmitParams): string {
  return String(
    params.type === 'audio' || params.type === 'text'
      ? (params.audioParams?.prompt ?? params.prompt)
      : params.type === 'video'
        ? (params.videoParams?.prompt ?? params.prompt)
        : (params.imageParams?.prompt ?? params.prompt),
  )
}

function splitReferenceFiles(params: MediaTaskSubmitParams): {
  images: string[]
  videos: string[]
  audios: string[]
} {
  const images = [...(params.referenceImages || [])]
  const videos = [
    ...new Set([
      ...(params.referenceVideos || []),
      ...(params.videoParams?.videoUrl ? [String(params.videoParams.videoUrl)] : []),
    ]),
  ]
  const audios = [params.videoParams?.audioUrl, params.audioParams?.audioUrl]
    .filter(Boolean)
    .map(String)
  return { images, videos, audios }
}

async function validateTaskInputs(params: MediaTaskSubmitParams): Promise<void> {
  if (!getApiKey() && !(await initApiKey()))
    throw new Error('使用云端模型需要先登录，请在设置中登录')
  if (params.source === 'creation' && !params.plan) {
    throw new Error('Creation source tasks must include a run plan')
  }
  if (params.plan) return
  const media = splitReferenceFiles(params)
  validateMediaModelInputs({
    modelId: params.model,
    prompt: taskPrompt(params),
    data: {
      ...(params.imageParams || {}),
      ...(params.videoParams || {}),
      ...(params.audioParams || {}),
    },
    images: media.images,
    videos: media.videos,
    audios: media.audios,
    emptyMessage: '请补充生成参数',
  })
}

function captureWebCreationProjectId(params: MediaTaskSubmitParams): string | undefined {
  if (isTauriRuntime() || params.source !== 'creation') return undefined
  return String(useProjectStore().webProjectId.value || '').trim()
}

function requireWebCreationProjectId(
  params: MediaTaskSubmitParams,
  projectId: string | undefined,
): string | undefined {
  if (isTauriRuntime() || params.source !== 'creation') return undefined
  if (!projectId) throw new Error('请先选择 Web 项目')
  return projectId
}

interface MediaTaskSubmitParams {
  type: TaskMediaType
  model: string
  modelLabel: string
  prompt: string
  referenceImages?: string[]
  referenceVideos?: string[]
  source: TaskSource
  chatMessageId?: string
  sessionId?: string
  directory?: string
  /** 图片生成参数 */
  imageParams?: Partial<ImageGenParams>
  /** 视频生成参数 */
  videoParams?: Partial<VideoGenParams>
  /** 音频生成参数 */
  audioParams?: Partial<AudioGenParams>
  plan?: CreationRunPlan
  canvasTarget?: CanvasTaskTarget
}

let creationSubmitExecutor: typeof executeCreationSubmitRequest = executeCreationSubmitRequest

export function __setCreationSubmitExecutorForTests(
  executor: typeof executeCreationSubmitRequest | null,
) {
  creationSubmitExecutor = executor || executeCreationSubmitRequest
}

// ─── Store ───

export const useMediaTaskStore = defineStore('mediaTasks', () => {
  const tasks = ref<MediaTask[]>([])
  const initialized = ref(false)
  let initPromise: Promise<void> | null = null
  let persistenceQueue = Promise.resolve()
  const canvasWriteReleases = new Map<string, () => void>()

  function releaseCanvasTaskGate(task: MediaTask): void {
    const release = canvasWriteReleases.get(task.id)
    canvasWriteReleases.delete(task.id)
    release?.()
  }

  function markCanvasWriteUnwritten(task: MediaTask): void {
    releaseCanvasTaskGate(task)
    if (task.canvasTarget) task.canvasWriteStatus = 'unwritten'
  }

  function hasPendingCanvasWrite(owner: string, path: string): boolean {
    return tasks.value.some(
      task =>
        task.canvasTarget?.owner === owner &&
        task.canvasTarget.canvasPath === path &&
        (task.status === 'pending' ||
          task.status === 'running' ||
          task.canvasWriteStatus === 'pending'),
    )
  }

  // ─── Computed ───
  const runningTasks = computed(() => tasks.value.filter(t => t.status === 'running'))
  const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'success'))
  const hasRunning = computed(() => runningTasks.value.length > 0)
  const runningCount = computed(() => runningTasks.value.length + pendingTasks.value.length)

  function chatTasksFor(sessionId: string, directory: string): MediaTask[] {
    const targetSession = String(sessionId || '')
    const targetDirectory = String(directory || '')
    if (!targetSession.startsWith('ses_') || !targetDirectory) return []
    return tasks.value
      .filter(
        task =>
          task.source === 'chat' &&
          task.sessionId === targetSession &&
          task.directory === targetDirectory,
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  function queueTaskPersistence(mutate?: () => void, rollback?: () => void): Promise<void> {
    const operation = persistenceQueue.then(async () => {
      mutate?.()
      try {
        const snapshot = JSON.parse(JSON.stringify(tasks.value)) as MediaTask[]
        await mediaTaskSaver(snapshot)
      } catch (error) {
        rollback?.()
        throw error
      }
    })
    persistenceQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  /** 将媒体结果存入文件树（媒体 tab） */
  async function saveMediaToFileTree(task: MediaTask) {
    if (!task.resultUrl) return
    try {
      const fileStore = useFileStore()
      const name = (task.prompt || task.modelLabel || '未命名').substring(0, 50)
      const cat = task.type === 'image' ? 'image' : task.type === 'video' ? 'video' : 'audio'
      const filename = `${name}.${task.type === 'audio' ? 'mp3' : task.type === 'video' ? 'mp4' : 'png'}`
      const mime = cat === 'image' ? 'image/png' : cat === 'video' ? 'video/mp4' : 'audio/mp3'
      const webProjectId = useProjectStore().webProjectId.value
      if (!isTauriRuntime() && webProjectId) {
        await webProjectFiles.addMedia(
          webProjectId,
          `output/${filename}`,
          task.resultUrl,
          cat,
          mime,
        )
      } else {
        await fileStore.addMedia(filename, task.resultUrl, cat, mime)
      }
    } catch {
      /* 文件树写入失败不影响主流程 */
    }
  }

  function shouldAutoSaveMediaToFileTree(task: MediaTask) {
    return task.source !== 'creation'
  }

  /** P3: 创作结果下载落地到 data/media/creation/，使 Finder「我的文件」可见 */
  async function downloadAndPersistMediaAsset(url: string, task: MediaTask) {
    if (!url || task.source !== 'creation') return
    const canvasOwner = canvasTaskOwner(task)
    if (task.canvasTarget && !canvasOwner) {
      markCanvasWriteUnwritten(task)
      return
    }
    if (task.assetStatus === 'local') return
    if (task.assetStatus === 'remote-only') return

    if (!isTauriRuntime()) {
      const projectId = String(task.projectId || '').trim()
      if (!projectId) throw new Error('任务未记录 Web 项目归属')
      const type =
        task.type === 'video'
          ? ('video' as const)
          : task.type === 'audio'
            ? ('audio' as const)
            : ('image' as const)
      const { blob, mimeType } = await fetchCreationMediaBlob(url, type)
      const projectPath = webCreationMediaProjectPath({
        type,
        prompt: task.prompt,
        model: task.modelLabel || task.model,
        taskId: task.id,
        mimeType,
      })
      await createProjectFileActions(createRuntimeProjectFileService()).importMedia({
        owner: projectId,
        path: projectPath,
        data: new Uint8Array(await blob.arrayBuffer()),
        mimeType,
      })
      task.projectPath = projectPath
      task.assetStatus = 'local'
      task.assetRetryCount = 0
      console.log('[JC] Web 创作结果已落项目文件夹:', `${projectId}/${projectPath}`)
      return
    }

    try {
      console.log('[JC] 开始下载创作结果:', url.substring(0, 80))
      const dataUri = /^data:([^;,]+);base64,(.+)$/i.exec(url)
      let dataBase64 = dataUri?.[2] || ''
      let contentType = dataUri?.[1] || ''
      if (!dataUri) {
        // 使用 https_download_base64（与 creationMediaCache 同通道，已验证 CDN 兼容）
        const { invoke } = await import('@tauri-apps/api/core')
        const dl = await invoke<{
          status: number
          data_base64: string
          headers?: Record<string, string>
        }>('http_download_base64', {
          request: { url, timeout_secs: 120 },
        })
        if (dl.status < 200 || dl.status >= 300) {
          console.warn('[JC] 创作结果下载失败 HTTP', dl.status)
          handleAssetDownloadFailure(task)
          return
        }
        dataBase64 = dl.data_base64
        contentType = normalizeContentType(dl.headers || {}, 'image/png')
      }
      if (!dataBase64) {
        console.warn('[JC] 创作结果下载为空')
        handleAssetDownloadFailure(task)
        return
      }

      // ★ 桌面端有项目文件夹 → 直写到项目文件夹
      const projectDir = canvasOwner || useProjectStore().projectDir.value
      if (projectDir) {
        const kind =
          task.type === 'video'
            ? ('video' as const)
            : task.type === 'audio'
              ? ('audio' as const)
              : task.type === 'text'
                ? ('text' as const)
                : ('image' as const)
        const { filePath } = await writeProjectMedia({
          dataBase64,
          mime: contentType,
          projectDir,
          kind,
          prompt: task.prompt || task.modelLabel || '',
        })
        task.assetUri = filePath
        task.assetStatus = 'local'
        task.assetRetryCount = 0
        console.log('[JC] 创作结果已落项目文件夹:', filePath)
        void persistTasksSafely('asset-localized-project')
        return
      }

      // 无项目文件夹 → 回退到 app data 目录
      const dataUrl = `data:${contentType};base64,${dataBase64}`
      // 延迟 1s 写入，避免与 persistTasksSafely 的 DB 写入冲突
      await new Promise(r => setTimeout(r, 1000))
      const result = await retryWriteMediaAsset({
        source: 'creation',
        data: dataUrl,
        sourceId: task.id,
        sourceUrl: url,
        name: (task.prompt || task.modelLabel || '未命名').substring(0, 50),
      })
      task.assetUri = `jc-media://${result.assetId}`
      task.assetStatus = 'local'
      task.assetRetryCount = 0
      console.log('[JC] 创作结果已落地:', result.assetId)
      void persistTasksSafely('asset-localized')
    } catch (e) {
      console.warn('[JC] 创作结果落地失败:', e)
      handleAssetDownloadFailure(task)
    }
  }

  function normalizeContentType(headers: Record<string, string>, fallback: string): string {
    const raw = headers['content-type'] || headers['Content-Type'] || ''
    return raw.split(';')[0].trim() || fallback
  }

  /** 带重试的 writeMediaAsset，解决 SQLite "database is locked" 并发写冲突 */
  async function retryWriteMediaAsset(
    opts: Parameters<typeof writeMediaAsset>[0],
    maxRetries = 3,
  ): ReturnType<typeof writeMediaAsset> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await writeMediaAsset(opts)
      } catch (e) {
        if (i < maxRetries - 1 && String(e).includes('database is locked')) {
          await new Promise(r => setTimeout(r, 500 * (i + 1)))
          continue
        }
        throw e
      }
    }
    throw new Error('unreachable')
  }

  function handleAssetDownloadFailure(task: MediaTask) {
    task.assetRetryCount = (task.assetRetryCount || 0) + 1
    if (task.assetRetryCount >= 3) {
      task.assetStatus = 'remote-only'
      console.warn('[JC] 创作结果本地化永久放弃（3次失败）:', task.id)
    }
  }

  async function writeCanvasResult(task: MediaTask) {
    if (!task.canvasTarget) return
    const webRuntime = !isTauriRuntime()
    const owner = webRuntime ? String(task.projectId || '').trim() : canvasTaskOwner(task)
    const relativeAssetPath = webRuntime
      ? String(task.projectPath || '').trim()
      : task.assetUri && owner && task.assetUri.startsWith(`${owner}/`)
        ? task.assetUri.slice(owner.length + 1)
        : ''
    if (!owner || !relativeAssetPath) {
      markCanvasWriteUnwritten(task)
      return
    }

    const payload: CanvasTaskWritePayload = { target: task.canvasTarget, owner, taskId: task.id }
    try {
      await emitEventAsync('canvas:before-task-write', payload)
      let release: (() => void) | undefined
      if (payload.release) {
        release = () => {
          if (canvasWriteReleases.get(task.id) === release) canvasWriteReleases.delete(task.id)
          payload.release?.()
        }
      }
      if (release) canvasWriteReleases.set(task.id, release)
      if (task.status === 'cancelled') {
        markCanvasWriteUnwritten(task)
        return
      }

      const document = await writeCanvasTaskResult(task.canvasTarget, relativeAssetPath, owner)
      task.canvasWriteStatus = 'written'
      try {
        await emitEventAsync('canvas:task-result', {
          target: task.canvasTarget,
          document,
          owner,
          release,
        })
      } catch (error) {
        console.warn('[mediaTaskStore] canvas result UI restore failed:', error)
      }
    } catch {
      markCanvasWriteUnwritten(task)
    }
  }

  function markWebMediaPersistenceFailure(task: MediaTask, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error || '未知错误')
    const message = `保存到项目失败：${detail.slice(0, 160)}`
    task.status = 'failed'
    task.progress = 0
    task.progressText = `失败: ${message}`
    task.errorMsg = message
    task.error = {
      category: 'persistence',
      stage: 'persistence',
      message,
      raw: error,
    }
    task.assetStatus = 'failed'
    task.completedAt = Date.now()
    markCanvasWriteUnwritten(task)
  }

  async function completeMediaTask(
    task: MediaTask,
    resultUrl: string,
    persistenceContext: string,
  ): Promise<void> {
    if (isTaskCancelled(task)) {
      markCanvasWriteUnwritten(task)
      await persistTasksSafely(`${persistenceContext}-cancelled`)
      return
    }
    task.resultUrl = resultUrl
    task.completedAt = Date.now()
    try {
      await downloadAndPersistMediaAsset(resultUrl, task)
    } catch (error) {
      if (isTaskCancelled(task)) {
        markCanvasWriteUnwritten(task)
        await persistTasksSafely(`${persistenceContext}-cancelled`)
        return
      }
      if (isTauriRuntime() || task.source !== 'creation') throw error
      markWebMediaPersistenceFailure(task, error)
      emitSettled(task)
      await persistTasksSafely(`${persistenceContext}-asset-failed`)
      return
    }

    if (isTaskCancelled(task)) {
      markCanvasWriteUnwritten(task)
      await persistTasksSafely(`${persistenceContext}-cancelled`)
      return
    }

    task.status = 'success'
    task.progress = 100
    task.progressText = '完成'
    await writeCanvasResult(task)
    emitEvent('media-task-complete', {
      taskId: task.id,
      type: task.type,
      url: resultUrl,
      source: task.source,
      chatMessageId: task.chatMessageId,
      model: task.modelLabel,
      prompt: task.prompt,
    })
    emitSettled(task)
    if (shouldAutoSaveMediaToFileTree(task)) saveMediaToFileTree(task).catch(() => {})
    const persisted = await persistTasksSafely(persistenceContext)
    if (!persisted) markPersistenceWarning(task, '结果已完成，但本地保存失败')
  }

  // ─── Init (恢复持久化任务 + 尝试恢复轮询) ───
  async function init() {
    if (initialized.value) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      const saved = await loadTasks()
      tasks.value = saved
      initialized.value = true

      // 尝试恢复在刷新前正在 running/pending 的任务
      for (const task of tasks.value) {
        if (task.status === 'running' || task.status === 'pending') {
          if (task.canvasTarget && !task.canvasWriteStatus) task.canvasWriteStatus = 'pending'
          if (task.pollUrl && task.pollKind) {
            // 有上游轮询地址，尝试恢复轮询
            _resumePolling(task).catch(() => {
              /* already handled internally */
            })
          } else if (
            task.source === 'creation' &&
            task.planSnapshot &&
            task.planSnapshot.pollKind !== 'none'
          ) {
            task.progressText = '等待恢复轮询元数据...'
          } else {
            // 没有上游 ID（可能是同步型任务如 gpt-image），标记失败
            task.status = 'failed'
            task.errorMsg = '页面刷新导致任务中断（无上游任务 ID）'
            task.error = {
              category: 'network',
              stage: 'poll',
              message: '页面刷新导致任务中断（无上游任务 ID）',
            }
            task.completedAt = Date.now()
            markCanvasWriteUnwritten(task)
            emitSettled(task)
          }
        }
      }
      await persistTasksSafely('init')
    })().finally(() => {
      initPromise = null
    })
    return initPromise
  }

  function emitSettled(task: MediaTask) {
    emitEvent('media-task-settled', {
      taskId: task.id,
      type: task.type,
      status: task.status,
      source: task.source,
      chatMessageId: task.chatMessageId,
      url: task.resultUrl,
      text: task.resultText,
      model: task.modelLabel,
      prompt: task.prompt,
      errorMsg: task.errorMsg,
    } satisfies MediaTaskSettledPayload)
  }

  async function persistTasksSafely(context: string): Promise<boolean> {
    try {
      await queueTaskPersistence()
      return true
    } catch (error) {
      console.error(`[mediaTaskStore] persist failed (${context}):`, error)
      return false
    }
  }

  function markPersistenceWarning(task: MediaTask, message: string) {
    task.error = {
      category: 'persistence',
      stage: 'submit',
      message: message.slice(0, 200),
    }
    if (task.status !== 'failed') {
      task.errorMsg = message.slice(0, 200)
    }
  }

  async function markTaskSubmitted(
    task: MediaTask,
    result: { taskId?: string; pollUrl?: string; pollKind?: 'image' | 'video' | 'audio' | 'text' },
  ): Promise<boolean> {
    if (result.taskId) task.upstreamTaskId = result.taskId
    if (result.pollUrl) task.pollUrl = result.pollUrl
    if (result.pollKind) task.pollKind = result.pollKind
    return persistTasksSafely('mark-submitted')
  }

  /** 恢复单个任务的轮询 */
  async function _resumePolling(task: MediaTask) {
    if (!task.pollUrl || !task.pollKind) return
    task.status = 'running'
    task.progressText = '恢复轮询中...'

    const onProgress = (elapsed: number, status: string) => {
      if ((task as MediaTask).status === 'cancelled') {
        markCanvasWriteUnwritten(task)
        return
      }
      task.progressText = `恢复轮询 ${Math.round(elapsed)}s · ${status}`
      const baseSec = task.type === 'image' ? 120 : 480
      task.progress = Math.min(95, Math.round((elapsed / baseSec) * 100))
    }

    try {
      const mediaUrl = await pollTask(task.pollUrl, task.pollKind, onProgress, 600, 10000)
      if ((task as MediaTask).status === 'cancelled') {
        markCanvasWriteUnwritten(task)
        return
      }
      if (task.pollKind === 'text' && mediaUrl) {
        task.status = 'success'
        task.progress = 100
        task.progressText = '完成'
        task.resultText = mediaUrl
        task.completedAt = Date.now()
        markCanvasWriteUnwritten(task)
        emitSettled(task)
        const persisted = await persistTasksSafely('resume-text-success')
        if (!persisted) markPersistenceWarning(task, '结果已完成，但本地保存失败')
        return
      } else if (mediaUrl) {
        const safeMediaUrl = assertSafeResultUrl(mediaUrl)
        task.resultUrl = safeMediaUrl
        await completeMediaTask(task, safeMediaUrl, 'resume-media-success')
        return
      } else {
        task.status = 'failed'
        task.errorMsg = '恢复轮询未获取到结果'
        task.error = {
          category: 'result-extract',
          stage: 'poll',
          message: '恢复轮询未获取到结果',
        }
        task.completedAt = Date.now()
        markCanvasWriteUnwritten(task)
        emitSettled(task)
        await persistTasksSafely('resume-empty-result')
        return
      }
    } catch (e: any) {
      if ((task as MediaTask).status === 'cancelled') {
        markCanvasWriteUnwritten(task)
        return
      }
      if (task.upstreamTaskId && task.pollUrl && task.pollKind) {
        task.status = 'pending'
        task.progressText = '轮询暂时失败，重启后将继续恢复'
        task.errorMsg = undefined
        task.error = buildTaskError(e, { category: 'network', stage: 'poll' })
        await persistTasksSafely('resume-pending')
        return
      }
      task.status = 'failed'
      task.errorMsg = `恢复失败: ${(e.message || e).toString().slice(0, 150)}`
      task.error = buildTaskError(e, { category: 'network', stage: 'poll' })
      task.completedAt = Date.now()
      markCanvasWriteUnwritten(task)

      emitSettled(task)
      await persistTasksSafely('resume-failed')
      return
    }
  }

  // ─── 提交任务 (单一入口) ───
  async function submitTask(params: MediaTaskSubmitParams): Promise<string> {
    const capturedProjectId = captureWebCreationProjectId(params)
    await init()
    await validateTaskInputs(params)
    const projectId = requireWebCreationProjectId(params, capturedProjectId)
    const taskId = 'mtask_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)

    const task: MediaTask = {
      id: taskId,
      type: params.type,
      model: params.model,
      modelLabel: params.modelLabel,
      prompt: params.prompt,
      referenceImages: params.referenceImages || [],
      referenceVideos: params.referenceVideos || [],
      status: 'pending',
      progress: 0,
      progressText: '排队中...',
      createdAt: Date.now(),
      source: params.source,
      projectId,
      assetStatus: projectId ? 'pending' : undefined,
      chatMessageId: params.chatMessageId,
      sessionId: params.sessionId,
      directory: params.directory,
      params: {
        ...(params.imageParams || {}),
        ...(params.videoParams || {}),
        ...(params.audioParams || {}),
      },
      route: params.plan?.route,
      upstreamFamily: params.plan?.upstreamFamily,
      apiStyle: params.plan?.apiStyle,
      mode: params.plan?.mode,
      canvasTarget: params.canvasTarget,
      canvasWriteStatus: params.canvasTarget ? 'pending' : undefined,
    }
    if (params.plan) task.planSnapshot = toPlanSnapshot(params.plan)

    await queueTaskPersistence(
      () => tasks.value.unshift(task),
      () => {
        tasks.value = tasks.value.filter(item => item.id !== taskId)
      },
    )

    // Fire-and-forget: 立刻开始执行
    _executeTask(taskId, params).catch(() => {
      /* 错误已在内部处理 */
    })

    return taskId
  }

  // ─── 取消任务 ───
  function cancelTask(taskId: string) {
    const t = tasks.value.find(x => x.id === taskId)
    if (t && (t.status === 'pending' || t.status === 'running')) {
      t.status = 'cancelled'
      t.progressText = '已取消'
      markCanvasWriteUnwritten(t)
      void persistTasksSafely('cancel-task')
    }
  }

  async function retryWebMediaPersistence(taskId: string): Promise<boolean> {
    const task = tasks.value.find(item => item.id === taskId)
    if (
      isTauriRuntime() ||
      !task ||
      task.source !== 'creation' ||
      task.status !== 'failed' ||
      task.assetStatus !== 'failed' ||
      !task.projectId ||
      !task.resultUrl
    )
      return false

    let resultUrl: string
    try {
      resultUrl = assertSafeResultUrl(task.resultUrl)
    } catch {
      return false
    }

    task.status = 'running'
    task.progress = 0
    task.progressText = '重新保存到项目...'
    task.errorMsg = undefined
    task.error = undefined
    task.assetStatus = 'pending'
    task.completedAt = undefined
    await persistTasksSafely('retry-web-media-persistence-start')
    await completeMediaTask(task, resultUrl, 'retry-web-media-persistence')
    return isTaskSuccessful(task)
  }

  // ─── 清除已完成/失败的任务 ───
  function clearFinished() {
    tasks.value = tasks.value.filter(
      t => t.status === 'running' || t.status === 'pending' || t.canvasWriteStatus === 'pending',
    )
    void persistTasksSafely('clear-finished')
  }

  function deleteTask(taskId: string) {
    const before = tasks.value.length
    tasks.value = tasks.value.filter(t => t.id !== taskId || t.canvasWriteStatus === 'pending')
    if (tasks.value.length !== before) void persistTasksSafely('delete-task')
  }

  async function bindLegacyChatTask(
    taskId: string,
    sessionId: string,
    directory: string,
  ): Promise<boolean> {
    const task = tasks.value.find(item => item.id === taskId)
    const targetSession = String(sessionId || '').trim()
    const targetDirectory = String(directory || '').trim()
    if (
      !task ||
      task.source !== 'chat' ||
      (task.sessionId && task.directory) ||
      !targetSession.startsWith('ses_') ||
      !targetDirectory
    )
      return false
    await queueTaskPersistence(() => {
      task.sessionId = targetSession
      task.directory = targetDirectory
    })
    return true
  }

  // ─── 获取任务 ───
  function getTask(taskId: string): MediaTask | undefined {
    return tasks.value.find(t => t.id === taskId)
  }

  // ─── 内部: 执行单个任务 ───
  async function _executeTask(taskId: string, params: Parameters<typeof submitTask>[0]) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return

    task.status = 'running'
    task.progressText = '生成中...'

    const onProgress = (elapsed: number, status: string) => {
      if (task.status === 'cancelled') return
      const text = `${Math.round(elapsed)}s · ${status}`
      task.progressText = text
      lastStatus.text = text
      const baseSec = task.type === 'image' ? 120 : 480
      task.progress = Math.min(95, Math.round((elapsed / baseSec) * 100))
    }

    // ★ 独立计时器：API 等待期间秒数持续跳动，避免"0s不变化"
    const startTime = Date.now()
    const lastStatus = { text: task.progressText }
    const progressTimer = setInterval(() => {
      if (task.status === 'cancelled' || task.status === 'success' || task.status === 'failed') {
        clearInterval(progressTimer)
        return
      }
      const elapsed = (Date.now() - startTime) / 1000
      const baseSec = task.type === 'image' ? 120 : 480
      task.progress = Math.min(95, Math.round((elapsed / baseSec) * 100))
      // 保留最后一次 onProgress 设置的状态文字，仅更新时间
      const statusPart = lastStatus.text.replace(/^\d+s · /, '') || '等待中'
      task.progressText = `${Math.round(elapsed)}s · ${statusPart}`
    }, 1000)

    try {
      let resultUrl = ''
      let result: MediaResult | null = null
      const shouldUseCreationRuntime = params.source === 'creation' && params.plan
      console.log(
        '[mediaTaskStore] _executeTask type=',
        params.type,
        'source=',
        params.source,
        'hasPlan=',
        !!params.plan,
        'shouldUseCreationRuntime=',
        shouldUseCreationRuntime,
        'model=',
        params.model,
      )

      if (shouldUseCreationRuntime) {
        const request = buildCreationSubmitRequest(params.plan!)
        task.planSnapshot = toPlanSnapshot(params.plan!)
        task.route = params.plan!.route
        task.upstreamFamily = params.plan!.upstreamFamily
        task.apiStyle = params.plan!.apiStyle
        task.mode = params.plan!.mode
        result = await creationSubmitExecutor(request, onProgress, async submitted => {
          const persisted = await markTaskSubmitted(task, submitted)
          if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
        })
        resultUrl = result.url
        const persisted = await markTaskSubmitted(task, result)
        if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
      } else if (params.type === 'image') {
        console.log(
          '[mediaTaskStore] _executeTask image, model=',
          params.model,
          'prompt=',
          params.prompt?.slice(0, 50),
        )
        result = await generateImage(
          {
            model: params.model,
            prompt: params.prompt,
            image:
              params.referenceImages && params.referenceImages.length > 1
                ? params.referenceImages
                : params.referenceImages?.[0],
            ...(params.imageParams || {}),
            onSubmitted: async submitted => {
              const persisted = await markTaskSubmitted(task, submitted)
              if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
            },
          },
          onProgress,
        )
        resultUrl = result.url
        const persisted = await markTaskSubmitted(task, result)
        if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
      } else if (params.type === 'video') {
        result = await generateVideo(
          {
            model: params.model,
            prompt: params.prompt,
            imageUrl: params.referenceImages?.[0],
            imageUrls:
              params.referenceImages && params.referenceImages.length > 1
                ? params.referenceImages
                : undefined,
            ...(params.videoParams || {}),
            onSubmitted: async submitted => {
              const persisted = await markTaskSubmitted(task, submitted)
              if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
            },
          },
          onProgress,
        )
        resultUrl = result.url

        // ★ 保存上游任务 ID 和轮询地址（用于刷新后恢复）
        const persisted = await markTaskSubmitted(task, result)
        if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
      } else if (params.type === 'audio' || params.type === 'text') {
        result = await generateAudio(
          {
            model: params.model,
            prompt: params.prompt,
            ...(params.audioParams || {}),
            onSubmitted: async submitted => {
              const persisted = await markTaskSubmitted(task, submitted)
              if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
            },
          },
          onProgress,
        )
        resultUrl = result.url
        const persisted = await markTaskSubmitted(task, result)
        if (!persisted) markPersistenceWarning(task, '任务已提交，但本地保存失败')
      }

      if ((task as MediaTask).status === 'cancelled') {
        markCanvasWriteUnwritten(task)
        return
      }
      if (result?.type === 'text') {
        task.status = 'success'
        task.progress = 100
        task.progressText = '完成'
        task.resultText = result.text || resultUrl
        task.completedAt = Date.now()
        markCanvasWriteUnwritten(task)
        emitEvent('media-task-complete', {
          taskId: task.id,
          type: task.type,
          url: '',
          text: task.resultText,
          source: task.source,
          chatMessageId: task.chatMessageId,
          model: task.modelLabel,
          prompt: task.prompt,
        })
        emitSettled(task)
        const persisted = await persistTasksSafely('execute-text-success')
        if (!persisted) markPersistenceWarning(task, '结果已完成，但本地保存失败')
        return
      }
      if (!resultUrl && result?.pollUrl && result?.pollKind) {
        resultUrl = await pollTask(result.pollUrl, result.pollKind, onProgress, 600, 10000)
      }
      const safeResultUrl = assertSafeResultUrl(resultUrl)
      task.resultUrl = safeResultUrl
      await completeMediaTask(task, safeResultUrl, 'execute-success')
      return
    } catch (e: any) {
      if ((task as MediaTask).status === 'cancelled') {
        markCanvasWriteUnwritten(task)
        return
      }
      if (task.upstreamTaskId && task.pollUrl && task.pollKind) {
        task.status = 'pending'
        task.progressText = '轮询暂时失败，重启后将继续恢复'
        task.errorMsg = undefined
        task.error = classifyExecutionError(task, e)
        await persistTasksSafely('execute-pending')
        return
      }
      task.status = 'failed'
      task.progress = 0
      task.errorMsg = (e.message || String(e)).slice(0, 200)
      task.error = classifyExecutionError(task, e)
      task.progressText = `失败: ${task.errorMsg}`
      task.completedAt = Date.now()
      markCanvasWriteUnwritten(task)
      console.error('[mediaTaskStore] _executeTask FAILED:', task.errorMsg)

      emitSettled(task)
      await persistTasksSafely('execute-failed')
      return
    }
  }

  return {
    tasks,
    runningTasks,
    pendingTasks,
    completedTasks,
    hasRunning,
    runningCount,
    init,
    submitTask,
    cancelTask,
    retryWebMediaPersistence,
    clearFinished,
    deleteTask,
    getTask,
    chatTasksFor,
    bindLegacyChatTask,
    hasPendingCanvasWrite,
  }
})
