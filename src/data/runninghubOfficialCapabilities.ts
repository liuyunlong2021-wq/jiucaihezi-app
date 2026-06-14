import type { MediaFieldKind, MediaModelField, MediaFieldOption } from './mediaModelCapabilities'

type RhOfficialParamType = 'STRING' | 'LIST' | 'INT' | 'FLOAT' | 'BOOLEAN' | 'IMAGE' | 'VIDEO' | 'AUDIO'

export interface RhOfficialParam {
  key: string
  type: RhOfficialParamType
  required?: boolean
  options?: Array<string | number | boolean>
  default?: string | number | boolean
  min?: number
  max?: number
  multiple?: boolean
  maxCount?: number
}

export interface RhOfficialEndpointCapability {
  endpoint: string
  task: string
  outputType: 'image' | 'video' | 'audio'
  params: RhOfficialParam[]
}

function options(values: Array<string | number | boolean> | undefined): MediaFieldOption[] | undefined {
  return values?.map(value => ({ value, label: String(value) }))
}

const FIELD_LABELS: Record<string, string> = {
  prompt: '提示词',
  text: '输出文字',
  lyrics: '歌词',
  aspectRatio: '比例',
  ratio: '比例',
  resolution: '分辨率',
  duration: '时长(秒)',
  imageUrls: '参考图',
  firstFrameUrl: '首帧图',
  lastFrameUrl: '尾帧图',
  videoUrls: '参考视频',
  audioUrls: '参考音频',
  audio: '参考音频',
  generateAudio: '生成音频',
  returnLastFrame: '返回尾帧',
  webSearch: '联网增强',
  language_boost: '语言增强',
}

const MEDIA_KIND_BY_TYPE: Record<'IMAGE' | 'VIDEO' | 'AUDIO', MediaFieldKind> = {
  IMAGE: 'images',
  VIDEO: 'video',
  AUDIO: 'audio',
}

function fieldKindForParam(param: RhOfficialParam): MediaFieldKind {
  if (param.type === 'IMAGE' || param.type === 'VIDEO' || param.type === 'AUDIO') {
    return param.multiple ? MEDIA_KIND_BY_TYPE[param.type] : MEDIA_KIND_BY_TYPE[param.type]
  }
  if (param.key === 'prompt') return 'prompt'
  if (param.key === 'lyrics') return 'textarea'
  if (param.type === 'LIST') return 'select'
  if (param.type === 'INT' || param.type === 'FLOAT') return 'number'
  if (param.type === 'BOOLEAN') return 'boolean'
  return 'text'
}

function toField(param: RhOfficialParam): MediaModelField {
  const hasDefault = param.default !== undefined && param.default !== null && String(param.default).length > 0
  return {
    key: param.key,
    label: FIELD_LABELS[param.key] || param.key,
    kind: fieldKindForParam(param),
    required: Boolean(param.required && !hasDefault),
    defaultValue: param.default,
    options: options(param.options),
    min: param.min,
    max: param.max,
    step: param.type === 'FLOAT' ? 0.1 : 1,
  }
}

export const RH_OFFICIAL_ENDPOINT_CAPABILITIES: Record<string, RhOfficialEndpointCapability> = {
  'rhart-image-n-pro/text-to-image': {
    endpoint: 'rhart-image-n-pro/text-to-image',
    task: 'text-to-image',
    outputType: 'image',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', options: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'], default: '9:16' },
      { key: 'resolution', type: 'LIST', required: true, options: ['1k', '2k', '4k'], default: '1k' },
    ],
  },
  'rhart-image-n-pro/edit': {
    endpoint: 'rhart-image-n-pro/edit',
    task: 'image-to-image',
    outputType: 'image',
    params: [
      { key: 'imageUrls', type: 'IMAGE', required: true, multiple: true, maxCount: 10 },
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', options: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'], default: '3:4' },
      { key: 'resolution', type: 'LIST', required: true, options: ['1k', '2k', '4k'], default: '1k' },
    ],
  },
  'rhart-image-n-g31-flash/text-to-image': {
    endpoint: 'rhart-image-n-g31-flash/text-to-image',
    task: 'text-to-image',
    outputType: 'image',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', options: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'], default: '9:16' },
      { key: 'resolution', type: 'LIST', required: true, options: ['1k', '2k', '4k'], default: '1k' },
    ],
  },
  'rhart-image-g-2/text-to-image': {
    endpoint: 'rhart-image-g-2/text-to-image',
    task: 'text-to-image',
    outputType: 'image',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', options: ['empty', '3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3'], default: 'empty' },
      { key: 'resolution', type: 'LIST', options: ['1k', '2k', '4k'], default: '1k' },
    ],
  },
  'rhart-image-g-2/image-to-image': {
    endpoint: 'rhart-image-g-2/image-to-image',
    task: 'image-to-image',
    outputType: 'image',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'imageUrls', type: 'IMAGE', required: true, multiple: true, maxCount: 10 },
      { key: 'aspectRatio', type: 'LIST', options: ['empty', '3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3'], default: 'empty' },
      { key: 'resolution', type: 'LIST', options: ['1k', '2k', '4k'], default: '1k' },
    ],
  },
  'rhart-video-v3.1-fast/text-to-video': {
    endpoint: 'rhart-video-v3.1-fast/text-to-video',
    task: 'text-to-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', required: true, options: ['16:9', '9:16'], default: '9:16' },
      { key: 'duration', type: 'LIST', options: ['8'], default: '8' },
      { key: 'resolution', type: 'LIST', required: true, options: ['720p', '1080p', '4k'], default: '720p' },
    ],
  },
  'rhart-video-v3.1-fast/image-to-video': {
    endpoint: 'rhart-video-v3.1-fast/image-to-video',
    task: 'image-to-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', required: true, options: ['16:9', '9:16'], default: '16:9' },
      { key: 'imageUrls', type: 'IMAGE', required: true, multiple: true, maxCount: 3 },
      { key: 'duration', type: 'LIST', options: ['8'], default: '8' },
      { key: 'resolution', type: 'LIST', required: true, options: ['720p', '1080p', '4k'], default: '720p' },
    ],
  },
  'rhart-video/sparkvideo-2.0/text-to-video': {
    endpoint: 'rhart-video/sparkvideo-2.0/text-to-video',
    task: 'text-to-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'resolution', type: 'LIST', required: true, options: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'], default: '720p' },
      { key: 'duration', type: 'LIST', required: true, options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'], default: '5' },
      { key: 'generateAudio', type: 'BOOLEAN', default: true },
      { key: 'ratio', type: 'LIST', options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], default: 'adaptive' },
      { key: 'webSearch', type: 'BOOLEAN', default: false },
      { key: 'returnLastFrame', type: 'BOOLEAN', default: false },
    ],
  },
  'rhart-video/sparkvideo-2.0/image-to-video': {
    endpoint: 'rhart-video/sparkvideo-2.0/image-to-video',
    task: 'image-to-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING' },
      { key: 'resolution', type: 'LIST', required: true, options: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'], default: '720p' },
      { key: 'duration', type: 'LIST', required: true, options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'], default: '5' },
      { key: 'firstFrameUrl', type: 'IMAGE', required: true },
      { key: 'lastFrameUrl', type: 'IMAGE' },
      { key: 'generateAudio', type: 'BOOLEAN', default: true },
      { key: 'ratio', type: 'LIST', options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], default: 'adaptive' },
      { key: 'returnLastFrame', type: 'BOOLEAN', default: false },
    ],
  },
  'rhart-video/sparkvideo-2.0/multimodal-video': {
    endpoint: 'rhart-video/sparkvideo-2.0/multimodal-video',
    task: 'multimodal-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'resolution', type: 'LIST', required: true, options: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'], default: '720p' },
      { key: 'duration', type: 'LIST', required: true, options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'], default: '5' },
      { key: 'imageUrls', type: 'IMAGE', multiple: true, maxCount: 9 },
      { key: 'videoUrls', type: 'VIDEO', multiple: true, maxCount: 3 },
      { key: 'audioUrls', type: 'AUDIO', multiple: true, maxCount: 3 },
      { key: 'generateAudio', type: 'BOOLEAN', default: true },
      { key: 'ratio', type: 'LIST', options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], default: 'adaptive' },
      { key: 'returnLastFrame', type: 'BOOLEAN', default: false },
    ],
  },
  'rhart-video-g/text-to-video': {
    endpoint: 'rhart-video-g/text-to-video',
    task: 'text-to-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', required: true, options: ['2:3', '3:2', '1:1', '16:9', '9:16'], default: '2:3' },
      { key: 'resolution', type: 'LIST', required: true, options: ['720p', '480p'], default: '720p' },
      { key: 'duration', type: 'INT', default: 6, min: 6, max: 30 },
    ],
  },
  'rhart-video-g/image-to-video': {
    endpoint: 'rhart-video-g/image-to-video',
    task: 'image-to-video',
    outputType: 'video',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'aspectRatio', type: 'LIST', required: true, options: ['2:3', '3:2', '1:1', '16:9', '9:16'], default: '2:3' },
      { key: 'imageUrls', type: 'IMAGE', multiple: true, maxCount: 7 },
      { key: 'resolution', type: 'LIST', required: true, options: ['720p', '480p'], default: '480p' },
      { key: 'duration', type: 'INT', default: 6, min: 6, max: 30 },
    ],
  },
  'rhart-audio/text-to-audio/music-2.5': {
    endpoint: 'rhart-audio/text-to-audio/music-2.5',
    task: 'music-generation',
    outputType: 'audio',
    params: [
      { key: 'prompt', type: 'STRING', required: true },
      { key: 'lyrics', type: 'STRING', required: true },
      { key: 'bitrate', type: 'LIST', options: ['32000', '60000', '64000', '128000', '256000'], default: '256000' },
      { key: 'sampleRate', type: 'LIST', options: ['16000', '24000', '32000', '44100'], default: '44100' },
    ],
  },
}

export function rhOfficialCapability(endpoint: string): RhOfficialEndpointCapability | undefined {
  return RH_OFFICIAL_ENDPOINT_CAPABILITIES[endpoint]
}

export function rhOfficialFields(endpoint: string, extraEndpoint?: string): MediaModelField[] {
  const primary = rhOfficialCapability(endpoint)
  if (!primary) return []
  const fields = primary.params.map(toField)
  if (!extraEndpoint) return fields

  const existing = new Set(fields.map(field => field.key))
  const extra = rhOfficialCapability(extraEndpoint)
  for (const param of extra?.params || []) {
    if (existing.has(param.key)) continue
    fields.push(toField(param))
    existing.add(param.key)
  }
  return fields
}

export function rhOfficialMaxFiles(endpoint: string, extraEndpoint?: string): number | undefined {
  const endpoints = [rhOfficialCapability(endpoint), extraEndpoint ? rhOfficialCapability(extraEndpoint) : undefined]
  const maxCounts = endpoints
    .flatMap(item => item?.params || [])
    .map(param => param.maxCount)
    .filter((value): value is number => typeof value === 'number')
  return maxCounts.length ? Math.max(...maxCounts) : undefined
}
