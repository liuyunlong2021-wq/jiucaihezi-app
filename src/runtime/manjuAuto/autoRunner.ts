/**
 * 漫剧全自动成片 P3：逐集运行控制。
 *
 * 每集：文字流水线（模型）→ 资产生图（资产阶段保存时已提前提交）→ 资产闸门（第 1 集审图）
 * → 按 refs 提交视频，不等待 → 直接进入下一集。视频在集与集之间、以及全部文字完成后
 * 每 30 分钟检查一次；某集视频全部完成即用 ffmpeg 拼接成片。
 * 运行状态落盘在 Wiki，停止后可从原集续做；花钱的参数只来自启动确认卡写入的 config。
 */
import { assetsToSubmit, awaitEpisodeAssets, lockAssets, submitEpisodeAssets, type AssetSchedulerDeps, type EpisodeCheckpoint } from './assetScheduler'
import { checkEpisodeVideos, submitEpisodeVideos, type VideoCheckpoint, type VideoSchedulerDeps } from './videoScheduler'

export const AUTO_RUN_PATH = '制作流水线/全自动运行.json'
const ASSET_GATE = { timeoutMs: 30 * 60_000, pollMs: 30_000 }
const VIDEO_CHECK_MS = 30 * 60_000

export interface AutoRunConfig {
  episodes: number[]
  videoModel: 'Seedance'
  imageModelId: string
  videoModelId: string
  ratio: string
  /** 第 1 集资产出齐后暂停审图（2026-10-25 用户确认默认开启）。 */
  review: boolean
  /** 单集预算上限（元）；价格无法估算时不拦截，由确认卡提示。 */
  budgetPerEpisode?: number
  imagePrice?: number | string
  videoPrice?: number | string
}

export type EpisodePhase = 'queued' | 'text' | 'assets' | 'review' | 'videos' | 'concat' | 'done' | 'blocked'

export interface EpisodeRunState {
  phase: EpisodePhase
  reason?: string
  output?: string
  assetsSubmitted?: boolean
  imageCost?: number
}

export interface AutoRunState {
  version: 1
  config: AutoRunConfig
  status: 'running' | 'blocked' | 'stopped' | 'done'
  reviewed: boolean
  episodes: Record<string, EpisodeRunState>
}

export interface RunnerCheckpoint extends EpisodeCheckpoint, VideoCheckpoint {
  stage: string
  status?: string
  reason?: string
}

export interface AutoRunnerDeps {
  wikiRoot: string
  /** 发送本集文字流水线指令并等待模型回合结束。 */
  runEpisodeText(episode: number): Promise<void>
  readCheckpoint(episode: number): Promise<RunnerCheckpoint | undefined>
  asset: AssetSchedulerDeps
  video: VideoSchedulerDeps
  concat(videos: string[], durations: number[], outputPath: string): Promise<void>
  waitForReview(ids: string[], images: Record<string, string>): Promise<'approved' | 'stopped'>
  save(state: AutoRunState): Promise<void>
  shouldStop(): boolean
  sleep(ms: number): Promise<void>
}

export function createAutoRun(config: AutoRunConfig): AutoRunState {
  return { version: 1, config, status: 'running', reviewed: false, episodes: Object.fromEntries(config.episodes.map(n => [String(n), { phase: 'queued' as const }])) }
}

/** 续做：保留原集数与进度，模型、比例、预算等用确认卡上新的选择（例如生图线路故障后换模型）。 */
export function resumeAutoRun(saved: AutoRunState, config: AutoRunConfig): AutoRunState {
  return { ...saved, config: { ...config, episodes: saved.config.episodes } }
}

/** 价格换算：数字或“x/条|张|次”按件，“x/秒”乘以秒数；其他写法无法估算。 */
export function estimateUnitCost(price: number | string | undefined, seconds = 1): number | undefined {
  if (typeof price === 'number') return price
  const match = String(price ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*元?\s*(?:\/\s*(秒|s|条|张|次|个))?$/)
  if (!match) return undefined
  return Number(match[1]) * (match[2] === '秒' || match[2] === 's' ? seconds : 1)
}

function overBudget(config: AutoRunConfig, cost: number | undefined) {
  return config.budgetPerEpisode !== undefined && cost !== undefined && cost > config.budgetPerEpisode
}

function block(state: AutoRunState, episode: EpisodeRunState, reason: string) {
  Object.assign(episode, { phase: 'blocked', reason })
  state.status = 'blocked'
}

/** 资产提交（含预算检查），幂等：资产阶段保存事件与回合结束后都会调用。 */
async function submitAssets(state: AutoRunState, checkpoint: RunnerCheckpoint, deps: AutoRunnerDeps): Promise<boolean> {
  const episode = state.episodes[String(checkpoint.episode_number)]
  if (episode.assetsSubmitted) return true
  const ids = await assetsToSubmit(deps.wikiRoot, checkpoint, deps.asset)
  const unit = estimateUnitCost(state.config.imagePrice)
  const cost = ids.length ? (unit === undefined ? undefined : unit * ids.length) : 0
  if (overBudget(state.config, cost)) {
    block(state, episode, `资产生图预计 ${cost} 元，超过单集预算 ${state.config.budgetPerEpisode} 元`)
    return false
  }
  await submitEpisodeAssets(deps.wikiRoot, checkpoint, deps.asset)
  Object.assign(episode, { assetsSubmitted: true, imageCost: cost })
  return true
}

/** 宿主收到进度文件保存事件时调用：资产阶段一完成就提交生图，不等文字流水线结束。 */
export async function handleCheckpointSaved(state: AutoRunState, checkpoint: RunnerCheckpoint, deps: AutoRunnerDeps) {
  const episode = state.episodes[String(checkpoint.episode_number)]
  if (state.status !== 'running' || !episode || checkpoint.video_model !== state.config.videoModel || !checkpoint.assets) return
  await submitAssets(state, checkpoint, deps)
  await deps.save(state)
}

async function checkVideos(state: AutoRunState, deps: AutoRunnerDeps) {
  for (const [key, episode] of Object.entries(state.episodes)) {
    if (episode.phase !== 'videos') continue
    const checkpoint = await deps.readCheckpoint(Number(key))
    if (!checkpoint) { Object.assign(episode, { phase: 'blocked', reason: '进度文件丢失' }); continue }
    const result = await checkEpisodeVideos(deps.wikiRoot, checkpoint, deps.video)
    if (result.status === 'failed') Object.assign(episode, { phase: 'blocked', reason: `视频片段失败：第${result.failed.join('、')}段` })
    if (result.status !== 'ready') continue
    const output = `${deps.wikiRoot}/成片/第${key}集成片.mp4`
    episode.phase = 'concat'
    await deps.save(state)
    try {
      await deps.concat(result.videos, checkpoint.segments.map(segment => segment.end_seconds - segment.start_seconds), output)
      Object.assign(episode, { phase: 'done', output })
    } catch (error) {
      Object.assign(episode, { phase: 'blocked', reason: `拼接失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  await deps.save(state)
}

export async function runAuto(state: AutoRunState, deps: AutoRunnerDeps): Promise<AutoRunState> {
  state.status = 'running'
  for (const episode of Object.values(state.episodes)) if (episode.phase === 'blocked') Object.assign(episode, { phase: 'queued', reason: undefined })
  await deps.save(state)

  for (const n of state.config.episodes) {
    const episode = state.episodes[String(n)]
    if (['videos', 'concat', 'done'].includes(episode.phase)) continue
    if (deps.shouldStop()) { state.status = 'stopped'; await deps.save(state); return state }

    let checkpoint = await deps.readCheckpoint(n)
    if (checkpoint?.stage !== 'complete') {
      episode.phase = 'text'
      await deps.save(state)
      await deps.runEpisodeText(n)
      // 资产阶段保存事件可能已因预算拦截本集（TS 不知道回调会改状态，需显式放宽类型）。
      if ((state.status as AutoRunState['status']) === 'blocked') { await deps.save(state); return state }
      checkpoint = await deps.readCheckpoint(n)
    }
    if (checkpoint?.stage !== 'complete') {
      block(state, episode, checkpoint?.reason || `第${n}集文字流水线未完成`)
      await deps.save(state)
      return state
    }

    if (episode.phase !== 'review') episode.phase = 'assets'
    if (!await submitAssets(state, checkpoint, deps)) { await deps.save(state); return state }
    await deps.save(state)
    let gate = await awaitEpisodeAssets(deps.wikiRoot, checkpoint, deps.asset, { ...ASSET_GATE, review: state.config.review && !state.reviewed })
    if (gate.status === 'awaiting_review') {
      episode.phase = 'review'
      await deps.save(state)
      if (await deps.waitForReview(gate.review, gate.images) === 'stopped') { state.status = 'stopped'; await deps.save(state); return state }
      await lockAssets(deps.wikiRoot, gate.review, deps.asset)
      state.reviewed = true
      gate = await awaitEpisodeAssets(deps.wikiRoot, checkpoint, deps.asset, ASSET_GATE)
    }
    if (gate.status !== 'ready') {
      block(state, episode, `资产未就绪：${[...gate.failed, ...gate.pending].join('、')}`)
      await deps.save(state)
      return state
    }

    const videoCost = checkpoint.segments.reduce<number | undefined>((sum, segment) => {
      const cost = estimateUnitCost(state.config.videoPrice, Math.ceil(segment.end_seconds - segment.start_seconds))
      return sum === undefined || cost === undefined ? undefined : sum + cost
    }, 0)
    const total = videoCost === undefined || episode.imageCost === undefined ? undefined : videoCost + episode.imageCost
    if (overBudget(state.config, total)) {
      block(state, episode, `本集预计 ${total?.toFixed(2)} 元，超过单集预算 ${state.config.budgetPerEpisode} 元`)
      await deps.save(state)
      return state
    }
    try {
      await submitEpisodeVideos(deps.wikiRoot, checkpoint, gate.images, deps.video)
    } catch (error) {
      block(state, episode, error instanceof Error ? error.message : String(error))
      await deps.save(state)
      return state
    }
    episode.phase = 'videos'
    await checkVideos(state, deps)
  }

  while (Object.values(state.episodes).some(episode => episode.phase === 'videos')) {
    if (deps.shouldStop()) { state.status = 'stopped'; await deps.save(state); return state }
    await deps.sleep(VIDEO_CHECK_MS)
    await checkVideos(state, deps)
  }
  state.status = Object.values(state.episodes).some(episode => episode.phase === 'blocked') ? 'blocked' : 'done'
  await deps.save(state)
  return state
}
