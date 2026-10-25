import { runCreationOperation } from '@/runtime/creation/creationMcpBridge'
import { createRuntimeProjectFileService, createSkillDraftFiles } from '@/services/projectFileService'
import type { AssetSchedulerDeps } from './assetScheduler'

/** 桌面端依赖：读写项目 Wiki，经 @影音 同一桥提交生图、查询任务。 */
export function createDesktopAssetDeps(owner: string, config: { imageModelId: string; aspectRatio: string }): AssetSchedulerDeps {
  const service = createRuntimeProjectFileService()
  const files = createSkillDraftFiles(service, owner)
  return {
    readText: path => files.readText(path),
    async writeText(path, content) { await files.writeText(path, content) },
    async exists(path) { return (await service.list(owner)).some(resource => !resource.isDirectory && String(resource.path) === path) },
    async submitImage({ requestId, prompt }) {
      const { contextVersion } = await runCreationOperation('get_creation_context', {}) as { contextVersion: string }
      const result = await runCreationOperation('submit_creation_task', {
        contextVersion, requestId, directory: owner, canvas: false,
        modelId: config.imageModelId, params: { prompt, aspect_ratio: config.aspectRatio },
      }) as { taskId: string }
      return result.taskId
    },
    async getTask(taskId) {
      try {
        return await runCreationOperation('get_creation_task', { taskId }) as { status: string; localPath?: string; error?: string }
      } catch (error) {
        if (error instanceof Error && error.message === '未找到创作任务') return undefined
        throw error
      }
    },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
}
