/**
 * 漫剧全自动成片 P2：视频提交与后台检查。
 *
 * 资产齐全后按每段 refs（@图 顺序）取参考图提交视频，不等待；
 * 之后在集与集之间或定时调用 checkEpisodeVideos 单次检查，不在这里循环轮询。
 */
import { MAX_TRANSIENT, MODERATION, RATE_LIMIT, promptBody, type WikiTaskDeps } from './assetScheduler'

/** 首次提交 + 1 次重试（2026-10-25 用户确认）。 */
const MAX_ATTEMPTS = 2

export interface VideoCheckpoint {
  episode_number: number
  video_model: string
  segments: Array<{ path: string; start_seconds: number; end_seconds: number; refs?: string[] }>
}

export interface VideoSchedulerDeps extends WikiTaskDeps {
  submitVideo(input: { requestId: string; prompt: string; images: string[]; durationSeconds: number }): Promise<string>
  /** 提交前对每段做模型约束检查（时长档位、参考图上限），任一段不合格则整集不提交。 */
  checkVideo?(input: { prompt: string; images: string[]; durationSeconds: number }): void
  /**
   * 等这一段的参考图上传完、任务已交给模型后再提交下一段。2026-10-25 实测：10 段同时提交，
   * 几十张 2MB 参考图同时上传 R2 挤满上行、申请上传地址 502，单张上传则正常。
   */
  waitSubmitted?(taskId: string): Promise<void>
}

interface VideoEntry {
  path: string
  fingerprint: string
  images: string[]
  duration_seconds: number
  status: 'pending' | 'ready' | 'failed'
  attempts: number
  /** 累计提交次数，生成唯一 requestId。 */
  submits?: number
  /** 连续暂时性失败（限流、网络）次数。 */
  transient?: number
  task_id?: string
  request_id?: string
  video_path?: string
  error?: string
}

type Registry = { version: 1; segments: VideoEntry[] }

export interface VideoCheckResult {
  status: 'ready' | 'pending' | 'failed'
  /** 全部完成时按片段顺序给出本地视频路径，供拼接。 */
  videos: string[]
  pending: number[]
  failed: number[]
}

export function videoRegistryPath(model: string, episode: number) {
  return `制作流水线/${model}/第${episode}集视频任务.json`
}

async function load(wikiRoot: string, checkpoint: VideoCheckpoint, deps: WikiTaskDeps): Promise<Registry> {
  const path = `${wikiRoot}/${videoRegistryPath(checkpoint.video_model, checkpoint.episode_number)}`
  return await deps.exists(path) ? JSON.parse(await deps.readText(path)) : { version: 1, segments: [] }
}

function save(wikiRoot: string, checkpoint: VideoCheckpoint, registry: Registry, deps: WikiTaskDeps) {
  return deps.writeText(`${wikiRoot}/${videoRegistryPath(checkpoint.video_model, checkpoint.episode_number)}`, JSON.stringify(registry, null, 2) + '\n')
}

async function fingerprintOf(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

type Prepared = { images: string[]; durationSeconds: number; fingerprint: string }

async function prepare(segment: VideoCheckpoint['segments'][number], images: Record<string, string>, deps: VideoSchedulerDeps): Promise<Prepared> {
  const refs = segment.refs || []
  const missing = refs.filter(id => !images[id])
  if (missing.length) throw new Error(`参考图未就绪：${missing.join('、')}`)
  const prompt = promptBody(await deps.readText(segment.path))
  const ordered = refs.map(id => images[id])
  const durationSeconds = Math.ceil(segment.end_seconds - segment.start_seconds)
  deps.checkVideo?.({ prompt, images: ordered, durationSeconds })
  return { images: ordered, durationSeconds, fingerprint: await fingerprintOf(JSON.stringify([prompt, ordered, durationSeconds])) }
}

async function submit(wikiRoot: string, checkpoint: VideoCheckpoint, registry: Registry, index: number, deps: VideoSchedulerDeps) {
  const entry = registry.segments[index]
  entry.submits = (entry.submits ?? entry.attempts - 1) + 1
  const requestId = `manju-video:${checkpoint.video_model}:${checkpoint.episode_number}:${index + 1}:${entry.fingerprint}:${entry.submits}`
  const prompt = promptBody(await deps.readText(entry.path))
  entry.task_id = await deps.submitVideo({ requestId, prompt, images: entry.images, durationSeconds: entry.duration_seconds })
  entry.request_id = requestId
  entry.status = 'pending'
  delete entry.error
  await save(wikiRoot, checkpoint, registry, deps)
  await deps.waitSubmitted?.(entry.task_id)
}

/** 资产齐全后调用：按 refs 顺序取图提交每段视频，立即返回。指纹未变的段不重复提交。 */
export async function submitEpisodeVideos(wikiRoot: string, checkpoint: VideoCheckpoint, images: Record<string, string>, deps: VideoSchedulerDeps) {
  const prepared = await Promise.all(checkpoint.segments.map(segment => prepare(segment, images, deps)))
  const registry = await load(wikiRoot, checkpoint, deps)
  registry.segments.length = Math.min(registry.segments.length, checkpoint.segments.length)
  for (const [index, segment] of checkpoint.segments.entries()) {
    const current = registry.segments[index]
    if (current?.path === segment.path && current.fingerprint === prepared[index].fingerprint && current.status !== 'failed') continue
    const { fingerprint, images: ordered, durationSeconds } = prepared[index]
    registry.segments[index] = { path: segment.path, fingerprint, images: ordered, duration_seconds: durationSeconds, status: 'pending', attempts: 1,
      ...(current && { submits: current.submits ?? current.attempts }) }
    await submit(wikiRoot, checkpoint, registry, index, deps)
  }
  await save(wikiRoot, checkpoint, registry, deps)
}

/** 新一次运行时调用：上次最终失败的片段用登记的参考图与时长重新给一轮机会。返回重提的段号（从 1 起）。 */
export async function retryFailedVideos(wikiRoot: string, checkpoint: VideoCheckpoint, deps: VideoSchedulerDeps): Promise<number[]> {
  const registry = await load(wikiRoot, checkpoint, deps)
  const retried: number[] = []
  for (const [index, entry] of registry.segments.entries()) {
    if (entry.status !== 'failed') continue
    Object.assign(entry, { attempts: 1, transient: 0 })
    delete entry.error
    await submit(wikiRoot, checkpoint, registry, index, deps)
    retried.push(index + 1)
  }
  return retried
}

/** 单次检查：成功且已落盘的段标记完成；失败重提 1 次；审核类失败不重试。 */
export async function checkEpisodeVideos(wikiRoot: string, checkpoint: VideoCheckpoint, deps: VideoSchedulerDeps): Promise<VideoCheckResult> {
  const registry = await load(wikiRoot, checkpoint, deps)
  const pending: number[] = [], failed: number[] = []
  for (const [index, entry] of registry.segments.entries()) {
    if (entry.status === 'ready') continue
    if (entry.status === 'failed') { failed.push(index + 1); continue }
    const task = entry.task_id ? await deps.getTask(entry.task_id) : undefined
    if (task?.status === 'success' && task.localPath) {
      entry.status = 'ready'
      entry.video_path = task.localPath
    } else if (!task || task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') {
      const error = task?.error || '任务记录丢失'
      if (task?.status === 'interrupted' || (task && RATE_LIMIT.test(error) && (entry.transient ?? 0) < MAX_TRANSIENT)) {
        // 限流、网络抖动或 App 重启后无人跟进：直接重提（沿用登记的参考图与时长），不计入重试次数。
        if (task.status !== 'interrupted') entry.transient = (entry.transient ?? 0) + 1
        await submit(wikiRoot, checkpoint, registry, index, deps)
        pending.push(index + 1)
      } else if (MODERATION.test(error) || entry.attempts >= MAX_ATTEMPTS) {
        Object.assign(entry, { status: 'failed', error })
        failed.push(index + 1)
      } else {
        // 重提沿用登记的参考图与时长，不重新解析资产。
        entry.attempts += 1
        await submit(wikiRoot, checkpoint, registry, index, deps)
        pending.push(index + 1)
      }
    } else {
      pending.push(index + 1)
    }
  }
  await save(wikiRoot, checkpoint, registry, deps)
  const status = pending.length ? 'pending' : failed.length ? 'failed' : 'ready'
  return { status, videos: status === 'ready' ? registry.segments.map(entry => entry.video_path!) : [], pending, failed }
}
