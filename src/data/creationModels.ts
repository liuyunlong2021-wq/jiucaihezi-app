/**
 * creationModels.ts — 创作面板模型定义（精简版）
 *
 * 全部走 NewAPI，只保留 6 个模型：
 * 图片: gpt-image-2
 * 视频: grok-video-3, veo3.1-fast, seedance-2.0, seedance-2.0-fast
 * 音乐: suno v5.5
 *
 * API 文档参考:
 * - T8gpt2.md (generations + edits 双接口)
 * - T8grok.md (v2/videos/generations + 轮询)
 * - T8 异步文档.md (图片异步 ?async=true)
 * - seedance-2.0-fast-use-guide.md (sd2 独立平台)
 * - T8suno 音乐模型文档.md (suno/generate + feed)
 */

// ─── 任务类型 ───
export type CreationTask =
  | 'text-image' | 'image-image'
  | 'text-video' | 'image-video'
  | 'text-music'

export const RH_TASK_LABELS: Record<CreationTask, string> = {
  'text-image': '文生图',
  'image-image': '图生图',
  'text-video': '文生视频',
  'image-video': '图生视频',
  'text-music': '音乐创作',
}

// ─── 模型配置 ───
export interface CreationModel {
  label: string
  tasks: CreationTask[]
  provider: 'newapi-image' | 'newapi-video' | 'newapi-suno'
  modelName: string
  /** 图片 size 选项 */
  sizes?: string[]
  defSize?: string
  /** 视频 ratio 选项 */
  ar?: string[]
  defAr?: string
  /** 视频 resolution 选项 */
  res?: string[]
  defRes?: string
  /** 视频 duration 选项 */
  dur?: number[]
  defDur?: number
  /** 最大参考图数量（默认 1） */
  maxFiles?: number
  /** Suno mv 版本 */
  sunoMv?: string
}

// 全部 6 个模型
export const RH_CREATION_MODELS: Record<string, CreationModel> = {

  // ═══ 图片 ═══
  'gpt-image-2': {
    label: 'GPT Image 2',
    tasks: ['text-image', 'image-image'],
    provider: 'newapi-image',
    modelName: 'gpt-image-2',
    // T8gpt2.md: size 参数
    sizes: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'],
    defSize: 'auto',
    maxFiles: 5,
  },

  // ═══ 图片 — Grok Image (T8grok.md: grok-4.2-image) ═══
  'grok-4.2-image': {
    label: 'Grok Image',
    tasks: ['text-image', 'image-image'],
    provider: 'newapi-image',
    modelName: 'grok-4.2-image',
    // T8grok.md: aspect_ratio 参数（非 size）
    ar: ['1:1', '2:3', '3:2', '9:16', '16:9'],
    defAr: '1:1',
    maxFiles: 1,
  },

  // ═══ 视频 — Grok Video HD (渠道18: 720P/1080P, 10-15秒, ¥0.2/秒) ═══
  'grok-video-3': {
    label: 'Grok Video HD',
    tasks: ['text-video', 'image-video'],
    provider: 'newapi-video',
    modelName: 'grok-video-3',
    ar: ['1:1', '2:3', '3:2', '16:9', '9:16'],
    defAr: '16:9',
    res: ['720P', '1080P'],
    defRes: '720P',
    dur: [6, 10],   // T8grok.md: duration enum 6, 10
    defDur: 6,
    maxFiles: 7,  // 最多7张参考图
  },

  // ═══ 视频 — Grok Video Flex (渠道36: 720P, 6-30秒, ¥0.3/秒) ═══
  'grok-video-3-fast': {
    label: 'Grok Video Flex',
    tasks: ['text-video', 'image-video'],
    provider: 'newapi-video',
    modelName: 'grok-video-3-fast',
    ar: ['1:1', '2:3', '3:2', '16:9', '9:16'],
    defAr: '16:9',
    res: ['720P'],
    defRes: '720P',
    dur: [6, 30],
    defDur: 10,
    maxFiles: 7,  // 最多7张参考图
  },

  // ═══ 视频 — Veo ═══
  'veo31-fast': {
    label: 'Veo 3.1 Fast',
    tasks: ['text-video', 'image-video'],
    provider: 'newapi-video',
    modelName: 'veo3.1-fast',
    // 走 /v1/video/generations 格式
    ar: ['16:9', '9:16'],
    defAr: '16:9',
    dur: [8],
    defDur: 8,
    maxFiles: 3,
  },

  // ═══ 视频 — Seedance 2.0 基础版 ═══
  'seedance-2-0': {
    label: 'Seedance 2.0',
    tasks: ['text-video', 'image-video'],
    provider: 'newapi-video',
    modelName: 'seedance-2-0',
    ar: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    defAr: '16:9',
    dur: [4, 15],
    defDur: 8,
    res: ['480p', '720p', '1080p'],
    defRes: '720p',
    maxFiles: 7,
  },

  // ═══ 视频 — Seedance 2.0 Fast ═══
  'seedance-2-0-fast': {
    label: 'Seedance 2.0 Fast',
    tasks: ['text-video', 'image-video'],
    provider: 'newapi-video',
    modelName: 'seedance-2-0-fast',
    ar: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    defAr: '16:9',
    dur: [4, 15],
    defDur: 5,
    maxFiles: 7,
  },

  // ═══ 视频 — Seedance 2.0 Pro ═══
  'seedance-2-0-pro': {
    label: 'Seedance 2.0 Pro',
    tasks: ['text-video', 'image-video'],
    provider: 'newapi-video',
    modelName: 'seedance-2-0-pro',
    ar: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    defAr: '16:9',
    dur: [4, 15],
    defDur: 8,
    res: ['480p', '720p', '1080p'],
    defRes: '720p',
    maxFiles: 7,
  },

  // ═══ 音乐 — Suno v5.5 ═══
  'suno-5.5': {
    label: 'Suno 5.5',
    tasks: ['text-music'],
    provider: 'newapi-suno',
    modelName: 'suno_music',
    sunoMv: 'chirp-fenix',
  },
}

// ─── 工具函数 ───
export function getModelsForTask(task: CreationTask): string[] {
  return Object.keys(RH_CREATION_MODELS).filter(k => RH_CREATION_MODELS[k].tasks.includes(task))
}

export function getAspectOptions(model: CreationModel, _task: CreationTask): string[] {
  return model.ar || []
}

export function getDefaultAspect(model: CreationModel, _task: CreationTask): string {
  return model.defAr || (getAspectOptions(model, _task)[0] || '')
}

export function getSizeOptions(model: CreationModel): string[] {
  return model.sizes || []
}

export function getDefaultSize(model: CreationModel): string {
  return model.defSize || (getSizeOptions(model)[0] || '')
}

export function getResolutionOptions(model: CreationModel): string[] {
  return model.res || []
}

export function getDefaultResolution(model: CreationModel): string {
  return model.defRes || (getResolutionOptions(model)[0] || '')
}
