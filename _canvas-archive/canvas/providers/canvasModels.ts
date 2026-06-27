/**
 * 模型注册表 - 集中定义可扩展模型清单
 * 后续要新增模型只需在对应数组里追加即可
 */

export type ProviderType = 'newapi' | 'llm-direct' | 'runninghub';

// ========== 图像 ==========
// paramKind:决定调用上游时使用哪种参数协议
//  - 'gpt-size'    : OpenAI 兼容,size 字段为像素串(1024x1024 等),编辑端点 multipart
//  - 'banana-ratio': nano-banana 协议,使用 aspect_ratio + image_size(1K/2K/4K) + image[]
//  - 'mj'          : Midjourney 协议,走专属 /api/proxy/mj/* 路由(speed_map + sref/oref)
export type ImageParamKind = 'gpt-size' | 'banana-ratio' | 'mj';

export interface ImageModelDef {
  id: string;             // 节点内部 id(如 'gpt-image-2')
  apiModel: string;       // 默认上游真实模型名(透传给 API)
  label: string;          // 长名(用于描述行)
  tabLabel: string;       // TAB 短名
  provider: ProviderType;
  paramKind: ImageParamKind;
  capabilities: ('t2i' | 'i2i' | 'edit' | 'text-render')[];
  // 子模型变体(对齐主项目 gpt-image-2-web 的 g_model / n_model 下拉)
  apiModelOptions: Array<{ value: string; label: string }>;
  // 比例选项(双协议通用,Auto/1:1/16:9 …)
  aspectRatios: string[];
  defaultAspectRatio: string;
  // 尺寸选项:gpt-size 用像素串(1024x1024…), banana-ratio 用等级(1K/2K/4K)
  sizes: string[];
  defaultSize: string;
  // 是否支持参考图(图生图)
  supportsReference: boolean;
  // 参考图最大数量
  maxReferenceImages: number;
  description?: string;
}

// 主项目 gpt-image-2-web 的 aspectRatio 全集(14 种 + Auto)
const GPT_RATIOS = ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'];
// nano-banana-2(Flash)支持全部 14 个比例,Pro 支持精简集
const BANANA_FLASH_RATIOS = GPT_RATIOS;
const BANANA_PRO_RATIOS = ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9'];

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: 'gpt-image-2',
    apiModel: 'gpt-image-2-all', // 主项目 Tab 0 默认选中
    label: 'GPT Image 2',
    tabLabel: 'GPT2',
    provider: 'newapi',
    paramKind: 'gpt-size',
    capabilities: ['t2i', 'i2i', 'edit', 'text-render'],
    apiModelOptions: [
      { value: 'gpt-image-2-all', label: 'gpt-image-2-all' },
      { value: 'gpt-image-2', label: 'gpt-image-2' },
      { value: 'gpt-image-2-fal', label: 'gpt-image-2-fal' },
    ],
    aspectRatios: GPT_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K', // 主项目默认为 2K
    supportsReference: true,
    maxReferenceImages: 5,
    description: '支持文生图/图生图/编辑/文字渲染',
  },
  {
    id: 'nano-banana-2',
    apiModel: 'nano-banana-2',
    label: 'Nano Banana 2',
    tabLabel: '香蕉2',
    provider: 'newapi',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [
      { value: 'nano-banana-2', label: 'nano-banana-2 (Flash)' },
      { value: 'nano-banana-2-fal', label: 'nano-banana-2-fal' },
    ],
    aspectRatios: BANANA_FLASH_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '高速生成,适合迭代',
  },
  {
    id: 'nano-banana-pro',
    apiModel: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    tabLabel: '香蕉Pro',
    provider: 'newapi',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i', 'edit'],
    apiModelOptions: [
      { value: 'nano-banana-pro', label: 'nano-banana-pro' },
      { value: 'nano-banana-pro-2k', label: 'nano-banana-pro-2k' },
      { value: 'nano-banana-pro-4k', label: 'nano-banana-pro-4k' },
      { value: 'nano-banana-pro-fal', label: 'nano-banana-pro-fal' },
    ],
    aspectRatios: BANANA_PRO_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '高品质 Pro 版本',
  },
  // ========================================================================
  // Midjourney — 完全对齐 gpt-image-2-web/index.html runMJ L4437~L4694
  //   * 不走 FAL 渠道
  //   * 不使用主流 size/imageSize 字段(MJ 用 ar 控制比例)
  //   * 参考图通过 --sref/--oref(uploadMJImage 后取 URL) 注入 prompt
  //   * 子模型在 prompt 后追加 --{version}(v 8.1 / niji 7 等)
  //   * 速度 fast/turbo/relax 决定上游 URL 段(mj-fast/mj-turbo/mj-relax)
  // ========================================================================
  {
    id: 'midjourney',
    apiModel: 'midjourney',
    label: 'Midjourney',
    tabLabel: 'MJ',
    provider: 'newapi',
    paramKind: 'mj',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [
      { value: 'midjourney', label: 'Midjourney' },
    ],
    aspectRatios: ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'],
    defaultAspectRatio: '1:1',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 4, // sref + oref(各 2 张)
    description: 'Midjourney v8.1 / niji 7 等',
  },
  // ── RunningHub 图片模型 (8788 网关) ──
  {
    id: 'rh-pro-image',
    apiModel: 'rh-pro-image',
    label: '全能图片PRO',
    tabLabel: 'RH-PRO',
    provider: 'runninghub',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [{ value: 'rh-pro-image', label: 'rh-pro-image' }],
    aspectRatios: BANANA_FLASH_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '1K',
    supportsReference: true,
    maxReferenceImages: 10,
    description: 'RunningHub 全能图片PRO',
  },
  {
    id: 'rh-gpt2-image',
    apiModel: 'rh-gpt2-image',
    label: 'GPT2.0',
    tabLabel: 'RH-GPT2',
    provider: 'runninghub',
    paramKind: 'banana-ratio',
    capabilities: ['i2i'],
    apiModelOptions: [{ value: 'rh-gpt2-image', label: 'rh-gpt2-image' }],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3'],
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '1K',
    supportsReference: true,
    maxReferenceImages: 10,
    description: 'RunningHub GPT2.0 图生图',
  },
  {
    id: 'rh-gpt2-text',
    apiModel: 'rh-gpt2-text',
    label: 'GPT2.0 文生图',
    tabLabel: 'RH-GPT2-T',
    provider: 'runninghub',
    paramKind: 'banana-ratio',
    capabilities: ['t2i'],
    apiModelOptions: [{ value: 'rh-gpt2-text', label: 'rh-gpt2-text' }],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3'],
    defaultAspectRatio: '16:9',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '1K',
    supportsReference: false,
    maxReferenceImages: 0,
    description: 'RunningHub GPT2.0 文生图',
  },
];

// ========================================================================
// MJ 常量(对齐 gpt-image-2-web/index.html L1552~L1580 mj_model/mj_ar 下拉)
// ========================================================================
/** 11 个 MJ 版本(v 8.1 默认 + niji 系列) */
export const MJ_VERSIONS: Array<{ value: string; label: string }> = [
  { value: 'v 8.1', label: 'v 8.1 (默认)' },
  { value: 'v 8',   label: 'v 8' },
  { value: 'v 7',   label: 'v 7' },
  { value: 'v 6.1', label: 'v 6.1' },
  { value: 'v 6.0', label: 'v 6.0' },
  { value: 'v 5.2', label: 'v 5.2' },
  { value: 'v 5.1', label: 'v 5.1' },
  { value: 'niji 7', label: 'niji 7' },
  { value: 'niji 6', label: 'niji 6' },
  { value: 'niji 5', label: 'niji 5' },
  { value: 'niji 4', label: 'niji 4' },
];
export const DEFAULT_MJ_VERSION = 'v 8.1';

/** 7 个 MJ 比例 */
export const MJ_RATIOS = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];
export const DEFAULT_MJ_RATIO = '1:1';

/** 3 档速度 */
export const MJ_SPEEDS: Array<{ value: 'fast' | 'turbo' | 'relax'; label: string }> = [
  { value: 'fast',  label: 'Fast (默认)' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'relax', label: 'Relax' },
];
export const DEFAULT_MJ_SPEED = 'fast';

/** 4 档 sv(Stylize Version) */
export const MJ_SVS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'sv 1 (默认)' },
  { value: '2', label: 'sv 2' },
  { value: '3', label: 'sv 3' },
  { value: '4', label: 'sv 4' },
];

/** 判断 modelDef.paramKind === 'mj' */
export function isMjModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  const def = IMAGE_MODELS.find((m) => m.id === apiModel || m.apiModel === apiModel);
  return def?.paramKind === 'mj';
}

// ========================================================================
// FAL 渠道注册表(完全对齐 gpt-image-2-web SKILL.md §FAL模型渠道接入规范)
//   - URL: {baseUrl}/fal/{endpoint}   (替换官方 queue.fal.run)
//   - 同步: response.images[]; 异步: request_id + response_url + 轮询
//   - response_url 域名修复: queue.fal.run → {baseUrl}/fal
//   - 轮询 HTTP 非 200 时,body 中 status==='IN_QUEUE'/'IN_PROGRESS' 时重试,否则抛错
// ========================================================================
// FAL 参数协议种类
//   - 'gpt-fal'      : openai/gpt-image-2(/edit) — quality/num_images/output_format/image_size/sync_mode
//   - 'nbpro-fal'    : fal-ai/nano-banana-pro/edit — num_images/aspect_ratio/resolution/output_format/safety_tolerance/system_prompt/enable_web_search
export type FalParamKind = 'gpt-fal' | 'nbpro-fal';

export interface FalEndpointDef {
  /** 文生图(无参考图)endpoint */
  endpoint: string;
  /** 图生图(有参考图,image_urls)endpoint;不填则与 endpoint 相同 */
  editEndpoint?: string;
  paramKind: FalParamKind;
  /** 最大参考图数(主项目: gpt=5, nbpro=8) */
  maxRefs: number;
}

/** 按 apiModel(如 'gpt-image-2-fal' / 'nano-banana-pro-fal' / 'nano-banana-2-fal')索引 */
export const FAL_REGISTRY: Record<string, FalEndpointDef> = {
  'gpt-image-2-fal': {
    endpoint: 'openai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    paramKind: 'gpt-fal',
    maxRefs: 5,
  },
  'nano-banana-pro-fal': {
    // nano-banana-pro FAL 只对外提供 edit 端点(主项目 line 3623)
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
  // 主项目 runGeminiFal(line 3491) 与 runNanoFal 共用同一个 fal-ai/nano-banana-pro/edit 端点,
  // 参数集与 nbpro-fal 完全一致(g2f_* 与 nf_* 仅是 UI 控件 id 前缀差异),
  // 所以复用 nbpro-fal paramKind / maxRefs=8 。
  'nano-banana-2-fal': {
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
};

/** 判断一个 apiModel 是否走 FAL 协议 */
export function isFalModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  return !!FAL_REGISTRY[String(apiModel)] || /-fal$/.test(String(apiModel));
}

/** GPT FAL 预设尺寸枚举(主项目 g_model 切到 fal 时的 gf_size 下拉) */
export const GPT_FAL_SIZES = [
  { value: 'auto', label: 'Auto' },
  { value: 'square_hd', label: 'Square HD' },
  { value: 'square', label: 'Square' },
  { value: 'portrait_4_3', label: 'Portrait 4:3' },
  { value: 'portrait_16_9', label: 'Portrait 16:9' },
  { value: 'landscape_4_3', label: 'Landscape 4:3' },
  { value: 'landscape_16_9', label: 'Landscape 16:9' },
  { value: 'custom', label: 'Custom (16 倍数)' },
];

/** Nano Banana Pro FAL 比例枚举(主项目 nf_ratio) */
export const NBPRO_FAL_RATIOS = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];
/** Nano Banana Pro FAL 分辨率枚举(主项目 nf_resolution) */
export const NBPRO_FAL_RESOLUTIONS = ['1K', '2K', '4K'];

// ========== 视频 ==========
// kind 决定上游 payload 协议(后端会根据 model 名自动识别,前端主要用于控制参数 UI 列表)
export type VideoKind = 'veo' | 'grok' | 'seedance';

// ---- Video FAL 渠道注册表 (1:1 对齐 gpt-image-2-web runVeo3Fal / runGrokFal) ----
export interface VideoFalEndpointDef {
  /** 文生视频 endpoint */
  endpoint: string;
  /** 图生视频 endpoint (有参考图时走这个) */
  i2vEndpoint?: string;
  paramKind: 'veo-fal' | 'grok-fal';
  maxRefImages: number;
}
export const VIDEO_FAL_REGISTRY: Record<string, VideoFalEndpointDef> = {
  // 主项目 runVeo3Fal (index.html line 3713)
  'veo3.1-fal': {
    endpoint: 'fal-ai/veo3.1/fast/reference-to-video',
    paramKind: 'veo-fal',
    maxRefImages: 3,
  },
  // 主项目 runGrokFal (index.html line 3772)
  'grok-video-fal': {
    endpoint: 'xai/grok-imagine-video/text-to-video',
    i2vEndpoint: 'xai/grok-imagine-video/image-to-video',
    paramKind: 'grok-fal',
    maxRefImages: 1,
  },
};
export function isFalVideoModel(apiModel: string): boolean {
  return apiModel in VIDEO_FAL_REGISTRY;
}
/** Veo FAL 比例(主项目 vf_ratio) */
export const VEO_FAL_RATIOS = ['16:9', '9:16'];
/** Veo FAL 时长(主项目 vf_duration) */
export const VEO_FAL_DURATIONS = ['8s'];
/** Veo FAL 分辨率(主项目 vf_resolution) */
export const VEO_FAL_RESOLUTIONS = ['720p', '1080p', '4k'];
/** Grok FAL 比例(主项目 gkf_ratio) */
export const GROK_FAL_RATIOS = ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', 'auto'];
/** Grok FAL 分辨率(主项目 gkf_resolution) */
export const GROK_FAL_RESOLUTIONS = ['720p', '480p'];

export interface VideoModelDef {
  id: string;                // 节点默认 model 字段(也是上游真实 model)
  label: string;             // 主选项显示名
  kind: VideoKind;
  provider: ProviderType;
  description?: string;
  // 子模型下拉(参考项目 类似 gpt-image-2-web 的 g_model / veo_model / gk_model)
  apiModelOptions: Array<{ value: string; label: string }>;
  // 比例/尺寸 — 字段名上游各不同,这里只是 UI 选项
  ratios: string[];
  defaultRatio: string;
  // Grok 专用:duration(s)、resolution 下拉
  durations?: number[];
  defaultDuration?: number;
  resolutions?: string[];
  defaultResolution?: string;
  // 参考图
  supportImages: boolean;
  maxRefImages: number;
}

// veo3.1 完整 13 个子模型(主项目 index.html line 1350)
const VEO_MODELS = [
  { value: 'veo3', label: 'veo3' },
  { value: 'veo3-fast', label: 'veo3-fast' },
  { value: 'veo3-pro', label: 'veo3-pro' },
  { value: 'veo3-fast-frames', label: 'veo3-fast-frames' },
  { value: 'veo3-pro-frames', label: 'veo3-pro-frames' },
  { value: 'veo3.1', label: 'veo3.1 默认' },
  { value: 'veo3.1-fast', label: 'veo3.1-fast' },
  { value: 'veo3.1-pro', label: 'veo3.1-pro' },
  { value: 'veo3.1-components', label: 'veo3.1-components' },
  { value: 'veo3.1-4k', label: 'veo3.1-4k' },
  { value: 'veo3.1-pro-4k', label: 'veo3.1-pro-4k' },
  { value: 'veo3.1-components-4k', label: 'veo3.1-components-4k' },
  { value: 'veo3.1-lite', label: 'veo3.1-lite' },
  // FAL 渠道
  { value: 'veo3.1-fal', label: 'veo3.1-fal (FAL)' },
];

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: 'veo3.1',
    label: 'Veo 3.1',
    kind: 'veo',
    provider: 'newapi',
    description: 'Google Veo 3.1 系列 (最多 3 张参考图)',
    apiModelOptions: VEO_MODELS,
    // 主项目 veo_ratio 只有 16:9 / 9:16(line 1352)
    ratios: ['16:9', '9:16'],
    defaultRatio: '16:9',
    supportImages: true,
    maxRefImages: 3,
  },
  {
    id: 'grok-video-3',
    label: 'Grok Video',
    kind: 'grok',
    provider: 'newapi',
    description: 'xAI Grok Video (最多 7 张参考图)',
    apiModelOptions: [{ value: 'grok-video-3', label: 'grok-video-3' }, { value: 'grok-video-fal', label: 'grok-video-fal (FAL)' }],
    // 主项目 gk_ratio(line 1410): 2:3 / 3:2 / 16:9 / 9:16 / 1:1
    ratios: ['2:3', '3:2', '16:9', '9:16', '1:1'],
    defaultRatio: '16:9',
    // gk_duration(line 1412): 6 / 10 / 15 / 30
    durations: [6, 10, 15, 30],
    defaultDuration: 15,
    // gk_resolution(line 1414): 480P / 720P
    resolutions: ['480P', '720P'],
    defaultResolution: '720P',
    supportImages: true,
    maxRefImages: 7,
  },
  // ── 火山引擎直连 Seedance 2.0（DoubaoVideo 渠道）──
  {
    id: 'doubao-seedance-2-0-pro',
    label: 'Seedance 2.0 Pro',
    kind: 'seedance',
    provider: 'newapi',
    description: '火山引擎 Seedance 2.0 Pro · DoubaoVideo 直连',
    apiModelOptions: [{ value: 'doubao-seedance-2-0-260128', label: 'doubao-seedance-2-0-260128' }],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: '16:9',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p', '1080p', '2k', '4k'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 9,
  },
  {
    id: 'doubao-seedance-2-0-fast',
    label: 'Seedance 2.0 Fast',
    kind: 'seedance',
    provider: 'newapi',
    description: '火山引擎 Seedance 2.0 Fast · DoubaoVideo 直连（仅 480p/720p）',
    apiModelOptions: [{ value: 'doubao-seedance-2-0-fast-260128', label: 'doubao-seedance-2-0-fast-260128' }],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
    defaultRatio: '16:9',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 9,
  },
  {
    id: 'doubao-seedance-2-0-mini',
    label: 'Seedance 2.0 Mini',
    kind: 'seedance',
    provider: 'newapi',
    description: '火山引擎 Seedance 2.0 Mini · DoubaoVideo 直连（仅 480p/720p，6/25 API 开放）',
    apiModelOptions: [{ value: 'doubao-seedance-2.0-mini', label: 'doubao-seedance-2.0-mini' }],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
    defaultRatio: '16:9',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 9,
  },
  // ── RunningHub 视频模型 (8788 网关) ──
  {
    id: 'rh-seedance2-text-video',
    label: 'RH Seedance 2.0 文生视频',
    kind: 'seedance',
    provider: 'runninghub',
    description: 'RunningHub Seedance 2.0 官方文生视频',
    apiModelOptions: [{ value: 'rh-seedance2-text-video', label: 'rh-seedance2-text-video' }],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: 'adaptive',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'],
    defaultResolution: '720p',
    supportImages: false,
    maxRefImages: 0,
  },
  {
    id: 'rh-seedance2-image-video',
    label: 'RH Seedance 2.0 图生视频',
    kind: 'seedance',
    provider: 'runninghub',
    description: 'RunningHub Seedance 2.0 官方图生视频',
    apiModelOptions: [{ value: 'rh-seedance2-image-video', label: 'rh-seedance2-image-video' }],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: 'adaptive',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 1,
  },
  {
    id: 'rh-seedance2-multimodal-video',
    label: 'RH Seedance 2.0 全能参考',
    kind: 'seedance',
    provider: 'runninghub',
    description: 'RunningHub Seedance 2.0 官方多模态参考视频',
    apiModelOptions: [{ value: 'rh-seedance2-multimodal-video', label: 'rh-seedance2-multimodal-video' }],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: 'adaptive',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 9,
  },
  {
    id: 'rh-video-v31-fast',
    label: 'RH 全能视频V3.1',
    kind: 'grok',
    provider: 'runninghub',
    description: 'RunningHub 全能视频V3.1-Fast',
    apiModelOptions: [{ value: 'rh-video-v31-fast', label: 'rh-video-v31-fast' }],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultRatio: '16:9',
    durations: [8],
    defaultDuration: 8,
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 3,
  },
  {
    id: 'rh-grok-text-video',
    label: 'RH Grok 文生视频',
    kind: 'grok',
    provider: 'runninghub',
    description: 'RunningHub Grok Video 文生视频',
    apiModelOptions: [{ value: 'rh-grok-text-video', label: 'rh-grok-text-video' }],
    ratios: ['2:3', '3:2', '1:1', '16:9', '9:16'],
    defaultRatio: '16:9',
    durations: [6, 8, 10, 15, 30],
    defaultDuration: 8,
    resolutions: ['720p', '480p'],
    defaultResolution: '480p',
    supportImages: false,
    maxRefImages: 0,
  },
  {
    id: 'rh-grok-image-video',
    label: 'RH Grok 图生视频',
    kind: 'grok',
    provider: 'runninghub',
    description: 'RunningHub Grok Video 图生视频',
    apiModelOptions: [{ value: 'rh-grok-image-video', label: 'rh-grok-image-video' }],
    ratios: ['2:3', '3:2', '1:1', '16:9', '9:16'],
    defaultRatio: '2:3',
    durations: [6, 8, 10, 15, 30],
    defaultDuration: 8,
    resolutions: ['720p', '480p'],
    defaultResolution: '480p',
    supportImages: true,
    maxRefImages: 7,
  },
];

// ========== 音频(Suno) ==========
export interface AudioModelDef {
  id: string;
  label: string;
  provider: ProviderType;
  mode: 'generate' | 'cover' | 'extend';
  description?: string;
}

export const AUDIO_MODELS: AudioModelDef[] = [
  { id: 'suno-v5.5-generate', label: 'Suno V5.5 生成', provider: 'newapi', mode: 'generate' },
  { id: 'suno-v5.5-cover', label: 'Suno V5.5 翻唱', provider: 'newapi', mode: 'cover' },
  { id: 'suno-v5.5-extend', label: 'Suno V5.5 续写', provider: 'newapi', mode: 'extend' },
];

// Suno 版本下拉选项（完全对齐主项目 gpt-image-2-web 的 SUNO_MV_MAP）。
// value 将被原样发送给后端。
export const SUNO_VERSIONS: Array<{ value: string; label: string }> = [
  { value: 'v3.0', label: 'v3.0' },
  { value: 'v3.5', label: 'v3.5' },
  { value: 'v4', label: 'v4' },
  { value: 'v4.5', label: 'v4.5' },
  { value: 'v4.5+', label: 'v4.5+' },
  { value: 'v5', label: 'v5' },
  { value: 'v5.5', label: 'v5.5' },
];
export const DEFAULT_SUNO_VERSION = 'v5.5';

// ========== LLM/Vision ==========
// 完全对齐 gpt-image-2-web Chat Tab(index.html L1600 chat_model select)
// 默认: gemini-3.1-flash-lite-preview
// 特殊模型: gpt-image-2-all — 图文双向(非流式,可返回 image_url)
export interface LlmModelDef {
  id: string;
  label: string;
  provider: ProviderType;
  /** 是否支持多模态(图片输入) */
  vision?: boolean;
  /** 是否支持图像输出(gpt-image-2-all) */
  imageOutput?: boolean;
  /** 是否仅支持非流式(出图模型走非流式) */
  nonStreaming?: boolean;
  contextLength?: number;
  description?: string;
}

export const LLM_MODELS: LlmModelDef[] = [
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', provider: 'llm-direct', vision: true, contextLength: 1_000_000 },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'llm-direct', vision: true, contextLength: 128_000 },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'llm-direct', vision: true, contextLength: 2_000_000 },
  { id: 'gpt-5', label: 'GPT-5', provider: 'llm-direct', vision: true, contextLength: 200_000 },
  { id: 'gpt-image-2-all', label: 'GPT Image 2 All (图文)', provider: 'llm-direct', vision: true, imageOutput: true, nonStreaming: true, description: '可自动调用图像生成' },
];

export const DEFAULT_LLM_MODEL = 'gemini-3.1-flash-lite-preview';

/** 是否为出图模型(需走非流式 + 检测 generate_image 指令) */
export function isImageOutputLlm(modelId: string): boolean {
  return LLM_MODELS.find((m) => m.id === modelId)?.imageOutput === true;
}
