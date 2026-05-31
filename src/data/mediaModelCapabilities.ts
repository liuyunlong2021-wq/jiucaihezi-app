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
  provider: 'gateway-image' | 'gateway-video' | 'gateway-audio' | 'runninghub-video' | 'runninghub-audio' | 'runninghub-image'
  enabled?: boolean
  endpoint?: string
  webappId?: string          // RunningHub workflow ID
  maxFiles?: number
  acceptedFiles?: Array<'image' | 'video' | 'audio'>
  fields: MediaModelField[]
}

export type MediaModelAvailabilityStatus = 'enabled' | 'degraded' | 'disabled'

export interface MediaModelAvailabilityOverride {
  id: string
  status: MediaModelAvailabilityStatus
  reason?: string
  lastSuccessAt?: string
  estimatedWaitSeconds?: number
}

const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840']
const NANO_ASPECT_RATIOS = ['4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '1:1', '4:5', '5:4', '21:9']
const VIDEO_RATIOS = ['2:3', '3:2', '1:1', '16:9', '9:16']
const VEO_RATIOS = ['16:9', '9:16']
const SUNO_MV = ['chirp-fenix', 'chirp-crow', 'chirp-bluejay', 'chirp-auk-turbo', 'chirp-auk', 'chirp-v4', 'chirp-v3-5', 'chirp-v3.0']
const LANGUAGES = ['自动', '中文', '英文', '日文', '韩文', '德文', '法文', '俄文', '葡萄牙文', '西班牙文', '意大利文']
const runtimeAvailability = new Map<string, MediaModelAvailabilityOverride>()

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
    enabled: false,
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
    model: 'nano-banana-pro-4k',
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
    provider: 'gateway-video',
    webappId: 'rhart-video-g/text-or-image-to-video',
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
    enabled: false,
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
    enabled: false,
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
  },

  // ── RunningHub 模型 ──
  {
    id: 'rh-pro-image',
    label: '全能图片PRO',
    task: 'image',
    model: 'rh-pro-image',
    provider: 'gateway-image',
    webappId: 'rhart-image-n-pro/text-to-image',
    maxFiles: 5,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'size', label: '尺寸', kind: 'select', defaultValue: '1024x1024', options: options(['1024x1024', '1536x1024', '1024x1536', '2048x2048']) },
      { key: 'image', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'rh-gpt2-image',
    label: 'GPT2.0',
    task: 'image',
    model: 'rh-gpt2-image',
    provider: 'gateway-image',
    webappId: '2046514150500524033',
    maxFiles: 5,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'size', label: '尺寸', kind: 'select', defaultValue: '1024x1024', options: options(['1024x1024', '1536x1024', '1024x1536', '2048x2048']) },
      { key: 'image', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'rh-seedance2',
    label: 'Seedance 2.0',
    task: 'video',
    model: 'rh-seedance2',
    provider: 'gateway-video',
    enabled: false,
    webappId: '2034917373414539273',
    maxFiles: 3,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16', '1:1', '4:3', '3:4']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1080p', options: options(['1080p', '720p', '480p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'rh-video-v31-fast',
    label: '全能视频V3.1-Fast',
    task: 'video',
    model: 'rh-video-v31-fast',
    provider: 'gateway-video',
    enabled: false,
    webappId: 'rhart-video-v3.1-fast/text-to-video',
    maxFiles: 3,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(VIDEO_RATIOS) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p', '1080p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'rh-gpt2-text',
    label: 'GPT2.0 文生图',
    task: 'image',
    model: 'rh-gpt2-text',
    provider: 'gateway-image',
    webappId: 'rhart-image-g-2/text-to-image',
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(NANO_ASPECT_RATIOS) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1k', options: options(['1k', '2k', '4k']) },
    ],
  },
  {
    id: 'rh-grok-text-video',
    label: 'Grok Video 文生视频',
    task: 'video',
    model: 'rh-grok-text-video',
    provider: 'gateway-video',
    webappId: 'rhart-video-g/text-to-video',
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['2:3', '3:2', '1:1', '16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '480p', options: options(['720p', '480p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 8, min: 6, max: 30, step: 1 },
    ],
  },
  {
    id: 'rh-grok-image-video',
    label: 'Grok Video 图生视频',
    task: 'video',
    model: 'rh-grok-image-video',
    provider: 'gateway-video',
    webappId: 'rhart-video-g/image-to-video',
    maxFiles: 7,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '2:3', options: options(['2:3', '3:2', '1:1', '16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '480p', options: options(['720p', '480p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 8, min: 6, max: 30, step: 1 },
      { key: 'images', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'rh-grok-video-edit',
    label: 'Grok Video 视频编辑',
    task: 'video',
    model: 'rh-grok-video-edit',
    provider: 'gateway-video',
    enabled: false,
    webappId: 'rhart-video-g-official/edit-video',
    maxFiles: 1,
    acceptedFiles: ['video'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p', '480p']) },
      { key: 'video', label: '输入视频', kind: 'video', required: true },
    ],
  },

  // ── RunningHub 数字人 & 声音模型 (V7.x 8788 网关) ──
  {
    id: 'rh-mimic',
    label: 'RH 动作模仿',
    task: 'video',
    model: 'rh-mimic',
    provider: 'gateway-video',
    enabled: false,
    webappId: 'rhart-mimic/mimic',
    maxFiles: 2,
    acceptedFiles: ['image', 'video'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt' },
      { key: 'image', label: '人物照片', kind: 'image', required: true },
      { key: 'video', label: '参考视频', kind: 'video', required: true },
      { key: 'text', label: '动作说明', kind: 'text' },
      { key: 'width', label: '宽', kind: 'number', defaultValue: 480, min: 16, step: 16 },
      { key: 'height', label: '高', kind: 'number', defaultValue: 832, min: 16, step: 16 },
    ],
  },
  {
    id: 'rh-digital-human-fast',
    label: 'RH 数字人快速版',
    task: 'digital-human',
    model: 'rh-digital-human-fast',
    provider: 'gateway-video',
    enabled: false,
    webappId: 'rhart-digital-human/fast',
    maxFiles: 2,
    acceptedFiles: ['image', 'audio'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt' },
      { key: 'image', label: '人物照片', kind: 'image', required: true },
      { key: 'audio', label: '参考音频', kind: 'audio', required: true },
      { key: 'value', label: '画面值', kind: 'number', defaultValue: 832, min: 16, step: 16 },
    ],
  },
  {
    id: 'rh-digital-human',
    label: 'RH 数字人标准版',
    task: 'digital-human',
    model: 'rh-digital-human',
    provider: 'gateway-video',
    enabled: false,
    webappId: 'rhart-digital-human/standard',
    maxFiles: 2,
    acceptedFiles: ['image', 'audio'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt' },
      { key: 'text', label: '台词', kind: 'text', required: true },
      { key: 'image', label: '首帧图', kind: 'image', required: true },
      { key: 'audio', label: '参考音频', kind: 'audio', required: true },
      { key: 'width', label: '宽', kind: 'number', defaultValue: 540, min: 16, step: 16 },
      { key: 'height', label: '高', kind: 'number', defaultValue: 960, min: 16, step: 16 },
    ],
  },
  {
    id: 'rh-voice-clone',
    label: 'RH 声音克隆',
    task: 'audio',
    model: 'rh-voice-clone',
    provider: 'gateway-audio',
    enabled: false,
    webappId: 'rhart-voice/clone',
    maxFiles: 1,
    acceptedFiles: ['audio'],
    fields: [
      { key: 'text', label: '输出文字', kind: 'text', required: true },
      { key: 'ref_text', label: '参考音频文字', kind: 'text', required: true },
      { key: 'audio', label: '参考音频', kind: 'audio', required: true },
      { key: 'start_time', label: '开始时间', kind: 'text', defaultValue: '0:00' },
      { key: 'end_time', label: '结束时间', kind: 'text', defaultValue: '0:11' },
      { key: 'language', label: '语言', kind: 'select', defaultValue: '中文', options: options(LANGUAGES) },
    ],
  },
  {
    id: 'rh-voice-design',
    label: 'RH 声音设计',
    task: 'audio',
    model: 'rh-voice-design',
    provider: 'gateway-audio',
    enabled: false,
    webappId: 'rhart-voice/design',
    fields: [
      { key: 'text', label: '文稿', kind: 'text', required: true },
      { key: 'voice_prompt', label: '人设音色风格', kind: 'text', required: true },
      { key: 'language', label: '语言', kind: 'select', defaultValue: '中文', options: options(LANGUAGES) },
    ],
  },
]

export const MEDIA_TASK_LABELS: Record<MediaTaskKind, string> = {
  image: '图片',
  video: '视频',
  'digital-human': '数字人',
  audio: '音频',
}

export function getMediaModelsForTask(task: MediaTaskKind): MediaModelCapability[] {
  return MEDIA_MODEL_CAPABILITIES.filter(model => model.task === task && isMediaModelEnabled(model.id))
}

export function getMediaModel(id: string): MediaModelCapability | undefined {
  return MEDIA_MODEL_CAPABILITIES.find(model => model.id === id || model.model === id)
}

export function isMediaModelEnabled(id: string): boolean {
  const model = getMediaModel(id)
  if (!model || model.enabled === false) return false
  const override = getMediaModelAvailability(model.id) || getMediaModelAvailability(model.model)
  return override?.status !== 'disabled'
}

export function getMediaModelAvailability(id: string): MediaModelAvailabilityOverride | undefined {
  return runtimeAvailability.get(String(id || '').trim())
}

export function setMediaModelAvailability(overrides: MediaModelAvailabilityOverride[]): void {
  runtimeAvailability.clear()
  for (const override of overrides) {
    const id = String(override.id || '').trim()
    if (!id) continue
    runtimeAvailability.set(id, {
      ...override,
      id,
      status: override.status === 'disabled' || override.status === 'degraded' ? override.status : 'enabled',
    })
  }
}

export function clearMediaModelAvailability(): void {
  runtimeAvailability.clear()
}

export function isRemovedMediaModelId(id: string): boolean {
  const value = String(id || '').trim().toLowerCase()
  if (!value) return false
  if (value === 'nano-banana' || value === 'nano-banana-hd') return true
  if (value === 'nano-banana-2k' || value === 'nano-banana-pro-2k') return true
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
