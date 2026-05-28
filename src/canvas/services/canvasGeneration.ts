/**
 * canvasGeneration.ts — 画布生成服务（jiucaihezi Gateway 直连）
 * 来源: T8-penguin-canvas/src/services/generation.ts
 * 改造: 所有 fetch → safeFetch + getApiKey() 鉴权
 */
import { getApiKey } from '@/services/newApiAuth'
import { safeFetch } from '@/utils/httpClient'

const GATEWAY = 'https://api.jiucaihezi.studio'

async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('请先登录韭菜盒子账号')
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> || {}),
    Authorization: `Bearer ${apiKey}`,
  }
  // FormData 不手动设 Content-Type
  if (init.body instanceof FormData) delete headers['Content-Type']
  return safeFetch(`${GATEWAY}${path}`, { ...init, headers })
}

/**
 * 生成服务 - 封装代理调用
 * 所有请求走 /api/proxy/* (后端会注入对应 Key 并转存结果)
 */

export interface GenerateImageRequest {
  model: string;          // 节点 id (gpt-image-2 / nano-banana-2 / nano-banana-pro)
  apiModel?: string;       // 上游真实模型名(优先使用)
  paramKind?: 'gpt-size' | 'banana-ratio' | 'mj';
  prompt: string;
  n?: number;
  // 主参数(双协议通用):
  aspect_ratio?: string;   // 1:1 / 16:9 / Auto …
  image_size?: string;     // 1K / 2K / 4K (banana) 或像素串(GPT 也可透传)
  // 多张参考图(base64 dataURL 或 http(s):// URL)
  images?: string[];
  quality?: string;
  // 兼容旧参数:若传了 size(像素串)则优先用、image 单张也会并入 images
  size?: string;
  image?: string;
}

export interface GenerateImageResult {
  urls: string[]; // 本地相对 URL,如 /files/output/xxx.png
  raw: any;
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
  const r = await gatewayFetch('/api/proxy/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data.data;
}

// ========================================================================
// 图像异步任务(对齐 gpt-image-2-web 的 submit + poll 模式)
// submitImageAsync 返 { sync, taskId?, urls?, status, progress }
//   - sync=true: 同步完成,urls 已存在
//   - sync=false: 需轮询 queryImageStatus(taskId)
// ========================================================================
export interface ImageSubmitResult {
  sync: boolean;
  taskId?: string;
  urls?: string[];
  status: string;       // pending / running / completed / failed
  progress: string;     // '0%' / '50%' / '100%'
  raw?: any;
}

export async function submitImageAsync(req: GenerateImageRequest): Promise<ImageSubmitResult> {
  const r = await gatewayFetch('/api/proxy/image/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface ImageQueryResult {
  status: string;       // pending / running / completed / failed
  progress: string;
  urls?: string[];
  error?: string;
}

// apiModel 透传给后端，让轮询阶段复用与 submit 一致的分类 API Key
// (否则 hint 为空时会 fallback 到通用 defaultApiKey，分类 key 失效)
export async function queryImageStatus(taskId: string, apiModel?: string): Promise<ImageQueryResult> {
  const qs = apiModel ? `?model=${encodeURIComponent(apiModel)}` : '';
  const r = await fetch(`/api/image/status/${encodeURIComponent(taskId)}${qs}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  // 失败状态下 success=false 但返回 body 中仍包含 status:'failed'
  return data.data || { status: data.success ? 'pending' : 'failed', progress: '0%', error: data?.error };
}

// ========================================================================
// FAL 渠道(独立提交 + 轮询,对齐 gpt-image-2-web runGPTFal / runNanoFal)
//   submitImageFal 返 { sync, urls? } 或 { sync:false, requestId, responseUrl, endpoint }
//   queryImageFal  返 { status: 'pending'|'completed'|'failed', urls?, error? }
// ========================================================================
export interface FalSubmitRequest {
  /** 'gpt-image-2-fal' | 'nano-banana-pro-fal' */
  apiModel: string;
  prompt: string;
  /** 参考图 URL(本地 /files/* 或 base64 dataURI),后端会上传到 /v1/files 取 URL */
  images?: string[];
  /** 生成张数 1-4 */
  n?: number;
  /** 输出格式 png / jpeg / webp */
  format?: 'png' | 'jpeg' | 'webp';
  /** 同步模式(true 会在提交请求中附加 sync_mode:true,贞贞上游如果接受会同步返 images) */
  sync?: boolean;

  // === gpt-fal 专属 ===
  /** 'edit' | 'gen';不填时有参考图走 edit,无参考图走 gen */
  mode?: 'edit' | 'gen';
  /** 'auto' / 'square_hd' / 'square' / 'portrait_4_3' / 'portrait_16_9' / 'landscape_4_3' / 'landscape_16_9' / 'custom' */
  size?: string;
  /** size === 'custom' 时有效,后端会 snap 到 16 倍数 */
  customW?: number;
  customH?: number;
  /** 'low' | 'medium' | 'high' | 'auto' 主项目默认 medium */
  quality?: 'low' | 'medium' | 'high' | 'auto';

  // === nbpro-fal 专属 ===
  /** 'auto' / '21:9' / '16:9' / '3:2' / '4:3' / '5:4' / '1:1' / '4:5' / '3:4' / '2:3' / '9:16' */
  aspect_ratio?: string;
  /** '1K' / '2K' / '4K' */
  resolution?: string;
  /** '1'(严)..'6'(松) 默认 '4' */
  safety_tolerance?: string;
  /** 0 = 不传 */
  seed?: number;
  system_prompt?: string;
  enable_web_search?: boolean;
  /** 'image_url'(上传贞贞取 URL) | 'base64' 默认 'image_url' */
  image_mode?: 'image_url' | 'base64';
}

export interface FalSubmitResult {
  sync: boolean;
  urls?: string[];
  requestId?: string;
  responseUrl?: string;
  endpoint?: string;
}

export async function submitImageFal(req: FalSubmitRequest): Promise<FalSubmitResult> {
  const r = await gatewayFetch('/api/proxy/image/fal/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface FalQueryResult {
  status: 'pending' | 'completed' | 'failed' | string;
  urls?: string[];
  error?: string;
  falStatus?: string;
}

export async function queryImageFal(params: { responseUrl?: string; endpoint?: string; requestId?: string }): Promise<FalQueryResult> {
  const r = await gatewayFetch('/api/proxy/image/fal/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await r.json();
  // 后端在 FAILED 时会 success=false 但 data.status='failed',这里返回结果供上层判断
  if (!r.ok && !data.data) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data || { status: 'failed', error: data?.error || 'unknown' };
}

// ========== Midjourney (严格对齐 gpt-image-2-web/index.html runMJ L4437~L4694 + uploadMJImage L4407) ==========
// 后端路由: /api/proxy/mj/imagine | /api/proxy/mj/task/:id | /api/proxy/mj/upload

export type MjSpeed = 'fast' | 'turbo' | 'relax';

export interface MjPromptParts {
  prompt: string;
  model?: string;       // 例如 'v 8.1' / 'niji 7'
  ar?: string;          // 例如 '1:1' / '16:9'
  no?: string;
  c?: number;
  s?: number;
  iw?: number;
  sw?: number;
  cw?: number;
  sv?: string;          // '1' | '2' | '3' | '4'
  srefUrls?: string[];  // --sref 风格参考图 URL
  orefUrls?: string[];  // --oref 角色参考图 URL
}

/** 拼装 MJ prompt — 与 index.html L4467~L4485 严格一致 */
export function buildMjPrompt(p: MjPromptParts): string {
  let full = p.prompt || '';
  if (p.model) full += ` --${p.model}`;
  if (p.ar) full += ` --ar ${p.ar}`;
  if (p.no) full += ` --no ${p.no}`;
  if (p.c) full += ` --c ${p.c}`;
  if (p.s) full += ` --s ${p.s}`;
  if (p.iw) full += ` --iw ${p.iw}`;
  if (p.sw) full += ` --sw ${p.sw}`;
  if (p.cw) full += ` --cw ${p.cw}`;
  if (p.sv && p.sv !== '0' && p.sv !== '1') full += ` --sv ${p.sv}`;
  for (const u of p.srefUrls || []) if (u) full += ` --sref ${u}`;
  for (const u of p.orefUrls || []) if (u) full += ` --oref ${u}`;
  return full;
}

export interface MjImagineRequest {
  prompt: string;          // 已经拼装好的完整 prompt
  speed?: MjSpeed;
  base64Array?: string[];  // 通常空数组(参考图走 sref/oref URL)
  ar?: string;
  no?: string;
  c?: number;
  s?: number;
  iw?: number;
  sw?: number;
  cw?: number;
  sv?: string;
  seed?: number;
  remix?: boolean;
}

export interface MjImagineResult {
  taskId: string;
  raw: any;
}

export async function submitMjImagine(req: MjImagineRequest): Promise<MjImagineResult> {
  const r = await gatewayFetch('/api/proxy/mj/imagine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  const upstream = data.data || {};
  // upstream.code === 1 表示提交成功(主项目 L4658)
  if (upstream.code !== undefined && upstream.code !== 1) {
    throw new Error(upstream.description || upstream.error || 'MJ imagine 提交失败');
  }
  const taskId = String(upstream.result || upstream.task_id || '');
  if (!taskId) throw new Error('未拿到 MJ taskId: ' + JSON.stringify(upstream).slice(0, 200));
  return { taskId, raw: upstream };
}

export interface MjTaskResult {
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE' | string;
  progress?: string;
  imageUrl?: string;
  imageUrls?: string[];   // 4 张子图
  failReason?: string;
  raw: any;
}

export async function queryMjTask(taskId: string, speed: MjSpeed = 'fast'): Promise<MjTaskResult> {
  const r = await fetch(`/api/mj/task/${encodeURIComponent(taskId)}?speed=${encodeURIComponent(speed)}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  const d = data.data || {};
  // 主项目 L4675~L4694: image_urls 可能是 JSON 字符串 / 对象数组 / 字符串数组
  // 元素可能为字符串 '...' 或对象 { url: '...' }，对齐主项目用 x.url || x 兼容
  // 另外上游字段名可能为 snake_case (image_url/image_urls) 或 camelCase (imageUrl/imageUrls)
  let imageUrls: string[] | undefined;
  const rawList = d.image_urls ?? d.imageUrls;
  if (rawList) {
    let parsed: any = rawList;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    if (Array.isArray(parsed)) {
      imageUrls = parsed
        .map((x: any) => (typeof x === 'string' ? x : (x && (x.url || x.image_url || x.imageUrl)) || ''))
        .filter((u: any): u is string => typeof u === 'string' && !!u);
    }
  }
  return {
    status: d.status || 'IN_PROGRESS',
    progress: d.progress,
    imageUrl: d.image_url || d.imageUrl,
    imageUrls,
    failReason: d.fail_reason || d.failReason,
    raw: d,
  };
}

/** 上传参考图(sref/oref)并取 URL — 对应主项目 uploadMJImage L4407 */
export async function uploadMjImage(file: File, speed: MjSpeed = 'fast'): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const r = await gatewayFetch('/api/proxy/mj/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data: dataUrl, speed }),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  const url = data.data?.url || '';
  if (!url) throw new Error('MJ upload 未返回 URL');
  return url;
}

// LLM
// content 支持多模态:字符串 或 [{type:'text',text} | {type:'image_url',image_url:{url}}]
// (对齐 gpt-image-2-web _doSendChat 多模态格式, index.html L8106~L8123)
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export interface GenerateLlmRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  max_tokens?: number;
  /** 流式开关;默认 false(非流式) */
  stream?: boolean;
}

export interface GenerateLlmResult {
  content: string;
  /** 仅 gpt-image-2-all 等出图模型返回 */
  imageUrls?: string[];
  raw: any;
  model: string;
}

export async function generateLlm(req: GenerateLlmRequest): Promise<GenerateLlmResult> {
  const r = await gatewayFetch('/api/proxy/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, stream: false }),
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data.data;
}

/**
 * 流式 LLM 调用,后端透传上游 SSE。
 * @param req 请求(自动注入 stream:true)
 * @param opts.onDelta 每个增量片段回调(实时拼接)
 * @param opts.signal AbortSignal 支持中断
 * @returns 最终拼接后的完整 content
 * 对齐 gpt-image-2-web index.html L8262~L8295 流式解析逻辑。
 */
export async function generateLlmStream(
  req: GenerateLlmRequest,
  opts: { onDelta?: (chunk: string) => void; signal?: AbortSignal } = {}
): Promise<{ content: string }> {
  const r = await gatewayFetch('/api/proxy/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, stream: true }),
    signal: opts.signal,
  });
  if (!r.ok) {
    // 后端在 stream 错路仍返 JSON
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j?.error || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  if (!r.body) throw new Error('上游未返回可读流');
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let assembled = '';
  let buffer = '';
  // SSE 按行解析
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return { content: assembled };
      try {
        const j = JSON.parse(data);
        const delta = j?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length) {
          assembled += delta;
          opts.onDelta?.(delta);
        }
      } catch {
        /* 心跳或不完整 JSON 忽略 */
      }
    }
  }
  return { content: assembled };
}

/** File → dataURL(对齐主项目 FileReader.readAsDataURL) */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target?.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

// 文件上传
export async function uploadFile(file: File): Promise<{ url: string; filename: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await gatewayFetch('/api/files/upload', { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data.data;
}

// ========================================================================
// Video FAL 渠道(独立提交 + 轮询,对齐 gpt-image-2-web runVeo3Fal / runGrokFal)
//   submitVideoFal 返 { sync, videoUrl? } 或 { sync:false, requestId, responseUrl, endpoint }
//   queryVideoFal  返 { status: 'pending'|'completed'|'failed', videoUrl?, error? }
// ========================================================================
export interface VideoFalSubmitRequest {
  /** 'veo3.1-fal' | 'grok-video-fal' */
  apiModel: string;
  prompt: string;
  /** 参考图(base64 dataURI 或本地 /files/* URL) */
  images?: string[];
  /** veo-fal: '16:9' | '9:16' */
  aspect_ratio?: string;
  /** veo-fal: '8s' */
  duration?: string;
  /** veo-fal: '720p' | '1080p' | '4k';  grok-fal: '720p' | '480p' */
  resolution?: string;
  /** veo-fal: 生成音频 */
  generate_audio?: boolean;
  /** veo-fal: 1-6 (默认 4) */
  safety_tolerance?: number;
  /** 参考图上传方式: 'image_url'(上传取URL) | 'base64' */
  image_mode?: 'image_url' | 'base64';
  /** grok-fal: 时长秒数 1-30 */
  gkDuration?: number;
  /** grok-fal: 比例 */
  gkRatio?: string;
}

export interface VideoFalSubmitResult {
  sync: boolean;
  videoUrl?: string;
  requestId?: string;
  responseUrl?: string;
  endpoint?: string;
}

export async function submitVideoFal(req: VideoFalSubmitRequest): Promise<VideoFalSubmitResult> {
  const r = await gatewayFetch('/api/proxy/video/fal/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface VideoFalQueryResult {
  status: 'pending' | 'completed' | 'failed' | string;
  videoUrl?: string;
  error?: string;
  falStatus?: string;
}

export async function queryVideoFal(params: { responseUrl?: string; endpoint?: string; requestId?: string }): Promise<VideoFalQueryResult> {
  const r = await gatewayFetch('/api/proxy/video/fal/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await r.json();
  if (!r.ok && !data.data) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data || { status: 'failed', error: data?.error || 'unknown' };
}

// ========================================================================
// 视频生成(异步) — 完全对齐 gpt-image-2-web
//   - veo3.1   字段:  aspect_ratio + enhance_prompt + enable_upsample + seed + images(base64,≤3)
//   - grok     字段:  ratio + duration(秒,数字) + resolution + seed + images(本地 URL/base64,≤7,后端转上游 URL)
//   - seedance 字段:  沿用 veo 字段(零破坏)
// 后端通过 model 字段名自动选择协议,前端无需显式传 kind。
// ========================================================================
export interface VideoSubmitRequest {
  model: string;
  prompt: string;
  // Veo3.1
  aspect_ratio?: string;
  enhance_prompt?: boolean;
  enable_upsample?: boolean;
  // Grok Video
  ratio?: string;
  duration?: number;
  resolution?: string;
  // 通用
  seed?: number;
  /**
   * 参考图。
   *  - veo3.1:   base64 dataURL,最多 3 张
   *  - grok:     可传 base64 dataURL 或 /files/* 本地 URL,最多 7 张(后端会上传到上游 /v1/files 取 URL)
   *  - seedance: base64 dataURL,最多 3 张(同 veo)
   */
  images?: string[];
}

export async function submitVideo(req: VideoSubmitRequest): Promise<{ taskId: string }> {
  const r = await gatewayFetch('/api/proxy/video/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface VideoQueryResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'RUNNING' | string;
  progress?: string;
  videoUrl?: string | null;
  failReason?: string | null;
}

// model 透传给后端，让轮询阶段复用与 submit 一致的分类 API Key
export async function queryVideo(taskId: string, model?: string): Promise<VideoQueryResult> {
  const extra = model ? `&model=${encodeURIComponent(model)}` : '';
  const r = await fetch(`/api/video/query?taskId=${encodeURIComponent(taskId)}${extra}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

// ========================================================================
// Seedance 2.0 (异步) — 完全对齐 gpt-image-2-web runSeedance / pollSeedance
//   submit: POST /api/proxy/seedance/submit
//   query : GET  /api/proxy/seedance/query?taskId=
// ========================================================================
export interface SeedanceSubmitRequest {
  /** 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-0-fast-260128' */
  model: string;
  prompt: string;
  /** 时长(秒) 4..15 */
  duration?: number;
  /** 比例 16:9|9:16|1:1|4:3|3:4|21:9|9:21|adaptive */
  ratio?: string;
  /** 分辨率 480p|720p|native1080p|1080p|2k|4k */
  resolution?: string;
  /** 生成音频（默认 true） */
  generate_audio?: boolean;
  /** 返回末帧 */
  return_last_frame?: boolean;
  /** 水印 */
  watermark?: boolean;
  /** 启用 web_search 工具 */
  web_search?: boolean;
  /** 随机种子 -1=不传 */
  seed?: number;
  /** 首帧参考(base64 dataURL 或 /files/* URL)，后端会上传取 URL */
  firstFrame?: string;
  /** 末帧参考(需与 firstFrame 同时传) */
  lastFrame?: string;
  /** 参考图多张(reference_image) */
  refImages?: string[];
  /** 参考视频 URL 多个 */
  videos?: string[];
  /** 参考音频 URL 多个 */
  audios?: string[];
}

export async function submitSeedance(req: SeedanceSubmitRequest): Promise<{ taskId: string }> {
  const r = await gatewayFetch('/api/proxy/seedance/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface SeedanceQueryResult {
  /** 'pending' | 'running' | 'succeeded' | 'failed' (已后端归一) */
  status: string;
  progress?: string;
  videoUrl?: string | null;
  failReason?: string | null;
}

export async function querySeedance(taskId: string): Promise<SeedanceQueryResult> {
  const r = await fetch(`/api/seedance/query?taskId=${encodeURIComponent(taskId)}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

// ========================================================================
// 音频 Suno(异步)
// 完全对齐主项目 gpt-image-2-web 的 runSuno / runSunoCover / runSunoExtend
// ========================================================================
export type AudioMode = 'generate' | 'cover' | 'extend';
export interface AudioSubmitRequest {
  mode: AudioMode;
  prompt?: string;
  title?: string;
  tags?: string;
  version?: string;
  seed?: number;
  continue_clip_id?: string;
  continue_at?: number;
  cover_clip_id?: string;
  /** canvas cover/extend: 参考音频 data URL */
  refAudioUrl?: string;
  startTime?: string;
  endTime?: string;
  refText?: string;
}

export async function submitAudio(
  req: AudioSubmitRequest,
): Promise<{ taskId: string; clipIds: string[] }> {
  const r = await gatewayFetch('/api/proxy/audio/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface AudioTrack {
  id: string;
  clipId?: string;
  audioUrl: string;
  /** 上游原始 URL（后端 saveLocal=true 时同时返回） */
  remoteUrl?: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  duration?: number;
}
export interface AudioQueryResult {
  status: 'PENDING' | 'SUCCESS' | string;
  tracks: AudioTrack[];
  total: number;
  completed: number;
}

/**
 * 轮询 Suno feed。
 * @param clipIds 任务中的 clip id 列表
 * @param saveLocal 是否让后端将完成的音频转存到本地 output（默认 true）
 */
export async function queryAudio(clipIds: string[], saveLocal: boolean = true): Promise<AudioQueryResult> {
  const ids = clipIds.join(',');
  const params = new URLSearchParams({ clipIds: ids, saveLocal: String(saveLocal) });
  const r = await fetch(`/api/audio/query?${params.toString()}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

/**
 * 将本地音频上传给 Suno 并获取 clipId（用于 cover/extend 模式）。
 * 后端代理 _sunoUploadAudio 的 5 步流程。
 */
export async function uploadAudioForSuno(
  file: File,
): Promise<{ clipId: string; uploadId: string; filename: string; size: number; mime: string }> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const r = await gatewayFetch('/api/proxy/audio/upload', { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

// ========================================================================
// RunningHub 工作流(异步)
// v1.2.9.16: 取消 rhWalletApiKey / useWallet 分路 ——
// RH 钱包应用节点与普通 RunningHub 节点统一使用 settings.rhApiKey。
// ========================================================================
export interface RhSubmitRequest {
  webappId: string;
  nodeInfoList?: Array<{ nodeId: string; fieldName: string; fieldValue: any }>;
  instanceType?: string;
}

export async function submitRh(req: RhSubmitRequest): Promise<{ taskId: string }> {
  const r = await gatewayFetch('/api/proxy/runninghub/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export interface RhQueryResult {
  status: 'PENDING' | 'SUCCESS' | 'RUNNING' | 'QUEUED' | 'FAILED' | string;
  urls: string[];
  failReason?: string | null;
  code?: number;
}

export async function queryRh(taskId: string): Promise<RhQueryResult> {
  const url = `/api/runninghub/query?taskId=${encodeURIComponent(taskId)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

export async function fetchRhAppInfo(webappId: string): Promise<any> {
  const url = `/api/runninghub/app-info?webappId=${encodeURIComponent(webappId)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

/**
 * 上传任意本地/远程素材到 RunningHub，拿到内部 fileName。
 * 用于 RhConfigNode / RunningHubNode 中 valueType=image|video|audio 的条目提交前的资源转换。
 */
export async function uploadRhAsset(url: string): Promise<{ fileName: string; fileType: string }> {
  const r = await gatewayFetch('/api/proxy/runninghub/upload-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error(data?.error || `HTTP ${r.status}`);
  return data.data;
}

// ============================================================================
// (原崩溃前遗留的 MJ 代码块已移除; MJ 实现参见上方 buildMjPrompt / submitMjImagine / queryMjTask / uploadMjImage 及 fileToDataUrl)
// ============================================================================

