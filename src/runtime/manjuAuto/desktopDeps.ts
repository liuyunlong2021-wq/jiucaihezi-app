import { runCreationOperation } from '@/runtime/creation/creationMcpBridge'
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
        return await runCreationOperation('get_creation_task', { taskId }) as { status: string; localPath?: string; error?: string }
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

export function createDesktopVideoDeps(owner: string, config: { videoModelId: string; ratio: string }, profile: MediaParamProfile): VideoSchedulerDeps {
  const params = (input: { prompt: string; images: string[]; durationSeconds: number }) => buildMediaParams(profile, { ...input, ratio: config.ratio })
  return {
    ...wikiTaskDeps(owner),
    checkVideo: input => { params(input) },
    submitVideo: ({ requestId, ...input }) => submit(owner, config.videoModelId, requestId, params(input)),
  }
}
