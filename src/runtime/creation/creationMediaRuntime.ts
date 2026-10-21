import { assertNoLegacyCreationOssReference } from '@/utils/creationR2Upload'
import {
  CREATION_VIDEO_POLL_INTERVAL_MS,
  CREATION_VIDEO_POLL_MAX_SEC,
  apiCall,
  apiCallBinary,
  apiCallMultipart,
  extractMediaText,
  extractMediaUrl,
  extractTaskId,
  generateVideo,
  pollTask,
  uploadCreationAsset,
  type AudioGenParams,
  type ImageGenParams,
  type MediaResult,
  type VideoGenParams,
} from '@/api/media-generation'
import type { CreationMediaInputTransport, CreationRunPlan } from './creationMediaTypes'
import { getComfyWorkflowApiKey } from '@/utils/comfyWorkflowCredential'
import { runComfyWorkflow } from '@/services/comfyMcp'
import zImageWorkflow from './workflows/z-image-turbo.json'
import grokWorkflow from './workflows/grok-video.json'
import { canonicalCreationRatio, usesNewApiContentEndpoint } from './creationMediaPlan'
import { detectImageMimeFromBytes } from '@/utils/imageContracts'

export interface CreationSubmitRequest {
  runtime: 'newapi-direct' | 'runninghub-adapter' | 'local-comfy'
  taskType: 'image' | 'video' | 'audio'
  endpoint: string
  pollKind: CreationRunPlan['pollKind']
  usesRhAdapter: boolean
  plan: CreationRunPlan
  imageParams?: Partial<ImageGenParams>
  videoParams?: Partial<VideoGenParams>
  audioParams?: Partial<AudioGenParams>
  signal?: AbortSignal
}

function creationAbortError(): Error {
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

function throwIfCreationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw creationAbortError()
}

function waitForCreationPoll(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfCreationAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(creationAbortError())
    }
    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function buildCreationSubmitRequest(plan: CreationRunPlan): CreationSubmitRequest {
  if (plan.task === 'ai-app') throw new Error('AI 应用缺少服务器注册的输出类型')
  const runtime = plan.route === 'local-comfy' ? 'local-comfy' : plan.usesRhAdapter ? 'runninghub-adapter' : 'newapi-direct'
  const params = plan.debug.normalizedParams
  const request: CreationSubmitRequest = {
    runtime,
    taskType: plan.task === 'image' ? 'image'
      : plan.task === 'video' || plan.task === 'model3d' ? 'video'
      : 'audio',
    endpoint: plan.endpoint,
    pollKind: plan.pollKind,
    usesRhAdapter: plan.usesRhAdapter,
    plan,
  }

  if (plan.task === 'image') {
    request.imageParams = {
      model: plan.model,
      prompt: asString(params.prompt),
      webappId: asOptionalString(params.webappId),
      size: asOptionalString(params.size),
      aspectRatio: firstString(params, ['aspect_ratio', 'aspectRatio', 'ratio']),
      ratio: asOptionalString(params.ratio),
      resolution: asOptionalString(params.resolution),
      imageSize: asOptionalString(params.imageSize),
      image: imageValueForRequest(params),
      lora: asOptionalString(params.lora),
      lora_strength: asOptionalNumber(params.lora_strength),
      outputFormat: asOptionalString(params.outputFormat),
      quality: asOptionalString(params.quality),
      responseFormat: (asOptionalString(params.response_format) || 'url') as ImageGenParams['responseFormat'],
    }
    return request
  }

  if (plan.task === 'video' || plan.task === 'model3d') {
    const images = asStringArray(firstMediaValue(params, ['images', 'image', 'imageUrls', 'imageUrl']))
    const videos = asStringArray(firstMediaValue(params, ['videos', 'video', 'videoUrls', 'videoUrl']))
    const audios = asStringArray(firstMediaValue(params, ['audios', 'audio', 'audioUrls', 'audioUrl']))
    request.videoParams = {
      model: plan.model,
      prompt: asString(params.prompt),
      webappId: asOptionalString(params.webappId),
      aspectRatio: firstString(params, ['aspect_ratio', 'aspectRatio', 'ratio']),
      resolution: asOptionalString(params.resolution),
      size: asOptionalString(params.size),
      duration: asOptionalNumber(params.duration),
      seconds: asOptionalNumber(params.seconds),
      imageUrl: images[0],
      imageUrls: images.length > 1 ? images : undefined,
      videoUrl: videos[0],
      videoUrls: videos.length ? videos : undefined,
      audioUrl: audios[0],
      audioUrls: audios.length ? audios : undefined,
      text: asOptionalString(params.text),
      width: asOptionalNumber(params.width),
      height: asOptionalNumber(params.height),
      value: asOptionalNumber(params.value),
    }
    return request
  }

  request.audioParams = {
    model: plan.model,
    prompt: asString(params.prompt),
    title: asOptionalString(params.title),
    tags: asOptionalString(params.tags),
    negativeTags: asOptionalString(params.negative_tags),
    makeInstrumental: asOptionalBoolean(params.make_instrumental),
    mv: asOptionalString(params.mv),
    audioUrl: firstString(params, ['audioUrl', 'audio', 'audios', 'audioUrls']),
    audioUrls: asStringArray(params.audios),
    startTime: asOptionalString(params.start_time),
    endTime: asOptionalString(params.end_time),
    refText: asOptionalString(params.ref_text),
    text: asOptionalString(params.text),
    language: asOptionalString(params.language),
    voicePrompt: asOptionalString(params.voice_prompt),
  }
  return request
}

export async function executeCreationSubmitRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<MediaResult> {
  if (signal) request = { ...request, signal }
  request = await materializeRequestMedia(request)
  if (request.runtime === 'local-comfy') return executeLocalComfyRequest(request, onProgress, onSubmitted)
  if (request.runtime === 'newapi-direct') {
    if (request.plan.apiStyle === 'openai-responses-text')
      return executeH3ContextIrRequest(request, onProgress, onSubmitted)
    if (request.taskType === 'image') return executeDirectImageRequest(request, onProgress, onSubmitted)
    if (request.taskType === 'video') return executeDirectVideoRequest(request, onProgress, onSubmitted)
    return executeDirectAudioRequest(request, onProgress, onSubmitted)
  }
  if (request.taskType === 'image') return executeRunningHubImageRequest(request, onProgress, onSubmitted)
  if (request.taskType === 'video') return executeRunningHubVideoRequest(request, onProgress, onSubmitted)
  return executeRunningHubAudioRequest(request, onProgress, onSubmitted)
}

async function executeH3ContextIrRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  const params = request.videoParams || {}
  const normalized = request.plan.debug.normalizedParams
  const prompt = asString(params.prompt).trim()
  const duration = Number(normalized.duration)
  const imageMode = asString(normalized.image_mode) || 'reference_image'
  const ratio = asString(normalized.ratio || normalized.aspect_ratio || normalized.aspectRatio) || '16:9'
  const images = [...new Set([...(params.imageUrls || []), ...(params.imageUrl ? [params.imageUrl] : [])])]
  const videos = [...new Set([...(params.videoUrls || []), ...(params.videoUrl ? [params.videoUrl] : [])])]
  const audios = [...new Set([...(params.audioUrls || []), ...(params.audioUrl ? [params.audioUrl] : [])])]
  const allowedRatios = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

  if (!prompt) throw new Error('请输入提示词')
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw new Error('目标时长必须为 4 到 15 秒的整数')
  if (!allowedRatios.includes(ratio)) throw new Error('画幅不受支持')
  if (images.length > 9 || videos.length > 3 || audios.length > 3) throw new Error('参考素材数量超过 MiniMax H3 Context IR 限制')
  if (!images.length && !videos.length && !audios.length && ratio === 'adaptive') throw new Error('纯文本增强必须选择具体画幅')

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (imageMode === 'reference_image') {
    images.forEach(url => content.push({ type: 'image_url', role: 'reference_image', image_url: { url } }))
  } else if (imageMode === 'first_frame' || imageMode === 'last_frame') {
    if (images.length !== 1) throw new Error('首帧或尾帧模式需要且只能选择一张图片')
    if (videos.length || audios.length) throw new Error('首帧/尾帧不能与参考视频或参考音频混用')
    content.push({ type: 'image_url', role: imageMode, image_url: { url: images[0] } })
  } else if (imageMode === 'first_last_frames') {
    if (images.length < 1 || images.length > 2) throw new Error('首尾帧模式需要一张或两张图片')
    if (videos.length || audios.length) throw new Error('首帧/尾帧不能与参考视频或参考音频混用')
    content.push({ type: 'image_url', role: 'first_frame', image_url: { url: images[0] } })
    if (images[1]) content.push({ type: 'image_url', role: 'last_frame', image_url: { url: images[1] } })
  } else {
    throw new Error('图片用途不受支持')
  }
  videos.forEach(url => content.push({ type: 'video_url', role: 'reference_video', video_url: { url } }))
  audios.forEach(url => content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url } }))

  const hasFrame = imageMode === 'first_frame' || imageMode === 'last_frame' || imageMode === 'first_last_frames'
  onProgress?.(0, '提交提示词增强...')
  const submitted = await apiCall('/v1/responses', {
    model: request.plan.model,
    background: true,
    content,
    duration,
    ratio: hasFrame ? 'adaptive' : ratio,
  }, 'POST', request.plan.model, request.signal)
  const responseId = String(submitted?.id || '')
  if (!/^resp_[A-Za-z0-9._:-]+$/.test(responseId)) throw new Error('MiniMax H3 Context IR 未返回有效的 response id')
  const pollUrl = `/v1/responses/${encodeURIComponent(responseId)}`
  const immediateText = extractMediaText(submitted)
  if (immediateText) return { url: '', text: immediateText, type: 'text', taskId: responseId, pollUrl, pollKind: 'text' }

  await onSubmitted?.({ taskId: responseId, pollUrl, pollKind: 'text' })
  const text = await pollTask(pollUrl, 'text', onProgress, 600, 5000, request.signal)
  if (!text.trim()) throw new Error('MiniMax H3 Context IR 已完成，但没有返回增强文本')
  return { url: '', text, type: 'text', taskId: responseId, pollUrl, pollKind: 'text' }
}

export async function materializeMediaInput(
  source: string,
  transport: CreationMediaInputTransport,
  upload: typeof uploadCreationAsset = uploadCreationAsset,
  signal?: AbortSignal,
): Promise<string> {
  assertNoLegacyCreationOssReference(source)
  if (!source || transport === 'multipart') return source
  if (transport === 'url') return upload(source, signal)
  if (source.startsWith('data:')) return source
  const response = await fetch(source, { signal })
  if (!response.ok) throw new Error(`读取本地素材失败 (${response.status})`)
  const blob = await response.blob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

async function materializeRequestMedia(request: CreationSubmitRequest): Promise<CreationSubmitRequest> {
  const transport = request.plan.mediaInputTransport
  const cache = new Map<string, Promise<string>>()
  const materialize = (value: string) => {
    const pending = cache.get(value) || materializeMediaInput(value, transport, uploadCreationAsset, request.signal)
    cache.set(value, pending)
    return pending
  }
  const convert = (value?: string) => value ? materialize(value) : Promise.resolve(undefined)
  const convertMany = (values?: string[]) => Promise.all((values || []).map(materialize))
  const plan = {
    ...request.plan,
    debug: {
      ...request.plan.debug,
      normalizedParams: { ...request.plan.debug.normalizedParams },
    },
  }
  for (const [key, value] of Object.entries(plan.debug.normalizedParams)) {
    if (!/(?:^|:)(?:image|images|video|videos|audio|audios)$/i.test(key)) continue
    if (request.plan.apiStyle === 'rh-aiapp' && value === 'None') continue
    if (typeof value === 'string') plan.debug.normalizedParams[key] = await materialize(value)
    else if (Array.isArray(value)) plan.debug.normalizedParams[key] = await convertMany(value.map(String))
  }
  return {
    ...request,
    plan,
    imageParams: request.imageParams ? {
      ...request.imageParams,
      image: Array.isArray(request.imageParams.image)
        ? await convertMany(request.imageParams.image)
        : await convert(request.imageParams.image),
    } : undefined,
    videoParams: request.videoParams ? {
      ...request.videoParams,
      imageUrl: await convert(request.videoParams.imageUrl),
      imageUrls: await convertMany(request.videoParams.imageUrls),
      videoUrl: await convert(request.videoParams.videoUrl),
      videoUrls: await convertMany(request.videoParams.videoUrls),
      audioUrl: await convert(request.videoParams.audioUrl),
      audioUrls: await convertMany(request.videoParams.audioUrls),
    } : undefined,
    audioParams: request.audioParams ? {
      ...request.audioParams,
      audioUrl: await convert(request.audioParams.audioUrl),
      audioUrls: await convertMany(request.audioParams.audioUrls),
    } : undefined,
  }
}

async function executeLocalComfyRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  const params = request.plan.debug.normalizedParams
  if (request.plan.apiStyle === 'comfy-grok-video') {
    const images = asStringArray(params.images)
    if (!images.length || images.length > GROK_REFERENCE_NODE_IDS.length) throw new Error('请选择 1 至 7 张参考图')
    const apiKey = await getComfyWorkflowApiKey()
    if (!apiKey) throw new Error('请先在设置 → MCP → ComfyUI 保存工作流上游模型 Key')
    try {
      return await runComfyWorkflow({ type: 'video', references: images, signal: request.signal, onProgress, onSubmitted,
        buildWorkflow: names => buildLocalGrokVideoPrompt({ prompt: asString(params.prompt), ratio: asOptionalString(params.ratio) || '16:9',
          duration: String(params.duration || 8), resolution: asOptionalString(params.resolution) || '720P', apiKey, images: names }),
      })
    } catch (error) {
      if (error instanceof Error) error.message = error.message.split(apiKey).join('[已隐藏凭据]')
      throw error
    }
  }
  if (request.taskType !== 'image') throw new Error('本地 Z-Image Turbo 当前只支持图片')
  const [width, height] = localComfyDimensions(asOptionalString(params.resolution) || '720p', asOptionalString(params.aspectRatio) || '16:9')
  return runComfyWorkflow({ type: 'image', signal: request.signal, onProgress, onSubmitted,
    buildWorkflow: () => buildLocalZImagePrompt(request.imageParams?.prompt || '', width, height),
  })
}

const GROK_REFERENCE_NODE_IDS = ['22', '10', '13', '9', '11', '12', '23']

export function buildLocalGrokVideoPrompt(input: { prompt: string; ratio: string; duration: string; resolution: string; apiKey: string; images: string[] }) {
  const workflow: Record<string, any> = structuredClone(grokWorkflow)
  Object.assign(workflow['7'].inputs, { ratio: input.ratio, duration: input.duration, resolution: input.resolution, api_key: input.apiKey, seed: Math.floor(Math.random() * 2147483647) })
  workflow['16'].inputs.prompt = input.prompt
  input.images.forEach((image, index) => {
    const nodeId = GROK_REFERENCE_NODE_IDS[index]
    workflow[nodeId] = { class_type: 'LoadImage', inputs: { image } }
    workflow['7'].inputs[`image${index + 1}`] = [nodeId, 0]
  })
  return workflow
}

function buildLocalZImagePrompt(prompt: string, width: number, height: number) {
  const workflow = structuredClone(zImageWorkflow)
  workflow['47'].inputs.text = prompt
  Object.assign(workflow['21'].inputs, { width, height })
  workflow['22'].inputs.seed = Math.floor(Math.random() * 2 ** 48)
  return workflow
}

function localComfyDimensions(resolution: string, ratio: string): [number, number] {
  const base = resolution === '1080p' ? 1080 : 720
  const values: Record<string, [number, number]> = {
    '16:9': [Math.round(base * 16 / 9), base],
    '9:16': [base, Math.round(base * 16 / 9)],
    '4:3': [Math.round(base * 4 / 3), base],
    '3:4': [base, Math.round(base * 4 / 3)],
    '1:1': [base, base],
  }
  const [width, height] = values[ratio] || values['16:9']
  return [Math.round(width / 8) * 8, Math.round(height / 8) * 8]
}

async function executeDirectImageRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  const params = request.imageParams || {}
  const prompt = asString(params.prompt)
  if (request.plan.apiStyle === 'newapi-image-task') {
    onProgress?.(0, '提交图片任务...')
    const images = asStringArray(params.image)
    const fields: Record<string, string | Blob | Blob[]> = {
      model: request.plan.model,
      prompt,
      seconds: '1',
      response_format: request.plan.apiStyle === 'newapi-image-task' || request.plan.model === 'xy-grok-imagine-image-2.0' ? 'url' : params.responseFormat || 'url',
    }
    if (params.size) fields.size = params.size
    if (images.length) fields.image = await Promise.all(images.map(image => imageReferenceToBlob(image, request.signal)))
    const data = await apiCallMultipart('/v1/videos', fields, request.signal)
    const directUrl = extractMediaUrl(data, 'image')
    if (directUrl) return { url: directUrl, type: 'image' }
    const taskId = extractTaskId(data)
    if (!taskId) throw new Error('图片任务未返回任务 ID')
    const pollUrl = `/v1/videos/${encodeURIComponent(taskId)}`
    await onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
    const url = await pollTask(pollUrl, 'image', onProgress, 600, 10000, request.signal)
    return { url, type: 'image', taskId, pollUrl, pollKind: 'image' }
  }
  if (request.plan.apiStyle === 'openai-image-edits') {
    const usesFkImageUrls = request.plan.modelId.startsWith('newapi/fk/ft-image-v1-')
    onProgress?.(0, usesFkImageUrls ? '提交图生图任务...' : '上传图片中...')
    const images = asStringArray(params.image)
    if (!images.length) throw new Error('没有可用参考图片')
    let data: any
    if (usesFkImageUrls) {
      // R2 signed URLs are readable by Fanke for a short period. Send references
      // as JSON imageUrls so file bytes bypass NewAPI/ECS and FK's multipart relay.
      data = await apiCall(request.endpoint, compact({
        model: request.plan.model,
        prompt,
        ratio: params.ratio || params.aspectRatio || '9:16',
        imageSize: (params.imageSize || params.resolution)
          ? asString(params.imageSize || params.resolution).toUpperCase()
          : undefined,
        size: params.size,
        quality: params.quality,
        imageUrls: images,
      }), 'POST', request.plan.model, request.signal)
    } else {
      const fields: Record<string, string | Blob | Blob[]> = {
        model: request.plan.model,
        prompt,
        response_format: params.responseFormat || 'url',
        image: await Promise.all(images.map(image => imageReferenceToBlob(image, request.signal))),
      }
      if (request.plan.model.startsWith('ft-image-v1-')) {
        fields.ratio = asString(params.ratio || params.aspectRatio || '9:16')
        if (params.imageSize || params.resolution) fields.imageSize = asString(params.imageSize || params.resolution).toUpperCase()
      }
      if (request.plan.modelId === 'newapi/yihong/gemini-nano-banana-2.1') {
        fields.ratio = asString(params.ratio || params.aspectRatio || '1:1')
        fields.imageSize = asString(params.imageSize || '1K')
      }
      if (params.size) fields.size = params.size
      if (params.quality) fields.quality = params.quality
      data = await apiCallMultipart(request.endpoint, fields, request.signal)
    }
    const mediaUrl = extractMediaUrl(data, 'image')
    if (mediaUrl) return { url: mediaUrl, type: 'image' }
    const taskId = extractTaskId(data)
    if (!taskId || request.pollKind === 'none') throw new Error('图片生成完成但未返回可用结果')
    const pollUrl = request.plan.pollPathTemplate?.replace('{task_id}', encodeURIComponent(taskId)) || `${request.endpoint}/${encodeURIComponent(taskId)}`
    await onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
    const url = await pollTask(pollUrl, 'image', onProgress, 600, 10000, request.signal)
    return { url, type: 'image', taskId, pollUrl, pollKind: 'image' }
  }

  onProgress?.(0, '提交中...')
  const body: Record<string, unknown> = compact({
    model: request.plan.model,
    prompt,
    size: params.size,
    quality: params.quality,
    aspect_ratio: params.aspectRatio,
    aspectRatio: params.aspectRatio,
    ratio: params.ratio || params.aspectRatio,
    resolution: params.resolution,
    ...(request.plan.model.startsWith('ft-image-v1-')
      ? {
          ratio: params.ratio || params.aspectRatio || '9:16',
          imageSize: params.imageSize || (params.resolution ? asString(params.resolution).toUpperCase() : undefined),
        }
      : {}),
    ...(request.plan.modelId === 'newapi/yihong/gemini-nano-banana-2.1' ? { imageSize: params.imageSize || '1K' } : {}),
    ...(request.plan.modelId.startsWith('newapi/lingdong/') ? { images: asStringArray(params.image) } : { image: params.image }),
    response_format: params.responseFormat || 'url',
  })
  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model, request.signal)
  const mediaUrl = extractMediaUrl(data, 'image')
  if (mediaUrl) return { url: mediaUrl, type: 'image' }
  const taskId = extractTaskId(data)
  if (!taskId || request.pollKind === 'none') throw new Error('图片生成完成但未返回可用结果')
  // MJ task: poll URL 是 /mj/task/{id}/fetch，不同于 submit endpoint
  const pollUrl = request.plan.apiStyle === 'mj-task'
    ? `/mj/task/${encodeURIComponent(taskId)}/fetch`
    : request.plan.pollPathTemplate?.replace('{task_id}', encodeURIComponent(taskId)) || `${request.endpoint}/${encodeURIComponent(taskId)}`
  await onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
  const url = await pollTask(pollUrl, 'image', onProgress, 600, 10000, request.signal)
  return { url, type: 'image', taskId, pollUrl, pollKind: 'image' }
}

async function imageReferenceToBlob(source: string, signal?: AbortSignal): Promise<Blob> {
  throwIfCreationAborted(signal)
  if (source.startsWith('data:')) return dataUrlToBlob(source)
  const response = await fetch(source, { signal })
  if (!response.ok) throw new Error('无法加载参考图片')
  const blob = await response.blob()
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  return new Blob([blob], {
    type: detectImageMimeFromBytes(head) || blob.type || 'application/octet-stream',
  })
}

async function executeDirectVideoRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  onProgress?.(0, '提交中...')
  const params = request.videoParams || {}
  if (request.plan.apiStyle === 'openai-videos') {
    return generateVideo({
      ...params,
      model: request.plan.model,
      prompt: asString(params.prompt),
      onSubmitted,
      signal: request.signal,
    }, onProgress)
  }
  const images = asStringArray(params.imageUrls?.length ? params.imageUrls : params.imageUrl)
  // Wan需要真实时长；Love音频同样先读元数据，校验失败时不提交生成。
  const model = request.plan.model
  let referenceDurations: { videos: number[]; audios: number[] } | undefined
  if (model === 'yh-wan3.0-video' || model === 'yh-seedance2.0 mini Love') {
    const videoSources = params.videoUrls?.length ? params.videoUrls : params.videoUrl ? [params.videoUrl] : []
    const audioSources = params.audioUrls?.length ? params.audioUrls : params.audioUrl ? [params.audioUrl] : []
    referenceDurations = {
      videos: await Promise.all(videoSources.map(url => readReferenceDuration(url, 'video', request.signal))),
      audios: await Promise.all(audioSources.map(url => readReferenceDuration(url, 'audio', request.signal))),
    }
    if (model === 'yh-wan3.0-video') {
      if (referenceDurations.videos.some(value => value < 1 || value > 15) || referenceDurations.videos.reduce((a, b) => a + b, 0) > 15) throw new Error('Wan参考视频每段1–15秒，合计不能超过15秒')
      if (referenceDurations.audios.reduce((a, b) => a + b, 0) > 15) throw new Error('Wan参考音频合计不能超过15秒')
    } else if (referenceDurations.audios.some(value => value < 2 || value > 15)) throw new Error('Love参考音频每段必须为2–15秒')
  }
  const shouldUploadAssets = request.plan.assetFlow !== 'none'
  const uploadedImages = shouldUploadAssets
    ? await Promise.all(images.map(image => uploadCreationAsset(image, request.signal)))
    : images
  const videos = params.videoUrls?.length ? params.videoUrls : (params.videoUrl ? [params.videoUrl] : [])
  const audios = params.audioUrls?.length ? params.audioUrls : (params.audioUrl ? [params.audioUrl] : [])
  const uploadedVideos = shouldUploadAssets
    ? await Promise.all(videos.map(video => uploadCreationAsset(video, request.signal)))
    : videos
  const uploadedAudios = shouldUploadAssets
    ? await Promise.all(audios.map(audio => uploadCreationAsset(audio, request.signal)))
    : audios

  const body = buildDirectVideoBody(request, uploadedImages, uploadedVideos, uploadedAudios, referenceDurations)
  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model, request.signal)
  let mediaUrl = extractMediaUrl(data, 'video')
  const taskId = extractTaskId(data)
  const pollUrl = taskId ? buildVideoPollUrl(request, taskId) : undefined
  if (!mediaUrl && taskId && pollUrl && request.pollKind !== 'none') {
    await onSubmitted?.({ taskId, pollUrl, pollKind: 'video' })
    // 本机 comfy-adapter 的成片同样经 NewAPI 的 /v1/videos/{id}/content 回收，
    // 这样客户端不必直连适配器，也不需要 public_base_url 对客户端可达。
    // 判据只有一处（`usesNewApiContentEndpoint`）：四处各写一份曾把这里修好的地址换回去。
    mediaUrl = await pollTask(
      pollUrl, 'video', onProgress,
      CREATION_VIDEO_POLL_MAX_SEC, CREATION_VIDEO_POLL_INTERVAL_MS,
      request.signal, usesNewApiContentEndpoint(request.plan),
    )
  }
  if (!mediaUrl) throw new Error('视频生成失败')
  return { url: mediaUrl, type: 'video', taskId, pollUrl, pollKind: 'video' }
}

async function executeDirectAudioRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  onProgress?.(0, '提交中...')
  const params = request.audioParams || {}
  if (request.plan.apiStyle === 'openai-audio-speech') {
    const references = (params.audioUrls || (params.audioUrl ? [params.audioUrl] : [])).map(reference =>
      reference.startsWith('data:')
        ? { audio_data: reference.replace(/^data:[^,]+,/, '') }
        : { audio_url: reference },
    )
    const url = await apiCallBinary(request.endpoint, {
      model: request.plan.model,
      input: params.prompt,
      response_format: 'mp3',
      ...(references.length ? { metadata: { references } } : {}),
    }, request.plan.model, request.signal)
    return { url, type: 'audio' }
  }
  const body = compact({
    model: request.plan.model,
    prompt: params.prompt,
    title: params.title,
    tags: params.tags,
    negative_tags: params.negativeTags,
    make_instrumental: params.makeInstrumental,
    mv: params.mv,
    text: params.text,
  })
  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model, request.signal)
  const syncText = request.plan.mode === 'lyrics' ? extractMediaText(data) : ''
  if (syncText) return { url: '', text: syncText, type: 'text' }
  const syncUrl = extractMediaUrl(data, 'audio')
  if (syncUrl) return { url: syncUrl, type: 'audio' }
  const taskId = extractTaskId(data)
  if (!taskId) throw new Error('音频任务未返回任务 ID')
  const pollUrl = request.endpoint.includes('/suno/')
    ? `/suno/fetch/${encodeURIComponent(taskId)}`
    : `${request.endpoint}/${encodeURIComponent(taskId)}`
  const pollKind = request.plan.mode === 'lyrics' ? 'text' : 'audio'
  await onSubmitted?.({ taskId, pollUrl, pollKind })
  const result = await pollTask(pollUrl, pollKind, onProgress, 600, 5000, request.signal)
  if (pollKind === 'text') return { url: '', text: result, type: 'text', taskId, pollUrl, pollKind }
  return { url: result, type: 'audio', taskId, pollUrl, pollKind }
}

async function executeRunningHubImageRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  onProgress?.(0, '提交 RunningHub...')
  const params = request.imageParams || {}
  const images = asStringArray(params.image)
  const aspectRatio = normalizeRhAspectRatio(params.aspectRatio)
  const resolution = asOptionalString(params.resolution) || '1k'
  const lora = asOptionalString(params.lora)
  const loraStrength = asOptionalNumber(params.lora_strength)
  const outputFormat = asOptionalString(params.outputFormat)

  // ★ NewAPI 只保留 model/prompt/images/extra_fields 四个顶层字段，
  //   其他所有参数（aspectRatio/resolution/lora/outputFormat 等）必须放进 extra_fields。
  //   🔴 排除所有已知字段，防止数组(image等)污染 extra_fields 导致 Pydantic 422
  const EXTRA_BLACKLIST = new Set([
    'model','prompt','images','image','imageUrl','imageUrls',
    'video','videos','videoUrl','videoUrls',
    'audio','audios','audioUrl','audioUrls',
    'aspectRatio','aspect_ratio','ratio','resolution',
    'lora','lora_strength','outputFormat',
    'extra_fields','n','response_format',
    'title','tags','negative_tags','make_instrumental','mv',
    'text','ref_text','voice_prompt','language',
    'start_time','end_time','width','height','value',
    'duration','size',
  ])
  const extraFields: Record<string, unknown> = {}
  // 核心 RH 参数
  if (aspectRatio) { extraFields.aspectRatio = aspectRatio; extraFields.aspect_ratio = aspectRatio; extraFields.ratio = aspectRatio }
  if (resolution) extraFields.resolution = resolution
  if (lora) extraFields.lora = lora
  if (loraStrength !== undefined) extraFields.lora_strength = loraStrength
  if (outputFormat) extraFields.outputFormat = outputFormat
  // 新模型独有字段（MJ/Grok/FLUX/LTX 等）— 只透传标量，拒绝数组/对象
  const normalized = request.plan.debug?.normalizedParams || {}
  for (const [k, v] of Object.entries(normalized)) {
    if (EXTRA_BLACKLIST.has(k)) continue
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) || typeof v === 'object') continue  // 🔴 拒绝数组/对象
    extraFields[k] = v
  }

  const body = compact({
    model: request.plan.model,
    prompt: asOptionalString(params.prompt),
    images: images.length ? images : undefined,
    extra_fields: Object.keys(extraFields).length ? extraFields : undefined,
  })
  if (request.plan.apiStyle === 'rh-aiapp') {
    const billingModel = asOptionalString(normalized.billingModel)
    if (billingModel) body.model = billingModel
    const nodeInfoList = buildRhAiAppNodeInfoList(request)
    if (!nodeInfoList.length) throw new Error(`RH AI App 暂未完成 ${request.plan.model} 的 nodeInfoList 映射`)
    body.nodeInfoList = nodeInfoList
    const webappId = asOptionalString(normalized.webappId)
    if (webappId) {
      body.webappId = webappId
      body.extra_fields = { webappId }
    }
  }
  // ★ 扩大的调试日志：覆盖所有 RH 图片模型，帮助排查 image-to-image 422 问题
  if (request.plan.usesRhAdapter && request.plan.task === 'image') {
    console.log('[DEBUG RH IMAGE] model:', request.plan.model, 'endpoint:', request.endpoint)
    console.log('[DEBUG RH IMAGE] body keys:', Object.keys(body).join(', '))
  }

  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model, request.signal)
  const mediaUrl = extractMediaUrl(data, 'image')
  if (mediaUrl) return { url: mediaUrl, type: 'image' }
  const taskId = extractTaskId(data)
  if (!taskId) throw new Error('RunningHub 图片任务未返回任务 ID')
  const pollUrl = buildRunningHubPollUrl(taskId, request.plan.apiStyle === 'rh-aiapp' || isAiAppResponse(data))
  await onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
  const url = await pollTask(pollUrl, 'image', onProgress, 600, 10000, request.signal)
  return { url, type: 'image', taskId, pollUrl, pollKind: 'image' }
}

async function executeRunningHubVideoRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  onProgress?.(0, '提交 RunningHub...')
  const params = request.videoParams || {}
  const images = asStringArray(params.imageUrls?.length ? params.imageUrls : params.imageUrl)
  const video = params.videoUrl
  const body: Record<string, unknown> = {
    model: request.plan.model,
    prompt: asOptionalString(params.prompt),
  }

  if (request.plan.apiStyle === 'rh-aiapp') {
    const normParams = request.plan.debug?.normalizedParams || {}
    const billingModel = asOptionalString(normParams['billingModel'])
    if (billingModel) body.model = billingModel
    body.prompt = asOptionalString(params.prompt) || 'AI App workflow'
    const nodeInfoList = buildRhAiAppNodeInfoList(request)
    if (!nodeInfoList.length) throw new Error(`RH AI App 暂未完成 ${request.plan.model} 的 nodeInfoList 映射`)
    body.nodeInfoList = nodeInfoList
    // 透传 webappId 到 rh-adapter
    const webappId = asOptionalString(normParams['webappId'])
    if (!webappId) throw new Error(`RH AI App 缺少 webappId，无法提交 ${request.plan.model}`)
    body.webappId = webappId
    // NewAPI drops unknown top-level fields; keep the full explicit overrides here too.
    body.extra_fields = { webappId, nodeInfoList }
    // TaskSubmitReq preserves metadata even when custom top-level fields are stripped.
    body.metadata = { rh_aiapp: { version: 1, webappId, nodeInfoList } }
    const durationNodes = nodeInfoList.filter(node => /^(duration|seconds)$/i.test(node.fieldName || ''))
    const duration = durationNodes.length === 1 ? asOptionalNumber(durationNodes[0]!.fieldValue)
      : durationNodes.length === 0 ? params.duration : undefined
    const ratioNodes = nodeInfoList.filter(node => /^(aspect_ratio|aspectRatio|ratio)$/i.test(node.fieldName || ''))
    const aspectRatio = normalizeRhAspectRatio((ratioNodes.length === 1 ? ratioNodes[0]!.fieldValue : params.aspectRatio)?.split(' (')[0])
    const nodeImages = nodeInfoList.filter(node => node.fieldName === 'image' && node.fieldValue !== 'None').map(node => node.fieldValue!)
    Object.assign(body, compact({
      duration: duration === undefined ? undefined : Number(duration),
      seconds: duration === undefined ? undefined : String(duration),
      aspectRatio,
      aspect_ratio: aspectRatio,
      ratio: aspectRatio,
      images: nodeImages.length ? nodeImages : undefined,
    }))
  } else {
    const aspectRatio = normalizeRhAspectRatio(params.aspectRatio)
    Object.assign(body, compact({
      aspectRatio,
      aspect_ratio: aspectRatio,
      ratio: aspectRatio,
      resolution: asOptionalString(params.resolution),
      duration: params.duration === undefined ? undefined : String(params.duration),
      seconds: params.seconds === undefined ? undefined : Math.max(1, Math.ceil(Number(params.seconds))),
      images: images.length ? images : undefined,
      video: asOptionalString(video),
      audio: asOptionalString(params.audioUrl),
      text: asOptionalString(params.text),
      width: asOptionalNumber(params.width),
      height: asOptionalNumber(params.height),
      value: asOptionalNumber(params.value),
    }))

    // ★ Phase 1b: 动态 extra_fields（与 image runtime 一致）
    const videoTopKeys = new Set(['model','prompt','aspectRatio','aspect_ratio','ratio','images','video','audio','text','width','height','value','resolution','duration','seconds','extra_fields'])
    const videoExtra: Record<string, unknown> = {}
    const vNorm = request.plan.debug?.normalizedParams || {}
    for (const [k, v] of Object.entries(vNorm)) {
      if (!videoTopKeys.has(k) && v !== undefined && v !== null && v !== '') {
        videoExtra[k] = v
      }
    }
    if (Object.keys(videoExtra).length) body.extra_fields = videoExtra
    if (params.seconds !== undefined) body.seconds = Math.max(1, Math.ceil(Number(params.seconds)))
  }

  const data = await apiCall(request.endpoint, compact(body), 'POST', request.plan.model, request.signal)
  let mediaUrl = extractMediaUrl(data, 'video')
  const taskId = extractTaskId(data)
  if (!mediaUrl && taskId) {
    const pollUrl = buildRunningHubPollUrl(taskId, request.plan.apiStyle === 'rh-aiapp' || isAiAppResponse(data))
    await onSubmitted?.({ taskId, pollUrl, pollKind: 'video' })
    mediaUrl = await pollTask(
      pollUrl, 'video', onProgress,
      CREATION_VIDEO_POLL_MAX_SEC, CREATION_VIDEO_POLL_INTERVAL_MS,
      request.signal,
    )
    return { url: mediaUrl, type: request.plan.task === 'model3d' ? 'model3d' : 'video', taskId, pollUrl, pollKind: 'video' }
  }
  if (!mediaUrl) throw new Error('RunningHub 视频生成失败')
  return { url: mediaUrl, type: request.plan.task === 'model3d' ? 'model3d' : 'video' }
}

async function executeRunningHubAudioRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  onProgress?.(0, '提交 RunningHub...')
  const params = request.audioParams || {}
  const body: Record<string, unknown> = { model: request.plan.model }

  if (request.plan.apiStyle === 'rh-aiapp') {
    const normParams = request.plan.debug?.normalizedParams || {}
    const billingModel = asOptionalString(normParams['billingModel'])
    if (billingModel) body.model = billingModel
    const nodeInfoList = buildRhAiAppNodeInfoList(request)
    if (!nodeInfoList.length) throw new Error(`RH AI App 暂未完成 ${request.plan.model} 的 nodeInfoList 映射`)
    body.nodeInfoList = nodeInfoList
    const webappId = asOptionalString(normParams['webappId'])
    if (webappId) {
      body.webappId = webappId
      body.extra_fields = { webappId }
    }
    // ★ 防止 NewAPI TTS adaptor 丢弃非标准字段 nodeInfoList：
    //    同时把 nodeInfoList base64 编码后塞进 voice 字段（rh-aiapp 模型不使用 voice）
    //    rh-adapter audio.py 会优先使用 nodeInfoList，fallback 时从 voice 恢复。
    const niJson = JSON.stringify(nodeInfoList)
    const niBytes = new TextEncoder().encode(niJson)
    let niBinary = ''
    for (let i = 0; i < niBytes.length; i++) niBinary += String.fromCharCode(niBytes[i])
    const voicePayload = '__rh_nodeinfo__' + btoa(niBinary)
    body.voice = voicePayload
    console.log(`[creationMediaRuntime] rh-aiapp body: model=${body.model} nodeInfoList_len=${nodeInfoList.length} voice_len=${voicePayload.length}`)
  } else if (request.plan.model === 'rh-suno-v55-single') {
    body.input = asString(params.prompt)
    body.extra_fields = {
      title: asOptionalString(params.title) || '未命名歌曲',
      description: asString(params.prompt),
      make_instrumental: String(asOptionalBoolean(params.makeInstrumental) ?? false),
    }
  } else if (request.plan.model === 'rh-suno-v55-custom') {
    body.input = asString(params.prompt)
    body.extra_fields = {
      title: asOptionalString(params.title) || '未命名歌曲',
      lyrics: asString(params.prompt),
      tags: asOptionalString(params.tags) || '',
      negative_tags: asOptionalString(params.negativeTags) || '',
      make_instrumental: String(asOptionalBoolean(params.makeInstrumental) ?? false),
    }
  } else if (request.plan.model === 'rh-suno-lyrics') {
    body.input = asString(params.prompt)
    body.prompt = asString(params.prompt)
  } else {
    Object.assign(body, compact({
      prompt: asOptionalString(params.prompt),
      title: asOptionalString(params.title),
      tags: asOptionalString(params.tags),
      negative_tags: asOptionalString(params.negativeTags),
      make_instrumental: asOptionalBoolean(params.makeInstrumental),
      audio: asOptionalString(params.audioUrl),
      text: asOptionalString(params.text),
      language: asOptionalString(params.language),
      voice_prompt: asOptionalString(params.voicePrompt),
    }))
  }

  const data = await apiCall(request.endpoint, compact(body), 'POST', request.plan.model, request.signal)
  const syncText = request.plan.mode === 'lyrics' ? extractMediaText(data) : ''
  if (syncText) return { url: '', text: syncText, type: 'text' }
  const syncUrl = extractMediaUrl(data, 'audio')
  if (syncUrl) return { url: syncUrl, type: 'audio' }
  const taskId = extractTaskId(data)
  if (!taskId) throw new Error('RunningHub 音频任务未返回任务 ID')
  const pollKind = request.plan.mode === 'lyrics' ? 'text' : 'audio'
  const pollUrl = buildRunningHubPollUrl(taskId, request.plan.apiStyle === 'rh-aiapp' || isAiAppResponse(data))
  await onSubmitted?.({ taskId, pollUrl, pollKind })
  const result = await pollTask(pollUrl, pollKind, onProgress, 600, 5000, request.signal)
  if (pollKind === 'text') return { url: '', text: result, type: 'text', taskId, pollUrl, pollKind }
  return { url: result, type: 'audio', taskId, pollUrl, pollKind }
}

function readReferenceDuration(url: string, kind: 'video' | 'audio', signal?: AbortSignal): Promise<number> {
  throwIfCreationAborted(signal)
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const duration = media.duration
      media.onloadedmetadata = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      if (error) reject(error)
      else if (!Number.isFinite(duration) || duration <= 0) reject(new Error('参考素材时长无效，请重新导入'))
      else resolve(duration)
    }
    const abort = () => finish(creationAbortError())
    const timer = setTimeout(() => finish(new Error('读取参考素材时长超时，请确认素材可读取')), 8000)
    signal?.addEventListener('abort', abort, { once: true })
    media.preload = 'metadata'
    media.onloadedmetadata = () => finish()
    media.onerror = () => finish(new Error('无法读取参考素材时长，请确认素材可读取'))
    media.src = url
  })
}

function buildDirectVideoBody(
  request: CreationSubmitRequest,
  uploadedImages: string[],
  uploadedVideos: string[],
  uploadedAudios: string[],
  referenceDurations?: { videos: number[]; audios: number[] },
): Record<string, unknown> {
  const params = request.videoParams || {}
  if (request.plan.model.startsWith('yh-')) {
    const normalized = request.plan.debug.normalizedParams
    const body: Record<string, unknown> = compact({ model: request.plan.model, prompt: params.prompt, seconds: params.duration, resolution: params.resolution, ratio: params.aspectRatio })
    if (request.plan.model === 'yh-wan3.0-video') {
      body.media = [
        ...uploadedImages.map(url => ({ type: 'reference_image', url })),
        ...uploadedVideos.map((url, index) => ({ type: 'reference_video', url, duration_seconds: referenceDurations?.videos[index] })),
        ...uploadedAudios.map((url, index) => ({ type: 'reference_audio', url, duration_seconds: referenceDurations?.audios[index] })),
      ]
      if (normalized.prompt_extend !== undefined) body.prompt_extend = normalized.prompt_extend
    } else {
      if (uploadedImages.length) body.image_urls = uploadedImages
      if (uploadedVideos.length) body.video_urls = uploadedVideos
      if (uploadedAudios.length) body.audio_urls = uploadedAudios
      if (request.plan.model === 'yh-seedance2.0 mini Love') {
        for (const key of ['generate_audio', 'watermark', 'camera_fixed', 'return_last_frame', 'seed']) if (normalized[key] !== undefined) body[key] = normalized[key]
      }
    }
    return body
  }
  if (request.plan.modelId.startsWith('newapi/yuanliu/')) {
    return compact({ model: request.plan.model, prompt: params.prompt, duration: params.duration, client_request_id: crypto.randomUUID(), images: uploadedImages.length ? uploadedImages : undefined, videos: uploadedVideos.length ? uploadedVideos : undefined, audios: uploadedAudios.length ? uploadedAudios : undefined })
  }
  if (request.plan.modelId.startsWith('newapi/lingdong/')) {
    return compact({ model: request.plan.model, prompt: params.prompt, duration: params.duration, ratio: params.aspectRatio, resolution: params.resolution, images: uploadedImages.length ? uploadedImages : undefined, videos: uploadedVideos.length ? uploadedVideos : undefined, audios: uploadedAudios.length ? uploadedAudios : undefined })
  }
  if (request.plan.apiStyle === 'seedance-task') {
    const normalized = request.plan.debug.normalizedParams
    const body: Record<string, unknown> = compact({
      model: request.plan.model,
      prompt: params.prompt,
      duration: asOptionalNumber(params.duration),
      ratio: params.aspectRatio,
      aspect_ratio: params.aspectRatio,
      resolution: asOptionalString(params.resolution)?.toLowerCase(),
      video_urls: uploadedVideos.length ? uploadedVideos : undefined,
      audio_urls: uploadedAudios.length ? uploadedAudios : undefined,
      conversion_slots: normalized.conversionSlots,
      return_last_frame: normalized.returnLastFrame,
      real_person_mode: normalized.realPersonMode,
      bitrate_mode: normalized.bitrateMode,
      generate_audio: normalized.generateAudio,
      seed: normalized.seed,
      output_format: normalized.outputFormat,
      omni_reference_task_type: normalized.omniReferenceTaskType,
      webhook_url: normalized.webhookUrl,
    })
    if (request.plan.endpoint === '/api/seedance/v1/videos') {
      uploadedImages.forEach((url, index) => {
        body[`image_file_${index + 1}`] = url
      })
    } else if (uploadedImages.length) {
      body.images = uploadedImages
    }
    return body
  }
  const isMiniMaxH3 = request.plan.model.startsWith('MiniMaxH3-')
  const isGrokImagineVideo = request.plan.model === 'grok-imagine-video-1.5'
  if (
    request.plan.apiStyle === 'comfy-video' ||
    request.plan.apiStyle === 'comfy-first-frame' ||
    request.plan.apiStyle === 'comfy-first-last'
  ) {
    // 本机 comfy-adapter 的 minimax-h3 模板：首帧 / 尾帧 / 参考图是三个互斥字段。
    // 面板只有 images 数组（画布选中顺序），所以在唯一一处把数组落到对应槽位。
    // duration 交的是秒数，适配器按模板的 duration_fps 自己换算成帧。
    // size 由适配器按模板 constraints（multiple_of=32）解析成 width/height；
    // ref2v 的模板没有 width/height 绑定，传了会被适配器忽略。
    // 模板自定义参数（戏种 mode）必须走 extra_fields：顶层的 mode 是 NewAPI 自己的
    // string 字段，发数字会被它的 JSON 绑定直接拒掉
    // （invalid_json: cannot unmarshal number into ... .mode of type string）。
    const normalized = request.plan.debug.normalizedParams
    const workflowMode = normalized.mode
    const requestedAspectRatio = asOptionalString(
      normalized.aspect_ratio ?? normalized.ratio ?? normalized.aspectRatio,
    )
    // ref2v 绑的是 ResolutionSelector 的 aspect_ratio；另外三个 H3 用显式 width/height，
    // 它们规格里必有 size，此时不要把 plan 兜底的 '16:9' 一起发出去。
    // 收敛成模型声明的枚举：旧版本存下来的计划会带着 '16:9' 这种界面标签绕过入口校验，
    // 直接发给 ResolutionSelector 就是 Value not in list（2026-10-02 实测）。
    const aspectRatioForBody = asOptionalString(params.size)
      ? undefined
      : canonicalCreationRatio(request.plan.modelId, requestedAspectRatio)
    // NewAPI 对本机 comfy 渠道只转发它 TaskSubmitReq 里认得的字段（model/prompt/images/
    // duration/size/mode/metadata…）。顶层自定义字段和 extra_fields 都会被整段丢掉 ——
    // 实测 aspect_ratio 与 mode 都到不了适配器，面板选了比例却出 16:9（模板默认）就是这么来的。
    // metadata 是它唯一保留的自定义槽位（RH 链路的 metadata.rh_aiapp 已实测可用），
    // 所以三处都发一份：顶层 / extra_fields / metadata，哪个活着哪个生效。
    const customParams = compact({ mode: workflowMode, aspect_ratio: aspectRatioForBody })
    const hasCustomParams = Object.keys(customParams).length > 0
    const body: Record<string, unknown> = compact({
      model: request.plan.model,
      prompt: params.prompt,
      duration: asOptionalNumber(params.duration),
      size: asOptionalString(params.size),
      aspect_ratio: aspectRatioForBody,
      extra_fields: hasCustomParams ? customParams : undefined,
      metadata: hasCustomParams ? customParams : undefined,
    })
    if (request.plan.apiStyle === 'comfy-first-frame') {
      body.first_frame = uploadedImages[0]
    } else if (request.plan.apiStyle === 'comfy-first-last') {
      body.first_frame = uploadedImages[0]
      body.last_frame = uploadedImages[1]
    } else if (uploadedImages.length) {
      body.images = uploadedImages
    }
    return body
  }
  if (request.plan.modelId === 'newapi/yihong/grok-imagine-video-1.5-preview') {
    return compact({
      model: request.plan.model,
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      image_url: uploadedImages.length === 1 ? uploadedImages[0] : undefined,
      reference_images: uploadedImages.length > 1 ? uploadedImages : undefined,
    })
  }
  return compact({
    model: request.plan.model,
    prompt: params.prompt,
    client_request_id: request.plan.modelId.startsWith('newapi/yuanliu/') ? crypto.randomUUID() : undefined,
    camera_movement: request.plan.modelId === 'newapi/yihong/seedance-2.5-max' ? request.plan.debug.normalizedParams.camera_movement : undefined,
    ratio: params.aspectRatio,
    aspect_ratio: params.aspectRatio,
    resolution: params.resolution,
    duration: isMiniMaxH3 || isGrokImagineVideo ? undefined : params.duration,
    seconds: (isMiniMaxH3 || isGrokImagineVideo) && params.duration !== undefined ? String(params.duration) : undefined,
    images: uploadedImages.length > 1 ? uploadedImages : undefined,
    image: uploadedImages.length === 1 ? uploadedImages[0] : undefined,
    imageUrl: uploadedImages[0],
    imageUrls: uploadedImages.length > 1 ? uploadedImages : undefined,
    video_url: uploadedVideos[0],
    video_urls: uploadedVideos.length > 1 ? uploadedVideos : undefined,
    audio_url: uploadedAudios[0],
    audio_urls: uploadedAudios.length > 1 ? uploadedAudios : undefined,
    text: params.text,
    width: params.width,
    height: params.height,
    value: params.value,
  })
}

function buildVideoPollUrl(request: CreationSubmitRequest, taskId: string): string {
  return `${request.endpoint}/${encodeURIComponent(taskId)}`
}

function buildRunningHubPollUrl(taskId: string, aiApp: boolean): string {
  // task_xxx 是 NewAPI 包装的 ID → 走 NewAPI 轮询
  // 纯数字是 RH 原始 ID → 直连 rh-adapter
  if (/^task_[A-Za-z0-9._:-]+$/.test(String(taskId || ''))) {
    return `/v1/videos/${encodeURIComponent(taskId)}`
  }
  return `/rh/tasks/${encodeURIComponent(taskId)}${aiApp ? '?ai_app=true' : ''}`
}

function isAiAppResponse(data: unknown): boolean {
  const value = data as Record<string, any> | undefined
  return Boolean(
    value?.ai_app === true ||
    value?.aiApp === true ||
    value?.data?.ai_app === true ||
    value?.data?.aiApp === true,
  )
}

function normalizeRhAspectRatio(value: unknown): string | undefined {
  const clean = asOptionalString(value)
  if (!clean || /^(empty|auto|adaptive)$/i.test(clean)) return undefined
  return clean
}

function buildRhAiAppNodeInfoList(request: CreationSubmitRequest): Array<Record<string, string>> {
  const video = request.videoParams || {}
  const audio = request.audioParams || {}
  switch (request.plan.model) {

    case 'rh-aiapp-director':
      return compactNodeInfoList([
        nodeInfo('57', 'image', asOptionalString(video.imageUrl), '你想让谁演'),
        nodeInfo('997', 'video', asOptionalString(video.videoUrl), '你想让她/他演啥'),
        nodeInfo('1019', 'text', asOptionalString(video.text), '简单说下动作是啥'),
        nodeInfo('999', 'value', stringifyValue(video.width), '宽（竖屏不用动，横屏换下数字）'),
        nodeInfo('1000', 'value', stringifyValue(video.height), '高（竖屏不用动，横屏换下数字）'),
      ])
    case 'rh-aiapp-voice-clone':
      return compactNodeInfoList([
        nodeInfo('4', 'audio', asOptionalString(audio.audioUrl), '参考音频'),
        nodeInfo('6', 'start_time', asOptionalString(audio.startTime), '参考音频开始时间'),
        nodeInfo('6', 'end_time', asOptionalString(audio.endTime), '参考音频结束时间'),
        nodeInfo('36', 'text', asOptionalString(audio.refText), '参考音频文字内容'),
        nodeInfo('11', 'text', asOptionalString(audio.text), '输出音频文字内容'),
        nodeInfo('1', '语言', asOptionalString(audio.language), '语言'),
      ])
    case 'rh-aiapp-voice-design':
      return compactNodeInfoList([
        nodeInfo('12', '语言', asOptionalString(audio.language), '语言'),
        nodeInfo('14', 'text', asOptionalString(audio.text), '文稿'),
        nodeInfo('15', 'text', asOptionalString(audio.voicePrompt), '【人设】+【音色特征】+【风格】+【情感】+【节奏】'),
      ])
    case 'rh-aiapp': {
      // 通用 AI 应用：从 normalizedParams 提取含 ":" 的键作为 nodeInfoList
      // key 格式: "nodeId:fieldName" → {"nodeId": "N", "fieldName": "F", "fieldValue": "V"}
      const params = request.plan.debug.normalizedParams || {}
      const nodes: Array<Record<string, string>> = []
      for (const [key, value] of Object.entries(params)) {
        if (typeof key === 'string' && key.includes(':') && value !== undefined && value !== null && value !== '') {
          const [nodeId, fieldName] = key.split(':', 2)
          if (nodeId && fieldName) {
            nodes.push({ nodeId, fieldName, fieldValue: String(value) })
          }
        }
      }
      return compactNodeInfoList(nodes)
    }
    default:
      return []
  }
}

function nodeInfo(nodeId: string, fieldName: string, fieldValue: string | undefined, description: string): Record<string, string> | undefined {
  if (!fieldValue) return undefined
  return { nodeId, fieldName, fieldValue, description }
}

function compactNodeInfoList(list: Array<Record<string, string> | undefined>): Array<Record<string, string>> {
  return list.filter((item): item is Record<string, string> => Boolean(item))
}

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return String(value)
}

async function toBlob(value: string): Promise<Blob> {
  if (value.startsWith('data:')) return dataUrlToBlob(value)
  const res = await fetch(value)
  if (!res.ok) throw new Error('无法加载参考图片')
  return await res.blob()
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/png'
  const byteString = atob(parts[1] || '')
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
  return new Blob([bytes], { type: detectImageMimeFromBytes(bytes) || mime })
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    output[key] = value
  }
  return output
}

function firstMediaValue(params: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = params[key]
    if (Array.isArray(value) && value.length) return value
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function imageValueForRequest(params: Record<string, unknown>): string | string[] | undefined {
  const images = asStringArray(firstMediaValue(params, ['images', 'imageUrls', 'imageUrl', 'image']))
  if (!images.length) return undefined
  // 始终返回数组，兼容 NewAPI 图片接口。
  return images
}

function firstString(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value || '')
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return value === undefined || value === null ? undefined : String(value)
  return value.trim() ? value : undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item || '')).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value]
  return []
}
