import { generateAudio, generateImage, generateVideo } from '@/api/media-generation'
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

interface RuntimeInput {
  node: CanvasNode
  nodes: CanvasNode[]
  edges: any[]
  onProgress?: (progress: number, message: string) => void
}

function inferMimeFromUrl(url: string, fallback: string): string {
  const clean = String(url || '').split(/[?#]/)[0].toLowerCase()
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.gif')) return 'image/gif'
  if (clean.endsWith('.mp4')) return 'video/mp4'
  if (clean.endsWith('.webm')) return 'video/webm'
  if (url.startsWith('data:image/')) return url.slice(5, url.indexOf(';')) || fallback
  return fallback
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


export async function runCanvasImageNode(input: RuntimeInput): Promise<{ url: string; fileId: string }> {
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
    if (!prompt.trim()) throw new Error('图片生成节点没有输入内容。')

    useCanvasStore().updateNodeData(pending.id, { prompt, progress: 6, detail: '已收集输入，提交生成' } as any)
    const imageInputs = getStructuredImageInputs(useCanvasStore().nodes, useCanvasStore().edges, input.node.id)
    const result = await generateImage({
      model: data.model,
      prompt,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      image: imageInputs.all.length > 1 ? imageInputs.all : imageInputs.all[0],
    }, (elapsed, status) => {
      const value = Math.min(94, Math.max(8, Math.round(Number(elapsed || 0))))
      input.onProgress?.(value, status)
      useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: value, detail: status || '生成中' } as any)
    })

    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      `${data.label || '图片结果'}.png`,
      result.url,
      'image',
      inferMimeFromUrl(result.url, 'image/png'),
    )
    useCanvasStore().updateNodeData(pending.id, {
      label: `${data.label || '图片'}结果`,
      status: 'success',
      progress: 100,
      url: result.url,
      prompt,
      model: data.model,
      fileId: file.id,
      detail: '生成完成',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: result.url, fileId: file.id }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '图片生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}


export async function runCanvasAudioNode(input: RuntimeInput): Promise<{ url: string; fileId: string }> {
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
    if (!prompt.trim()) throw new Error('音频生成节点没有输入内容。')
    input.onProgress?.(8, '已提交音频生成')
    useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: 8, prompt, detail: '已提交音频生成' } as any)
    const result = await generateAudio(prompt)
    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      `${data.label || '音频结果'}.mp3`,
      result.url,
      'audio',
      inferMimeFromUrl(result.url, 'audio/mpeg'),
    )
    useCanvasStore().updateNodeData(pending.id, {
      label: `${data.label || '音频'}结果`,
      status: 'success',
      progress: 100,
      url: result.url,
      prompt,
      model: data.model,
      fileId: file.id,
      detail: '生成完成',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: result.url, fileId: file.id }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '音频生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}


export async function runCanvasVideoNode(input: RuntimeInput): Promise<{ url: string; fileId: string; taskId?: string }> {
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
    if (!prompt.trim()) throw new Error('视频生成节点没有输入内容。')

    useCanvasStore().updateNodeData(pending.id, { prompt, progress: 6, detail: '已收集输入，提交生成' } as any)
    const imageInputs = getStructuredImageInputs(useCanvasStore().nodes, useCanvasStore().edges, input.node.id)
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
    }, (elapsed, status) => {
      const numeric = Number(elapsed || 0)
      const progress = numeric > 100 ? Math.min(94, Math.round(numeric / 10)) : Math.min(94, Math.max(8, Math.round(numeric)))
      input.onProgress?.(progress, status)
      useCanvasStore().updateNodeData(pending.id, { status: 'running', progress, detail: status || '生成中' } as any)
    })

    const fileStore = useFileStore()
    const file = await fileStore.addMedia(
      `${data.label || '视频结果'}.mp4`,
      result.url,
      'video',
      inferMimeFromUrl(result.url, 'video/mp4'),
    )
    useCanvasStore().updateNodeData(pending.id, {
      label: `${data.label || '视频'}结果`,
      status: 'success',
      progress: 100,
      url: result.url,
      prompt,
      model: data.model,
      taskId: result.taskId,
      pollUrl: result.pollUrl,
      fileId: file.id,
      detail: '生成完成',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: result.url, fileId: file.id, taskId: result.taskId }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '视频生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}

