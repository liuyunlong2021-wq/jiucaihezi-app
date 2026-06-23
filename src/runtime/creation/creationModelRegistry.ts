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
const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840']
const RH_IMAGE_RESOLUTIONS = ['1k', '2k', '4k']
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', 'native1080p', '2k', '4k']
const VIDEO_RATIOS = ['2:3', '3:2', '1:1', '16:9', '9:16']

/** 设为 true 时，创作面板和画布只展示 RunningHub 渠道的模型，隐藏 T8/火山/WorldRouter/特朗普等不稳定渠道 */
export const RH_ONLY_MODE = true

function options(values: Array<string | number | boolean>) {
  return values.map(value => ({ value, label: String(value) }))
}

function promptFields(extra: CreationFieldSpec[] = []): CreationFieldSpec[] {
  return [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    ...extra,
  ]
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
  price?: number
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
  contractIssues?: string[]
}): CreationModelSpec {
  const outputModalities = input.outputModalities || (input.task === 'image' ? ['image'] : input.task === 'audio' ? ['audio'] : ['video'])
  const inputModalities = input.files?.audios
    ? ['text', 'image', 'audio'] as const
    : input.files?.videos
      ? ['text', 'image', 'video'] as const
      : input.files?.images
        ? ['text', 'image'] as const
        : ['text'] as const

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
  price: number
  upstreamFamily?: CreationUpstreamFamily
  apiStyle?: CreationApiStyle
  mode?: CreationMode
  endpoint?: string
  assetFlow?: CreationAssetFlow
  resultExtractor?: CreationResultExtractor
  contractStatus?: CreationContractStatus
  notes: string[]
  aliases?: string[]
  contractIssues?: string[]
  fields?: CreationFieldSpec[]
  ratios?: string[]
  resolutions?: string[]
}): CreationModelSpec {
  return baseSpec({
    id: input.id,
    model: input.model,
    label: input.label,
    task: 'image',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: input.upstreamFamily || 't8',
    apiStyle: input.apiStyle || 'openai-image-edits',
    mode: input.mode || 'image-to-image',
    contractStatus: input.contractStatus,
    price: input.price,
    endpoint: input.endpoint || '/v1/images/edits',
    assetFlow: input.assetFlow || 'newapi-upload',
    resultExtractor: input.resultExtractor || 'openai-image',
    files: { images: { min: 0, max: 8 } },
    fields: input.fields || promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '2k', options: options(['1k', '2k', '4k']) },
      { key: 'size', label: '尺寸', kind: 'select', defaultValue: 'auto', options: options(GPT_IMAGE_SIZES) },
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
  price: number
  upstreamFamily: CreationUpstreamFamily
  apiStyle?: CreationApiStyle
  contractStatus?: CreationContractStatus
  endpoint?: string
  notes: string[]
  aliases?: string[]
  contractIssues?: string[]
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
    mode: 'image-to-video',
    contractStatus: input.contractStatus || 'partial',
    price: input.price,
    endpoint: input.endpoint || '/v1/videos',
    pollKind: input.apiStyle === 'seedance-task' ? 'seedance-task' : 'newapi-task',
    assetFlow: input.apiStyle === 'seedance-task' ? 'seedance-asset' : 'newapi-upload',
    resultExtractor: 'newapi-task',
    files: { images: { min: 0, max: 9 } },
    fields: promptFields([
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(RATIOS) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(VIDEO_RESOLUTIONS) },
      { key: 'duration', label: '时长', kind: 'number', defaultValue: 6, min: 4, max: 30, step: 1 },
      { key: 'images', label: '参考图', kind: 'images' },
    ]),
    notes: input.notes,
    aliases: input.aliases,
    duration: { min: 4, max: 30 },
    contractIssues: input.contractIssues ?? (input.contractStatus === 'partial' ? ['异步轮询字段需以后端实测确认。'] : undefined),
  })
}

function runninghubStandard(input: {
  id: string
  model?: string
  label: string
  task: CreationTask
  mode: CreationMode
  price: number
  apiStyle?: CreationApiStyle
  contractStatus?: CreationContractStatus
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
  const rhEndpoint = input.webappId
    || MEDIA_MODEL_CAPABILITIES.find(m => m.model === modelName)?.webappId
  const rhCap = rhEndpoint ? getRhEndpointCapability(rhEndpoint) : undefined

  const officialRatios = input.ratios
    || (rhCap?.params.find(p => ['aspectRatio', 'ratio', 'aspect_ratio'].includes(p.key))?.options)
  const officialDuration = input.duration
    || (() => {
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
    price: input.price,
    endpoint: input.endpoint || (isAudio ? '/v1/audio/speech' : input.task === 'image' ? '/v1/images/generations' : '/v1/videos'),
    pollKind: 'rh-task',
    assetFlow: input.files ? 'rh-upload' : 'none',
    resultExtractor: 'rh-task',
    files: input.files,
    fields: input.fields,
    aliases: input.aliases,
    notes: input.notes,
    outputModalities: input.outputModalities,
    ratios: officialRatios,
    resolutions: input.resolutions || (input.task === 'image' ? RH_IMAGE_RESOLUTIONS : input.task === 'video' ? VIDEO_RESOLUTIONS : undefined),
    duration: officialDuration,
    contractIssues: input.contractIssues,
  })
}

export const CREATION_MODEL_REGISTRY: CreationModelSpec[] = [
  baseSpec({
    id: 'newapi/t8/gpt-image-2',
    model: 'gpt-image-2',
    label: 'GPT Image 2 · T8 直连',
    task: 'image',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: 't8',
    apiStyle: 'openai-images',
    mode: 'text-to-image',
    contractStatus: 'verified',
    price: 0.15,
    endpoint: '/v1/images/generations',
    assetFlow: 'none',
    resultExtractor: 'openai-image',
    files: { images: { min: 0, max: 8 } },
    fields: [
      { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
      { key: 'ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1', '2:3', '3:2', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16', '21:9']) },
      { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '2k', options: options(['1k', '2k', '4k']) },
      { key: 'image', label: '参考图', kind: 'images' },
      { key: 'response_format', label: '返回格式', kind: 'select', defaultValue: 'url', options: options(['url', 'b64_json']) },
    ],
    aliases: ['gpt-image-2'],
    notes: ['docs/notes/T8gpt2.md'],
    ratios: ['1:1', '2:3', '3:2', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16', '21:9'],
    resolutions: ['1k', '2k', '4k'],
  }),
  directImage({ id: 'newapi/t8/grok-4.2-image', model: 'grok-4.2-image', label: 'Grok 4.2 Image · T8 直连', price: 0.2, apiStyle: 'newapi-task', mode: 'text-to-image', endpoint: '/v1/images/generations', assetFlow: 'none', resultExtractor: 'generic-media', contractStatus: 'partial', notes: ['docs/notes/T8grok.md'], contractIssues: ['图像接口参数需按 T8 文档继续实测。'], fields: promptFields([{ key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'image', label: '参考图', kind: 'images' }]), ratios: RATIOS.filter(value => value !== 'adaptive') }),
  runninghubStandard({ id: 'runninghub/api/z-image-turbo', model: 'z-image-turbo', label: 'Z Image Turbo · RunningHub', task: 'image', mode: 'text-to-image', price: 0.05, notes: ['docs/notes/runninghub-zimage-turbo模型.md'], fields: promptFields([{ key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2']) }, { key: 'lora', label: 'LoRA', kind: 'text' }, { key: 'lora_strength', label: 'LoRA 强度', kind: 'number', defaultValue: 1, min: -100, max: 100, step: 0.1 }, { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png', options: options(['png', 'jpeg', 'webp(lossless)', 'webp(lossy)']) }]), ratios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'] }),
  directImage({ id: 'newapi/t8/gemini-3.1-flash-image-preview', model: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image · T8 直连', price: 0.1, apiStyle: 'newapi-task', mode: 'text-to-image', endpoint: '/v1/images/generations', assetFlow: 'none', resultExtractor: 'generic-media', notes: ['docs/notes/T8gemini.md'], contractStatus: 'partial', fields: promptFields([{ key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'image', label: '参考图', kind: 'images' }]), ratios: RATIOS.filter(value => value !== 'adaptive') }),
  directImage({ id: 'newapi/t8/gemini-3.1-flash-image-preview-2k', model: 'gemini-3.1-flash-image-preview-2k', label: 'Gemini 3.1 Flash Image 2K · T8 直连', price: 0.1, apiStyle: 'newapi-task', mode: 'text-to-image', endpoint: '/v1/images/generations', assetFlow: 'none', resultExtractor: 'generic-media', notes: ['docs/notes/T8gemini.md'], contractStatus: 'partial', fields: promptFields([{ key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'image', label: '参考图', kind: 'images' }]), ratios: RATIOS.filter(value => value !== 'adaptive') }),
  directImage({ id: 'newapi/t8/gemini-3-pro-image-preview', model: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image · T8 直连', price: 0.2, apiStyle: 'newapi-task', mode: 'text-to-image', endpoint: '/v1/images/generations', assetFlow: 'none', resultExtractor: 'generic-media', notes: ['docs/notes/T8gemini.md'], contractStatus: 'partial', fields: promptFields([{ key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'image', label: '参考图', kind: 'images' }]), ratios: RATIOS.filter(value => value !== 'adaptive') }),
  directImage({ id: 'newapi/t8/gemini-3-pro-image-preview-2k', model: 'gemini-3-pro-image-preview-2k', label: 'Gemini 3 Pro Image 2K · T8 直连', price: 0.4, apiStyle: 'newapi-task', mode: 'text-to-image', endpoint: '/v1/images/generations', assetFlow: 'none', resultExtractor: 'generic-media', notes: ['docs/notes/T8gemini.md'], contractStatus: 'partial', fields: promptFields([{ key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'image', label: '参考图', kind: 'images' }]), ratios: RATIOS.filter(value => value !== 'adaptive') }),
  directImage({ id: 'newapi/t8/gemini-3-pro-image-preview-4k', model: 'gemini-3-pro-image-preview-4k', label: 'Gemini 3 Pro Image 4K · T8 直连', price: 0.5, apiStyle: 'newapi-task', mode: 'text-to-image', endpoint: '/v1/images/generations', assetFlow: 'none', resultExtractor: 'generic-media', notes: ['docs/notes/T8gemini.md'], contractStatus: 'partial', fields: promptFields([{ key: 'aspect_ratio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'image', label: '参考图', kind: 'images' }]), ratios: RATIOS.filter(value => value !== 'adaptive') }),

  // ── MJ (Midjourney) relax imagine (T8/NewAPI) ──
  // 文档: docs/notes/T8mj模型.md
  // 提交 POST /mj/submit/imagine → 轮询 GET /mj/task/{id}/fetch
  baseSpec({
    id: 'newapi/t8/mj-relax-imagine',
    model: 'mj_relax_imagine',
    label: 'MJ Relax Imagine · T8 直连',
    task: 'image',
    source: 'newapi-direct',
    route: 'newapi-direct',
    upstreamFamily: 't8',
    apiStyle: 'mj-task',
    mode: 'text-to-image',
    contractStatus: 'partial',
    price: 0.1,
    endpoint: '/mj/submit/imagine',
    pollKind: 'mj-task',
    assetFlow: 'none',
    resultExtractor: 'generic-media',
    fields: promptFields(),
    notes: ['docs/notes/T8mj模型.md'],
    contractIssues: ['MJ relax 模式，轮询走 /mj/task/{id}/fetch。'],
  }),

  directVideo({ id: 'newapi/t8/grok-video-3', model: 'grok-video-3', label: 'Grok Video 3 · T8 直连', price: 0.2, upstreamFamily: 't8', notes: ['docs/notes/T8grok.md'] }),
  directVideo({ id: 'newapi/t8/grok-video-3-fast', model: 'grok-video-3-fast', label: 'Grok Video 3 Fast · T8 直连', price: 0.2, upstreamFamily: 't8', contractStatus: 'broken', notes: ['docs/notes/T8grok.md'], contractIssues: ['上游返回 503，渠道不可用'] }),
  directVideo({ id: 'newapi/t8/veo3.1-fast', model: 'veo3.1-fast', label: 'Veo 3.1 Fast · T8 直连', price: 0.4, upstreamFamily: 't8', notes: ['docs/notes/T8模型接口配置文档.md'], contractStatus: 'broken', contractIssues: ['上游返回 model_not_found，模型不存在或已下线'] }),
  directVideo({ id: 'newapi/t8/veo_3_1-fast', model: 'veo_3_1-fast', label: 'Veo 3.1 Fast · NewAPI Alias', price: 0.4, upstreamFamily: 't8', notes: ['NewAPI alias'], contractStatus: 'partial' }),
  directVideo({ id: 'newapi/trump/seedance-2.0', model: 'seedance-2.0', label: 'Seedance 2.0 · 特朗普/WorldRouter', price: 1, upstreamFamily: 'trump', apiStyle: 'seedance-task', endpoint: '/api/v3/contents/generations/tasks', contractStatus: 'broken', notes: ['docs/notes/特朗普seedace2.md'], contractIssues: ['/api/v3/contents/generations/tasks 返回 404'] }),
  directVideo({ id: 'newapi/trump/seedance-2.0-fast', model: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast · 特朗普/WorldRouter', price: 1, upstreamFamily: 'trump', apiStyle: 'seedance-task', endpoint: '/api/v3/contents/generations/tasks', contractStatus: 'broken', notes: ['docs/notes/特朗普seedace2.md'], contractIssues: ['/api/v3/contents/generations/tasks 返回 404'] }),
  directVideo({ id: 'newapi/t8/seedance-2-0', model: 'seedance-2-0', label: 'Seedance 2.0 · T8/火山', price: 1, upstreamFamily: 't8', apiStyle: 'seedance-task', endpoint: '/api/seedance/v1/videos', notes: ['docs/notes/t8seedance.md'] }),
  directVideo({ id: 'newapi/t8/seedance-2-0-pro', model: 'seedance-2-0-pro', label: 'Seedance 2.0 Pro · T8/火山', price: 1, upstreamFamily: 't8', apiStyle: 'seedance-task', endpoint: '/api/seedance/v1/videos', notes: ['docs/notes/t8seedance.md'] }),
  directVideo({ id: 'newapi/t8/seedance-2-0-fast', model: 'seedance-2-0-fast', label: 'Seedance 2.0 Fast · T8/火山', price: 1, upstreamFamily: 't8', apiStyle: 'seedance-task', endpoint: '/api/seedance/v1/videos', contractStatus: 'degraded', notes: ['docs/notes/t8seedance.md'], contractIssues: ['上游偶发 522，触发时可重试'] }),
  directVideo({ id: 'newapi/volcengine/doubao-seedance-2-0-260128', model: 'doubao-seedance-2-0-260128', label: 'Doubao Seedance 2.0 · 火山', price: 1.5, upstreamFamily: 'volcengine', apiStyle: 'seedance-task', endpoint: '/api/seedance/v1/videos', notes: ['docs/notes/火山引擎seedance2.0.md'] }),

  baseSpec({ id: 'newapi/t8/suno-custom-song', model: 'suno_music', label: 'Suno 自定义歌曲 · T8 直连', task: 'audio', source: 'newapi-direct', route: 'newapi-direct', upstreamFamily: 't8', apiStyle: 'suno-task', mode: 'text-to-audio', contractStatus: 'partial', endpoint: '/suno/submit/music', pollKind: 'suno-task', resultExtractor: 'suno', notes: ['docs/notes/T8suno 音乐模型文档.md'], fields: promptFields([{ key: 'title', label: '歌曲标题', kind: 'text' }, { key: 'tags', label: '音乐风格', kind: 'text' }]) }),
  baseSpec({ id: 'newapi/t8/suno-inspiration-song', model: 'suno_music', label: 'Suno 灵感歌曲 · T8 直连', task: 'audio', source: 'newapi-direct', route: 'newapi-direct', upstreamFamily: 't8', apiStyle: 'suno-task', mode: 'text-to-audio', contractStatus: 'partial', endpoint: '/suno/submit/music', pollKind: 'suno-task', resultExtractor: 'suno', notes: ['docs/notes/T8suno 音乐模型文档.md'], fields: promptFields([{ key: 'title', label: '歌曲标题', kind: 'text' }, { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false }]) }),
  baseSpec({ id: 'newapi/t8/suno-lyrics', model: 'suno_lyrics', label: 'Suno 歌词 · T8 直连', task: 'audio', source: 'newapi-direct', route: 'newapi-direct', upstreamFamily: 't8', apiStyle: 'suno-task', mode: 'lyrics', contractStatus: 'partial', endpoint: '/suno/submit/lyrics', pollKind: 'suno-task', resultExtractor: 'suno', outputModalities: ['text'], notes: ['docs/notes/T8suno 音乐模型文档.md'] }),

  runninghubStandard({ id: 'runninghub/api/rh-gpt2-image', model: 'rh-gpt2-image', label: 'GPT2.0 图生图 · RunningHub', task: 'image', mode: 'image-to-image', price: 0.15, notes: ['docs/notes/runninghub-GPT-image-2.md'], files: { images: { min: 1, max: 5 } }, fields: promptFields([{ key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1k', options: options(RH_IMAGE_RESOLUTIONS) }, { key: 'images', label: '参考图', kind: 'images', required: true }]) }),
  runninghubStandard({ id: 'runninghub/api/rh-gpt2-text', model: 'rh-gpt2-text', label: 'GPT2.0 文生图 · RunningHub', task: 'image', mode: 'text-to-image', price: 0.15, notes: ['docs/notes/runninghub-GPT-image-2.md'], fields: promptFields([{ key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(RATIOS.filter(value => value !== 'adaptive')) }, { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '1k', options: options(RH_IMAGE_RESOLUTIONS) }]) }),
  runninghubStandard({ id: 'runninghub/api/rh-image-v2', model: 'rh-image-v2', label: '全能图片 V2 · RunningHub', task: 'image', mode: 'text-to-image', price: 0.3, notes: ['RH capabilities'], files: { images: { min: 0, max: 5 } }, fields: promptFields([{ key: 'images', label: '参考图', kind: 'images' }]) }),
  runninghubStandard({ id: 'runninghub/api/rh-pro-image', model: 'rh-pro-image', label: '全能图片 PRO · RunningHub', task: 'image', mode: 'image-to-image', price: 0.3, notes: ['docs/notes/runninghub-banana.md'], files: { images: { min: 0, max: 8 } } }),

  // ── 🆕 FLUX.2 Klein 9B 系列 (3 个) ──
  runninghubStandard({ id: 'runninghub/api/rh-flux-klein-edit', model: 'rh-flux-klein-edit', label: 'FLUX Klein 9B 编辑 · RunningHub', task: 'image', mode: 'image-to-image', price: 0.10, contractStatus: 'partial', notes: ['docs/notes/rh-flux-klein-9b.md'], files: { images: { min: 1, max: 1 } }, fields: promptFields([{ key: 'images', label: '参考图', kind: 'images', required: true }, { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom']) }, { key: 'customWidth', label: '宽度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 }, { key: 'customHight', label: '高度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 }, { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png', options: options(['png','jpeg','webp(lossless)','webp(lossy)']) }]), ratios: ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom'], contractIssues: ['imageUrl 字段映射需验证。customWidth/customHight 仅 aspectRatio=custom 时 UI 显示。'] }),
  runninghubStandard({ id: 'runninghub/api/rh-flux-klein-text', model: 'rh-flux-klein-text', label: 'FLUX Klein 9B 文生图 · RunningHub', task: 'image', mode: 'text-to-image', price: 0.05, contractStatus: 'partial', notes: ['docs/notes/rh-flux-klein-9b.md'], fields: promptFields([{ key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom']) }, { key: 'customWidth', label: '宽度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 }, { key: 'customHight', label: '高度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 }, { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png', options: options(['png','jpeg','webp(lossless)','webp(lossy)']) }]), ratios: ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom'] }),
  runninghubStandard({ id: 'runninghub/api/rh-flux-klein-lora', model: 'rh-flux-klein-lora', label: 'FLUX Klein 9B LoRA · RunningHub', task: 'image', mode: 'text-to-image', price: 0.08, contractStatus: 'partial', notes: ['docs/notes/rh-flux-klein-9b.md'], fields: promptFields([{ key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom']) }, { key: 'customWidth', label: '宽度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 }, { key: 'customHight', label: '高度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 }, { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png', options: options(['png','jpeg','webp(lossless)','webp(lossy)']) }, { key: 'lora', label: 'LoRA', kind: 'text' }, { key: 'lora_strength', label: 'LoRA 强度', kind: 'number', defaultValue: 0, min: -100, max: 100, step: 0.1 }]), ratios: ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom'] }),

  // ── 🆕 Midjourney.1 ──
  runninghubStandard({ id: 'runninghub/api/rh-midjourney-v81', model: 'rh-midjourney-v81', label: 'Midjourney.1 · RunningHub', task: 'image', mode: 'text-to-image', price: 0.10, contractStatus: 'partial', notes: ['docs/notes/RH-图片模型.md'], files: { images: { min: 0, max: 1 } }, fields: promptFields([{ key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1', options: options(['1:1','4:3','3:2','16:9','3:4','2:3','9:16']) }, { key: 'hd', label: '原生 2K', kind: 'boolean', defaultValue: false }, { key: 'images', label: '垫图', kind: 'images' }, { key: 'quality', label: '质量', kind: 'select', defaultValue: '1', options: options(['1','4']) }, { key: 'stylize', label: '风格化', kind: 'number', defaultValue: 100, min: 0, max: 1000, step: 10 }, { key: 'chaos', label: '混沌', kind: 'number', defaultValue: 0, min: 0, max: 100, step: 1 }, { key: 'raw', label: '原始模式', kind: 'boolean', defaultValue: false }, { key: 'iw', label: '图像权重', kind: 'number', defaultValue: 1, min: 0, max: 3, step: 1 }, { key: 'sref', label: '风格参考', kind: 'text' }, { key: 'sw', label: '风格权重', kind: 'number', defaultValue: 100, min: 0, max: 1000, step: 10 }, { key: 'sv', label: '风格版本', kind: 'number', defaultValue: 6, min: 6, max: 6 }]), ratios: ['1:1','4:3','3:2','16:9','3:4','2:3','9:16'], contractIssues: ['全部 11 个参数已注册。高级参数(raw/iw/sref/sw/sv) UI 折叠展示。需验证全部 11 个参数进入 RH payload。'] }),

  // ── 🆕 Grok Image 4.2 系列 (2 个) ──
  runninghubStandard({ id: 'runninghub/api/rh-grok-image-text', model: 'rh-grok-image-text', label: 'Grok Image 4.2 文生图 · RunningHub', task: 'image', mode: 'text-to-image', price: 0.03, contractStatus: 'partial', notes: ['docs/notes/RH-图片模型.md'], fields: promptFields([{ key: 'variant', label: '版本', kind: 'select', defaultValue: 'g-4.2', options: options(['g-3','g-4','g-4.1','g-4.2']) }, { key: 'aspectRatio', label: '尺寸', kind: 'select', defaultValue: '960x960', options: options(['960x960','720x1280','1280x720','1168x784','784x1168']) }]), contractIssues: ['低价渠道，不稳定。aspectRatio 为像素尺寸格式。variant→model 映射在 rh-adapter 完成。'] }),
  runninghubStandard({ id: 'runninghub/api/rh-grok-image-image', model: 'rh-grok-image-image', label: 'Grok Image 4.2 图生图 · RunningHub', task: 'image', mode: 'image-to-image', price: 0.05, contractStatus: 'partial', notes: ['docs/notes/RH-图片模型.md'], files: { images: { min: 1, max: 1 } }, fields: promptFields([{ key: 'variant', label: '版本', kind: 'select', defaultValue: 'g-4.2', options: options(['g-3','g-4','g-4.1','g-4.2']) }, { key: 'images', label: '参考图', kind: 'images', required: true }]), contractIssues: ['低价渠道，不稳定。imageUrl + variant→model 映射需验证。'] }),
  runninghubStandard({ id: 'runninghub/api/rh-video-v31-fast', model: 'rh-video-v31-fast', label: '全能视频 V3.1 Fast · RunningHub', task: 'video', mode: 'image-to-video', price: 2, notes: ['RH capabilities'], files: { images: { min: 0, max: 3 } }, duration: { allowedValues: [8] }, aliases: ['全能视频V3.1-Fast'] }),
  runninghubStandard({ id: 'runninghub/api/rh-grok-text-video', model: 'rh-grok-text-video', label: 'Grok Video 文生视频 · RunningHub', task: 'video', mode: 'text-to-video', price: 0.08, notes: ['docs/notes/runninghub-grok-video-3文档.md'], duration: { min: 6, max: 30 }, aliases: ['Grok Video 文生视频'] }),
  runninghubStandard({ id: 'runninghub/api/rh-grok-image-video', model: 'rh-grok-image-video', label: 'Grok Video 图生视频 · RunningHub', task: 'video', mode: 'image-to-video', price: 0.08, notes: ['docs/notes/runninghub-grok-video-3文档.md'], files: { images: { min: 1, max: 3 } }, duration: { min: 6, max: 30 } }),
  runninghubStandard({ id: 'runninghub/api/rh-grok-video-edit', model: 'rh-grok-video-edit', label: 'Grok Video 视频编辑 · RunningHub', task: 'video', mode: 'video-edit', price: 0.08, notes: ['docs/notes/runninghub-grok-video-3文档.md'], files: { videos: { min: 1, max: 1 } } }),
  runninghubStandard({ id: 'runninghub/api/rh-seedance2-text-video', model: 'rh-seedance2-text-video', label: 'Seedance 2.0 文生视频 · RunningHub', task: 'video', mode: 'text-to-video', price: 1.5, notes: ['docs/notes/runninghub-seedance文档.md'], duration: { min: 4, max: 15 } }),
  runninghubStandard({ id: 'runninghub/api/rh-seedance2-image-video', model: 'rh-seedance2-image-video', label: 'Seedance 2.0 图生视频 · RunningHub', task: 'video', mode: 'image-to-video', price: 1.5, notes: ['docs/notes/runninghub-seedance文档.md'], files: { images: { min: 1, max: 2 } }, duration: { min: 4, max: 15 } }),
  runninghubStandard({ id: 'runninghub/api/rh-seedance2-multimodal-video', model: 'rh-seedance2-multimodal-video', label: 'Seedance 2.0 全能参考 · RunningHub', task: 'video', mode: 'workflow', price: 1.5, notes: ['docs/notes/runninghub-seedance文档.md'], files: { images: { min: 0, max: 9 }, videos: { min: 0, max: 1 }, audios: { min: 0, max: 1 } }, duration: { min: 4, max: 15 } }),

  // ── 🆕 LTX 2.3 视频系列 (2 个) ──
  runninghubStandard({ id: 'runninghub/api/rh-ltx23-text-video', model: 'rh-ltx23-text-video', label: 'LTX 2.3 文生视频 · RunningHub', task: 'video', mode: 'text-to-video', price: 0.50, contractStatus: 'partial', notes: ['docs/notes/RH-视频模型.md'], fields: promptFields([{ key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['1080p','720p','480p']) }, { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['16:9','9:16']) }, { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 5, max: 15, step: 1 }]), duration: { min: 5, max: 15 }, ratios: ['16:9','9:16'], resolutions: ['1080p','720p','480p'] }),
  runninghubStandard({ id: 'runninghub/api/rh-ltx23-image-video', model: 'rh-ltx23-image-video', label: 'LTX 2.3 图生视频 · RunningHub', task: 'video', mode: 'image-to-video', price: 0.50, contractStatus: 'partial', notes: ['docs/notes/RH-视频模型.md'], files: { images: { min: 1, max: 1 } }, fields: promptFields([{ key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p', options: options(['480p','720p','1080p']) }, { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9', options: options(['9:16','16:9']) }, { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 5, max: 20, step: 1 }]), duration: { min: 5, max: 20 }, ratios: ['9:16','16:9'], resolutions: ['480p','720p','1080p'] }),

  runninghubStandard({ id: 'runninghub/api/rh-suno-v55-single', model: 'rh-suno-v55-single', label: 'Suno v5.5 一句话成歌 · RunningHub', task: 'audio', mode: 'text-to-audio', price: 1, notes: ['docs/notes/runninghub-suno.md'], fields: promptFields([{ key: 'title', label: '歌曲标题', kind: 'text' }, { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false }]) }),
  runninghubStandard({ id: 'runninghub/api/rh-suno-v55-custom', model: 'rh-suno-v55-custom', label: 'Suno v5.5 自定义成歌 · RunningHub', task: 'audio', mode: 'text-to-audio', price: 1, notes: ['docs/notes/runninghub-suno.md'], fields: promptFields([{ key: 'title', label: '歌曲标题', kind: 'text' }, { key: 'tags', label: '音乐风格', kind: 'text' }, { key: 'negative_tags', label: '排除风格', kind: 'text' }, { key: 'make_instrumental', label: '纯音乐', kind: 'boolean', defaultValue: false }]) }),
  runninghubStandard({ id: 'runninghub/api/rh-suno-lyrics', model: 'rh-suno-lyrics', label: 'Suno 创作歌词 · RunningHub', task: 'audio', mode: 'lyrics', price: 0.02, notes: ['docs/notes/runninghub-suno.md'], outputModalities: ['text'] }),
  runninghubStandard({ id: 'runninghub/api/rh-speech-hd', model: 'rh-speech-hd', label: '语音合成 HD · RunningHub', task: 'audio', mode: 'text-to-audio', price: 0.5, notes: ['RH capabilities'], contractStatus: 'unknown' }),
  runninghubStandard({ id: 'runninghub/api/rh-speech-turbo', model: 'rh-speech-turbo', label: '语音合成 Turbo · RunningHub', task: 'audio', mode: 'text-to-audio', price: 0.5, notes: ['RH capabilities'], contractStatus: 'unknown' }),
  runninghubStandard({ id: 'runninghub/api/rh-music', model: 'rh-music', label: '音乐生成 · RunningHub', task: 'audio', mode: 'text-to-audio', price: 0.5, notes: ['RH capabilities'], contractStatus: 'unknown' }),
  runninghubStandard({ id: 'runninghub/api/rh-voice-clone', model: 'rh-voice-clone', label: '声音克隆 · RunningHub', task: 'audio', mode: 'voice-clone', price: 0.15, notes: ['RH capabilities'], contractStatus: 'unknown', files: { audios: { min: 1, max: 1 } } }),

  runninghubStandard({ id: 'runninghub/aiapp/rh-aiapp-fast-digital-human', model: 'rh-aiapp-fast-digital-human', label: '极速数字人 · RunningHub 工作流', task: 'digital-human', mode: 'digital-human', price: 0.5, apiStyle: 'rh-aiapp', contractStatus: 'partial', notes: ['docs/notes/runninghub 5个工作流模型参数.md'], files: { images: { min: 1, max: 1 }, audios: { min: 1, max: 1 } }, fields: [{ key: 'image', label: '人物照片', kind: 'image', required: true }, { key: 'audio', label: '驱动音频', kind: 'audio', required: true }, { key: 'value', label: '画面值', kind: 'number', defaultValue: 832, min: 16, step: 16 }], contractIssues: ['AI App nodeInfoList 映射需由 rh-adapter 实测确认。'], aliases: ['rh-digital-human-fast', 'rh-aiapp-fast-digital-human', 'runninghub/aiapp/rh-digital-human-fast'] }),
  runninghubStandard({ id: 'runninghub/aiapp/rh-aiapp-digital-human', model: 'rh-aiapp-digital-human', label: '数字人 · RunningHub 工作流', task: 'digital-human', mode: 'digital-human', price: 0.5, apiStyle: 'rh-aiapp', contractStatus: 'partial', notes: ['docs/notes/runninghub 5个工作流模型参数.md'], files: { images: { min: 1, max: 1 }, audios: { min: 1, max: 1 } }, fields: promptFields([{ key: 'text', label: '台词', kind: 'textarea', required: true }, { key: 'image', label: '上传首帧图', kind: 'image', required: true }, { key: 'audio', label: '上传参考音频', kind: 'audio', required: true }, { key: 'width', label: '宽', kind: 'number', defaultValue: 540, min: 1, step: 1 }, { key: 'height', label: '高', kind: 'number', defaultValue: 960, min: 1, step: 1 }]) }),
  runninghubStandard({ id: 'runninghub/aiapp/rh-aiapp-director', model: 'rh-aiapp-director', label: '我是导演 · RunningHub 工作流', task: 'video', mode: 'workflow', price: 0.5, apiStyle: 'rh-aiapp', contractStatus: 'partial', notes: ['docs/notes/我是导演.md'], files: { images: { min: 1, max: 1 }, videos: { min: 1, max: 1 } }, fields: [{ key: 'image', label: '你想让谁演', kind: 'image', required: true }, { key: 'video', label: '你想让她/他演啥', kind: 'video', required: true }, { key: 'text', label: '简单说下动作是啥', kind: 'textarea', required: true }, { key: 'width', label: '宽（竖屏不用动，横屏换下数字）', kind: 'number', defaultValue: 480, min: 1, step: 1 }, { key: 'height', label: '高（竖屏不用动，横屏换下数字）', kind: 'number', defaultValue: 832, min: 1, step: 1 }] }),
  runninghubStandard({ id: 'runninghub/aiapp/rh-aiapp-voice-clone', model: 'rh-aiapp-voice-clone', label: '声音克隆 · RunningHub 工作流', task: 'audio', mode: 'voice-clone', price: 0.5, apiStyle: 'rh-aiapp', contractStatus: 'partial', notes: ['docs/notes/runninghub 5个工作流模型参数.md'], files: { audios: { min: 1, max: 1 } }, fields: [{ key: 'audio', label: '参考音频', kind: 'audio', required: true }, { key: 'start_time', label: '开始时间', kind: 'text', required: true, defaultValue: '0:00' }, { key: 'end_time', label: '结束时间', kind: 'text', required: true, defaultValue: '0:11' }, { key: 'ref_text', label: '参考音频文字内容', kind: 'textarea', required: true }, { key: 'text', label: '输出音频文字内容', kind: 'textarea', required: true }, { key: 'language', label: '语言', kind: 'select', required: true, defaultValue: '中文', options: options(['自动', '中文', '英文', '日文', '韩文', '德文', '法文', '俄文', '葡萄牙文', '西班牙文', '意大利文']) }] }),
  runninghubStandard({ id: 'runninghub/aiapp/rh-aiapp-voice-design', model: 'rh-aiapp-voice-design', label: '声音设计 · RunningHub 工作流', task: 'audio', mode: 'voice-design', price: 0.5, apiStyle: 'rh-aiapp', contractStatus: 'partial', notes: ['docs/notes/runninghub 5个工作流模型参数.md'], fields: [{ key: 'language', label: '语言', kind: 'select', required: true, defaultValue: '中文', options: options(['自动', '中文', '英文', '日文', '韩文', '德文', '法文', '俄文', '葡萄牙文', '西班牙文', '意大利文']) }, { key: 'text', label: '文稿', kind: 'textarea', required: true }, { key: 'voice_prompt', label: '声音设定', kind: 'textarea', required: true }] }),
]

export function getCreationModelSpec(idOrModel: string): CreationModelSpec | undefined {
  const exact = CREATION_MODEL_REGISTRY.find(spec => spec.id === idOrModel)
  if (exact) return exact
  const matches = CREATION_MODEL_REGISTRY.filter(spec => spec.model === idOrModel || spec.aliases?.includes(idOrModel))
  if (matches.length > 1) {
    throw new Error(`Ambiguous creation model key "${idOrModel}". Use a namespaced CreationModelSpec.id.`)
  }
  return matches[0]
}

export function listCreationModels(filter: ListCreationModelsFilter = {}): CreationModelListItem[] {
  return CREATION_MODEL_REGISTRY
    .filter(spec => !filter.task || spec.task === filter.task)
    .filter(spec => !filter.mode || spec.mode === filter.mode)
    .filter(spec => !filter.source || filter.source === 'all' || spec.source === filter.source)
    .filter(spec => filter.includeDisabled || spec.contractStatus !== 'broken')
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
        spec.contractStatus === 'verified' ? '已核对'
          : spec.contractStatus === 'partial' ? '部分核对'
          : spec.contractStatus === 'broken' ? '已损坏'
          : spec.contractStatus === 'degraded' ? '降级'
          : '待核对',
      ],
    }))
}

export function listCreationPanelModels(filter: ListCreationModelsFilter = {}): CreationPanelModelItem[] {
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
  const base = String(label || '').split('·')[0].trim()
  return LABEL_OVERRIDES[base] || base
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
  if (spec.files?.images?.min) params.images = Array.from({ length: spec.files.images.min }, (_, index) => `preview-${index}.png`)
  if (spec.files?.videos?.min) params.videos = Array.from({ length: spec.files.videos.min }, (_, index) => `preview-${index}.mp4`)
  if (spec.files?.audios?.min) params.audios = Array.from({ length: spec.files.audios.min }, (_, index) => `preview-${index}.mp3`)
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

function buildPanelSummaryPreview(spec: CreationModelSpec, params: Record<string, unknown>): string {
  const sourceLabel = spec.source === 'runninghub' ? 'RunningHub' : '直连'
  const upstreamLabels: Record<CreationUpstreamFamily, string> = {
    t8: 'T8',
    volcengine: '火山',
    worldrouter: 'WorldRouter',
    trump: '特朗普',
    runninghub: 'RH 官方 API',
    'openai-compatible': 'OpenAI-compatible',
    unknown: '未知',
  }
  const parts = [sourceLabel, upstreamLabels[spec.upstreamFamily], spec.mode]
  if (params.prompt) parts.push('有提示词')
  if (params.images) parts.push(`参考图 ${Array.isArray(params.images) ? params.images.length : 1} 张`)
  if (params.audios) parts.push(`音频 ${Array.isArray(params.audios) ? params.audios.length : 1} 段`)
  if (params.videos) parts.push(`视频 ${Array.isArray(params.videos) ? params.videos.length : 1} 段`)
  return parts.join(' · ')
}

function upstreamBadge(upstreamFamily: CreationUpstreamFamily): string {
  const labels: Record<CreationUpstreamFamily, string> = {
    t8: 'T8',
    volcengine: '火山',
    worldrouter: 'WorldRouter',
    trump: '特朗普',
    runninghub: 'RH',
    'openai-compatible': 'OpenAI-compatible',
    unknown: '未知',
  }
  return labels[upstreamFamily]
}
