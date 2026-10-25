/**
 * 漫剧全自动成片的桌面控制器：把 autoRunner 接到工作台（发送消息、文件树、ffmpeg、审图界面）。
 * 只有用户在启动确认卡点“开始”后才会提交任何付费任务。
 */
import { invoke } from '@tauri-apps/api/core'
import { ref, shallowRef } from 'vue'
import { runCreationOperation } from '@/runtime/creation/creationMcpBridge'
import { getCreationModelSpec, prioritizedCreationModelIds } from '@/runtime/creation/creationModelRegistry'
import { createAutoRun, handleCheckpointSaved, resumeAutoRun, runAuto, AUTO_RUN_PATH, type AutoRunConfig, type AutoRunState, type RunnerCheckpoint } from '@/runtime/manjuAuto/autoRunner'
import { createDesktopAssetDeps, createDesktopVideoDeps, loadMediaParamProfile } from '@/runtime/manjuAuto/desktopDeps'
import { createRuntimeProjectFileService, createSkillDraftFiles } from '@/services/projectFileService'
import { emitEvent } from '@/utils/eventBus'

export interface ManjuAutoModelOption { id: string; label: string; price?: number | string }

export interface ManjuAutoDraft {
  wikiRoot: string
  episodes: number[]
  ratio?: string
  imageModels: ManjuAutoModelOption[]
  videoModels: ManjuAutoModelOption[]
  saved?: AutoRunState
}

export const AUTO_INTAKE_PREFIX = '【全自动成片·入稿】'
const VIDEO_MODEL = 'Seedance'

export function episodeInstruction(episode: number, wikiRoot: string) {
  return `【全自动成片·第${episode}集】请按 jc-manju-pipeline 执行第${episode}集，视频模型 ${VIDEO_MODEL}，剧本使用 ${wikiRoot}/项目资料/分集剧本/第${episode}集分集剧本.md，比例与风格沿用已确认的项目风格，并遵守本对话入稿时用户提出的制作要求，从 plan 连续执行到 complete。`
}

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
  const error = ref('')
  const preparing = ref(false)
  let stopRequested = false
  let wakeSleep: (() => void) | undefined
  let reviewResolve: ((value: 'approved' | 'stopped') => void) | undefined
  let liveDeps: Parameters<typeof runAuto>[1] | undefined
  // runAuto 原地修改这份状态；事件处理必须改同一个对象，run.value 只是界面快照。
  let liveState: AutoRunState | undefined

  const files = (owner: string) => createSkillDraftFiles(createRuntimeProjectFileService(), owner)
  const checkpointPath = (wikiRoot: string, episode: number) => `${wikiRoot}/制作流水线/${VIDEO_MODEL}/第${episode}集进度.json`

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
    const state = resume && current.saved ? resumeAutoRun(current.saved, config) : createAutoRun(config)
    const { wikiRoot } = current
    draft.value = null
    error.value = ''
    stopRequested = false
    run.value = state
    try {
      const [imageProfile, videoProfile] = await Promise.all([loadMediaParamProfile(state.config.imageModelId), loadMediaParamProfile(state.config.videoModelId)])
      const projectFiles = files(owner)
      const deps: Parameters<typeof runAuto>[1] = {
        wikiRoot,
        runEpisodeText: episode => options.sendText(episodeInstruction(episode, wikiRoot)),
        readCheckpoint: episode => readJson<RunnerCheckpoint>(owner, checkpointPath(wikiRoot, episode)),
        asset: createDesktopAssetDeps(owner, { imageModelId: state.config.imageModelId, ratio: state.config.ratio }, imageProfile),
        video: createDesktopVideoDeps(owner, { videoModelId: state.config.videoModelId, ratio: state.config.ratio }, videoProfile),
        async concat(videos, durations, outputPath) {
          await invoke('media_concat_videos', { input: { inputs: videos, durations, outputPath: `${owner.replace(/[\\/]+$/, '')}/${outputPath}` } })
          emitEvent('project-filetree:locate', { path: outputPath, owner, refresh: true, quiet: true })
        },
        waitForReview(ids, images) {
          review.value = { ids, images }
          return new Promise(resolve => { reviewResolve = resolve })
        },
        async save(next) {
          run.value = { ...next, episodes: { ...next.episodes } }
          await projectFiles.writeText(`${wikiRoot}/${AUTO_RUN_PATH}`, JSON.stringify(next, null, 2) + '\n')
        },
        shouldStop: () => stopRequested,
        sleep: ms => new Promise(resolve => {
          const timer = setTimeout(resolve, ms)
          wakeSleep = () => { clearTimeout(timer); resolve() }
        }),
      }
      liveDeps = deps
      liveState = state
      await runAuto(state, deps)
    } catch (cause) {
      error.value = `全自动成片已暂停：${cause instanceof Error ? cause.message : String(cause)}`
      if (run.value) run.value = { ...run.value, status: 'stopped' }
    } finally {
      liveDeps = undefined
      liveState = undefined
      review.value = null
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

  function approveReview() {
    review.value = null
    reviewResolve?.('approved')
  }

  function stop() {
    stopRequested = true
    wakeSleep?.()
    if (review.value) {
      review.value = null
      reviewResolve?.('stopped')
    }
  }

  return { run, draft, review, error, preparing, prepare, start, stop, approveReview, handleArtifactSaved, cancelDraft: () => { draft.value = null } }
}
