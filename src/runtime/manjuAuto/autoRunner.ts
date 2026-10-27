/**
 * 漫剧全自动成片 P3：逐集运行控制。
 *
 * 每集：文字流水线（模型）→ 资产生图（资产阶段保存时已提前提交）→ 资产闸门（第 1 集审图）
 * → 按 refs 提交视频，不等待 → 直接进入下一集。视频在集与集之间、以及全部文字完成后
 * 每分钟检查一次；某集视频全部完成即用 ffmpeg 拼接成片。
 * 运行状态落盘在 Wiki，停止后可从原集续做；花钱的参数只来自启动确认卡写入的 config。
 */
import { assetsToSubmit, awaitEpisodeAssets, lockAssets, submitEpisodeAssets, type AssetSchedulerDeps, type EpisodeCheckpoint } from './assetScheduler'
import { checkEpisodeVideos, retryFailedVideos, submitEpisodeVideos, type VideoCheckpoint, type VideoSchedulerDeps } from './videoScheduler'

export const AUTO_RUN_PATH = '制作流水线/全自动运行.json'
const ASSET_GATE = { timeoutMs: 30 * 60_000, pollMs: 30_000 }
// 只读本机任务记录（上游轮询由任务系统负责），查得勤不多花钱；实测 H3 几分钟就出片，30 分钟一查会白等。
const VIDEO_CHECK_MS = 60_000

export type VideoRoute = 'Seedance' | 'H3'

/** 所选视频模型的限制：写进每集指令，并由流水线写入 plan 进度供程序校验。 */
export interface ModelLimits {
  max_seconds: number
  max_refs?: number
  /** 只支持固定档位时（如 15/30 秒）。 */
  allowed_seconds?: number[]
}

export interface AutoRunConfig {
  /** prompts：只跑文字流水线到 complete（不生图、不生视频）；film（缺省）：直到成片。 */
  target?: 'prompts' | 'film'
  episodes: number[]
  videoModel: VideoRoute
  limits?: ModelLimits
  imageModelId: string
  videoModelId: string
  ratio: string
  /** 视频分辨率（如 480P）；影响计费，确认卡默认最低档。 */
  videoResolution?: string
  /** 每集视频出齐后、拼接前暂停审片（2026-10-26 用户要求）；未设置视为开启。 */
  reviewVideos?: boolean
  /** 第 1 集资产出齐后暂停审图（2026-10-25 用户确认默认开启）。 */
  review: boolean
  /** 审图方式：first 只审第 1 集；new 每集有新资产就审（只列新资产）；off 不审。未设置时按 review 兼容旧记录。 */
  reviewMode?: 'first' | 'new' | 'off'
  /** 单集预算上限（元）；价格无法估算时不拦截，由确认卡提示。 */
  budgetPerEpisode?: number
  imagePrice?: number | string
  videoPrice?: number | string
}

export type EpisodePhase = 'queued' | 'text' | 'assets' | 'review' | 'videos' | 'cut' | 'concat' | 'done' | 'blocked'

export interface EpisodeRunState {
  phase: EpisodePhase
  reason?: string
  output?: string
  assetsSubmitted?: boolean
  imageCost?: number
  /** 本集视频已审过（审片确认后才拼接）。 */
  videosReviewed?: boolean
}

export interface AutoRunState {
  version: 1
  /** 每次开始/续做生成新的 ID；落盘时发现记录已属于更新的运行就退出，避免两个运行互相覆盖。 */
  runId?: string
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
  /** 发送本集文字流水线指令并等待模型回合结束；rewrite 为已有提示词不符合所选模型的原因，resumeFrom 为已完成到的阶段。 */
  runEpisodeText(episode: number, rewrite?: string, resumeFrom?: string): Promise<void>
  readCheckpoint(episode: number): Promise<RunnerCheckpoint | undefined>
  asset: AssetSchedulerDeps
  video: VideoSchedulerDeps
  concat(videos: string[], durations: number[], outputPath: string): Promise<void>
  waitForReview(ids: string[], images: Record<string, string>): Promise<'approved' | 'stopped'>
  /** 审片：按片段顺序给出本集视频，用户可单独重做某段，确认后才拼接。 */
  waitForVideoReview(episode: number, videos: string[]): Promise<'approved' | 'stopped'>
  save(state: AutoRunState): Promise<void>
  shouldStop(): boolean
  sleep(ms: number): Promise<void>
}

export function createAutoRun(config: AutoRunConfig): AutoRunState {
  return { version: 1, config, status: 'running', reviewed: false, episodes: Object.fromEntries(config.episodes.map(n => [String(n), { phase: 'queued' as const }])) }
}

/** 续做：保留原集数、视频路线与进度，模型、比例、预算等用确认卡上新的选择（例如生图线路故障后换模型）。 */
export function resumeAutoRun(saved: AutoRunState, config: AutoRunConfig): AutoRunState {
  return { ...saved, config: { ...config, episodes: saved.config.episodes, videoModel: saved.config.videoModel } }
}

/** 由视频模型登记的时长与参考图上限得出限制；固定档位取 ≤30 秒的最大档，范围上限封顶 30 秒；未知时按路线默认。 */
export function modelLimits(route: VideoRoute, model: { duration?: { min?: number; max?: number; allowedValues?: number[] }; maxImages?: number }): ModelLimits {
  const allowed = model.duration?.allowedValues?.filter(value => value <= 30).sort((a, b) => a - b)
  const max = allowed?.length ? allowed.at(-1)! : Math.min(model.duration?.max ?? 30, 30)
  return { max_seconds: max, ...(model.maxImages !== undefined && { max_refs: model.maxImages }), ...(allowed?.length && { allowed_seconds: allowed }) }
}

/**
 * 本集文字进度对所选模型是否可用：自由创作或别的运行写好的进度直接复用，
 * 但有片段超过所选模型的时长或参考图上限时要按新模型重写（路线不同本来就是另一份进度文件）。
 */
export function episodeTextStatus(checkpoint: Pick<RunnerCheckpoint, 'stage' | 'segments'> | undefined, limits: ModelLimits):
  { state: 'none' } | { state: 'partial'; stage: string } | { state: 'complete' } | { state: 'stale'; reason: string } {
  if (!checkpoint) return { state: 'none' }
  if (checkpoint.stage !== 'complete') return { state: 'partial', stage: checkpoint.stage }
  for (const [index, segment] of checkpoint.segments.entries()) {
    const seconds = Math.round((segment.end_seconds - segment.start_seconds) * 100) / 100
    if (seconds > limits.max_seconds) return { state: 'stale', reason: `片段${index + 1} ${seconds} 秒，超过所选模型 ${limits.max_seconds} 秒` }
    const refs = segment.refs?.length ?? 0
    if (limits.max_refs !== undefined && refs > limits.max_refs) return { state: 'stale', reason: `片段${index + 1} 用了 ${refs} 张参考图，超过所选模型 ${limits.max_refs} 张` }
  }
  return { state: 'complete' }
}

/** 写进 plan 的限制；max_refs 为 0 表示纯文生，也要原样写入。 */
function planLimits(limits: ModelLimits) {
  return { max_seconds: limits.max_seconds, ...(limits.max_refs !== undefined && { max_refs: limits.max_refs }) }
}

/**
 * 参考图按段决定（2026-10-26 用户确认）：max_refs 为 0 是纯文生（广告、纪录片等不建资产、不生图）；
 * 否则每段只带需要保持一致的入画资产，0 到上限张都合法。
 */
function refsRule(limits: ModelLimits) {
  if (limits.max_refs === 0) return '，本次为纯文生：不建资产提示词、不生图，assets 阶段 outputs 为空，每段 refs 为空，H3 用 T2VA、Seedance 不写 @图 行'
  return `，参考图按段决定：只给需要保持外观一致的入画资产编号，无需一致性的段（空镜、纯氛围）refs 为空并按纯文生写${limits.max_refs ? `，每段最多 ${limits.max_refs} 张参考图（超出就拆镜或减少本段入画资产）` : ''}`
}

/** 用户明确要求优先（2026-10-26 用户确认）：Skill 只给默认值，只有超出模型硬限制才暂停。 */
const USER_FIRST = '用户的明确制作要求优先于 Skill 默认路线（如要求不生图、纯文生、不用参考图），只有违反模型硬限制（时长、参考图上限）才以 blocked 说明'

/**
 * 扫描可用的分集剧本：漫剧入稿的「项目资料/分集剧本/第N集分集剧本.md」与短剧改编的「剧本/第NNN集/分集剧本.md」。
 * 同一集两处都有时以入稿剧本为准，并列入 duplicates 供确认卡提示。
 */
export function scanEpisodeScripts(paths: string[]): { wikiRoot: string; episodes: number[]; scripts: Record<number, string>; duplicates: number[] } {
  const found = paths.flatMap(path => {
    const intake = path.match(/^(.*)\/项目资料\/分集剧本\/第(\d+)集分集剧本\.md$/)
    if (intake) return [{ root: intake[1], episode: Number(intake[2]), path, intake: true }]
    const adapted = path.match(/^(.*)\/剧本\/第(\d+)集\/分集剧本\.md$/)
    return adapted ? [{ root: adapted[1], episode: Number(adapted[2]), path, intake: false }] : []
  })
  const wikiRoot = (found.find(item => item.intake) ?? found[0])?.root || (paths.some(path => path.startsWith('docs/wiki/')) ? 'docs/wiki' : 'wiki')
  const scripts: Record<number, string> = {}, duplicates: number[] = []
  for (const item of found.filter(item => item.root === wikiRoot).sort((a, b) => Number(b.intake) - Number(a.intake))) {
    if (scripts[item.episode]) duplicates.push(item.episode)
    else scripts[item.episode] = item.path
  }
  const episodes = Object.keys(scripts).map(Number).sort((a, b) => a - b)
  return { wikiRoot, episodes, scripts, duplicates: [...new Set(duplicates)].sort((a, b) => a - b) }
}

export function episodeInstruction(episode: number, wikiRoot: string, config: Pick<AutoRunConfig, 'videoModel' | 'limits'>, rewrite?: string, resumeFrom?: string, scriptPath = `${wikiRoot}/项目资料/分集剧本/第${episode}集分集剧本.md`): string {
  const limits = config.limits ?? modelLimits(config.videoModel, {})
  const duration = limits.allowed_seconds?.length
    ? `所选视频模型只支持 ${limits.allowed_seconds.join('/')} 秒：每段尽量写满一档（优先 ${limits.max_seconds} 秒），每段不超过 ${limits.max_seconds} 秒`
    : `所选视频模型每段不超过 ${limits.max_seconds} 秒`
  const plan = JSON.stringify(planLimits(limits))
  const redo = rewrite ? `本集已有提示词不符合所选视频模型（${rewrite}），请从 plan 重新执行，按新限制重写分段与视频提示词，已确认的项目资料与资产提示词可沿用。` : ''
  const resume = resumeFrom && !rewrite ? `本集已有进度到 ${resumeFrom} 阶段：按「输入与恢复」先用该阶段原 outputs 保存 running 进度，再续做之后的阶段，已完成阶段的产物不重写，` : '从 plan '
  return `【全自动成片·第${episode}集】${redo}请按 jc-manju-pipeline 执行第${episode}集，视频模型 ${config.videoModel}，剧本使用 ${scriptPath}，比例与风格沿用已确认的项目风格，并遵守本对话入稿时用户提出的制作要求（${USER_FIRST}），${resume}连续执行到 complete。${duration}${refsRule(limits)}；plan 进度写入 "limits":${plan}。`
}

/** 审片修改意见：index 为段号（从 1 起），0 表示整集意见。 */
export type ReviewNotes = Record<number, string>

/**
 * 审片后按修改意见重做本集：改工程剧本（或只改画面表现时只改提示词），只重写受影响的片段，
 * 未改动的片段原文不动，视频指纹不变就不会重新提交。
 */
export function revisionInstruction(episode: number, config: Pick<AutoRunConfig, 'videoModel' | 'limits'>, notes: ReviewNotes): string {
  const limits = config.limits ?? modelLimits(config.videoModel, {})
  const lines = Object.entries(notes).filter(([, note]) => note.trim()).sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, note]) => `- ${index === '0' ? '整集' : `第${index}段`}：${note.trim()}`)
  return `【全自动成片·第${episode}集·审片修改】用户看完本集视频提出修改意见：\n${lines.join('\n')}\n请按 jc-manju-pipeline「审片修改」执行，视频模型 ${config.videoModel}，每段不超过 ${limits.max_seconds} 秒${refsRule(limits)}；${USER_FIRST}，连续执行到 complete。`
}

/**
 * 用另一条路线已完成的进度派生本路线的进度（H3 测试版定稿后出 Seedance 正式版）：
 * 项目资料、风格、资产与工程剧本两条路线共用，只保留到 engineering，视频提示词按本路线重写。
 */
export function deriveCheckpoint(other: Record<string, unknown>, route: VideoRoute, limits: ModelLimits | undefined): Record<string, unknown> {
  const files = { ...(other.files as Record<string, unknown> | undefined) }
  delete files.prompts
  delete files.complete
  const derived: Record<string, unknown> = { ...other, stage: 'engineering', status: 'running', reason: '', video_model: route, files }
  delete derived.segments
  delete derived.limits
  if (limits) derived.limits = planLimits(limits)
  return derived
}

/** 分档价格（如“480P ¥0.2/秒 · 720P ¥0.4/秒”）取所选分辨率那一档；不分档返回 undefined。 */
export function priceForResolution(price: number | string | undefined, resolution: string | undefined): string | undefined {
  if (typeof price !== 'string' || !resolution) return undefined
  const height = resolution.replace(/p$/i, '')
  const match = price.match(new RegExp(`(?:^|\\s|·)${height}\\s*[pP]\\s*[¥￥]?\\s*(\\d+(?:\\.\\d+)?)\\s*元?\\s*\\/\\s*(秒|条|张|次|个)`))
  return match ? `${match[1]}/${match[2]}` : undefined
}

/** 价格换算：数字或“x/条|张|次”按件，“x/秒”乘以秒数；其他写法无法估算。 */
export function estimateUnitCost(price: number | string | undefined, seconds = 1): number | undefined {
  if (typeof price === 'number') return price
  const match = String(price ?? '').trim().match(/^[¥￥]?\s*(\d+(?:\.\d+)?)\s*元?\s*(?:\/\s*(秒|s|条|张|次|个))?$/)
  if (!match) return undefined
  return Number(match[1]) * (match[2] === '秒' || match[2] === 's' ? seconds : 1)
}

/** 项目风格里的参考图建议：制作路线、参考图方式，以及资产清单里每项“参考图：需要 / 文字带过”。 */
export interface ReferenceAdvice {
  route?: string
  mode?: 'pure' | 'segment'
  reason?: string
  needed: string[]
  skipped: string[]
}

/**
 * 解析项目风格（2026-10-26 用户确认与项目风格合为一体）：用户不看剧本也能在确认卡上看懂
 * 这部片怎么拍、哪些东西要图。旧项目风格没有这些标签时返回空建议，确认卡沿用上次选择。
 */
export function referenceAdvice(style: string): ReferenceAdvice {
  const label = (text: string, name: string) => text.match(new RegExp(`^${name}[：:]\\s*(.+)$`, 'm'))?.[1].trim()
  const advice: ReferenceAdvice = { needed: [], skipped: [] }
  const route = label(style, '制作路线')
  if (route) advice.route = route
  const mode = label(style, '参考图方式')?.match(/^(纯文生|按段决定)\s*(?:[（(](.+?)[）)])?/)
  if (mode) Object.assign(advice, { mode: mode[1] === '纯文生' ? 'pure' : 'segment' }, mode[2] && { reason: mode[2] })
  for (const block of style.split(/^(?=资产名称[：:])/m).slice(1)) {
    const name = label(block, '资产名称'), mark = label(block, '参考图')
    if (name && mark?.startsWith('需要')) advice.needed.push(name)
    else if (name && mark?.startsWith('文字带过')) advice.skipped.push(name)
  }
  return advice
}

/** 确认卡上的一行建议：纯文生不生图；按段决定列出要生的参考图与预计生图费用（价格无法估算时不写）。 */
export function adviceSummary(advice: ReferenceAdvice, imagePrice: number | string | undefined): string | undefined {
  if (!advice.mode) return undefined
  const head = advice.route ? `${advice.route} · ` : ''
  if (advice.mode === 'pure') return `${head}纯文生：不生图`
  const unit = estimateUnitCost(imagePrice)
  const cost = advice.needed.length && unit !== undefined ? `，生图约 ¥${(unit * advice.needed.length).toFixed(2)}` : ''
  const needed = advice.needed.length ? `${advice.needed.length} 张参考图（${advice.needed.join('、')}）${cost}` : '不生图'
  return `${head}按段决定：${needed}${advice.skipped.length ? `；文字带过：${advice.skipped.join('、')}` : ''}`
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
  if (state.config.target === 'prompts' || state.status !== 'running' || !episode || checkpoint.video_model !== state.config.videoModel || !checkpoint.assets) return
  await submitAssets(state, checkpoint, deps)
  await deps.save(state)
}

/** 检查出片中的集：出齐后审片、拼接。返回 true 表示用户在审片时停止。 */
async function checkVideos(state: AutoRunState, deps: AutoRunnerDeps): Promise<boolean> {
  for (const [key, episode] of Object.entries(state.episodes)) {
    if (episode.phase !== 'videos') continue
    const checkpoint = await deps.readCheckpoint(Number(key))
    if (!checkpoint) { Object.assign(episode, { phase: 'blocked', reason: '进度文件丢失' }); continue }
    let result = await checkEpisodeVideos(deps.wikiRoot, checkpoint, deps.video)
    if (result.status === 'failed') Object.assign(episode, { phase: 'blocked', reason: `视频片段失败：第${result.failed.join('、')}段` })
    if (result.status !== 'ready') continue
    if (state.config.reviewVideos !== false && !episode.videosReviewed) {
      episode.phase = 'cut'
      await deps.save(state)
      const decision = await deps.waitForVideoReview(Number(key), result.videos)
      episode.phase = 'videos'
      if (decision === 'stopped') { state.status = 'stopped'; await deps.save(state); return true }
      episode.videosReviewed = true
      // 审片时可能重做了某段：按最新登记拼接，重做的段还没出完就留到下次检查。
      result = await checkEpisodeVideos(deps.wikiRoot, checkpoint, deps.video)
      if (result.status !== 'ready') continue
    }
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
  return false
}

export async function runAuto(state: AutoRunState, deps: AutoRunnerDeps): Promise<AutoRunState> {
  state.status = 'running'
  for (const episode of Object.values(state.episodes)) {
    if (episode.phase === 'blocked') Object.assign(episode, { phase: 'queued', reason: undefined })
    // 上次在审片时退出（如 App 关闭）：回到出片中，续做时重新审。
    if (episode.phase === 'cut') episode.phase = 'videos'
  }
  await deps.save(state)

  for (const n of state.config.episodes) {
    const episode = state.episodes[String(n)]
    if (['videos', 'concat', 'done'].includes(episode.phase)) continue
    if (deps.shouldStop()) { state.status = 'stopped'; await deps.save(state); return state }

    const limits = state.config.limits ?? modelLimits(state.config.videoModel, {})
    let checkpoint = await deps.readCheckpoint(n)
    let text = episodeTextStatus(checkpoint, limits)
    if (text.state !== 'complete') {
      episode.phase = 'text'
      await deps.save(state)
      await deps.runEpisodeText(n, text.state === 'stale' ? text.reason : undefined, text.state === 'partial' ? text.stage : undefined)
      // 资产阶段保存事件可能已因预算拦截本集（TS 不知道回调会改状态，需显式放宽类型）。
      if ((state.status as AutoRunState['status']) === 'blocked') { await deps.save(state); return state }
      checkpoint = await deps.readCheckpoint(n)
      text = episodeTextStatus(checkpoint, limits)
    }
    if (!checkpoint || text.state !== 'complete') {
      block(state, episode, text.state === 'stale' ? text.reason : checkpoint?.reason || `第${n}集文字流水线未完成`)
      await deps.save(state)
      return state
    }
    if (state.config.target === 'prompts') {
      episode.phase = 'done'
      await deps.save(state)
      continue
    }

    if (episode.phase !== 'review') episode.phase = 'assets'
    if (!await submitAssets(state, checkpoint, deps)) { await deps.save(state); return state }
    await deps.save(state)
    const reviewMode = state.config.reviewMode ?? (state.config.review ? 'first' : 'off')
    let gate = await awaitEpisodeAssets(deps.wikiRoot, checkpoint, deps.asset, { ...ASSET_GATE, shouldStop: deps.shouldStop, review: reviewMode === 'new' || (reviewMode === 'first' && !state.reviewed) })
    if (gate.status === 'awaiting_review') {
      episode.phase = 'review'
      await deps.save(state)
      if (await deps.waitForReview(gate.review, gate.images) === 'stopped') { state.status = 'stopped'; await deps.save(state); return state }
      await lockAssets(deps.wikiRoot, gate.review, deps.asset)
      state.reviewed = true
      gate = await awaitEpisodeAssets(deps.wikiRoot, checkpoint, deps.asset, { ...ASSET_GATE, shouldStop: deps.shouldStop })
    }
    if (gate.status === 'stopped') { state.status = 'stopped'; await deps.save(state); return state }
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
      if (!await submitEpisodeVideos(deps.wikiRoot, checkpoint, gate.images, deps.video, deps.shouldStop)) { state.status = 'stopped'; await deps.save(state); return state }
    } catch (error) {
      block(state, episode, error instanceof Error ? error.message : String(error))
      await deps.save(state)
      return state
    }
    episode.phase = 'videos'
    if (await checkVideos(state, deps)) return state
  }

  // 续做时已在出片中的集：上次最终失败的片段重新给一轮机会，然后先检查一次再等（中断任务马上重提）。
  for (const [key, episode] of Object.entries(state.episodes)) {
    if (episode.phase !== 'videos') continue
    const checkpoint = await deps.readCheckpoint(Number(key))
    if (checkpoint) await retryFailedVideos(deps.wikiRoot, checkpoint, deps.video)
  }
  if (await checkVideos(state, deps)) return state
  while (Object.values(state.episodes).some(episode => episode.phase === 'videos')) {
    if (deps.shouldStop()) { state.status = 'stopped'; await deps.save(state); return state }
    await deps.sleep(VIDEO_CHECK_MS)
    if (await checkVideos(state, deps)) return state
  }
  state.status = Object.values(state.episodes).some(episode => episode.phase === 'blocked') ? 'blocked' : 'done'
  await deps.save(state)
  return state
}
