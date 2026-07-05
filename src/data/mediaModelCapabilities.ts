import { rhOfficialFields, rhOfficialMaxFiles } from './runninghubOfficialCapabilities'

/** 设为 true 时，创作面板和画布只展示 RunningHub 渠道的模型，隐藏 T8/火山/WorldRouter/特朗普等不稳定渠道 */
const RH_ONLY_MODE = false

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
const SEEDANCE_2_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
const SUNO_MV = ['chirp-fenix', 'chirp-crow', 'chirp-bluejay', 'chirp-auk-turbo', 'chirp-auk', 'chirp-v4', 'chirp-v3-5', 'chirp-v3.0']
const LANGUAGES = ['自动', '中文', '英文', '日文', '韩文', '德文', '法文', '俄文', '葡萄牙文', '西班牙文', '意大利文']
const RH_LANGUAGE_BOOSTS = ['auto', 'Chinese', 'Chinese,Yue', 'English', 'Japanese', 'Korean', 'Spanish', 'French', 'Portuguese', 'German', 'Arabic', 'Russian', 'Vietnamese', 'Indonesian', 'Italian', 'Thai']
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
    enabled: false,
    fields: [
      { key: 'title', label: '歌曲标题', kind: 'text', required: true },
      { key: 'tags', label: '音乐风格', kind: 'text', required: true },
      { key: 'negative_tags', label: '排除风格', kind: 'text' },
      { key: 'mv', label: 'Suno 版本', kind: 'select', defaultValue: 'chirp-fenix', options: options(SUNO_MV) },
      { key: 'prompt', label: '歌词/提示词', kind: 'prompt', required: true },
    ],
  },
  {
    id: 'rh-suno-v55-single',
    label: 'Suno v5.5 一句话成歌',
    task: 'audio',
    model: 'rh-suno-v55-single',
    provider: 'gateway-audio',
    webappId: 'rhart-audio/suno-v5.5/single',
    fields: [
      { key: 'title', label: '歌曲标题', kind: 'text' },
      { key: 'prompt', label: '歌曲描述', kind: 'prompt', required: true },
      { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false },
    ],
  },
  {
    id: 'rh-suno-v55-custom',
    label: 'Suno v5.5 自定义成歌',
    task: 'audio',
    model: 'rh-suno-v55-custom',
    provider: 'gateway-audio',
    webappId: 'rhart-audio/suno-v5.5/custom',
    fields: [
      { key: 'title', label: '歌曲标题', kind: 'text' },
      { key: 'tags', label: '音乐风格', kind: 'text', required: true },
      { key: 'negative_tags', label: '排除风格', kind: 'text' },
      { key: 'prompt', label: '歌词', kind: 'prompt', required: true },
      { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false },
    ],
  },
  {
    id: 'rh-suno-lyrics',
    label: 'Suno 创作歌词',
    task: 'audio',
    model: 'rh-suno-lyrics',
    provider: 'gateway-audio',
    webappId: 'rhart-audio/suno/lyrics',
    fields: [
      { key: 'prompt', label: '歌词主题', kind: 'prompt', required: true },
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
    maxFiles: rhOfficialMaxFiles('rhart-image-n-pro/text-to-image', 'rhart-image-n-pro/edit'),
    acceptedFiles: ['image'],
    fields: rhOfficialFields('rhart-image-n-pro/text-to-image', 'rhart-image-n-pro/edit'),
  },
  {
    id: 'rh-image-v2',
    label: '全能图片V2',
    task: 'image',
    model: 'rh-image-v2',
    provider: 'gateway-image',
    webappId: 'rhart-image-n-g31-flash/text-to-image',
    fields: rhOfficialFields('rhart-image-n-g31-flash/text-to-image'),
  },
  {
    id: 'rh-gpt2-official',
    label: 'GPT Image 2 官方',
    task: 'image',
    model: 'rh-gpt2-official',
    provider: 'gateway-image',
    webappId: 'rhart-image-g-2-official/text-to-image',
    maxFiles: rhOfficialMaxFiles('rhart-image-g-2-official/image-to-image'),
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9', options: [
        { value: '1:1', label: '1:1' }, { value: '2:3', label: '2:3' }, { value: '3:2', label: '3:2' },
        { value: '4:5', label: '4:5' }, { value: '5:4', label: '5:4' }, { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' },
      ]},
      { key: 'images', label: '参考图', kind: 'images' },
    ],
  },
  {
    id: 'rh-gpt2-image',
    label: 'GPT2.0',
    task: 'image',
    model: 'rh-gpt2-image',
    provider: 'gateway-image',
    webappId: 'rhart-image-g-2/image-to-image',
    maxFiles: rhOfficialMaxFiles('rhart-image-g-2/image-to-image'),
    acceptedFiles: ['image'],
    fields: rhOfficialFields('rhart-image-g-2/image-to-image'),
  },
  {
    id: 'rh-video-v31-fast',
    label: '全能视频V3.1-Fast',
    task: 'video',
    model: 'rh-video-v31-fast',
    provider: 'gateway-video',
    webappId: 'rhart-video-v3.1-fast/text-to-video',
    maxFiles: rhOfficialMaxFiles('rhart-video-v3.1-fast/text-to-video', 'rhart-video-v3.1-fast/image-to-video'),
    acceptedFiles: ['image'],
    fields: rhOfficialFields('rhart-video-v3.1-fast/text-to-video', 'rhart-video-v3.1-fast/image-to-video'),
  },
  {
    id: 'rh-seedance2-text-video',
    label: 'Seedance 2.0 文生视频',
    task: 'video',
    model: 'rh-seedance2-text-video',
    provider: 'gateway-video',
    webappId: 'rhart-video/sparkvideo-2.0/text-to-video',
    fields: rhOfficialFields('rhart-video/sparkvideo-2.0/text-to-video'),
  },
  {
    id: 'rh-seedance2-image-video',
    label: 'Seedance 2.0 图生视频',
    task: 'video',
    model: 'rh-seedance2-image-video',
    provider: 'gateway-video',
    webappId: 'rhart-video/sparkvideo-2.0/image-to-video',
    maxFiles: 2,
    acceptedFiles: ['image'],
    fields: rhOfficialFields('rhart-video/sparkvideo-2.0/image-to-video'),
  },
  {
    id: 'rh-seedance2-multimodal-video',
    label: 'Seedance 2.0 全能参考',
    task: 'video',
    model: 'rh-seedance2-multimodal-video',
    provider: 'gateway-video',
    webappId: 'rhart-video/sparkvideo-2.0/multimodal-video',
    maxFiles: 9,
    acceptedFiles: ['image', 'video', 'audio'],
    fields: rhOfficialFields('rhart-video/sparkvideo-2.0/multimodal-video'),
  },
  {
    id: 'rh-gpt2-text',
    label: 'GPT2.0 文生图',
    task: 'image',
    model: 'rh-gpt2-text',
    provider: 'gateway-image',
    webappId: 'rhart-image-g-2/text-to-image',
    fields: rhOfficialFields('rhart-image-g-2/text-to-image'),
  },
  {
    id: 'z-image-turbo',
    label: 'Z Image Turbo',
    task: 'image',
    model: 'z-image-turbo',
    provider: 'gateway-image',
    webappId: 'rhart-image/z-image/turbo-lora',
    fields: rhOfficialFields('rhart-image/z-image/turbo-lora'),
  },
  {
    id: 'rh-grok-text-video',
    label: 'Grok Video 文生视频',
    task: 'video',
    model: 'rh-grok-text-video',
    provider: 'gateway-video',
    webappId: 'rhart-video-g/text-to-video',
    fields: rhOfficialFields('rhart-video-g/text-to-video'),
  },
  {
    id: 'rh-grok-image-video',
    label: 'Grok Video 图生视频',
    task: 'video',
    model: 'rh-grok-image-video',
    provider: 'gateway-video',
    webappId: 'rhart-video-g/image-to-video',
    maxFiles: rhOfficialMaxFiles('rhart-video-g/image-to-video'),
    acceptedFiles: ['image'],
    fields: rhOfficialFields('rhart-video-g/image-to-video'),
  },
  {
    id: 'rh-aiapp-fast-digital-human',
    label: '极速数字人',
    task: 'digital-human',
    model: 'rh-aiapp-fast-digital-human',
    provider: 'gateway-video',
    enabled: false,
    webappId: '2028055408421642241',
    maxFiles: 2,
    acceptedFiles: ['image', 'audio'],
    fields: [
      { key: 'image', label: '人物照片', kind: 'image', required: true },
      { key: 'audio', label: '驱动音频', kind: 'audio', required: true },
      { key: 'value', label: '画面值', kind: 'number', defaultValue: 832, min: 16, step: 16 },
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

  // 普 prefixed models for general users (group=1 / 普 channel)
  // Images (3): reuse gpt-image path for NewAPI routing; labels with 普 prefix
  {
    id: '普gpt-image-2',
    label: '普gpt-image-2',
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
    id: '普gemini-3-pro-image-preview',
    label: '普gemini-3-pro-image-preview',
    task: 'image',
    model: 'gemini-3-pro-image-preview',
    provider: 'gateway-image',
    enabled: false,
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
    id: '普gemini-3.1-flash-image-preview',
    label: '普gemini-3.1-flash-image-preview',
    task: 'image',
    model: 'gemini-3.1-flash-image-preview',
    provider: 'gateway-image',
    enabled: false,
    maxFiles: 5,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'size', label: '尺寸', kind: 'select', defaultValue: 'auto', options: options(GPT_IMAGE_SIZES) },
      { key: 'image', label: '参考图', kind: 'images' },
      { key: 'response_format', label: '返回格式', kind: 'select', defaultValue: 'url', options: options(['url', 'b64_json']) },
    ],
  },
  // Seedance 普 versions (2): WorldRouter 上游使用点号 (seedance-2.0 / seedance-2.0-fast)
  // 注意: WorldRouter Seedance 是 ByteDance 原生 API，端点 /api/v3/contents/generations/tasks
  // NewAPI 渠道需要配 DoubaoVideo 类型 (非 OpenAI 类型) 才能转发到正确路径
  {
    id: '普seedance2.0',
    label: '普seedance2.0',
    task: 'video',
    model: 'seedance-2.0',
    provider: 'gateway-video',
    enabled: false,
    endpoint: '/api/seedance/v1/videos',
    maxFiles: 9,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(SEEDANCE_2_RATIOS) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p', '1080p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图 (0-9张)', kind: 'images' },
    ],
  },
  {
    id: '普seedance2.0-fast',
    label: '普seedance2.0-fast',
    task: 'video',
    model: 'seedance-2.0-fast',
    provider: 'gateway-video',
    enabled: false,
    endpoint: '/api/seedance/v1/videos',
    maxFiles: 9,
    acceptedFiles: ['image'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(SEEDANCE_2_RATIOS) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图 (0-9张)', kind: 'images' },
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
  return MEDIA_MODEL_CAPABILITIES.filter(model => {
    if (model.task !== task) return false
    if (!isMediaModelEnabled(model.id)) return false
    if (RH_ONLY_MODE && !model.provider?.startsWith('runninghub-')) return false
    return true
  })
}

export function getMediaModel(id: string): MediaModelCapability | undefined {
  return MEDIA_MODEL_CAPABILITIES.find(model => model.id === id || model.model === id)
}

export function isMediaModelEnabled(id: string): boolean {
  if (isRemovedMediaModelId(id)) return false
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
    if (value.startsWith('rh-seedance2-')) return false
    if (value.startsWith('普seedance')) return false
    if (value === 'seedance-2.0' || value === 'seedance-2.0-fast') return false
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
