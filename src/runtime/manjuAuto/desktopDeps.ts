import { runCreationOperation } from '@/runtime/creation/creationMcpBridge'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { createRuntimeProjectFileService, createSkillDraftFiles } from '@/services/projectFileService'
import type { AssetSchedulerDeps, WikiTaskDeps } from './assetScheduler'
import { buildMediaParams, profileFromCapability, profileFromSpec, type MediaParamProfile } from './mediaParams'
import type { VideoSchedulerDeps } from './videoScheduler'

/** 读写项目 Wiki、经 @影音 同一桥查询任务。 */
function wikiTaskDeps(owner: string): WikiTaskDeps {
  const service = createRuntimeProjectFileService()
  const files = createSkillDraftFiles(service, owner)
  return {
    readText: path => files.readText(path),
    async writeText(path, content) { await files.writeText(path, content) },
    async exists(path) { return (await service.list(owner)).some(resource => !resource.isDirectory && String(resource.path) === path) },
    async getTask(taskId) {
      try {
        const task = await runCreationOperation('get_creation_task', { taskId }) as { status: string; localPath?: string; error?: string }
        if (task.status !== 'pending' && task.status !== 'running') return task
        // App 重启后：有上游任务号的继续查结果（不重提、不多花钱）；拿不到上游任务号的判为中断，由调度器重提。
        const store = useMediaTaskStore()
        if (store.isTaskActive(taskId)) return task
        const raw = store.getTask(taskId)
        if (raw?.planSnapshot?.protocol) return task // 统一合同任务由 get_creation_task 自己恢复
        if (raw && store.canRefreshTaskResult(raw)) {
          void store.refreshTaskResult(taskId).catch(() => {})
          return task
        }
        return { status: 'interrupted', error: '任务中断：App 重启时尚未拿到上游任务号，需要重新提交' }
      } catch (error) {
        if (error instanceof Error && error.message === '未找到创作任务') return undefined
        throw error
      }
    },
  }
}

/** 经 @影音 同一桥提交，复用参数校验与 requestId 去重；canvas:false 不写入用户画布。 */
async function submit(owner: string, modelId: string, requestId: string, params: Record<string, unknown>) {
  const { contextVersion } = await runCreationOperation('get_creation_context', {}) as { contextVersion: string }
  const result = await runCreationOperation('submit_creation_task', { contextVersion, requestId, directory: owner, canvas: false, modelId, params }) as { taskId: string }
  return result.taskId
}

/** 读取模型参数档案：本地登记有 fields，远程动态目录有 parameter_schema。 */
export async function loadMediaParamProfile(modelId: string): Promise<MediaParamProfile> {
  const model = await runCreationOperation('get_creation_model', { modelId }) as Record<string, unknown>
  if (Array.isArray(model.fields)) return profileFromSpec(model as never)
  if (model.parameter_schema) return profileFromCapability(model as never)
  throw new Error(`无法读取模型参数：${modelId}`)
}

export function createDesktopAssetDeps(owner: string, config: { imageModelId: string; ratio: string }, profile: MediaParamProfile): AssetSchedulerDeps {
  return {
    ...wikiTaskDeps(owner),
    submitImage: ({ requestId, prompt }) => submit(owner, config.imageModelId, requestId, buildMediaParams(profile, { prompt, ratio: config.ratio })),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
}

export function createDesktopVideoDeps(owner: string, config: { videoModelId: string; ratio: string; resolution?: string }, profile: MediaParamProfile): VideoSchedulerDeps {
  const params = (input: { prompt: string; images: string[]; durationSeconds: number }) => buildMediaParams(profile, { ...input, ratio: config.ratio, resolution: config.resolution })
  return {
    ...wikiTaskDeps(owner),
    checkVideo: input => { params(input) },
    // 依次提交：等上一段参考图上传完、拿到上游任务号（或已结束）再交下一段，最多等 10 分钟。
    async waitSubmitted(taskId) {
      const deadline = Date.now() + 10 * 60_000
      while (Date.now() < deadline) {
        const task = await runCreationOperation('get_creation_task', { taskId }).catch(() => undefined) as { status?: string; submitted?: boolean } | undefined
        if (!task || task.submitted || !['pending', 'running'].includes(String(task.status))) return
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    },
    submitVideo: ({ requestId, ...input }) => submit(owner, config.videoModelId, requestId, params(input)),
  }
}
