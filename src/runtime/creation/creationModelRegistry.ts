import type {
  CreationApiStyle,
  CreationAssetFlow,
  CreationContractStatus,
  CreationFieldSpec,
  CreationMode,
  CreationPanelModelItem,
  CreationModelListItem,
  CreationModelSpec,
  CreationOutputModality,
  CreationInputModality,
  CreationResultExtractor,
  CreationRoute,
  CreationSource,
  CreationTask,
  CreationUpstreamFamily,
  ListCreationModelsFilter,
} from './creationMediaTypes'

import { getRhEndpointCapability } from '@/data/rhCapabilities'
import { MEDIA_MODEL_CAPABILITIES } from '@/data/mediaModelCapabilities'

const RATIOS = ['adaptive', '1:1', '2:3', '3:2', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16', '21:9']
const GPT_IMAGE_SIZES = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
]

const GPT_IMAGE_2_ROUTES: Array<{
  id: string
  label: string
  price: number
  resolutions: string[]
}> = [
  { id: 'gpt-image-2-1k', label: 'GPT Image 2 1K', price: 0.08, resolutions: ['1k'] },
  { id: 'gpt-image-2-低质量', label: 'GPT Image 2 低质量', price: 0.1, resolutions: ['1k', '2k', '4k'] },
  { id: 'gpt-image-2-中质量', label: 'GPT Image 2 中质量', price: 0.15, resolutions: ['1k', '2k', '4k'] },
  { id: 'gpt-image-2-vip', label: 'GPT Image 2 VIP', price: 0.2, resolutions: ['1k', '2k', '4k'] },
  { id: 'gpt-image-2-官方', label: 'GPT Image 2 官方', price: 0.25, resolutions: ['1k', '2k', '4k'] },
]
const XIAOYI_GEMINI_FIELDS = promptFields([
  {
    key: 'ratio',
    label: '比例',
    kind: 'select',
    defaultValue: '1:1',
    options: options(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']),
  },
  {
    key: 'resolution',
    label: '分辨率',
    kind: 'select',
    defaultValue: '2k',
    options: options(['1k', '2k', '4k']),
  },
  { key: 'images', label: '参考图', kind: 'images' },
])

const XIAOYI_MINIMAX_H3_MODELS = [
  { model: 'MiniMaxH3-2k-pro-sec', label: 'MiniMax H3 2K Pro', price: 0.16, resolution: '2k' },
  { model: 'MiniMaxH3-2k-sec', label: 'MiniMax H3 2K', price: 0.14, resolution: '2k' },
  { model: 'MiniMaxH3-720p-sec', label: 'MiniMax H3 720P', price: 0.12, resolution: '720p' },
] as const
const RH_IMAGE_RESOLUTIONS = ['1k', '2k', '4k']
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', 'native1080p', '2k', '4k']
const VIDEO_RATIOS = ['2:3', '3:2', '1:1', '16:9', '9:16']

/** 设为 true 时，创作面板和画布只展示 RunningHub 渠道的模型。 */
export const RH_ONLY_MODE = false

function options(values: Array<string | number | boolean>) {
  return values.map(value => ({ value, label: String(value) }))
}

function promptFields(extra: CreationFieldSpec[] = []): CreationFieldSpec[] {
  return [{ key: 'prompt', label: '提示词', kind: 'prompt', required: true }, ...extra]
}

function baseSpec(input: {
  id: string
  model?: string
  label: string
  task: CreationTask
  source: CreationSource
  route: CreationRoute
  upstreamFamily: CreationUpstreamFamily
  apiStyle: CreationApiStyle
  mode: CreationMode
  contractStatus?: CreationContractStatus
  hidden?: boolean
  price?: number | string
  endpoint: string
  pollKind?: NonNullable<CreationModelSpec['poll']>['kind']
  assetFlow?: CreationAssetFlow
  resultExtractor?: CreationResultExtractor
  fields?: CreationFieldSpec[]
  files?: CreationModelSpec['files']
  aliases?: string[]
  notes: string[]
  officialAbilityTypes?: string[]
  adapterAbilityTypes?: string[]
  outputModalities?: CreationOutputModality[]
  ratios?: string[]
  resolutions?: string[]
  duration?: CreationModelSpec['capabilities']['duration']
  inputModalities?: CreationInputModality[]
  contractIssues?: string[]
}): CreationModelSpec {
  const outputModalities =
    input.outputModalities ||
    (input.task === 'image' ? ['image'] : input.task === 'audio' ? ['audio'] : ['video'])
  const inputModalities = input.inputModalities || (input.files?.audios
    ? (input.files?.videos
      ? (['text', 'image', 'video', 'audio'] as const)
      : (['text', 'image', 'audio'] as const))
    : input.files?.videos
      ? (['text', 'image', 'video'] as const)
      : input.files?.images
        ? (['text', 'image'] as const)
        : (['text'] as const))

  return {
    id: input.id,
    model: input.model || input.id.split('/').at(-1) || input.id,
    label: input.label,
    task: input.task,
    source: input.source,
    route: input.route,
    upstreamFamily: input.upstreamFamily,
    apiStyle: input.apiStyle,
    mode: input.mode,
    contractStatus: input.contractStatus || 'verified',
    hidden: input.hidden,
    price: input.price,
    endpoint: input.endpoint,
    poll: { kind: input.pollKind || 'none' },
    files: input.files,
    capabilities: {
      officialAbilityTypes: input.officialAbilityTypes || [input.mode.replaceAll('-', '_')],
      adapterAbilityTypes: input.adapterAbilityTypes || [input.mode.replaceAll('-', '_')],
      inputModalities: [...inputModalities],
      outputModalities,
      ratios: input.ratios,
      resolutions: input.resolutions,
      duration: input.duration,
      assetFlow: input.assetFlow || 'none',
      resultExtractor: input.resultExtractor || 'generic-media',
    },
    fields: input.fields || promptFields(),
    aliases: input.aliases,
    notes: input.notes,
    verifiedAt: input.contractStatus === 'unknown' ? undefined : '2026-06-16',
    contractIssues: input.contractIssues,
  }
}

function directImage(input: {
  id: string
  model?: string
  label: string
  price?: number | string
  upstreamFamily?: CreationUpstreamFamily
  apiStyle?: CreationApiStyle
  mode?: CreationMode
  endpoint?: string
  pollKind?: NonNullable<CreationModelSpec['poll']>['kind']
  assetFlow?: CreationAssetFlow
  resultExtractor?: CreationResultExtractor
  contractStatus?: CreationContractStatus
  hidden?: boolean
  notes: string[]
  aliases?: string[]
  contractIssues?: string[]
  fields?: CreationFieldSpec[]
  ratios?: string[]
  resolutions?: string[]
  files?: { images?: { min?: number; max?: number } }
}): CreationModelSpec {
  return baseSpec({
    id: input.id,
    model: input.model,
    label: input.label,
    task: 'image',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: input.upstreamFamily || 'openai-compatible',
    apiStyle: input.apiStyle || 'openai-image-edits',
    mode: input.mode || 'image-to-image',
    contractStatus: input.contractStatus,
    hidden: input.hidden,
    price: input.price,
    endpoint: input.endpoint || '/v1/images/edits',
    pollKind: input.pollKind,
    assetFlow: input.assetFlow || 'newapi-upload',
    resultExtractor: input.resultExtractor || 'openai-image',
    files: input.files || { images: { min: 0, max: 8 } },
    fields:
      input.fields ||
      promptFields([
        {
          key: 'ratio',
          label: '比例',
          kind: 'select',
          defaultValue: '1:1',
          options: options(RATIOS.filter(value => value !== 'adaptive')),
        },
        {
          key: 'resolution',
          label: '分辨率',
          kind: 'select',
          defaultValue: '2k',
          options: options(['1k', '2k', '4k']),
        },
        {
          key: 'size',
          label: '尺寸',
          kind: 'select',
          defaultValue: 'auto',
          options: options(GPT_IMAGE_SIZES),
        },
        { key: 'images', label: '参考图', kind: 'images' },
      ]),
    aliases: input.aliases,
    notes: input.notes,
    ratios: input.ratios,
    resolutions: input.resolutions,
    contractIssues: input.contractIssues,
  })
}

function directVideo(input: {
  id: string
  model?: string
  label: string
  price: number | string
  upstreamFamily: CreationUpstreamFamily
  apiStyle?: CreationApiStyle
  contractStatus?: CreationContractStatus
  hidden?: boolean
  endpoint?: string
  assetFlow?: CreationAssetFlow
  notes: string[]
  aliases?: string[]
  contractIssues?: string[]
  mode?: CreationMode
  fields?: CreationFieldSpec[]
  ratios?: string[]
  resolutions?: string[]
  duration?: { min?: number; max?: number; allowedValues?: number[] }
  files?: CreationModelSpec['files']
}): CreationModelSpec {
  return baseSpec({
    id: input.id,
    model: input.model,
    label: input.label,
    task: 'video',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: input.upstreamFamily,
    apiStyle: input.apiStyle || 'newapi-task',
    mode: input.mode || 'image-to-video',
    contractStatus: input.contractStatus || 'partial',
    hidden: input.hidden,
    price: input.price,
    endpoint: input.endpoint || '/v1/videos',
    pollKind: input.apiStyle === 'seedance-task' ? 'seedance-task' : 'newapi-task',
    assetFlow:
      input.assetFlow || (input.apiStyle === 'seedance-task' ? 'seedance-asset' : 'newapi-upload'),
    resultExtractor: 'newapi-task',
    files: input.files || { images: { min: 0, max: 9 } },
    fields: input.fields || promptFields([
      {
        key: 'ratio',
        label: '比例',
        kind: 'select',
        defaultValue: '16:9',
        options: options(RATIOS),
      },
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        defaultValue: '720p',
        options: options(VIDEO_RESOLUTIONS),
      },
      { key: 'duration', label: '时长', kind: 'number', defaultValue: 6, min: 4, max: 30, step: 1 },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    ratios: input.ratios,
    resolutions: input.resolutions,
    notes: input.notes,
    aliases: input.aliases,
    duration: input.duration || { min: 4, max: 30 },
    contractIssues:
      input.contractIssues ??
      (input.contractStatus === 'partial' ? ['异步轮询字段需以后端实测确认。'] : undefined),
  })
}

function runninghubStandard(input: {
  id: string
  model?: string
  label: string
  task: CreationTask
  mode: CreationMode
  price?: number | string
  apiStyle?: CreationApiStyle
  contractStatus?: CreationContractStatus
  hidden?: boolean
  endpoint?: string
  webappId?: string
  notes: string[]
  aliases?: string[]
  files?: CreationModelSpec['files']
  fields?: CreationFieldSpec[]
  outputModalities?: CreationOutputModality[]
  ratios?: string[]
  resolutions?: string[]
  duration?: CreationModelSpec['capabilities']['duration']
  contractIssues?: string[]
}): CreationModelSpec {
  const isAudio = input.task === 'audio'
  const modelName = input.model || input.id

  // ★ 从官方 capabilities.json 读取模型真实参数，替代硬编码默认值
  const rhEndpoint =
    input.webappId || MEDIA_MODEL_CAPABILITIES.find(m => m.model === modelName)?.webappId
  const rhCap = rhEndpoint ? getRhEndpointCapability(rhEndpoint) : undefined

  const officialRatios =
    input.ratios ||
    rhCap?.params.find(p => ['aspectRatio', 'ratio', 'aspect_ratio'].includes(p.key))?.options
  const officialResolutions =
    input.resolutions || rhCap?.params.find(p => p.key === 'resolution')?.options
  const officialDuration =
    input.duration ||
    (() => {
      const durParam = rhCap?.params.find(p => p.key === 'duration')
      if (durParam && durParam.min !== undefined && durParam.max !== undefined) {
        return { min: durParam.min, max: durParam.max }
      }
      return undefined
    })()

  return baseSpec({
    id: input.id,
    model: input.model,
    label: input.label,
    task: input.task,
    source: 'runninghub',
    route: 'runninghub-adapter',
    upstreamFamily: 'runninghub',
    apiStyle: input.apiStyle || 'rh-standard',
    mode: input.mode,
    contractStatus: input.contractStatus,
    hidden: input.hidden,
    price: input.price,
    endpoint:
      input.endpoint ||
      (isAudio
        ? '/v1/audio/speech'
        : input.task === 'image'
          ? '/v1/images/generations'
          : '/v1/videos'),
    pollKind: 'rh-task',
    assetFlow: input.files ? 'rh-upload' : 'none',
    resultExtractor: 'rh-task',
    files: input.files,
    fields: input.fields,
    aliases: input.aliases,
    notes: input.notes,
    outputModalities: input.outputModalities,
    ratios: officialRatios,
    resolutions:
      officialResolutions ||
      (input.task === 'image'
        ? RH_IMAGE_RESOLUTIONS
        : input.task === 'video'
          ? VIDEO_RESOLUTIONS
          : undefined),
    duration: officialDuration,
    contractIssues: input.contractIssues,
  })
}

export const CREATION_MODEL_REGISTRY: CreationModelSpec[] = [
  baseSpec({
    id: 'local-comfy/z-image-turbo',
    model: 'z-image-turbo',
    label: 'Z-Image Turbo · 本机 ComfyUI',
    task: 'image',
    source: 'local-comfy',
    route: 'local-comfy',
    upstreamFamily: 'openai-compatible',
    apiStyle: 'openai-images',
    mode: 'text-to-image',
    contractStatus: 'verified',
    endpoint: '/prompt',
    fields: promptFields([
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p', '1080p']) },
      { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16', '4:3', '3:4', '1:1']) },
    ]),
    notes: ['本机 ComfyUI 固定工作流；仅 Desktop 本地执行。'],
    resolutions: ['720p', '1080p', '4k'],
    ratios: ['16:9', '9:16', '4:3', '3:4', '1:1'],
  }),
  baseSpec({
    id: 'local-comfy/grok-video-3-30s',
    model: 'grok-video-3',
    label: 'Grok 视频 30 秒 · 本机 ComfyUI',
    task: 'video',
    source: 'local-comfy',
    route: 'local-comfy',
    upstreamFamily: 'unknown',
    apiStyle: 'comfy-grok-video',
    mode: 'image-to-video',
    contractStatus: 'verified',
    endpoint: '/prompt',
    files: { images: { min: 1, max: 7 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['2:3', '3:2', '16:9', '9:16', '1:1']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720P', options: options(['720P']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 8, options: options([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) },
      { key: 'images', label: '参考图', kind: 'images', required: true },
    ]),
    notes: ['本机 ComfyUI 已核验的 Grok 视频工作流；支持 1 至 7 张画布参考图。'],
    resolutions: ['720P'],
    ratios: ['2:3', '3:2', '16:9', '9:16', '1:1'],
    duration: { min: 6, max: 30 },
  }),
  ...GPT_IMAGE_2_ROUTES.map(route => baseSpec({
    id: route.id,
    model: route.id,
    label: route.label,
    task: 'image',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: 'openai-compatible',
    apiStyle: 'xiaoyi-image-task',
    pollKind: 'newapi-task',
    mode: 'text-to-image',
    contractStatus: 'verified',
    price: route.price,
    endpoint: '/v1/videos',
    assetFlow: 'none',
    resultExtractor: 'newapi-task',
    files: { images: { min: 0, max: 8 } },
    aliases: route.id === 'gpt-image-2-低质量' ? ['gpt-image-2'] : undefined,
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      {
        key: 'ratio',
        label: '比例',
        kind: 'select',
        defaultValue: '1:1',
        options: options(['1:1', '2:3', '3:2', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16', '21:9']),
      },
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        defaultValue: route.resolutions[0],
        options: options(route.resolutions),
      },
      { key: 'image', label: '参考图', kind: 'images' },
    ],
    notes: ['docs/wiki/运维/模型矩阵.md'],
    ratios: ['1:1', '2:3', '3:2', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16', '21:9'],
    resolutions: route.resolutions,
  })),
  baseSpec({
    id: 'seed-audio-1.0',
    label: '豆包音频生成1.0',
    task: 'audio',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: 'volcengine',
    apiStyle: 'openai-audio-speech',
    mode: 'voice-clone',
    contractStatus: 'verified',
    price: '1.2元/分钟',
    endpoint: '/v1/audio/speech',
    files: { audios: { min: 0, max: 3 } },
    inputModalities: ['text', 'audio'],
    fields: promptFields([
      { key: 'audios', label: '参考音频（最多3段）', kind: 'audio' },
    ]),
    notes: ['docs/wiki/运维/服务器运维.md#参考音频适配验收（2026-08-09）'],
  }),
  runninghubStandard({
    id: 'runninghub/api/z-image-turbo',
    model: 'z-image-turbo',
    label: 'Z Image Turbo · RunningHub',
    task: 'image',
    mode: 'text-to-image',
    price: 0.05,
    notes: ['docs/notes/runninghub-zimage-turbo模型.md'],
    fields: promptFields([
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '1:1',
        options: options(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2']),
      },
      { key: 'lora', label: 'LoRA', kind: 'text' },
      {
        key: 'lora_strength',
        label: 'LoRA 强度',
        kind: 'number',
        defaultValue: 1,
        min: -100,
        max: 100,
        step: 0.1,
      },
      {
        key: 'outputFormat',
        label: '输出格式',
        kind: 'select',
        defaultValue: 'png',
        options: options(['png', 'jpeg', 'webp(lossless)', 'webp(lossy)']),
      },
    ]),
    ratios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'],
  }),
  directImage({
    id: 'newapi/xiaoyi/grok-imagine-image-2.0',
    model: 'grok-imagine-image-2.0',
    label: 'Grok Imagine Image 2.0 · 小易',
    price: 0.05,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'xiaoyi-image-task',
    mode: 'text-to-image',
    endpoint: '/v1/videos',
    assetFlow: 'none',
    resultExtractor: 'newapi-task',
    pollKind: 'newapi-task',
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1', '16:9', '9:16', '3:2', '2:3']) },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    ratios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
    resolutions: ['1k', '2k', '4k'],
    files: { images: { min: 0, max: 8 } },
    contractStatus: 'verified',
    notes: ['https://xiaoyiapi.xyz/docs/api/grok-images/'],
  }),
  directVideo({
    id: 'newapi/xiaoyi/kling-video-v3',
    model: 'kling-video-v3',
    label: 'Kling Video V3 · 小易',
    price: 0.3,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['720p', '1080p', '4k'],
    duration: { min: 3, max: 15 },
    files: { images: { min: 0, max: 7, maxBytes: 20 * 1024 * 1024 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16', '1:1']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p', '1080p', '4k']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 3, max: 15, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
    ]),
    notes: ['https://xiaoyiapi.xyz/docs/api/video-generation/'],
  }),
  directVideo({
    id: 'newapi/xiaoyi/seedance2.5',
    model: 'seedance2.5',
    label: 'Seedance 2.5 · 小易',
    price: 1,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['720p'],
    duration: { min: 4, max: 30 },
    files: { images: { min: 0, max: 30, maxBytes: 50 * 1024 * 1024 }, videos: { min: 0, max: 10, maxBytes: 50 * 1024 * 1024 }, audios: { min: 0, max: 10, maxBytes: 50 * 1024 * 1024 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16', '1:1']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 30, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'videos', label: '参考视频', kind: 'video' },
      { key: 'audios', label: '参考音频', kind: 'audio' },
    ]),
    notes: ['https://xiaoyiapi.xyz/docs/api/video-generation/'],
  }),
  directVideo({
    id: 'newapi/dola/seedance2.5',
    model: 'dola-seedance2.5',
    label: 'Seedance 2.5 · Dola',
    price: 0.2,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9'],
    resolutions: ['720p'],
    duration: { allowedValues: [30] },
    files: { images: { min: 0, max: 30 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16', '1:1', '3:4', '4:3', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'duration', label: '时长(秒)', kind: 'select', defaultValue: 30, options: options([30]) },
      { key: 'images', label: '参考图 (0-30张)', kind: 'images' },
    ]),
    notes: ['API接口说明.md', '独立 Dola 适配器。'],
  }),
  directVideo({
    id: 'newapi/xiaoyi/grok-imagine-video-1.5',
    model: 'grok-imagine-video-1.5',
    label: 'Grok Imagine Video 1.5 · 小易',
    price: 0.25,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['16:9', '9:16'],
    resolutions: ['480p', '720p', '1080p'],
    duration: { allowedValues: [6, 10] },
    files: { images: { min: 0, max: 1 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p', '1080p']) },
      { key: 'duration', label: '时长(秒)', kind: 'select', defaultValue: 6, options: options([6, 10]) },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    notes: ['https://xiaoyiapi.xyz/docs/api/grok-videos/'],
  }),
  directImage({
    id: 'gemini-3.1-flash-image-preview',
    model: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
    price: 0.1,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'xiaoyi-image-task',
    mode: 'text-to-image',
    endpoint: '/v1/videos',
    assetFlow: 'none',
    resultExtractor: 'newapi-task',
    pollKind: 'newapi-task',
    fields: XIAOYI_GEMINI_FIELDS,
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
    resolutions: ['1k', '2k', '4k'],
    files: { images: { min: 0, max: 10 } },
    contractStatus: 'verified',
    notes: ['docs/wiki/运维/模型矩阵.md'],
  }),
  directImage({
    id: 'gemini-3-pro-image-preview',
    model: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image',
    price: 0.2,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'xiaoyi-image-task',
    mode: 'text-to-image',
    endpoint: '/v1/videos',
    assetFlow: 'none',
    resultExtractor: 'newapi-task',
    pollKind: 'newapi-task',
    fields: XIAOYI_GEMINI_FIELDS,
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
    resolutions: ['1k', '2k', '4k'],
    files: { images: { min: 0, max: 10 } },
    contractStatus: 'verified',
    notes: ['docs/wiki/运维/模型矩阵.md'],
  }),

  ...XIAOYI_MINIMAX_H3_MODELS.map(({ model, label, price, resolution }) => directVideo({
    id: `newapi/xiaoyi/${model}`,
    model,
    label,
    price,
    upstreamFamily: 'openai-compatible',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'partial',
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: [resolution],
    duration: { min: 5, max: 15 },
    files: { images: { min: 0, max: 9 }, videos: { min: 0, max: 3 }, audios: { min: 0, max: 3 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16', '1:1']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: resolution, options: options([resolution]) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 5, max: 15, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'videos', label: '参考视频', kind: 'video' },
      { key: 'audios', label: '参考音频', kind: 'audio' },
    ]),
    notes: ['https://docs.comfy.org/zh/tutorials/video/minimax/minimax-h3'],
  })),

  directVideo({
    id: 'newapi/zx/veo-3.1-generate-preview',
    model: 'veo-3.1-generate-preview',
    label: 'Veo 3.1',
    price: 0.2,
    upstreamFamily: 'zx',
    apiStyle: 'openai-videos',
    mode: 'text-to-video',
    contractStatus: 'verified',
    files: { images: { min: 0, max: 3 } },
    duration: { allowedValues: [4, 6, 8] },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 4, options: options([4, 6, 8]) },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    notes: ['docs/wiki/归档/模型文档/zx-veo.md'],
  }),
  directVideo({
    id: 'newapi/zx/veo-3.1-fast-generate-preview',
    model: 'veo-3.1-fast-generate-preview',
    label: 'Veo 3.1 Fast',
    price: 0.1,
    upstreamFamily: 'zx',
    apiStyle: 'openai-videos',
    mode: 'text-to-video',
    contractStatus: 'verified',
    files: { images: { min: 0, max: 3 } },
    duration: { allowedValues: [4, 6, 8] },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 4, options: options([4, 6, 8]) },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    notes: ['docs/wiki/归档/模型文档/zx-veo.md'],
  }),
  directVideo({
    id: 'newapi/trump/seedance-2.0',
    hidden: true,
    model: 'seedance-2.0',
    label: 'Seedance 2.0 · 特朗普/WorldRouter',
    price: 1,
    upstreamFamily: 'trump',
    apiStyle: 'seedance-task',
    endpoint: '/api/v3/contents/generations/tasks',
    contractStatus: 'broken',
    notes: ['docs/notes/特朗普seedace2.md'],
    contractIssues: ['/api/v3/contents/generations/tasks 返回 404'],
  }),
  directVideo({
    id: 'newapi/trump/seedance-2.0-fast',
    hidden: true,
    model: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast · 特朗普/WorldRouter',
    price: 1,
    upstreamFamily: 'trump',
    apiStyle: 'seedance-task',
    endpoint: '/api/v3/contents/generations/tasks',
    contractStatus: 'broken',
    notes: ['docs/notes/特朗普seedace2.md'],
    contractIssues: ['/api/v3/contents/generations/tasks 返回 404'],
  }),
  directVideo({
    id: 'newapi/kik/doubao-seedance-2',
    hidden: true,
    model: 'doubao-seedance-2',
    label: 'Seedance 2.0',
    price: '按 Token',
    upstreamFamily: 'volcengine',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['480p', '720p', '1080p', '4k'],
    files: {
      images: { min: 0, max: 9, maxBytes: 30 * 1024 * 1024 },
      videos: { min: 0, max: 1, maxBytes: 200 * 1024 * 1024 },
      audios: { min: 0, max: 1, maxBytes: 15 * 1024 * 1024 },
    },
    duration: { min: 4, max: 15 },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p', '1080p', '4k']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'video', label: '参考视频', kind: 'video' },
      { key: 'audio', label: '参考音频', kind: 'audio' },
    ]),
    notes: ['KIK Seedance 文档', '按 Token 计费'],
  }),
  directVideo({
    id: 'newapi/kik/doubao-seedance-2-0-fast-260128',
    hidden: true,
    model: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    price: '按 Token',
    upstreamFamily: 'volcengine',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['480p', '720p'],
    files: {
      images: { min: 0, max: 9, maxBytes: 30 * 1024 * 1024 },
      videos: { min: 0, max: 1, maxBytes: 200 * 1024 * 1024 },
      audios: { min: 0, max: 1, maxBytes: 15 * 1024 * 1024 },
    },
    duration: { min: 4, max: 15 },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'video', label: '参考视频', kind: 'video' },
      { key: 'audio', label: '参考音频', kind: 'audio' },
    ]),
    notes: ['KIK Seedance 文档', '按 Token 计费'],
  }),
  directVideo({
    id: 'newapi/kik/doubao-seedance-2-mini',
    hidden: true,
    model: 'doubao-seedance-2-mini',
    label: 'Seedance 2.0 Mini',
    price: '按 Token',
    upstreamFamily: 'volcengine',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    endpoint: '/v1/videos',
    assetFlow: 'newapi-upload',
    contractStatus: 'verified',
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['480p', '720p'],
    files: {
      images: { min: 0, max: 9, maxBytes: 30 * 1024 * 1024 },
      videos: { min: 0, max: 1, maxBytes: 200 * 1024 * 1024 },
      audios: { min: 0, max: 1, maxBytes: 15 * 1024 * 1024 },
    },
    duration: { min: 4, max: 15 },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p']) },
      { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 4, max: 15, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'video', label: '参考视频', kind: 'video' },
      { key: 'audio', label: '参考音频', kind: 'audio' },
    ]),
    notes: ['KIK Seedance 文档', '按 Token 计费'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-gpt2-image',
    model: 'rh-gpt2-image',
    label: 'GPT2.0 图生图 · RunningHub',
    task: 'image',
    mode: 'image-to-image',
    price: 0.15,
    notes: ['docs/notes/runninghub-GPT-image-2.md'],
    files: { images: { min: 1, max: 5 } },
    fields: promptFields([
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '16:9',
        options: options(RATIOS.filter(value => value !== 'adaptive')),
      },
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        defaultValue: '1k',
        options: options(RH_IMAGE_RESOLUTIONS),
      },
      { key: 'images', label: '参考图', kind: 'images', required: true },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-gpt2-text',
    model: 'rh-gpt2-text',
    label: 'GPT2.0 文生图 · RunningHub',
    task: 'image',
    mode: 'text-to-image',
    price: 0.15,
    notes: ['docs/notes/runninghub-GPT-image-2.md'],
    fields: promptFields([
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '16:9',
        options: options(RATIOS.filter(value => value !== 'adaptive')),
      },
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        defaultValue: '1k',
        options: options(RH_IMAGE_RESOLUTIONS),
      },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-image-v2',
    model: 'rh-image-v2',
    label: 'Banana Fresh · RunningHub',
    task: 'image',
    mode: 'text-to-image',
    price: 0.3,
    notes: ['RH capabilities'],
    files: { images: { min: 0, max: 5 } },
    fields: promptFields([{ key: 'images', label: '参考图', kind: 'images' }]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-pro-image',
    model: 'rh-pro-image',
    label: 'Banana Pro · RunningHub',
    task: 'image',
    mode: 'image-to-image',
    price: 0.5,
    notes: ['docs/notes/runninghub-banana.md'],
    files: { images: { min: 0, max: 8 } },
  }),

  // ── 🆕 FLUX.2 Klein 9B 系列 (3 个) ──
  runninghubStandard({
    id: 'runninghub/api/rh-flux-klein-edit',
    model: 'rh-flux-klein-edit',
    label: 'FLUX Klein 9B 编辑 · RunningHub',
    task: 'image',
    mode: 'image-to-image',
    price: 0.1,
    contractStatus: 'partial',
    notes: ['docs/notes/rh-flux-klein-9b.md'],
    files: { images: { min: 1, max: 1 } },
    fields: promptFields([
      { key: 'images', label: '参考图', kind: 'images', required: true },
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '1:1',
        options: options(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'custom']),
      },
      {
        key: 'customWidth',
        label: '宽度',
        kind: 'number',
        defaultValue: 1024,
        min: 256,
        max: 1536,
        step: 16,
      },
      {
        key: 'customHight',
        label: '高度',
        kind: 'number',
        defaultValue: 1024,
        min: 256,
        max: 1536,
        step: 16,
      },
      {
        key: 'outputFormat',
        label: '输出格式',
        kind: 'select',
        defaultValue: 'png',
        options: options(['png', 'jpeg', 'webp(lossless)', 'webp(lossy)']),
      },
    ]),
    ratios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'custom'],
    contractIssues: [
      'imageUrl 字段映射需验证。customWidth/customHight 仅 aspectRatio=custom 时 UI 显示。',
    ],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-flux-klein-text',
    model: 'rh-flux-klein-text',
    label: 'FLUX Klein 9B 文生图 · RunningHub',
    task: 'image',
    mode: 'text-to-image',
    price: 0.05,
    contractStatus: 'partial',
    notes: ['docs/notes/rh-flux-klein-9b.md'],
    fields: promptFields([
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '1:1',
        options: options(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'custom']),
      },
      {
        key: 'customWidth',
        label: '宽度',
        kind: 'number',
        defaultValue: 1024,
        min: 256,
        max: 1536,
        step: 16,
      },
      {
        key: 'customHight',
        label: '高度',
        kind: 'number',
        defaultValue: 1024,
        min: 256,
        max: 1536,
        step: 16,
      },
      {
        key: 'outputFormat',
        label: '输出格式',
        kind: 'select',
        defaultValue: 'png',
        options: options(['png', 'jpeg', 'webp(lossless)', 'webp(lossy)']),
      },
    ]),
    ratios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'custom'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-flux-klein-lora',
    model: 'rh-flux-klein-lora',
    label: 'FLUX Klein 9B LoRA · RunningHub',
    task: 'image',
    mode: 'text-to-image',
    price: 0.08,
    contractStatus: 'partial',
    notes: ['docs/notes/rh-flux-klein-9b.md'],
    fields: promptFields([
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '1:1',
        options: options(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'custom']),
      },
      {
        key: 'customWidth',
        label: '宽度',
        kind: 'number',
        defaultValue: 1024,
        min: 256,
        max: 1536,
        step: 16,
      },
      {
        key: 'customHight',
        label: '高度',
        kind: 'number',
        defaultValue: 1024,
        min: 256,
        max: 1536,
        step: 16,
      },
      {
        key: 'outputFormat',
        label: '输出格式',
        kind: 'select',
        defaultValue: 'png',
        options: options(['png', 'jpeg', 'webp(lossless)', 'webp(lossy)']),
      },
      { key: 'lora', label: 'LoRA', kind: 'text' },
      {
        key: 'lora_strength',
        label: 'LoRA 强度',
        kind: 'number',
        defaultValue: 0,
        min: -100,
        max: 100,
        step: 0.1,
      },
    ]),
    ratios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'custom'],
  }),

  runninghubStandard({
    id: 'runninghub/api/rh-video-v31-fast',
    model: 'rh-video-v31-fast',
    label: '全能视频 V3.1 Fast · RunningHub',
    task: 'video',
    mode: 'image-to-video',
    price: 2,
    notes: ['RH capabilities'],
    files: { images: { min: 0, max: 3 } },
    duration: { allowedValues: [8] },
    aliases: ['全能视频V3.1-Fast'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-gemini-omni-text-video', model: 'rh-gemini-omni-text-video',
    hidden: true,
    label: '全能视频 Omni Flash 文生视频 · RunningHub', task: 'video', mode: 'text-to-video', price: '2.5元/次',
    notes: ['docs/wiki/运维/Geminiomini.md'], ratios: ['16:9', '9:16'], resolutions: ['1080p'], duration: { allowedValues: [10] },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1080p', options: options(['1080p']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 10, options: options([10]) },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-gemini-omni-image-video', model: 'rh-gemini-omni-image-video',
    hidden: true,
    label: '全能视频 Omni Flash 图生视频 · RunningHub', task: 'video', mode: 'image-to-video', price: '2.5元/次',
    notes: ['docs/wiki/运维/Geminiomini.md'], ratios: ['16:9', '9:16'], resolutions: ['1080p'], duration: { allowedValues: [10] },
    files: { images: { min: 1, max: 3, allowedCounts: [1, 3], maxBytes: 10 * 1024 * 1024 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1080p', options: options(['1080p']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 10, options: options([10]) },
      { key: 'images', label: '参考图', kind: 'images', required: true },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-gemini-omni-video-edit', model: 'rh-gemini-omni-video-edit',
    hidden: true,
    label: '全能视频 Omni Flash 视频编辑 · RunningHub', task: 'video', mode: 'video-edit', price: '0.4元/秒',
    notes: ['docs/wiki/运维/Geminiomini.md'], ratios: ['16:9', '9:16'], resolutions: ['1080p'],
    files: {
      images: { min: 0, max: 3, allowedCounts: [1, 3], maxBytes: 10 * 1024 * 1024 },
      videos: { min: 1, max: 1, maxBytes: 10 * 1024 * 1024 },
    },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1080p', options: options(['1080p']) },
      { key: 'images', label: '参考图', kind: 'images' },
      { key: 'videos', label: '输入视频', kind: 'video', required: true },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-grok-text-video',
    model: 'rh-grok-text-video',
    label: 'Grok Video 文生视频 · RunningHub',
    task: 'video',
    mode: 'text-to-video',
    price: 0.25,
    notes: ['docs/wiki/归档/模型文档/runninghub-grok-video低价渠道版-v1.5.md'],
    duration: { min: 6, max: 15 },
    aliases: ['Grok Video 文生视频'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-grok-image-video',
    model: 'rh-grok-image-video',
    label: 'Grok Video 图生视频 · RunningHub',
    task: 'video',
    mode: 'image-to-video',
    price: 0.25,
    notes: ['docs/wiki/归档/模型文档/runninghub-grok-video低价渠道版-v1.5.md'],
    files: { images: { min: 1, max: 7, maxBytes: 10 * 1024 * 1024 } },
    duration: { min: 6, max: 15 },
  }),
  ...([6, 10, 15] as const).map(seconds => baseSpec({
    id: `newapi/zx/grok-1.5-video-${seconds}s`,
    hidden: true,
    model: `grok-1.5-video-${seconds}s`,
    label: `Grok 1.5 Video ${seconds}s · ZX`,
    task: 'video',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: 'zx',
    apiStyle: 'newapi-task',
    mode: 'text-to-video',
    price: 0.2,
    contractStatus: seconds === 15 ? 'degraded' : 'verified',
    endpoint: '/v1/videos',
    pollKind: 'newapi-task',
    assetFlow: 'none',
    resultExtractor: 'newapi-task',
    duration: { allowedValues: [seconds] },
    files: { images: { min: 0, max: 7 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    notes: ['docs/wiki/开发/ZX-Grok视频独立适配器SDD.md'],
    contractIssues: seconds === 15 ? ['ZX 15 秒任务偶发上游失败，失败后可重试。'] : undefined,
  })),
  directVideo({
    id: 'newapi/zx/doubao-seedance-2-5-260628',
    hidden: true,
    model: 'doubao-seedance-2-5-260628',
    label: 'Seedance 2.5 · ZX',
    price: 'ZX 按秒计费',
    upstreamFamily: 'zx',
    apiStyle: 'seedance-task',
    endpoint: '/v1/video/generations',
    assetFlow: 'none',
    mode: 'text-to-video',
    contractStatus: 'partial',
    files: {
      images: { min: 0, max: 30, maxBytes: 50 * 1024 * 1024 },
      videos: { min: 0, max: 10, maxBytes: 50 * 1024 * 1024 },
      audios: { min: 0, max: 10, maxBytes: 50 * 1024 * 1024 },
    },
    duration: { allowedValues: Array.from({ length: 27 }, (_, i) => i + 4) },
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'],
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true, maxLength: 20480 },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p', '720p', 'native1080p', '1080p', '2k', '4k']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 5, options: options(Array.from({ length: 27 }, (_, i) => i + 4)) },
      { key: 'images', label: '参考图', kind: 'images' },
      { key: 'videos', label: '参考视频', kind: 'video' },
      { key: 'audios', label: '参考音频', kind: 'audio' },
      { key: 'conversionSlots', label: '真人素材槽位', kind: 'multiselect', options: options(['all', ...Array.from({ length: 30 }, (_, i) => `image${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `video${i + 1}`)]) },
      { key: 'returnLastFrame', label: '返回尾帧', kind: 'boolean', defaultValue: false },
      { key: 'realPersonMode', label: '真人模式', kind: 'boolean', defaultValue: false },
      { key: 'bitrateMode', label: '码率', kind: 'select', defaultValue: 'standard', options: options(['standard', 'high']) },
      { key: 'generateAudio', label: '生成音频', kind: 'boolean', defaultValue: false },
      { key: 'seed', label: '随机种子', kind: 'number', defaultValue: -1, min: -1, max: 2147483647, step: 1 },
      { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'mp4', options: options(['mp4', 'mov']) },
      { key: 'omniReferenceTaskType', label: '任务类型', kind: 'select', defaultValue: 'auto', options: options(['auto', 'reference', 'edit', 'extend']) },
      { key: 'webhookUrl', label: 'Webhook', kind: 'text' },
    ],
    notes: ['docs/wiki/开发/ZX视频适配器多模型升级TDD-2026-08-18.md'],
    contractIssues: ['上游文档未列出该别名，需用 ZX Key 完成真实提交与轮询验证。'],
  }),
  directVideo({
    id: 'newapi/zx/omni-fast',
    hidden: true,
    model: 'omni-fast',
    label: 'Omni Fast · ZX',
    price: 0.18,
    upstreamFamily: 'zx',
    mode: 'text-to-video',
    assetFlow: 'none',
    contractStatus: 'verified',
    files: { images: { min: 0, max: 1 } },
    duration: { allowedValues: [10] },
    ratios: ['16:9', '9:16'],
    resolutions: ['720p'],
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 10, options: options([10]) },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    notes: ['docs/wiki/开发/ZX视频适配器多模型升级TDD-2026-08-18.md'],
  }),
  directVideo({
    id: 'newapi/zx/omni-v2v',
    hidden: true,
    model: 'omni-v2v',
    label: 'Omni V2V · ZX',
    price: 0.2,
    upstreamFamily: 'zx',
    mode: 'video-edit',
    assetFlow: 'none',
    contractStatus: 'partial',
    files: { videos: { min: 1, max: 1 } },
    duration: { allowedValues: [10] },
    ratios: ['16:9', '9:16'],
    resolutions: ['720p'],
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9', '9:16']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['720p']) },
      { key: 'duration', label: '时长', kind: 'select', defaultValue: 10, options: options([10]) },
      { key: 'videos', label: '输入视频', kind: 'video', required: true },
    ]),
    notes: ['docs/wiki/开发/ZX视频适配器多模型升级TDD-2026-08-18.md'],
    contractIssues: ['上游文档当前只列出 omni-fast；omni-v2v 的 video_url 合同需用 ZX Key 实测。'],
  }),
  // ── Seedance 2.0 多模态 (3 个，最低计费时长使成本更高) ──
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-mini',
    model: 'rh-seedance2-mini',
    label: 'Seedance 2.0 Mini 多模态 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'workflow',
    price: 1.2,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    files: { images: { min: 0, max: 9 }, videos: { min: 0, max: 1 }, audios: { min: 0, max: 1 } },
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-fast',
    model: 'rh-seedance2-fast',
    label: 'Seedance 2.0 Fast 多模态 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'workflow',
    price: 2.0,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    files: { images: { min: 0, max: 9 }, videos: { min: 0, max: 1 }, audios: { min: 0, max: 1 } },
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2',
    model: 'rh-seedance2',
    label: 'Seedance 2.0 多模态 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'workflow',
    price: 2.3,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    files: { images: { min: 0, max: 9 }, videos: { min: 0, max: 1 }, audios: { min: 0, max: 1 } },
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  // ── Seedance 2.0 文生视频 (3 个) ──
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-mini-text',
    model: 'rh-seedance2-mini-text',
    label: 'Seedance 2.0 Mini 文生视频 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'text-to-video',
    price: 0.8,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-fast-text',
    model: 'rh-seedance2-fast-text',
    label: 'Seedance 2.0 Fast 文生视频 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'text-to-video',
    price: 1.3,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-text',
    model: 'rh-seedance2-text',
    label: 'Seedance 2.0 文生视频 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'text-to-video',
    price: 1.5,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  // ── Seedance 2.0 图生视频 (3 个) ──
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-mini-image',
    model: 'rh-seedance2-mini-image',
    label: 'Seedance 2.0 Mini 图生视频 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'image-to-video',
    price: 0.8,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    files: { images: { min: 1, max: 1 } },
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-fast-image',
    model: 'rh-seedance2-fast-image',
    label: 'Seedance 2.0 Fast 图生视频 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'image-to-video',
    price: 1.3,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    files: { images: { min: 1, max: 1 } },
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance2-image',
    model: 'rh-seedance2-image',
    label: 'Seedance 2.0 图生视频 · RunningHub',
    hidden: true,
    task: 'video',
    mode: 'image-to-video',
    price: 1.5,
    notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
    files: { images: { min: 1, max: 1 } },
    duration: { min: 4, max: 15 },
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance25-no-video-ref',
    hidden: true,
    model: 'rh-seedance25-no-video-ref',
    label: 'Seedance 2.5 无参考视频 · RunningHub',
    task: 'video',
    mode: 'workflow',
    price: '4元/秒',
    webappId: 'bytedance/seedance-2.5-global-token/multimodal-video',
    notes: ['docs/wiki/运维/RH-seedace25.md'],
    files: { images: { min: 0, max: 30, maxBytes: 50 * 1024 * 1024 }, audios: { min: 0, max: 10, maxBytes: 50 * 1024 * 1024 } },
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['native1080p'],
    duration: { min: 4, max: 30 },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: 'native1080p', options: options(['native1080p']) },
      { key: 'duration', label: '时长', kind: 'number', defaultValue: 5, min: 4, max: 30, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'audios', label: '参考音频', kind: 'audio' },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-seedance25-with-video-ref',
    hidden: true,
    model: 'rh-seedance25-with-video-ref',
    label: 'Seedance 2.5 有参考视频 · RunningHub',
    task: 'video',
    mode: 'workflow',
    price: '3.5元/秒',
    webappId: 'bytedance/seedance-2.5-global-token/multimodal-video',
    notes: ['docs/wiki/运维/RH-seedace25.md'],
    files: { images: { min: 0, max: 30, maxBytes: 50 * 1024 * 1024 }, videos: { min: 1, max: 10, maxBytes: 50 * 1024 * 1024 }, audios: { min: 0, max: 10, maxBytes: 50 * 1024 * 1024 } },
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['native1080p'],
    duration: { min: 4, max: 30 },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: 'adaptive', options: options(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: 'native1080p', options: options(['native1080p']) },
      { key: 'duration', label: '时长', kind: 'number', defaultValue: 5, min: 4, max: 30, step: 1 },
      { key: 'images', label: '参考图片', kind: 'images' },
      { key: 'videos', label: '参考视频', kind: 'video', required: true },
      { key: 'audios', label: '参考音频', kind: 'audio' },
    ]),
  }),

  // ── 🆕 Sora2 视频系列 (4 个) ──
  runninghubStandard({
    id: 'runninghub/api/rh-sora2-text',
    hidden: true,
    model: 'rh-sora2-text',
    label: 'Sora2 文生视频',
    task: 'video',
    mode: 'text-to-video',
    price: 2,
    notes: ['docs/notes/RH-SORA2-4模型.md'],
    fields: promptFields([
      {
        key: 'duration',
        label: '时长',
        kind: 'select',
        defaultValue: '10',
        options: options(['10', '15']),
      },
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '9:16',
        options: options(['9:16', '16:9']),
      },
    ]),
    ratios: ['9:16', '16:9'],
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-sora2-image',
    hidden: true,
    model: 'rh-sora2-image',
    label: 'Sora2 图生视频',
    task: 'video',
    mode: 'image-to-video',
    price: 2,
    notes: ['docs/notes/RH-SORA2-4模型.md'],
    files: { images: { min: 1, max: 1 } },
    fields: promptFields([
      {
        key: 'duration',
        label: '时长',
        kind: 'select',
        defaultValue: '10',
        options: options(['10', '15']),
      },
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '9:16',
        options: options(['9:16', '16:9']),
      },
    ]),
    ratios: ['9:16', '16:9'],
    resolutions: ['720p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-sora2-character',
    hidden: true,
    model: 'rh-sora2-character',
    label: 'Sora2 角色上传',
    task: 'video',
    mode: 'video-edit',
    price: 0.08,
    notes: ['docs/notes/RH-SORA2-4模型.md'],
    files: { videos: { min: 1, max: 1 } },
    resolutions: [],
  }),

  // ── 🆕 LTX 2.3 视频系列 (2 个) ──
  runninghubStandard({
    id: 'runninghub/api/rh-ltx23-text-video',
    hidden: true,
    model: 'rh-ltx23-text-video',
    label: 'LTX 2.3 文生视频 · RunningHub',
    task: 'video',
    mode: 'text-to-video',
    price: 0.2,
    contractStatus: 'partial',
    notes: ['docs/notes/RH-视频模型.md'],
    fields: promptFields([
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        defaultValue: '720p',
        options: options(['1080p', '720p', '480p']),
      },
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '16:9',
        options: options(['16:9', '9:16']),
      },
      {
        key: 'duration',
        label: '时长(秒)',
        kind: 'number',
        defaultValue: 5,
        min: 5,
        max: 15,
        step: 1,
      },
    ]),
    duration: { min: 5, max: 15 },
    ratios: ['16:9', '9:16'],
    resolutions: ['1080p', '720p', '480p'],
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-ltx23-image-video',
    hidden: true,
    model: 'rh-ltx23-image-video',
    label: 'LTX 2.3 图生视频 · RunningHub',
    task: 'video',
    mode: 'image-to-video',
    price: 0.2,
    contractStatus: 'partial',
    notes: ['docs/notes/RH-视频模型.md'],
    files: { images: { min: 1, max: 1 } },
    fields: promptFields([
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        defaultValue: '720p',
        options: options(['480p', '720p', '1080p']),
      },
      {
        key: 'aspectRatio',
        label: '比例',
        kind: 'select',
        defaultValue: '16:9',
        options: options(['9:16', '16:9']),
      },
      {
        key: 'duration',
        label: '时长(秒)',
        kind: 'number',
        defaultValue: 5,
        min: 5,
        max: 20,
        step: 1,
      },
    ]),
    duration: { min: 5, max: 20 },
    ratios: ['9:16', '16:9'],
    resolutions: ['480p', '720p', '1080p'],
  }),

  runninghubStandard({
    id: 'runninghub/api/rh-suno-v55-single',
    model: 'rh-suno-v55-single',
    label: 'Suno v5.5 一句话成歌 · RunningHub',
    task: 'audio',
    mode: 'text-to-audio',
    price: 1,
    notes: ['docs/notes/runninghub-suno.md'],
    fields: promptFields([
      { key: 'title', label: '歌曲标题', kind: 'text' },
      { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-suno-v55-custom',
    model: 'rh-suno-v55-custom',
    label: 'Suno v5.5 自定义成歌 · RunningHub',
    task: 'audio',
    mode: 'text-to-audio',
    price: 1,
    notes: ['docs/notes/runninghub-suno.md'],
    fields: promptFields([
      { key: 'title', label: '歌曲标题', kind: 'text' },
      { key: 'tags', label: '音乐风格', kind: 'text' },
      { key: 'negative_tags', label: '排除风格', kind: 'text' },
      { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-suno-lyrics',
    model: 'rh-suno-lyrics',
    label: 'Suno 创作歌词 · RunningHub',
    task: 'audio',
    mode: 'lyrics',
    price: 0.05,
    notes: ['docs/notes/runninghub-suno.md'],
    outputModalities: ['text'],
  }),

  runninghubStandard({
    id: 'runninghub/api/rh-3d-text',
    model: 'rh-3d-text',
    label: '混元 3D v3.1 文生 3D · RunningHub',
    task: 'model3d',
    mode: 'text-to-3d',
    price: 4.8,
    webappId: 'hunyuan3d-v3.1/text-to-3d',
    notes: ['docs/wiki/归档/模型文档/RH-混元3D.md'],
    outputModalities: ['model3d'],
    fields: promptFields([
      { key: 'faceCount', label: '面数', kind: 'number', defaultValue: 500000, min: 10000, max: 1500000, step: 1 },
      { key: 'enablePbr', label: 'PBR 材质', kind: 'boolean', defaultValue: false },
      { key: 'generateType', label: '生成类型', kind: 'select', defaultValue: 'Normal', options: options(['Normal', 'Geometry', 'Sketch']) },
    ]),
  }),
  runninghubStandard({
    id: 'runninghub/api/rh-3d-image',
    model: 'rh-3d-image',
    label: '混元 3D v3.1 图生 3D · RunningHub',
    task: 'model3d',
    mode: 'image-to-3d',
    price: 6.6,
    webappId: 'hunyuan3d-v3.1/image-to-3d',
    notes: ['docs/wiki/归档/模型文档/RH-混元3D.md'],
    files: { images: { min: 1, max: 8 } },
    outputModalities: ['model3d'],
    fields: [
      { key: 'faceCount', label: '面数', kind: 'number', defaultValue: 500000, min: 10000, max: 1500000, step: 1 },
      { key: 'enablePbr', label: 'PBR 材质', kind: 'boolean', defaultValue: false },
      { key: 'generateType', label: '生成类型', kind: 'select', defaultValue: 'Normal', options: options(['Normal', 'Geometry', 'Sketch']) },
      { key: 'images', label: '参考图（主、左、右、后、上、下、左前、右前）', kind: 'images', required: true },
    ],
  }),

  runninghubStandard({
    id: 'runninghub/aiapp/rh-aiapp',
    model: 'rh-aiapp',
    label: 'AI 应用（自定义）· RunningHub 工作流',
    task: 'ai-app',
    mode: 'workflow',
    price: 0.3,
    apiStyle: 'rh-aiapp',
    contractStatus: 'partial',
    notes: [],
    fields: [],
  }),
]

export function getCreationModelSpec(idOrModel: string): CreationModelSpec | undefined {
  const exact = CREATION_MODEL_REGISTRY.find(spec => spec.id === idOrModel)
  if (exact) return exact
  const matches = CREATION_MODEL_REGISTRY.filter(
    spec => spec.model === idOrModel || spec.aliases?.includes(idOrModel),
  )
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous creation model key "${idOrModel}". Use a namespaced CreationModelSpec.id.`,
    )
  }
  return matches[0]
}

export function listCreationModels(filter: ListCreationModelsFilter = {}): CreationModelListItem[] {
  return CREATION_MODEL_REGISTRY.filter(spec => !filter.task || spec.task === filter.task)
    .filter(spec => !filter.mode || spec.mode === filter.mode)
    .filter(spec => !filter.source || filter.source === 'all' || spec.source === filter.source)
    .filter(spec => filter.includeDisabled || (spec.contractStatus !== 'broken' && !spec.hidden))
    .filter(spec => !RH_ONLY_MODE || spec.source === 'runninghub')
    .map(spec => ({
      id: spec.id,
      model: spec.model,
      label: spec.label,
      task: spec.task,
      source: spec.source,
      upstreamFamily: spec.upstreamFamily,
      mode: spec.mode,
      price: spec.price,
      contractStatus: spec.contractStatus,
      badges: [
        spec.source === 'runninghub' ? 'RunningHub' : '直连',
        upstreamBadge(spec.upstreamFamily),
        spec.contractStatus === 'verified'
          ? '已核对'
          : spec.contractStatus === 'partial'
            ? '部分核对'
            : spec.contractStatus === 'broken'
              ? '已损坏'
              : spec.contractStatus === 'degraded'
                ? '降级'
                : '待核对',
      ],
    }))
}

export function listCreationPanelModels(
  filter: ListCreationModelsFilter = {},
): CreationPanelModelItem[] {
  return listCreationModels(filter).map(item => {
    const spec = getCreationModelSpec(item.id)!
    const sampleParams = buildPanelPreviewParams(spec)
    return {
      ...item,
      label: displayModelLabel(spec.label),
      apiStyle: spec.apiStyle,
      route: spec.route,
      fields: spec.fields,
      submitSummaryPreview: buildPanelSummaryPreview(spec, sampleParams),
    }
  })
}

const LABEL_OVERRIDES: Record<string, string> = {
  '全能图片 V2': 'Nano Banana Flash',
  '全能图片 PRO': 'Nano Banana Pro',
  '全能视频 V3.1 Fast': 'Veo 3.1 Fast',
}

export function displayModelLabel(label: string): string {
  const base = String(label || '')
    .split('·')[0]
    .trim()
  return LABEL_OVERRIDES[base] || base
}

export function creationModelFamily(spec: Pick<CreationModelSpec, 'id' | 'model' | 'task'>): string {
  const id = `${spec.id} ${spec.model}`.toLowerCase()
  if (spec.task === 'image' && (id.includes('gpt-image') || id.includes('rh-gpt2-'))) return 'GPT Image'
  if (spec.task === 'image' && ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'rh-image-v2', 'rh-pro-image'].some(key => id.includes(key))) return 'Banana'
  if (id.includes('z-image')) return 'Z Image'
  if (id.includes('flux-klein')) return 'FLUX Klein'
  if (id.includes('grok-image') || (id.includes('grok-') && id.includes('video'))) return spec.task === 'video' ? 'Grok Video' : 'Grok Image'
  if (id.includes('veo-') || id.includes('rh-video-v31-fast')) return 'Veo'
  if (id.includes('seedance2-mini')) return 'Seedance 2.0 Mini'
  if (id.includes('seedance2-fast')) return 'Seedance 2.0 Fast'
  if (id.includes('seedance2')) return 'Seedance 2.0'
  if (id.includes('sora2')) return 'Sora2'
  if (id.includes('ltx23')) return 'LTX 2.3'
  if (id.includes('suno')) return 'Suno'
  if (id.includes('rh-3d')) return '3D'
  if (spec.task === 'ai-app' || id.includes('rh-aiapp')) return 'AI 应用'
  return '其他模型'
}

export function displayModelPrice(spec: Pick<CreationModelSpec, 'price' | 'task' | 'route'>): string {
  if (spec.route === 'local-comfy') return '本地模型'
  if (spec.price === undefined) return '费用以实际扣费为准'
  const raw = String(spec.price).replace(/[¥￥元]/g, '')
  if (raw.includes('/')) return raw
  const amount = raw.match(/\d+(?:\.\d+)?/)?.[0]
  if (!amount) return raw || '费用以实际扣费为准'
  const unit = spec.task === 'image' ? '张' : spec.task === 'video' || spec.task === 'ai-app' ? '秒' : '次'
  return `${amount}/${unit}`
}

function buildPanelPreviewParams(spec: CreationModelSpec): Record<string, unknown> {
  const params: Record<string, unknown> = {
    prompt: '预览提示词',
    ratio: spec.capabilities.ratios?.includes('16:9') ? '16:9' : undefined,
    resolution: spec.capabilities.resolutions?.[0],
    duration: spec.capabilities.duration?.allowedValues?.[0] || spec.capabilities.duration?.min,
    title: '预览标题',
    tags: 'pop',
    value: 832,
  }
  if (spec.files?.images?.min)
    params.images = Array.from(
      { length: spec.files.images.min },
      (_, index) => `preview-${index}.png`,
    )
  if (spec.files?.videos?.min)
    params.videos = Array.from(
      { length: spec.files.videos.min },
      (_, index) => `preview-${index}.mp4`,
    )
  if (spec.files?.audios?.min)
    params.audios = Array.from(
      { length: spec.files.audios.min },
      (_, index) => `preview-${index}.mp3`,
    )
  for (const field of spec.fields) {
    if (!field.required || params[field.key] !== undefined) continue
    if (field.kind === 'image') params[field.key] = 'preview.png'
    else if (field.kind === 'audio') params[field.key] = 'preview.mp3'
    else if (field.kind === 'video') params[field.key] = 'preview.mp4'
    else if (field.kind === 'number') params[field.key] = field.defaultValue ?? field.min ?? 1
    else params[field.key] = field.defaultValue ?? '预览'
  }
  return params
}

function buildPanelSummaryPreview(
  spec: CreationModelSpec,
  params: Record<string, unknown>,
): string {
  const sourceLabel = spec.source === 'runninghub' ? 'RunningHub' : '直连'
  const upstreamLabels: Record<CreationUpstreamFamily, string> = {
    volcengine: '火山',
    worldrouter: 'WorldRouter',
    trump: '特朗普',
    runninghub: 'RH 官方 API',
    'openai-compatible': 'OpenAI-compatible',
    zx: 'ZX',
    unknown: '未知',
  }
  const parts = [sourceLabel, upstreamLabels[spec.upstreamFamily], spec.mode]
  if (params.prompt) parts.push('有提示词')
  if (params.images)
    parts.push(`参考图 ${Array.isArray(params.images) ? params.images.length : 1} 张`)
  if (params.audios)
    parts.push(`音频 ${Array.isArray(params.audios) ? params.audios.length : 1} 段`)
  if (params.videos)
    parts.push(`视频 ${Array.isArray(params.videos) ? params.videos.length : 1} 段`)
  return parts.join(' · ')
}

function upstreamBadge(upstreamFamily: CreationUpstreamFamily): string {
  const labels: Record<CreationUpstreamFamily, string> = {
    volcengine: '火山',
    worldrouter: 'WorldRouter',
    trump: '特朗普',
    runninghub: 'RH',
    'openai-compatible': 'OpenAI-compatible',
    zx: 'ZX',
    unknown: '未知',
  }
  return labels[upstreamFamily]
}
