/**
 * 漫剧全自动成片的桌面控制器：把 autoRunner 接到工作台（发送消息、文件树、ffmpeg、审图界面）。
 * 只有用户在启动确认卡点“开始”后才会提交任何付费任务。
 */
import { invoke } from '@tauri-apps/api/core'
import { ref, shallowRef } from 'vue'
import { runCreationOperation } from '@/runtime/creation/creationMcpBridge'
import { getCreationModelSpec, prioritizedCreationModelIds } from '@/runtime/creation/creationModelRegistry'
import { createAutoRun, episodeInstruction, handleCheckpointSaved, resumeAutoRun, runAuto, AUTO_RUN_PATH, type AutoRunConfig, type AutoRunState, type RunnerCheckpoint, type VideoRoute } from '@/runtime/manjuAuto/autoRunner'
import { createDesktopAssetDeps, createDesktopVideoDeps, loadMediaParamProfile } from '@/runtime/manjuAuto/desktopDeps'
import { ASSET_REGISTRY_PATH, awaitAsset, promptBody, regenerateAsset, type AssetRegistryEntry } from '@/runtime/manjuAuto/assetScheduler'
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
  imageModels: ManjuAutoModelOption[]
  videoModels: ManjuAutoModelOption[]
  saved?: AutoRunState
  /** 上一次运行的设置（含已完成的运行）：确认卡默认沿用，不用每次重选模型与路线。 */
  last?: AutoRunConfig
  /** 各路线已有的每集文字进度（自由创作或之前的运行写的），确认卡据此标出哪几集可直接复用。 */
  checkpoints: Record<VideoRoute, Record<number, RunnerCheckpoint>>
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
  async function prepare(prepareOptions: { onlyIfReady?: boolean } = {}) {
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
        imageModels: normalizeModels(models, 'image'),
        videoModels: normalizeModels(models, 'video'),
        saved: saved && saved.status !== 'done' ? saved : undefined,
        last: saved?.config,
        checkpoints,
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
        const entry = await registryEntry(id)
        const original = await files(owner).readText(entry.prompt_path)
        const heading = original.match(/^(?:\s*#[^\n]*\n)+/)?.[0] || ''
        const text = `${heading}${newPrompt.trim()}\n`
        await files(owner).writeText(entry.prompt_path, text)
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
  }

  return { run, stopping, draft, review, reviewBusy, reviewErrors, loadPrompt, regenerate, error, preparing, prepare, start, stop, approveReview, handleArtifactSaved, cancelDraft: () => { draft.value = null } }
}
