import { shallowRef, type Ref } from 'vue'
import type { ManjuAutoDraft } from '@/composables/useManjuAuto'
import {
  modelLimits,
  priceForResolution,
  type AutoRunConfig,
  type AutoRunState,
  type VideoRoute,
} from '@/runtime/manjuAuto/autoRunner'
import { RemoteProtocolError } from './desktopRemoteProtocol'

/**
 * 手机操作漫剧全自动成片：工作台把它那份 useManjuAuto 登记到这里，手机的命令直接调用
 * 同一组函数（开始/续做、停止、审图确认、单张重新生成、改提示词），电脑与手机看到的是同一个运行。
 */
export type ManjuAutoController = {
  owner: () => string | undefined
  run: Ref<AutoRunState | null>
  draft: Ref<ManjuAutoDraft | null>
  review: Ref<{ ids: string[]; images: Record<string, string> } | null>
  reviewBusy: Ref<Record<string, boolean>>
  reviewErrors: Ref<Record<string, string>>
  error: Ref<string>
  preparing: Ref<boolean>
  prepare: (options?: { onlyIfReady?: boolean }) => Promise<void>
  start: (config: AutoRunConfig, resume?: boolean) => Promise<void>
  stop: () => void
  approveReview: () => void
  regenerate: (id: string, prompt?: string) => Promise<void>
  loadPrompt: (id: string) => Promise<string>
  cancelDraft: () => void
}

export type RemoteManjuChoice = {
  episodes: number[]
  imageModelId: string
  videoModelId: string
  reviewMode: 'new' | 'first' | 'off'
  route?: VideoRoute
  videoResolution?: string
  budget?: number
}

const controller = shallowRef<ManjuAutoController | null>(null)

export function setDesktopManjuAuto(next: ManjuAutoController | null) {
  controller.value = next
}

function invalid(): never {
  throw new RemoteProtocolError('MANJU_CONFIG_INVALID')
}

const resolutionHeight = (value: string) => Number(value.replace(/\D/g, '')) || Infinity

/** 与 ManjuAutoPanel 的 startNew 同一规则：默认最低分辨率并按该档计价，续做沿用原路线。 */
export function buildRemoteAutoRunConfig(draft: ManjuAutoDraft, choice: RemoteManjuChoice): AutoRunConfig {
  const episodes = [...new Set(Array.isArray(choice?.episodes) ? choice.episodes : [])].sort((a, b) => a - b)
  const imageModel = draft.imageModels.find(model => model.id === choice?.imageModelId)
  const videoModel = draft.videoModels.find(model => model.id === choice?.videoModelId)
  if (!draft.ratio || !episodes.length || episodes.some(episode => !draft.episodes.includes(episode))
    || !imageModel || !videoModel || !['new', 'first', 'off'].includes(choice.reviewMode)) invalid()
  const route: VideoRoute = draft.saved?.config.videoModel ?? (choice.route === 'H3' ? 'H3' : 'Seedance')
  const resolutions = videoModel.resolutions || []
  if (choice.videoResolution && !resolutions.includes(choice.videoResolution)) invalid()
  const videoResolution = choice.videoResolution
    || resolutions.slice().sort((a, b) => resolutionHeight(a) - resolutionHeight(b))[0] || ''
  const budget = Number(choice.budget)
  return {
    episodes,
    videoModel: route,
    limits: modelLimits(route, videoModel),
    imageModelId: imageModel.id,
    videoModelId: videoModel.id,
    ratio: draft.ratio,
    review: choice.reviewMode !== 'off',
    reviewMode: choice.reviewMode,
    budgetPerEpisode: choice.budget !== undefined && Number.isFinite(budget) && budget > 0 ? budget : undefined,
    imagePrice: imageModel.price,
    videoResolution: videoResolution || undefined,
    videoPrice: priceForResolution(videoModel.price, videoResolution) ?? videoModel.price,
  }
}

function active(owner: string) {
  const current = controller.value
  return current && current.owner() === owner ? current : null
}

function relative(owner: string, path: string | undefined) {
  const root = `${owner.replace(/\\/g, '/').replace(/\/$/, '')}/`
  const normalized = String(path || '').replace(/\\/g, '/')
  return normalized.startsWith(root) ? normalized.slice(root.length) : null
}

/** 发给手机的全自动状态：不含绝对路径与产出路径；图片给项目内相对路径，由手机经「看成果」通道取。 */
export function manjuAutoProjection(owner: string) {
  const current = active(owner)
  if (!current) return null
  const run = current.run.value
  const draft = current.draft.value
  const review = current.review.value
  return {
    preparing: current.preparing.value,
    error: current.error.value,
    run: run ? {
      status: run.status,
      episodes: Object.fromEntries(Object.entries(run.episodes).map(([key, episode]) =>
        [key, { phase: episode.phase, ...episode.reason ? { reason: episode.reason } : {} }])),
    } : null,
    draft: draft ? {
      episodes: draft.episodes,
      ratio: draft.ratio ?? null,
      imageModels: draft.imageModels,
      videoModels: draft.videoModels,
      saved: draft.saved ? {
        route: draft.saved.config.videoModel,
        episodes: Object.fromEntries(Object.entries(draft.saved.episodes).map(([key, episode]) => [key, episode.phase])),
      } : null,
    } : null,
    review: review ? review.ids.map(id => ({
      id,
      path: relative(owner, review.images[id]),
      busy: Boolean(current.reviewBusy.value[id]),
      error: current.reviewErrors.value[id] || '',
    })) : null,
  }
}

export async function runManjuCommand(owner: string, type: string, payload: Record<string, unknown>) {
  const current = active(owner)
  if (!current) throw new RemoteProtocolError('MANJU_UNAVAILABLE')
  const reviewId = () => {
    const id = String(payload.id ?? '')
    if (!current.review.value?.ids.includes(id)) throw new RemoteProtocolError('MANJU_REVIEW_ITEM_INVALID')
    return id
  }
  switch (type) {
    case 'manju.prepare':
      await current.prepare()
      return { ok: true }
    case 'manju.cancel':
      current.cancelDraft()
      return { ok: true }
    case 'manju.start': {
      if (current.run.value?.status === 'running') throw new RemoteProtocolError('MANJU_RUNNING')
      const draft = current.draft.value
      if (!draft) throw new RemoteProtocolError('MANJU_CONFIG_INVALID')
      const config = buildRemoteAutoRunConfig(draft, payload.choice as RemoteManjuChoice)
      // 整场要跑很久：开始即回执，进度经推送回到手机。
      void current.start(config, payload.resume === true && Boolean(draft.saved))
      return { started: true }
    }
    case 'manju.stop':
      current.stop()
      return { ok: true }
    case 'manju.approve':
      if (!current.review.value) throw new RemoteProtocolError('MANJU_REVIEW_NONE')
      if (Object.values(current.reviewBusy.value).some(Boolean)) throw new RemoteProtocolError('MANJU_REVIEW_BUSY')
      current.approveReview()
      return { ok: true }
    case 'manju.regenerate': {
      const id = reviewId()
      const prompt = typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt : undefined
      void current.regenerate(id, prompt)
      return { ok: true }
    }
    case 'manju.prompt':
      return { prompt: await current.loadPrompt(reviewId()) }
    default:
      throw new RemoteProtocolError('UNSUPPORTED_MESSAGE')
  }
}
