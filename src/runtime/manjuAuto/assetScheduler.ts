/**
 * 漫剧全自动成片 P1：资产生图调度。
 *
 * 文字流水线在进度文件里登记本集资产（P0）；这里负责提交生图、不等待，
 * 视频前再统一检查、补提交失败项。项目级注册表落盘在 Wiki 内，
 * 重启后据此去重，不依赖内存里的 requestId 表（静态模型重启后会丢）。
 */

export const ASSET_REGISTRY_PATH = '制作流水线/资产注册表.json'
/** 首次提交 + 2 次重试（2026-10-25 用户确认）。 */
const MAX_ATTEMPTS = 3
export const MODERATION = /审核|敏感|违规|moderation|content.?policy|sensitive|safety/i

export type AssetKind = 'character' | 'scene' | 'prop'

export interface EpisodeCheckpoint {
  episode_number: number
  assets?: Record<string, { kind: AssetKind; prompt_path: string; prompt_hash: string }>
}

export interface AssetRegistryEntry {
  kind: AssetKind
  prompt_path: string
  prompt_hash: string
  status: 'pending' | 'ready' | 'failed' | 'locked'
  attempts: number
  task_id?: string
  request_id?: string
  image_path?: string
  error?: string
  episode: number
}

export interface WikiTaskDeps {
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  getTask(taskId: string): Promise<{ status: string; localPath?: string; error?: string } | undefined>
}

export interface AssetSchedulerDeps extends WikiTaskDeps {
  submitImage(input: { requestId: string; prompt: string; kind: AssetKind }): Promise<string>
  sleep(ms: number): Promise<void>
  now?(): number
}

export interface AssetGateResult {
  status: 'ready' | 'awaiting_review' | 'failed' | 'timeout'
  images: Record<string, string>
  failed: string[]
  pending: string[]
  review: string[]
}

type Registry = { version: 1; assets: Record<string, AssetRegistryEntry> }

async function loadRegistry(wikiRoot: string, deps: WikiTaskDeps): Promise<Registry> {
  const path = `${wikiRoot}/${ASSET_REGISTRY_PATH}`
  return await deps.exists(path) ? JSON.parse(await deps.readText(path)) : { version: 1, assets: {} }
}

function saveRegistry(wikiRoot: string, registry: Registry, deps: WikiTaskDeps) {
  return deps.writeText(`${wikiRoot}/${ASSET_REGISTRY_PATH}`, JSON.stringify(registry, null, 2) + '\n')
}

/** 提示词文档去掉开头的 Markdown 标题，只提交正文。 */
export function promptBody(text: string): string {
  return text.replace(/^(?:\s*#[^\n]*\n)+/, '').trim()
}

async function submit(wikiRoot: string, registry: Registry, id: string, entry: AssetRegistryEntry, deps: AssetSchedulerDeps) {
  const requestId = `manju:${id}:${entry.prompt_hash.slice(0, 16)}:${entry.attempts}`
  entry.task_id = await deps.submitImage({ requestId, prompt: promptBody(await deps.readText(entry.prompt_path)), kind: entry.kind })
  entry.request_id = requestId
  entry.status = 'pending'
  delete entry.error
  // 每提交一个就落盘：崩溃最多丢失正在提交的那一个。
  await saveRegistry(wikiRoot, registry, deps)
}

/** 未登记、提示词改了、或上次运行最终失败的资产需要提交；失败项每次新运行重新给一轮重试。 */
function needsSubmit(registry: Registry, id: string, hash: string) {
  const current = registry.assets[id]
  return !current || (current.status !== 'locked' && (current.prompt_hash !== hash || current.status === 'failed'))
}

/** 本集需要新生成的资产（预算估算用），与 submitEpisodeAssets 的判断一致。 */
export async function assetsToSubmit(wikiRoot: string, checkpoint: EpisodeCheckpoint, deps: WikiTaskDeps): Promise<string[]> {
  const registry = await loadRegistry(wikiRoot, deps)
  return Object.entries(checkpoint.assets || {}).filter(([id, asset]) => needsSubmit(registry, id, asset.prompt_hash)).map(([id]) => id)
}

/** 资产提示词完成后调用：提交尚未生成的资产，立即返回，不等待结果。 */
export async function submitEpisodeAssets(wikiRoot: string, checkpoint: EpisodeCheckpoint, deps: AssetSchedulerDeps) {
  const registry = await loadRegistry(wikiRoot, deps)
  for (const [id, asset] of Object.entries(checkpoint.assets || {})) {
    if (!needsSubmit(registry, id, asset.prompt_hash)) continue
    const entry: AssetRegistryEntry = { ...asset, status: 'pending', attempts: 1, episode: checkpoint.episode_number }
    registry.assets[id] = entry
    await submit(wikiRoot, registry, id, entry, deps)
  }
}

/**
 * 视频提示词完成后调用：轮询本集资产直到齐全；失败的重提，审核类失败不重试。
 * review=true 时全部出图后暂停，等 lockAssets 确认后才返回 ready。
 */
export async function awaitEpisodeAssets(
  wikiRoot: string,
  checkpoint: EpisodeCheckpoint,
  deps: AssetSchedulerDeps,
  options: { timeoutMs: number; pollMs: number; review?: boolean },
): Promise<AssetGateResult> {
  const now = deps.now ?? Date.now
  const deadline = now() + options.timeoutMs
  const ids = Object.keys(checkpoint.assets || {})
  await submitEpisodeAssets(wikiRoot, checkpoint, deps)
  for (;;) {
    const registry = await loadRegistry(wikiRoot, deps)
    const pending: string[] = [], failed: string[] = []
    for (const id of ids) {
      const entry = registry.assets[id]
      if (entry.status === 'locked' || entry.status === 'ready') continue
      if (entry.status === 'failed') { failed.push(id); continue }
      const task = entry.task_id ? await deps.getTask(entry.task_id) : undefined
      if (task?.status === 'success' && task.localPath) {
        entry.status = 'ready'
        entry.image_path = task.localPath
      } else if (!task || task.status === 'failed' || task.status === 'cancelled') {
        const error = task?.error || '任务记录丢失'
        if (MODERATION.test(error) || entry.attempts >= MAX_ATTEMPTS) {
          Object.assign(entry, { status: 'failed', error })
          failed.push(id)
        } else {
          entry.attempts += 1
          await submit(wikiRoot, registry, id, entry, deps)
          pending.push(id)
        }
      } else {
        pending.push(id)
      }
    }
    await saveRegistry(wikiRoot, registry, deps)
    const images = Object.fromEntries(ids.filter(id => registry.assets[id].image_path).map(id => [id, registry.assets[id].image_path!]))
    if (!pending.length) {
      if (failed.length) return { status: 'failed', images, failed, pending, review: [] }
      const review = options.review ? ids.filter(id => registry.assets[id].status !== 'locked') : []
      return { status: review.length ? 'awaiting_review' : 'ready', images, failed, pending, review }
    }
    if (now() >= deadline) return { status: 'timeout', images, failed, pending, review: [] }
    await deps.sleep(options.pollMs)
  }
}

/** 用户审过（或手动换过）的图锁定，之后永不自动重生成。 */
export async function lockAssets(wikiRoot: string, ids: string[], deps: AssetSchedulerDeps) {
  const registry = await loadRegistry(wikiRoot, deps)
  for (const id of ids) if (registry.assets[id]) registry.assets[id].status = 'locked'
  await saveRegistry(wikiRoot, registry, deps)
}
