export type MediaTaskKind = 'image' | 'video' | 'digital-human' | 'audio'

export type MediaFieldKind =
  | 'prompt'
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'boolean'
  | 'image'
  | 'images'
  | 'video'
  | 'audio'

export interface MediaFieldOption {
  value: string | number | boolean
  label: string
}

export interface MediaModelField {
  key: string
  label: string
  kind: MediaFieldKind
  required?: boolean
  defaultValue?: string | number | boolean
  options?: MediaFieldOption[]
  min?: number
  max?: number
  step?: number
}

export interface MediaModelCapability {
  id: string
  label: string
  task: MediaTaskKind
  model: string
  provider: 'gateway-image' | 'gateway-video' | 'gateway-audio' | 'runninghub-video' | 'runninghub-audio'
  endpoint?: string
  maxFiles?: number
  acceptedFiles?: Array<'image' | 'video' | 'audio'>
  fields: MediaModelField[]
}

const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840']
const NANO_ASPECT_RATIOS = ['4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '1:1', '4:5', '5:4', '21:9']
const VIDEO_RATIOS = ['2:3', '3:2', '1:1', '16:9', '9:16']
const VEO_RATIOS = ['16:9', '9:16']
const SUNO_MV = ['chirp-fenix', 'chirp-crow', 'chirp-bluejay', 'chirp-auk-turbo', 'chirp-auk', 'chirp-v4', 'chirp-v3-5', 'chirp-v3.0']
const LANGUAGES = ['自动', '中文', '英文', '日文', '韩文', '德文', '法文', '俄文', '葡萄牙文', '西班牙文', '意大利文']

function options(values: Array<string | number | boolean>): MediaFieldOption[] {
  return values.map(value => ({ value, label: String(value) }))
}

export const MEDIA_MODEL_CAPABILITIES: MediaModelCapability[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    task: 'image',
    model: 'gpt-image-2',
    provider: 'gateway-image',
    maxFiles: 5,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'size', label: '尺寸', kind: 'select', defaultValue: 'auto', options: options(GPT_IMAGE_SIZES) },
      { key: 'image', label: '参考图', kind: 'images' },
      { key: 'response_format', label: '返回格式', kind: 'select', defaultValue: 'url', options: options(['url', 'b64_json']) },
    ],
  },
  {
    id: 'nano-banana-2k',
    label: 'Nano Banana 2K',
    task: 'image',
    model: 'nano-banana-2k',
    provider: 'gateway-image',
    maxFiles: 8,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(NANO_ASPECT_RATIOS) },
      { key: 'response_format', label: '返回格式', kind: 'select', defaultValue: 'url', options: options(['url', 'b64_json']) },
      { key: 'image', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'nano-banana-4k',
    label: 'Nano Banana 4K',
    task: 'image',
    model: 'nano-banana-4k',
    provider: 'gateway-image',
    maxFiles: 8,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(NANO_ASPECT_RATIOS) },
      { key: 'response_format', label: '返回格式', kind: 'select', defaultValue: 'url', options: options(['url', 'b64_json']) },
      { key: 'image', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'grok-video-3',
    label: 'Grok Video 3',
    task: 'video',
    model: 'grok-video-3',
    provider: 'runninghub-video',
    endpoint: '/openapi/v2/rhart-video-g/image-to-video',
    maxFiles: 7,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['2:3', '3:2', '1:1', '16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p', '480p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 6, min: 6, max: 30, step: 1 },
      { key: 'images', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'veo3.1-fast',
    label: 'Veo Fast',
    task: 'video',
    model: 'veo3.1-fast',
    provider: 'gateway-video',
    maxFiles: 3,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(VEO_RATIOS) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720P', options: options(['720P', '1080P']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 8, options: options([8]) },
      { key: 'images', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'seedance-2-0',
    label: 'Seedance 2.0',
    task: 'video',
    model: 'seedance-2-0-pro',
    provider: 'gateway-video',
    endpoint: '/api/seedance/v1/videos',
    maxFiles: 9,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p', '1080p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图 (0-9张)', kind: 'images' },
    ],
  },
  {
    id: 'suno-custom-song',
    label: 'Suno 自定义歌曲',
    task: 'audio',
    model: 'suno_music',
    provider: 'gateway-audio',
    fields: [
      { key: 'title', label: '歌曲标题', kind: 'text', required: true },
      { key: 'tags', label: '音乐风格', kind: 'text', required: true },
      { key: 'negative_tags', label: '排除风格', kind: 'text' },
      { key: 'mv', label: 'Suno 版本', kind: 'select', defaultValue: 'chirp-fenix', options: options(SUNO_MV) },
      { key: 'prompt', label: '歌词/提示词', kind: 'prompt', required: true },
    ],
  }
]

export const MEDIA_TASK_LABELS: Record<MediaTaskKind, string> = {
  image: '图片',
  video: '视频',
  'digital-human': '数字人',
  audio: '音频',
}

export function getMediaModelsForTask(task: MediaTaskKind): MediaModelCapability[] {
  return MEDIA_MODEL_CAPABILITIES.filter(model => model.task === task)
}

export function getMediaModel(id: string): MediaModelCapability | undefined {
  return MEDIA_MODEL_CAPABILITIES.find(model => model.id === id || model.model === id)
}

export function isMediaModelEnabled(id: string): boolean {
  return Boolean(getMediaModel(id))
}

export function isRemovedMediaModelId(id: string): boolean {
  const value = String(id || '').trim().toLowerCase()
  if (!value) return false
  if (value === 'nano-banana' || value === 'nano-banana-hd') return true
  if (value === 'grok-4.2-image' || value === 'grok-4.1-image') return true
  if (value.includes('seedance')) {
    // 只保留新版 Seedance 2.0 系列 (doubao-seedance-2-0-*)
    if (value.startsWith('doubao-seedance-2-0-')) return false
    return value !== 'seedance-2-0' && value !== 'seedance-2-0-pro'
  }
  return false
}

export function getMediaField(model: MediaModelCapability | undefined, key: string): MediaModelField | undefined {
  return model?.fields.find(field => field.key === key)
}

export function mediaFieldOptions(model: MediaModelCapability | undefined, key: string): MediaFieldOption[] {
  return getMediaField(model, key)?.options || []
}

