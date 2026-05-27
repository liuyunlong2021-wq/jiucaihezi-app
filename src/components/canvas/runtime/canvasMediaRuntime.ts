import { generateAudio, generateImage, generateVideo, pollTask } from '@/api/media-generation'
import { useFileStore } from '@/composables/useFileStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type {
  CanvasAudioGenNodeData,
  CanvasAudioResultNodeData,
  CanvasImageGenNodeData,
  CanvasImageResultNodeData,
  CanvasNode,
  CanvasVideoGenNodeData,
  CanvasVideoResultNodeData,
} from '@/types/canvas'
import { buildFinalPrompt, getStructuredImageInputs, mergePromptInputs } from './canvasInputs'
import { validateCanvasAudioInputs, validateCanvasImageInputs, validateCanvasVideoInputs } from './canvasMediaValidation'
import { isCloudLoggedIn } from '@/services/newApiAuth'
import { isAllowedCreationPollUrl, isAllowedCreationResultUrl } from '@/utils/urlSafety'

interface RuntimeInput {
  node: CanvasNode
  nodes: CanvasNode[]
  edges: any[]
  onProgress?: (progress: number, message: string) => void
}

type CanvasResultKind = 'image' | 'video' | 'audio'

function inferMimeFromUrl(url: string, fallback: string): string {
  const clean = String(url || '').split(/[?#]/)[0].toLowerCase()
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.gif')) return 'image/gif'
  if (clean.endsWith('.mp4')) return 'video/mp4'
  if (clean.endsWith('.webm')) return 'video/webm'
  if (clean.endsWith('.wav')) return 'audio/wav'
  if (clean.endsWith('.m4a')) return 'audio/mp4'
  if (clean.endsWith('.ogg') || clean.endsWith('.opus')) return 'audio/ogg'
  if (clean.endsWith('.mp3')) return 'audio/mpeg'
  if (url.startsWith('data:image/')) return url.slice(5, url.indexOf(';')) || fallback
  if (url.startsWith('data:audio/')) return url.slice(5, url.indexOf(';')) || fallback
  return fallback
}

function assertSafeCanvasResultUrl(url: string): string {
  const clean = String(url || '').trim()
  if (!clean || !isAllowedCreationResultUrl(clean)) {
    throw new Error('媒体结果地址不安全，已阻止展示')
  }
  return clean
}

function assertSafePollUrl(url: string): string {
  const clean = String(url || '').trim()
  if (!clean || !isAllowedCreationPollUrl(clean)) {
    throw new Error('任务轮询地址不安全，已阻止请求')
  }
  return clean
}

async function assertCanvasMediaCloudLoggedIn() {
  if (!(await isCloudLoggedIn())) {
    throw new Error('使用云端模型需要先登录，请在设置中登录')
  }
}

// Membership guard removed — all logged-in users can use media generation

function markSubmittedResult(
  nodeId: string,
  submitted: { taskId?: string; pollUrl?: string; pollKind?: CanvasResultKind },
) {
  useCanvasStore().updateNodeData(nodeId, {
    taskId: submitted.taskId,
    pollUrl: submitted.pollUrl,
    pollKind: submitted.pollKind,
    detail: '任务已提交，可恢复轮询',
    updatedAt: Date.now(),
  } as any)
}

function createPendingResultNode(
  source: CanvasNode,
  resultType: 'imageResult' | 'videoResult' | 'audioResult',
  data: CanvasImageResultNodeData | CanvasVideoResultNodeData | CanvasAudioResultNodeData,
) {
  const canvasStore = useCanvasStore()
  const currentNodes = canvasStore.nodes
  const currentEdges = canvasStore.edges
  const outgoingResultCount = currentEdges.filter(edge => {
    if (edge.source !== source.id) return false
    const target = currentNodes.find(node => node.id === edge.target)
    return target?.type === resultType
  }).length
  const sourceHeight = Number((source.data as any).height || 180)
  const sourcePosition = canvasStore.getAbsoluteNodePosition(source.id)
  const resultNode = canvasStore.addNodeWithData(resultType, data as any, {
    x: sourcePosition.x + 360,
    y: sourcePosition.y + outgoingResultCount * Math.max(230, sourceHeight + 36),
  })
  canvasStore.updateNodeData(source.id, { outputNodeId: resultNode.id } as any)
  canvasStore.addEdge(source.id, resultNode.id, { kind: 'generated-output' })
  return resultNode
}

function fileNameForResult(kind: CanvasResultKind, label?: string): string {
  if (kind === 'video') return `${label || '视频结果'}.mp4`
  if (kind === 'audio') return `${label || '音频结果'}.mp3`
  return `${label || '图片结果'}.png`
}

function mimeForResult(kind: CanvasResultKind, url: string): string {
  if (kind === 'video') return inferMimeFromUrl(url, 'video/mp4')
  if (kind === 'audio') return inferMimeFromUrl(url, 'audio/mpeg')
  return inferMimeFromUrl(url, 'image/png')
}

export async function resumeCanvasResultNode(
  nodeId: string,
  kind: CanvasResultKind,
  data: Pick<CanvasImageResultNodeData | CanvasVideoResultNodeData | CanvasAudioResultNodeData, 'label' | 'pollUrl' | 'pollKind'>,
): Promise<{ url: string; fileId: string }> {
  const pollUrl = String((data as any).pollUrl || '').trim()
  if (!pollUrl) throw new Error('没有可恢复的任务地址')
  const safePollUrl = assertSafePollUrl(pollUrl)
  const pollKind = ((data as any).pollKind || kind) as CanvasResultKind
  const canvasStore = useCanvasStore()
  canvasStore.updateNodeData(nodeId, {
    status: 'running',
    progress: Math.max(3, Number((data as any).progress || 3)),
    error: '',
    detail: '正在恢复任务',
  } as any)

  try {
    const mediaUrl = await pollTask(safePollUrl, pollKind, (elapsed, status) => {
      const numeric = Number(elapsed || 0)
      const progress = numeric > 100 ? Math.min(94, Math.round(numeric / 10)) : Math.min(94, Math.max(8, Math.round(numeric)))
      canvasStore.updateNodeData(nodeId, {
        status: 'running',
        progress,
        detail: status || '恢复轮询中',
      } as any)
    })
    const safeUrl = assertSafeCanvasResultUrl(mediaUrl)
    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      fileNameForResult(kind, data.label),
      safeUrl,
      kind,
      mimeForResult(kind, safeUrl),
    )
    canvasStore.updateNodeData(nodeId, {
      status: 'success',
      progress: 100,
      url: safeUrl,
      fileId: file.id,
      detail: '恢复完成',
      error: '',
    } as any)
    return { url: safeUrl, fileId: file.id }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '恢复失败')
    canvasStore.updateNodeData(nodeId, {
      status: 'error',
      progress: 100,
      error: message,
      detail: '恢复失败',
    } as any)
    throw err
  }
}


export async function runCanvasImageNode(input: RuntimeInput): Promise<{ url: string; fileId: string }> {
  await assertCanvasMediaCloudLoggedIn()
  const data = input.node.data as CanvasImageGenNodeData
  const pending = createPendingResultNode(input.node, 'imageResult', {
    label: `${data.label || '图片'}结果`,
    status: 'running',
    progress: 3,
    url: '',
    prompt: '',
    model: data.model,
    detail: '准备生成图片',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any)

  try {
    const merged = await mergePromptInputs(input.nodes, input.edges, input.node.id)
    const prompt = buildFinalPrompt(merged.text, data.prompt)
    if (merged.missing.length) throw new Error(`图片生成缺少上游输出：${merged.missing.join('、')}`)

    useCanvasStore().updateNodeData(pending.id, { prompt, progress: 6, detail: '已收集输入，提交生成' } as any)
    const imageInputs = getStructuredImageInputs(useCanvasStore().nodes, useCanvasStore().edges, input.node.id)
    validateCanvasImageInputs(data.model, prompt, data as any, imageInputs)
    const result = await generateImage({
      model: data.model,
      prompt,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      size: data.size,
      image: imageInputs.all.length > 1 ? imageInputs.all : imageInputs.all[0],
    }, (elapsed, status) => {
      const value = Math.min(94, Math.max(8, Math.round(Number(elapsed || 0))))
      input.onProgress?.(value, status)
      useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: value, detail: status || '生成中' } as any)
    })

    const safeUrl = assertSafeCanvasResultUrl(result.url)
    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      `${data.label || '图片结果'}.png`,
      safeUrl,
      'image',
      inferMimeFromUrl(safeUrl, 'image/png'),
    )
    useCanvasStore().updateNodeData(pending.id, {
      label: `${data.label || '图片'}结果`,
      status: 'success',
      progress: 100,
      url: safeUrl,
      prompt,
      model: data.model,
      fileId: file.id,
      detail: '生成完成',
      taskId: result.taskId,
      pollUrl: result.pollUrl,
      pollKind: result.pollKind,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: safeUrl, fileId: file.id }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '图片生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}


export async function runCanvasAudioNode(input: RuntimeInput): Promise<{ url: string; fileId: string }> {
  await assertCanvasMediaCloudLoggedIn()
  const data = input.node.data as CanvasAudioGenNodeData
  const pending = createPendingResultNode(input.node, 'audioResult', {
    label: `${data.label || '音频'}结果`,
    status: 'running',
    progress: 3,
    url: '',
    prompt: '',
    model: data.model,
    detail: '准备生成音频',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any)

  try {
    const merged = await mergePromptInputs(input.nodes, input.edges, input.node.id)
    const prompt = buildFinalPrompt(merged.text, data.prompt)
    if (merged.missing.length) throw new Error(`音频生成缺少上游输出：${merged.missing.join('、')}`)
    const imageInputs = getStructuredImageInputs(useCanvasStore().nodes, useCanvasStore().edges, input.node.id)
    validateCanvasAudioInputs(data.model, prompt, data as any, imageInputs)
    input.onProgress?.(8, '已提交音频生成')
    useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: 8, prompt, detail: '已提交音频生成' } as any)
    const audioUrl = imageInputs.audios[0]
    const result = await generateAudio({
      model: data.model,
      prompt,
      title: data.title,
      tags: data.tags,
      negativeTags: data.negativeTags,
      mv: data.mv,
      audioUrl,
      startTime: data.startTime,
      endTime: data.endTime,
      refText: data.refText,
      text: data.text,
      language: data.language,
      voicePrompt: data.voicePrompt,
      onSubmitted: submitted => markSubmittedResult(pending.id, submitted),
    })
    const safeUrl = assertSafeCanvasResultUrl(result.url)
    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      `${data.label || '音频结果'}.mp3`,
      safeUrl,
      'audio',
      inferMimeFromUrl(safeUrl, 'audio/mpeg'),
    )
    useCanvasStore().updateNodeData(pending.id, {
      label: `${data.label || '音频'}结果`,
      status: 'success',
      progress: 100,
      url: safeUrl,
      prompt,
      model: data.model,
      fileId: file.id,
      detail: '生成完成',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: safeUrl, fileId: file.id }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '音频生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}


export async function runCanvasVideoNode(input: RuntimeInput): Promise<{ url: string; fileId: string; taskId?: string }> {
  await assertCanvasMediaCloudLoggedIn()
  const data = input.node.data as CanvasVideoGenNodeData
  const pending = createPendingResultNode(input.node, 'videoResult', {
    label: `${data.label || '视频'}结果`,
    status: 'running',
    progress: 3,
    url: '',
    prompt: '',
    model: data.model,
    detail: '准备生成视频',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any)

  try {
    const merged = await mergePromptInputs(input.nodes, input.edges, input.node.id)
    const prompt = buildFinalPrompt(merged.text, data.prompt)
    if (merged.missing.length) throw new Error(`视频生成缺少上游输出：${merged.missing.join('、')}`)
    const imageInputs = getStructuredImageInputs(useCanvasStore().nodes, useCanvasStore().edges, input.node.id)
    validateCanvasVideoInputs(data.model, prompt, data as any, imageInputs)

    useCanvasStore().updateNodeData(pending.id, { prompt, progress: 6, detail: '已收集输入，提交生成' } as any)
    const orderedImages = [imageInputs.firstFrame, imageInputs.lastFrame, ...imageInputs.references].filter(Boolean) as string[]
    if (imageInputs.videos.length) {
      input.onProgress?.(8, '已接收上游视频素材，当前媒体接口暂按提示词续作')
    }
    const result = await generateVideo({
      model: data.model,
      prompt,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      duration: data.duration,
      imageUrl: imageInputs.firstFrame || orderedImages[0],
      imageUrls: orderedImages.length > 1 ? orderedImages : undefined,
      videoUrl: imageInputs.videos[0],
      audioUrl: imageInputs.audios[0],
      text: data.text,
      width: (data as any).outputWidth || data.width,
      height: (data as any).outputHeight || data.height,
      value: data.value,
      onSubmitted: submitted => markSubmittedResult(pending.id, submitted),
    }, (elapsed, status) => {
      const numeric = Number(elapsed || 0)
      const progress = numeric > 100 ? Math.min(94, Math.round(numeric / 10)) : Math.min(94, Math.max(8, Math.round(numeric)))
      input.onProgress?.(progress, status)
      useCanvasStore().updateNodeData(pending.id, { status: 'running', progress, detail: status || '生成中' } as any)
    })

    const safeUrl = assertSafeCanvasResultUrl(result.url)
    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      `${data.label || '视频结果'}.mp4`,
      safeUrl,
      'video',
      inferMimeFromUrl(safeUrl, 'video/mp4'),
    )
    useCanvasStore().updateNodeData(pending.id, {
      label: `${data.label || '视频'}结果`,
      status: 'success',
      progress: 100,
      url: safeUrl,
      prompt,
      model: data.model,
      taskId: result.taskId,
      pollUrl: result.pollUrl,
      pollKind: result.pollKind,
      fileId: file.id,
      detail: '生成完成',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: safeUrl, fileId: file.id, taskId: result.taskId }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '视频生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}
