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
import { generateImage, generateVideo, generateAudio, pollTask, pollSeedanceTaskById } from '@/api/media-generation'
import type { ImageGenParams, VideoGenParams, MediaResult } from '@/api/media-generation'
import { emitEvent } from '@/utils/eventBus'

// ─── Types ───

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
export type TaskMediaType = 'image' | 'video' | 'audio'
export type TaskSource = 'chat' | 'creation'

export interface MediaTask {
  id: string
  type: TaskMediaType
  model: string
  modelLabel: string
  prompt: string
  /** 参考图 URL / data URL 列表 */
  referenceImages: string[]
  status: TaskStatus
  progress: number          // 0-100
  progressText: string
  createdAt: number
  completedAt?: number
  /** 生成成功后的结果 URL */
  resultUrl?: string
  errorMsg?: string
  /** 来源面板 */
  source: TaskSource
  /** 来源对话的消息 ID（用于 ChatPanel 气泡渲染） */
  chatMessageId?: string
  /** 生成参数快照 */
  params?: Record<string, unknown>
  // ─── 任务恢复字段 ───
  /** 上游服务返回的任务 ID */
  upstreamTaskId?: string
  /** 上游轮询路径 (e.g. /v2/videos/generations/xxx) */
  pollUrl?: string
  /** 轮询媒体类型 */
  pollKind?: 'image' | 'video' | 'audio'
}

// ─── Persistence ───

const TASKS_KEY = 'jc_media_tasks_v1'
const MAX_PERSISTED = 50 // 最多持久化 50 个任务

async function loadTasks(): Promise<MediaTask[]> {
  try {
    const raw = await getItem(TASKS_KEY)
    if (!raw) return []
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

async function saveTasks(tasks: MediaTask[]) {
  try {
    // 只持久化最近 N 个
    const toSave = tasks.slice(0, MAX_PERSISTED)
    await setItem(TASKS_KEY, JSON.stringify(toSave))
  } catch { /* noop */ }
}

// ─── Store ───

export const useMediaTaskStore = defineStore('mediaTasks', () => {
  const tasks = ref<MediaTask[]>([])
  const initialized = ref(false)

  // ─── Computed ───
  const runningTasks = computed(() => tasks.value.filter(t => t.status === 'running'))
  const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'success'))
  const hasRunning = computed(() => runningTasks.value.length > 0)
  const runningCount = computed(() => runningTasks.value.length + pendingTasks.value.length)

  // ─── Init (恢复持久化任务 + 尝试恢复轮询) ───
  async function init() {
    if (initialized.value) return
    const saved = await loadTasks()
    tasks.value = saved
    initialized.value = true

    // 尝试恢复在刷新前正在 running/pending 的任务
    for (const task of tasks.value) {
      if (task.status === 'running' || task.status === 'pending') {
        if (task.pollUrl && task.pollKind) {
          // 有上游轮询地址，尝试恢复轮询
          _resumePolling(task).catch(() => { /* already handled internally */ })
        } else {
          // 没有上游 ID（可能是同步型任务如 gpt-image），标记失败
          task.status = 'failed'
          task.errorMsg = '页面刷新导致任务中断（无上游任务 ID）'
        }
      }
    }
    await saveTasks(tasks.value)
  }

  /** 恢复单个任务的轮询 */
  async function _resumePolling(task: MediaTask) {
    if (!task.pollUrl || !task.pollKind) return
    task.status = 'running'
    task.progressText = '恢复轮询中...'

    const onProgress = (elapsed: number, status: string) => {
      if ((task as MediaTask).status === 'cancelled') return
      task.progressText = `恢复轮询 ${Math.round(elapsed)}s · ${status}`
      const baseSec = task.type === 'image' ? 120 : 480
      task.progress = Math.min(95, Math.round((elapsed / baseSec) * 100))
    }

    try {
      // Seedance 任务走专用轮询（用固定 key，绕过 NewAPI）
      const isSeedance = task.pollUrl.startsWith('/api/seedance/')
      const mediaUrl = isSeedance
        ? await pollSeedanceTaskById(task.pollUrl.replace('/api/seedance/videos/', ''), onProgress)
        : await pollTask(task.pollUrl, task.pollKind, onProgress, 600, 10000)
      if ((task as MediaTask).status === 'cancelled') return
      if (mediaUrl) {
        task.status = 'success'
        task.progress = 100
        task.progressText = '完成'
        task.resultUrl = mediaUrl
        task.completedAt = Date.now()
        emitEvent('media-task-complete', {
          taskId: task.id, type: task.type, url: mediaUrl,
          source: task.source, chatMessageId: task.chatMessageId,
          model: task.modelLabel, prompt: task.prompt,
        })
      } else {
        task.status = 'failed'
        task.errorMsg = '恢复轮询未获取到结果'
      }
    } catch (e: any) {
      if ((task as MediaTask).status === 'cancelled') return
      task.status = 'failed'
      task.errorMsg = `恢复失败: ${(e.message || e).toString().slice(0, 150)}`
    }
    await saveTasks(tasks.value)
  }

  // ─── 提交任务 (单一入口) ───
  async function submitTask(params: {
    type: TaskMediaType
    model: string
    modelLabel: string
    prompt: string
    referenceImages?: string[]
    source: TaskSource
    chatMessageId?: string
    /** 图片生成参数 */
    imageParams?: Partial<ImageGenParams>
    /** 视频生成参数 */
    videoParams?: Partial<VideoGenParams>
  }): Promise<string> {
    const taskId = 'mtask_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)

    const task: MediaTask = {
      id: taskId,
      type: params.type,
      model: params.model,
      modelLabel: params.modelLabel,
      prompt: params.prompt,
      referenceImages: params.referenceImages || [],
      status: 'pending',
      progress: 0,
      progressText: '排队中...',
      createdAt: Date.now(),
      source: params.source,
      chatMessageId: params.chatMessageId,
      params: {
        ...(params.imageParams || {}),
        ...(params.videoParams || {}),
      },
    }

    tasks.value.unshift(task)
    await saveTasks(tasks.value)

    // Fire-and-forget: 立刻开始执行
    _executeTask(taskId, params).catch(() => { /* 错误已在内部处理 */ })

    return taskId
  }

  // ─── 取消任务 ───
  function cancelTask(taskId: string) {
    const t = tasks.value.find(x => x.id === taskId)
    if (t && (t.status === 'pending' || t.status === 'running')) {
      t.status = 'cancelled'
      t.progressText = '已取消'
      saveTasks(tasks.value)
    }
  }

  // ─── 清除已完成/失败的任务 ───
  function clearFinished() {
    tasks.value = tasks.value.filter(t => t.status === 'running' || t.status === 'pending')
    saveTasks(tasks.value)
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
      task.progressText = `${Math.round(elapsed)}s · ${status}`
      // 视频/音频通常需要 3-8 分钟，用 480s 作为基准避免进度条过早到 95%
      const baseSec = task.type === 'image' ? 120 : 480
      task.progress = Math.min(95, Math.round((elapsed / baseSec) * 100))
    }

    try {
      let resultUrl = ''
      let result: MediaResult | null = null

      if (params.type === 'image') {
        result = await generateImage({
          model: params.model,
          prompt: params.prompt,
          image: params.referenceImages?.[0],
          ...(params.imageParams || {}),
        }, onProgress)
        resultUrl = result.url

      } else if (params.type === 'video') {
        result = await generateVideo({
          model: params.model,
          prompt: params.prompt,
          imageUrl: params.referenceImages?.[0],
          imageUrls: params.referenceImages && params.referenceImages.length > 1
            ? params.referenceImages : undefined,
          ...(params.videoParams || {}),
        }, onProgress)
        resultUrl = result.url

        // ★ 保存上游任务 ID 和轮询地址（用于刷新后恢复）
        if (result.taskId) task.upstreamTaskId = result.taskId
        if (result.pollUrl) task.pollUrl = result.pollUrl
        if (result.pollKind) task.pollKind = result.pollKind
        await saveTasks(tasks.value)

      } else if (params.type === 'audio') {
        result = await generateAudio(params.prompt)
        resultUrl = result.url
      }

      if ((task as MediaTask).status === 'cancelled') return

      task.status = 'success'
      task.progress = 100
      task.progressText = '完成'
      task.resultUrl = resultUrl
      task.completedAt = Date.now()

      // 通知其他面板
      emitEvent('media-task-complete', {
        taskId: task.id,
        type: task.type,
        url: resultUrl,
        source: task.source,
        chatMessageId: task.chatMessageId,
        model: task.modelLabel,
        prompt: task.prompt,
      })

    } catch (e: any) {
      if ((task as MediaTask).status === 'cancelled') return
      task.status = 'failed'
      task.progress = 0
      task.errorMsg = (e.message || String(e)).slice(0, 200)
      task.progressText = `失败: ${task.errorMsg}`
    }

    await saveTasks(tasks.value)
  }

  return {
    tasks,
    runningTasks, pendingTasks, completedTasks,
    hasRunning, runningCount,
    init, submitTask, cancelTask, clearFinished, getTask,
  }
})
