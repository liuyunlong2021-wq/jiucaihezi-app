/**
 * 漫剧全自动成片的桌面控制器：把 autoRunner 接到工作台（发送消息、文件树、ffmpeg、审图界面）。
 * 只有用户在启动确认卡点“开始”后才会提交任何付费任务。
 */
import { invoke } from '@tauri-apps/api/core'
import { ref, shallowRef } from 'vue'
import { runCreationOperation } from '@/runtime/creation/creationMcpBridge'
import { getCreationModelSpec, prioritizedCreationModelIds } from '@/runtime/creation/creationModelRegistry'
import { createAutoRun, deriveCheckpoint, episodeInstruction, handleCheckpointSaved, referenceAdvice, resumeAutoRun, revisionInstruction, runAuto, AUTO_RUN_PATH, type AutoRunConfig, type AutoRunState, type ReferenceAdvice, type ReviewNotes, type RunnerCheckpoint, type VideoRoute } from '@/runtime/manjuAuto/autoRunner'
import { createDesktopAssetDeps, createDesktopVideoDeps, loadMediaParamProfile } from '@/runtime/manjuAuto/desktopDeps'
import { ASSET_REGISTRY_PATH, awaitAsset, awaitEpisodeAssets, promptBody, regenerateAsset, type AssetRegistryEntry } from '@/runtime/manjuAuto/assetScheduler'
import { awaitSegment, checkEpisodeVideos, regenerateSegment as resubmitSegment, submitEpisodeVideos } from '@/runtime/manjuAuto/videoScheduler'
import { createRuntimeProjectFileService, createSkillDraftFiles } from '@/services/projectFileService'
import { emitEvent } from '@/utils/eventBus'

export interface ManjuAutoModelOption {
  id: string
  label: string
  price?: number | string
  resolutions?: string[]
  duration?: { min?: number; max?: number; allowedValues?: number[] }
  maxImages?: number
}

export interface ManjuAutoDraft {
  wikiRoot: string
  episodes: number[]
  ratio?: string
  /** 项目风格里的参考图建议：确认卡据此预选参考图方式并显示要生的图与费用。 */
  advice: ReferenceAdvice
  imageModels: ManjuAutoModelOption[]
  videoModels: ManjuAutoModelOption[]
  saved?: AutoRunState
  /** 上一次运行的设置（含已完成的运行）：确认卡默认沿用，不用每次重选模型与路线。 */
  last?: AutoRunConfig
  /** 各路线已有的每集文字进度（自由创作或之前的运行写的），确认卡据此标出哪几集可直接复用。 */
  checkpoints: Record<VideoRoute, Record<number, RunnerCheckpoint>>
  /** 「用 Seedance 出正式版」：确认卡预选的路线与集数。 */
  route?: VideoRoute
  select?: number[]
}

export const AUTO_INTAKE_PREFIX = '【全自动成片·入稿】'

/**
 * 确认卡的模型选项：与 @影音 面板同一份默认顺序（prioritizedCreationModelIds），
 * 去掉已退出面板的型号；视频只列能接收参考图的模型（全自动按 @图 传资产图）。
 */
export function normalizeModels(models: Array<Record<string, unknown>>, kind: 'image' | 'video'): ManjuAutoModelOption[] {
  const order = prioritizedCreationModelIds(kind)
  // 提示词按 Seedance 格式写，视频默认优先 Seedance 型号。
  const rank = (option: ManjuAutoModelOption) => {
    const index = order.indexOf(option.id)
    const base = index < 0 ? order.length : index
    return kind === 'video' && /seedance/i.test(`${option.id} ${option.label}`) ? base - 10_000 : base
  }
  return models.filter(model => {
    const spec = getCreationModelSpec(String(model.id))
    if (model.availability && model.availability !== 'available') return false
    if (model.contractStatus === 'broken' || spec?.hidden) return false
    const outputs = Array.isArray(model.output_modalities) ? model.output_modalities : []
    if (model.task !== kind && !outputs.includes(kind)) return false
    if (kind !== 'video') return true
    const inputs = Array.isArray(model.input_modalities) ? model.input_modalities : []
    return inputs.includes('image') || Boolean(spec?.files?.images?.max)
  }).map(model => ({
    id: String(model.id),
    label: String(model.label || model.display_name || model.id),
    price: typeof model.price === 'number' || typeof model.price === 'string' ? model.price : undefined,
    resolutions: getCreationModelSpec(String(model.id))?.capabilities.resolutions,
    duration: getCreationModelSpec(String(model.id))?.capabilities.duration,
    maxImages: getCreationModelSpec(String(model.id))?.files?.images?.max,
  })).sort((a, b) => rank(a) - rank(b))
}

export function useManjuAuto(options: {
  owner: () => string | undefined
  /** 等当前回合结束后发送一条消息，并等待它的回合结束。 */
  sendText: (text: string) => Promise<void>
}) {
  const run = ref<AutoRunState | null>(null)
  const draft = ref<ManjuAutoDraft | null>(null)
  const review = shallowRef<{ ids: string[]; images: Record<string, string> } | null>(null)
  /** 审片：本集各段视频（按片段顺序），revised 为按修改意见重做过的段号（从 0 起）。忙碌与错误沿用 reviewBusy / reviewErrors，键为段号，整集修改用 revise。 */
  const cutReview = shallowRef<{ episode: number; videos: string[]; revised?: number[] } | null>(null)
  /** 审图时正在单独重新生成的图，以及每张图最近一次重新生成的错误。 */
  const reviewBusy = ref<Record<string, boolean>>({})
  const reviewErrors = ref<Record<string, string>>({})
  const error = ref('')
  const preparing = ref(false)
  /** 每次运行独立的停止开关：新运行不会把旧运行的“停止”重置掉。 */
  let session: { stopped: boolean; wakers: Set<() => void> } | undefined
  /** 已点停止、正在等当前步骤收尾（模型回合或正在上传的视频结束后才真正停下）。 */
  const stopping = ref(false)
  let runFinished: Promise<void> | undefined
  let reviewResolve: ((value: 'approved' | 'stopped') => void) | undefined
  let cutResolve: ((value: 'approved' | 'stopped') => void) | undefined
  let liveDeps: Parameters<typeof runAuto>[1] | undefined
  // runAuto 原地修改这份状态；事件处理必须改同一个对象，run.value 只是界面快照。
  let liveState: AutoRunState | undefined

  const files = (owner: string) => createSkillDraftFiles(createRuntimeProjectFileService(), owner)
  const checkpointPath = (wikiRoot: string, route: string, episode: number) => `${wikiRoot}/制作流水线/${route}/第${episode}集进度.json`

  async function readJson<T>(owner: string, path: string): Promise<T | undefined> {
    const list = await createRuntimeProjectFileService().list(owner)
    if (!list.some(resource => !resource.isDirectory && String(resource.path) === path)) return undefined
    return JSON.parse(await files(owner).readText(path)) as T
  }

  /**
   * 入稿回合结束后：扫描分集剧本、读取已确认比例、列出可用模型，弹出确认卡。
   * onlyIfReady：切换模式时用，没有分集剧本也没有可续做的运行就不弹卡，避免挡住待发送的剧本。
   */
  async function prepare(prepareOptions: { onlyIfReady?: boolean; route?: VideoRoute; select?: number[] } = {}) {
    const owner = options.owner()
    if (!owner) return
    preparing.value = true
    error.value = ''
    try {
      const paths = (await createRuntimeProjectFileService().list(owner)).filter(resource => !resource.isDirectory).map(resource => String(resource.path))
      const matches = paths.map(path => path.match(/^(.*)\/项目资料\/分集剧本\/第(\d+)集分集剧本\.md$/)).filter(Boolean) as RegExpMatchArray[]
      const wikiRoot = matches[0]?.[1] || (paths.some(path => path.startsWith('docs/wiki/')) ? 'docs/wiki' : 'wiki')
      const episodes = [...new Set(matches.filter(match => match[1] === wikiRoot).map(match => Number(match[2])))].sort((a, b) => a - b)
      const stylePath = `${wikiRoot}/项目风格/影片比例与风格.md`
      const style = paths.includes(stylePath) ? await files(owner).readText(stylePath) : ''
      const ratio = style.match(/(\d+)\s*[:：]\s*(\d+)/)?.slice(1, 3).join(':')
      const saved = await readJson<AutoRunState>(owner, `${wikiRoot}/${AUTO_RUN_PATH}`)
      if (prepareOptions.onlyIfReady && !episodes.length && (!saved || saved.status === 'done')) return
      const checkpoints: ManjuAutoDraft['checkpoints'] = { Seedance: {}, H3: {} }
      for (const route of ['Seedance', 'H3'] as const) for (const episode of episodes) {
        const path = checkpointPath(wikiRoot, route, episode)
        if (paths.includes(path)) checkpoints[route][episode] = JSON.parse(await files(owner).readText(path)) as RunnerCheckpoint
      }
      const models: Array<Record<string, unknown>> = []
      let cursor: string | null | undefined
      for (let page = 0; page < 10; page += 1) {
        const catalog = await runCreationOperation('list_creation_models', { limit: 100, ...(cursor ? { cursor } : {}) }) as { models?: Array<Record<string, unknown>>; next_cursor?: string | null }
        models.push(...(catalog.models || []))
        cursor = catalog.next_cursor
        if (!cursor) break
      }
      draft.value = {
        wikiRoot, episodes, ratio,
        advice: referenceAdvice(style),
        imageModels: normalizeModels(models, 'image'),
        videoModels: normalizeModels(models, 'video'),
        saved: saved && saved.status !== 'done' ? saved : undefined,
        last: saved?.config,
        checkpoints,
        route: prepareOptions.route,
        select: prepareOptions.select,
      }
    } catch (cause) {
      error.value = `无法准备全自动成片：${cause instanceof Error ? cause.message : String(cause)}`
    } finally {
      preparing.value = false
    }
  }

  async function start(config: AutoRunConfig, resume = false) {
    const owner = options.owner()
    const current = draft.value
    if (!owner || !current || run.value?.status === 'running') return
    if (runFinished) {
      error.value = '上一轮全自动还在收尾，请稍等几秒再续做'
      return
    }
    const state = { ...(resume && current.saved ? resumeAutoRun(current.saved, config) : createAutoRun(config)), runId: crypto.randomUUID() }
    const { wikiRoot } = current
    const mine = { stopped: false, wakers: new Set<() => void>() }
    // 运行器的 30 分钟等待和生图的 30 秒轮询都要能被“停止”立即唤醒。
    const sleep = (ms: number) => new Promise<void>(resolve => {
      const wake = () => { clearTimeout(timer); mine.wakers.delete(wake); resolve() }
      const timer = setTimeout(wake, ms)
      mine.wakers.add(wake)
    })
    let claimed = false
    session = mine
    draft.value = null
    error.value = ''
    run.value = state
    let finish: () => void = () => {}
    runFinished = new Promise(resolve => { finish = resolve })
    try {
      // 只写提示词时不生图也不生视频，不读取模型参数（生图模型可以未选）。
      const media = state.config.target !== 'prompts'
      const [imageProfile, videoProfile] = media
        ? await Promise.all([loadMediaParamProfile(state.config.imageModelId), loadMediaParamProfile(state.config.videoModelId)])
        : [{ keys: [], imageKey: 'images' }, { keys: [], imageKey: 'images' }]
      const projectFiles = files(owner)
      const deps: Parameters<typeof runAuto>[1] = {
        wikiRoot,
        runEpisodeText: (episode, rewrite) => options.sendText(episodeInstruction(episode, wikiRoot, state.config, rewrite)),
        readCheckpoint: episode => readJson<RunnerCheckpoint>(owner, checkpointPath(wikiRoot, state.config.videoModel, episode)),
        asset: { ...createDesktopAssetDeps(owner, { imageModelId: state.config.imageModelId, ratio: state.config.ratio }, imageProfile), sleep },
        video: createDesktopVideoDeps(owner, { videoModelId: state.config.videoModelId, ratio: state.config.ratio, resolution: state.config.videoResolution }, videoProfile),
        async concat(videos, durations, outputPath) {
          await invoke('media_concat_videos', { input: { inputs: videos, durations, outputPath: `${owner.replace(/[\\/]+$/, '')}/${outputPath}` } })
          emitEvent('project-filetree:locate', { path: outputPath, owner, refresh: true, quiet: true })
        },
        waitForReview(ids, images) {
          reviewBusy.value = {}
          reviewErrors.value = {}
          review.value = { ids, images }
          return new Promise(resolve => { reviewResolve = resolve })
        },
        waitForVideoReview(episode, videos) {
          reviewBusy.value = {}
          reviewErrors.value = {}
          cutReview.value = { episode, videos }
          return new Promise(resolve => { cutResolve = resolve })
        },
        async save(next) {
          // 第一次保存是“认领”：直接写入本轮 runId；之后每次保存才检查是否已被更新的运行接管。
          const onDisk = claimed ? await readJson<AutoRunState>(owner, `${wikiRoot}/${AUTO_RUN_PATH}`) : undefined
          claimed = true
          if (onDisk?.runId && onDisk.runId !== next.runId) {
            mine.stopped = true
            throw new Error('已有更新的全自动运行，本轮退出')
          }
          if (session === mine) run.value = { ...next, episodes: { ...next.episodes } }
          await projectFiles.writeText(`${wikiRoot}/${AUTO_RUN_PATH}`, JSON.stringify(next, null, 2) + '\n')
        },
        shouldStop: () => mine.stopped,
        sleep,
      }
      // 本路线还没写、另一路线已写完的集：沿用共用的项目资料、资产与工程剧本，只按本路线重写视频提示词。
      const other: VideoRoute = state.config.videoModel === 'H3' ? 'Seedance' : 'H3'
      for (const episode of state.config.episodes) {
        const done = current.checkpoints[other][episode]
        if (current.checkpoints[state.config.videoModel][episode] || done?.stage !== 'complete') continue
        const derived = deriveCheckpoint(done as unknown as Record<string, unknown>, state.config.videoModel, state.config.limits)
        await projectFiles.writeText(checkpointPath(wikiRoot, state.config.videoModel, episode), JSON.stringify(derived, null, 2) + '\n')
      }
      liveDeps = deps
      liveState = state
      await runAuto(state, deps)
    } catch (cause) {
      if (session === mine) {
        error.value = `全自动成片已暂停：${cause instanceof Error ? cause.message : String(cause)}`
        if (run.value) run.value = { ...run.value, status: 'stopped' }
      }
    } finally {
      if (session === mine) {
        liveDeps = undefined
        liveState = undefined
        review.value = null
        cutReview.value = null
      }
      if (session === mine) stopping.value = false
      runFinished = undefined
      finish()
    }
  }

  /** 进度 JSON 保存事件：资产阶段一保存就提交生图。 */
  async function handleArtifactSaved(path: string) {
    const owner = options.owner()
    const state = liveState
    if (!owner || !state || state.status !== 'running' || !liveDeps || !/\/制作流水线\/[^/]+\/第\d+集进度\.json$/.test(path)) return
    const checkpoint = await readJson<RunnerCheckpoint>(owner, path)
    if (checkpoint?.stage === 'assets') await handleCheckpointSaved(state, checkpoint, liveDeps).catch(cause => {
      error.value = `资产生图提交失败：${cause instanceof Error ? cause.message : String(cause)}`
    })
  }

  async function registryEntry(id: string): Promise<AssetRegistryEntry> {
    const owner = options.owner()
    const entry = owner && liveDeps ? (await readJson<{ assets: Record<string, AssetRegistryEntry> }>(owner, `${liveDeps.wikiRoot}/${ASSET_REGISTRY_PATH}`))?.assets[id] : undefined
    if (!entry) throw new Error(`找不到资产：${id}`)
    return entry
  }

  /** 审图面板读取一张图的提示词正文（不含标题）。 */
  async function loadPrompt(id: string): Promise<string> {
    const owner = options.owner()!
    return promptBody(await files(owner).readText((await registryEntry(id)).prompt_path))
  }

  /** 改写一个 Wiki 提示词正文，保留原标题；返回写入后的全文。 */
  async function rewritePrompt(owner: string, path: string, body: string) {
    const original = await files(owner).readText(path)
    const heading = original.match(/^(?:\s*#[^\n]*\n)+/)?.[0] || ''
    const text = `${heading}${body.trim()}\n`
    await files(owner).writeText(path, text)
    return text
  }

  async function segmentCheckpoint() {
    const current = cutReview.value
    const checkpoint = current && liveDeps ? await liveDeps.readCheckpoint(current.episode) : undefined
    if (!current || !checkpoint) throw new Error('找不到本集进度')
    return checkpoint
  }

  /** 审片面板读取一段的视频提示词正文（index 从 0 起）。 */
  async function loadSegmentPrompt(index: number): Promise<string> {
    const checkpoint = await segmentCheckpoint()
    return promptBody(await files(options.owner()!).readText(checkpoint.segments[index].path))
  }

  /** 审片时单独重做一段：可先改提示词（保留标题），沿用原参考图与时长，只动这一段。 */
  async function regenerateSegment(index: number, newPrompt?: string) {
    const owner = options.owner()
    const deps = liveDeps
    const key = String(index)
    if (!owner || !deps || !cutReview.value || reviewBusy.value[key]) return
    reviewBusy.value = { ...reviewBusy.value, [key]: true }
    reviewErrors.value = { ...reviewErrors.value, [key]: '' }
    try {
      const checkpoint = await segmentCheckpoint()
      if (newPrompt !== undefined) await rewritePrompt(owner, checkpoint.segments[index].path, newPrompt)
      await resubmitSegment(deps.wikiRoot, checkpoint, index, deps.video)
      const video = await awaitSegment(deps.wikiRoot, checkpoint, index, deps.video, { sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs: 60 * 60_000 })
      if (cutReview.value) cutReview.value = { ...cutReview.value, videos: cutReview.value.videos.map((item, i) => i === index ? video : item) }
    } catch (cause) {
      reviewErrors.value = { ...reviewErrors.value, [key]: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      reviewBusy.value = { ...reviewBusy.value, [key]: false }
    }
  }

  /**
   * 审片后按修改意见重做本集：模型改工程剧本（或只改受影响的提示词），之后只重新提交提示词变了的段，
   * 出齐后回到审片，可以反复改直到满意。
   */
  async function reviseEpisode(notes: ReviewNotes) {
    const deps = liveDeps
    const state = liveState
    const current = cutReview.value
    if (!deps || !state || !current || Object.values(reviewBusy.value).some(Boolean) || !Object.values(notes).some(note => note.trim())) return
    reviewBusy.value = { ...reviewBusy.value, revise: true }
    reviewErrors.value = {}
    try {
      await options.sendText(revisionInstruction(current.episode, state.config, notes))
      const checkpoint = await deps.readCheckpoint(current.episode)
      if (checkpoint?.stage !== 'complete') throw new Error(checkpoint?.reason || '修改没有完成，请看对话里的说明')
      const gate = await awaitEpisodeAssets(deps.wikiRoot, checkpoint, deps.asset, { timeoutMs: 30 * 60_000, pollMs: 5000 })
      if (gate.status !== 'ready') throw new Error(`参考图未就绪：${gate.status === 'stopped' ? '已停止' : [...gate.failed, ...gate.pending].join('、')}`)
      await submitEpisodeVideos(deps.wikiRoot, checkpoint, gate.images, deps.video)
      const deadline = Date.now() + 60 * 60_000
      for (;;) {
        const result = await checkEpisodeVideos(deps.wikiRoot, checkpoint, deps.video)
        if (result.status === 'ready') {
          if (cutReview.value) cutReview.value = { episode: current.episode, videos: result.videos, revised: result.videos.flatMap((video, i) => video === current.videos[i] ? [] : [i]) }
          break
        }
        if (result.status === 'failed') throw new Error(`第${result.failed.join('、')}段视频生成失败`)
        if (Date.now() >= deadline) throw new Error('等待重做的片段超时')
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    } catch (cause) {
      reviewErrors.value = { revise: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      reviewBusy.value = { ...reviewBusy.value, revise: false }
    }
  }

  function approveCut() {
    if (Object.values(reviewBusy.value).some(Boolean)) return
    cutReview.value = null
    cutResolve?.('approved')
  }

  /** 审图时单独重新生成一张：可先把改过的提示词写回 Wiki（保留原标题），只动这一张。 */
  async function regenerate(id: string, newPrompt?: string) {
    const owner = options.owner()
    const deps = liveDeps
    if (!owner || !deps || !review.value || reviewBusy.value[id]) return
    reviewBusy.value = { ...reviewBusy.value, [id]: true }
    reviewErrors.value = { ...reviewErrors.value, [id]: '' }
    let touched = [id]
    try {
      let hash: string | undefined
      if (newPrompt !== undefined) {
        const text = await rewritePrompt(owner, (await registryEntry(id)).prompt_path, newPrompt)
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      }
      // 身份图或服装图重做后，由它融合出的造型也跟着重做，一并在面板里更新。
      const dependents = await regenerateAsset(deps.wikiRoot, id, deps.asset, hash)
      touched = [id, ...dependents]
      reviewBusy.value = { ...reviewBusy.value, ...Object.fromEntries(dependents.map(dependent => [dependent, true])) }
      for (const target of [id, ...dependents]) {
        const image = await awaitAsset(deps.wikiRoot, target, deps.asset, { timeoutMs: 30 * 60_000, pollMs: 5000 })
        if (review.value) review.value = { ...review.value, images: { ...review.value.images, [target]: image } }
        if (target !== id) reviewBusy.value = { ...reviewBusy.value, [target]: false }
      }
    } catch (cause) {
      reviewErrors.value = { ...reviewErrors.value, [id]: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      reviewBusy.value = { ...reviewBusy.value, ...Object.fromEntries(touched.map(target => [target, false])) }
    }
  }

  function approveReview() {
    if (Object.values(reviewBusy.value).some(Boolean)) return
    review.value = null
    reviewResolve?.('approved')
  }

  function stop() {
    if (session && run.value?.status === 'running') stopping.value = true
    if (session) session.stopped = true
    for (const wake of [...session?.wakers ?? []]) wake()
    if (review.value) {
      review.value = null
      reviewResolve?.('stopped')
    }
    if (cutReview.value) {
      cutReview.value = null
      cutResolve?.('stopped')
    }
  }

  return { run, stopping, draft, review, cutReview, loadSegmentPrompt, regenerateSegment, reviseEpisode, approveCut, reviewBusy, reviewErrors, loadPrompt, regenerate, error, preparing, prepare, start, stop, approveReview, handleArtifactSaved, cancelDraft: () => { draft.value = null } }
}
