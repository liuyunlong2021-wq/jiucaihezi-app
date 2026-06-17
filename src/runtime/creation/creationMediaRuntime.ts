import {
  apiCall,
  apiCallMultipart,
  extractMediaText,
  extractMediaUrl,
  extractTaskId,
  pollTask,
  uploadCreationAsset,
  type AudioGenParams,
  type ImageGenParams,
  type MediaResult,
  type VideoGenParams,
} from '@/api/media-generation'
import type { CreationRunPlan } from './creationMediaTypes'

export interface CreationSubmitRequest {
  runtime: 'newapi-direct' | 'runninghub-adapter'
  taskType: 'image' | 'video' | 'audio'
  endpoint: string
  pollKind: CreationRunPlan['pollKind']
  usesRhAdapter: boolean
  plan: CreationRunPlan
  imageParams?: Partial<ImageGenParams>
  videoParams?: Partial<VideoGenParams>
  audioParams?: Partial<AudioGenParams>
}

export function buildCreationSubmitRequest(plan: CreationRunPlan): CreationSubmitRequest {
  const runtime = plan.usesRhAdapter ? 'runninghub-adapter' : 'newapi-direct'
  const params = plan.debug.normalizedParams
  const request: CreationSubmitRequest = {
    runtime,
    taskType: plan.task === 'image' ? 'image' : plan.task === 'video' || plan.task === 'digital-human' ? 'video' : 'audio',
    endpoint: plan.endpoint,
    pollKind: plan.pollKind,
    usesRhAdapter: plan.usesRhAdapter,
    plan,
  }

  if (plan.task === 'image') {
    request.imageParams = {
      model: plan.model,
      prompt: asString(params.prompt),
      size: asOptionalString(params.size),
      aspectRatio: firstString(params, ['aspect_ratio', 'aspectRatio', 'ratio']),
      resolution: asOptionalString(params.resolution),
      image: imageValueForRequest(params),
      lora: asOptionalString(params.lora),
      lora_strength: asOptionalNumber(params.lora_strength),
      outputFormat: asOptionalString(params.outputFormat),
      responseFormat: (asOptionalString(params.response_format) || 'url') as ImageGenParams['responseFormat'],
    }
    return request
  }

  if (plan.task === 'video' || plan.task === 'digital-human') {
    const images = asStringArray(firstMediaValue(params, ['images', 'image', 'imageUrls', 'imageUrl']))
    const videos = asStringArray(firstMediaValue(params, ['videos', 'video', 'videoUrls', 'videoUrl']))
    const audios = asStringArray(firstMediaValue(params, ['audios', 'audio', 'audioUrls', 'audioUrl']))
    request.videoParams = {
      model: plan.model,
      prompt: asString(params.prompt),
      aspectRatio: firstString(params, ['aspect_ratio', 'aspectRatio', 'ratio']),
      resolution: asOptionalString(params.resolution),
      duration: asOptionalNumber(params.duration),
      imageUrl: images[0],
      imageUrls: images.length > 1 ? images : undefined,
      videoUrl: videos[0],
      audioUrl: audios[0],
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
): Promise<MediaResult> {
  if (request.runtime === 'newapi-direct') {
    if (request.taskType === 'image') return executeDirectImageRequest(request, onProgress, onSubmitted)
    if (request.taskType === 'video') return executeDirectVideoRequest(request, onProgress, onSubmitted)
    return executeDirectAudioRequest(request, onProgress, onSubmitted)
  }
  if (request.taskType === 'image') return executeRunningHubImageRequest(request, onProgress, onSubmitted)
  if (request.taskType === 'video') return executeRunningHubVideoRequest(request, onProgress, onSubmitted)
  return executeRunningHubAudioRequest(request, onProgress, onSubmitted)
}

async function executeDirectImageRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  const params = request.imageParams || {}
  const prompt = asString(params.prompt)
  if (request.plan.apiStyle === 'openai-image-edits') {
    onProgress?.(0, '上传图片中...')
    const images = asStringArray(params.image)
    const fields: Record<string, string | Blob | Blob[]> = {
      model: request.plan.model,
      prompt,
      response_format: params.responseFormat || 'url',
    }
    if (params.size) fields.size = params.size
    fields.image = await Promise.all(images.map(toBlob))
    const data = await apiCallMultipart(request.endpoint, fields)
    const mediaUrl = extractMediaUrl(data, 'image')
    if (!mediaUrl) throw new Error('图片生成完成但未返回可用结果')
    return { url: mediaUrl, type: 'image' }
  }

  onProgress?.(0, '提交中...')
  const body: Record<string, unknown> = compact({
    model: request.plan.model,
    prompt,
    size: params.size,
    aspect_ratio: params.aspectRatio,
    aspectRatio: params.aspectRatio,
    ratio: params.aspectRatio,
    resolution: params.resolution,
    image: params.image,
    response_format: params.responseFormat || 'url',
  })
  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model)
  const mediaUrl = extractMediaUrl(data, 'image')
  if (mediaUrl) return { url: mediaUrl, type: 'image' }
  const taskId = extractTaskId(data)
  if (!taskId || request.pollKind === 'none') throw new Error('图片生成完成但未返回可用结果')
  // MJ task: poll URL 是 /mj/task/{id}/fetch，不同于 submit endpoint
  const pollUrl = request.plan.apiStyle === 'mj-task'
    ? `/mj/task/${encodeURIComponent(taskId)}/fetch`
    : `${request.endpoint}/${encodeURIComponent(taskId)}`
  await onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
  const url = await pollTask(pollUrl, 'image', onProgress, 600, 10000)
  return { url, type: 'image', taskId, pollUrl, pollKind: 'image' }
}

async function executeDirectVideoRequest(
  request: CreationSubmitRequest,
  onProgress?: (elapsed: number, status: string) => void,
  onSubmitted?: (submitted: { taskId: string; pollUrl: string; pollKind: 'image' | 'video' | 'audio' | 'text' }) => void | Promise<void>,
): Promise<MediaResult> {
  onProgress?.(0, '提交中...')
  const params = request.videoParams || {}
  const images = asStringArray(params.imageUrls?.length ? params.imageUrls : params.imageUrl)
  const uploadedImages = request.plan.assetFlow === 'seedance-asset'
    ? await Promise.all(images.map(uploadCreationAsset))
    : images

  const body = buildDirectVideoBody(request, uploadedImages)
  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model)
  let mediaUrl = extractMediaUrl(data, 'video')
  const taskId = extractTaskId(data)
  const pollUrl = taskId ? buildVideoPollUrl(request, taskId) : undefined
  if (!mediaUrl && taskId && pollUrl && request.pollKind !== 'none') {
    await onSubmitted?.({ taskId, pollUrl, pollKind: 'video' })
    mediaUrl = await pollTask(pollUrl, 'video', onProgress, 600, 10000)
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
  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model)
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
  const result = await pollTask(pollUrl, pollKind, onProgress, 600, 5000)
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
  const extraFields = compact({
    aspectRatio,
    aspect_ratio: aspectRatio,
    ratio: aspectRatio,
    resolution,
    lora,
    lora_strength: loraStrength,
    outputFormat,
  })
  const body = compact({
    model: request.plan.model,
    prompt: asOptionalString(params.prompt),
    aspectRatio,
    aspect_ratio: aspectRatio,
    ratio: aspectRatio,
    resolution,
    lora,
    lora_strength: loraStrength,
    outputFormat,
    extra_fields: Object.keys(extraFields).length ? extraFields : undefined,
    images: images.length ? images : undefined,
  })

  const data = await apiCall(request.endpoint, body, 'POST', request.plan.model)
  const mediaUrl = extractMediaUrl(data, 'image')
  if (mediaUrl) return { url: mediaUrl, type: 'image' }
  const taskId = extractTaskId(data)
  if (!taskId) throw new Error('RunningHub 图片任务未返回任务 ID')
  const pollUrl = buildRunningHubPollUrl(taskId, request.plan.apiStyle === 'rh-aiapp' || isAiAppResponse(data))
  await onSubmitted?.({ taskId, pollUrl, pollKind: 'image' })
  const url = await pollTask(pollUrl, 'image', onProgress, 600, 10000)
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
  const body: Record<string, unknown> = {
    model: request.plan.model,
    prompt: asOptionalString(params.prompt),
  }

  if (request.plan.apiStyle === 'rh-aiapp') {
    body.prompt = asOptionalString(params.prompt) || 'AI App workflow'
    const nodeInfoList = buildRhAiAppNodeInfoList(request)
    if (!nodeInfoList.length) throw new Error(`RH AI App 暂未完成 ${request.plan.model} 的 nodeInfoList 映射`)
    body.nodeInfoList = nodeInfoList
  } else {
    const aspectRatio = normalizeRhAspectRatio(params.aspectRatio)
    Object.assign(body, compact({
      aspectRatio,
      aspect_ratio: aspectRatio,
      ratio: aspectRatio,
      resolution: asOptionalString(params.resolution),
      duration: params.duration === undefined ? undefined : String(params.duration),
      images: images.length ? images : undefined,
      video: asOptionalString(params.videoUrl),
      audio: asOptionalString(params.audioUrl),
      text: asOptionalString(params.text),
      width: asOptionalNumber(params.width),
      height: asOptionalNumber(params.height),
      value: asOptionalNumber(params.value),
    }))
  }

  const data = await apiCall(request.endpoint, compact(body), 'POST', request.plan.model)
  let mediaUrl = extractMediaUrl(data, 'video')
  const taskId = extractTaskId(data)
  if (!mediaUrl && taskId) {
    const pollUrl = buildRunningHubPollUrl(taskId, request.plan.apiStyle === 'rh-aiapp' || isAiAppResponse(data))
    await onSubmitted?.({ taskId, pollUrl, pollKind: 'video' })
    mediaUrl = await pollTask(pollUrl, 'video', onProgress, 600, 10000)
    return { url: mediaUrl, type: 'video', taskId, pollUrl, pollKind: 'video' }
  }
  if (!mediaUrl) throw new Error('RunningHub 视频生成失败')
  return { url: mediaUrl, type: 'video' }
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
    const nodeInfoList = buildRhAiAppNodeInfoList(request)
    if (!nodeInfoList.length) throw new Error(`RH AI App 暂未完成 ${request.plan.model} 的 nodeInfoList 映射`)
    body.nodeInfoList = nodeInfoList
  } else if (request.plan.model === 'rh-suno-v55-single') {
    body.title = asOptionalString(params.title) || '未命名歌曲'
    body.description = asString(params.prompt)
    body.make_instrumental = String(asOptionalBoolean(params.makeInstrumental) ?? false)
  } else if (request.plan.model === 'rh-suno-v55-custom') {
    body.title = asOptionalString(params.title) || '未命名歌曲'
    body.lyrics = asString(params.prompt)
    body.tags = asOptionalString(params.tags) || ''
    body.negative_tags = asOptionalString(params.negativeTags) || ''
    body.make_instrumental = String(asOptionalBoolean(params.makeInstrumental) ?? false)
  } else if (request.plan.model === 'rh-suno-lyrics') {
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

  const data = await apiCall(request.endpoint, compact(body), 'POST', request.plan.model)
  const syncText = request.plan.mode === 'lyrics' ? extractMediaText(data) : ''
  if (syncText) return { url: '', text: syncText, type: 'text' }
  const syncUrl = extractMediaUrl(data, 'audio')
  if (syncUrl) return { url: syncUrl, type: 'audio' }
  const taskId = extractTaskId(data)
  if (!taskId) throw new Error('RunningHub 音频任务未返回任务 ID')
  const pollKind = request.plan.mode === 'lyrics' ? 'text' : 'audio'
  const pollUrl = buildRunningHubPollUrl(taskId, request.plan.apiStyle === 'rh-aiapp' || isAiAppResponse(data))
  await onSubmitted?.({ taskId, pollUrl, pollKind })
  const result = await pollTask(pollUrl, pollKind, onProgress, 600, 5000)
  if (pollKind === 'text') return { url: '', text: result, type: 'text', taskId, pollUrl, pollKind }
  return { url: result, type: 'audio', taskId, pollUrl, pollKind }
}

function buildDirectVideoBody(request: CreationSubmitRequest, uploadedImages: string[]): Record<string, unknown> {
  const params = request.videoParams || {}
  if (request.plan.apiStyle === 'seedance-task') {
    const body: Record<string, unknown> = compact({
      model: request.plan.model,
      prompt: params.prompt,
      duration: asOptionalNumber(params.duration),
      ratio: params.aspectRatio,
      aspect_ratio: params.aspectRatio,
      resolution: asOptionalString(params.resolution)?.toLowerCase(),
      generate_audio: true,
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
  return compact({
    model: request.plan.model,
    prompt: params.prompt,
    ratio: params.aspectRatio,
    aspect_ratio: params.aspectRatio,
    resolution: params.resolution,
    duration: params.duration,
    images: uploadedImages.length > 1 ? uploadedImages : undefined,
    image: uploadedImages.length === 1 ? uploadedImages[0] : undefined,
    imageUrl: uploadedImages[0],
    imageUrls: uploadedImages.length > 1 ? uploadedImages : undefined,
    video_url: params.videoUrl,
    audio_url: params.audioUrl,
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
    case 'rh-aiapp-fast-digital-human':
    case 'rh-digital-human-fast':
      return compactNodeInfoList([
        nodeInfo('3', 'audio', asOptionalString(video.audioUrl), 'audio'),
        nodeInfo('4', 'image', asOptionalString(video.imageUrl), 'image'),
        nodeInfo('10', 'value', stringifyValue(video.value ?? 832), 'value'),
      ])
    case 'rh-aiapp-digital-human':
    case 'rh-digital-human':
      return compactNodeInfoList([
        nodeInfo('20', 'prompt', asOptionalString(video.prompt), '简单提示词'),
        nodeInfo('41', 'prompt', asOptionalString(video.text), '台词'),
        nodeInfo('43', 'image', asOptionalString(video.imageUrl), '上传首帧图'),
        nodeInfo('40', 'audio', asOptionalString(video.audioUrl), '上传参考音频'),
        nodeInfo('47', 'value', stringifyValue(video.height), '高'),
        nodeInfo('48', 'value', stringifyValue(video.width), '宽'),
      ])
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
  return new Blob([bytes], { type: mime })
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
  return images.length === 1 ? images[0] : images
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
