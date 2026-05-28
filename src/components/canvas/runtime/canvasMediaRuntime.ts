import {
  submitImageAsync, queryImageStatus,
  submitImageFal, queryImageFal,
  submitVideo, queryVideo,
  submitVideoFal, queryVideoFal,
  submitSeedance, querySeedance,
  submitAudio, queryAudio,
  submitRh, queryRh,
  uploadRhAsset,
} from '@/canvas/services/canvasGeneration'
import type { ImageQueryResult, VideoQueryResult } from '@/canvas/services/canvasGeneration'
import type { FalSubmitRequest, VideoFalSubmitRequest } from '@/canvas/services/canvasGeneration'
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

async function pollByKind(taskId: string, kind: CanvasResultKind): Promise<string> {
  if (kind === 'image') {
    const r = await queryImageStatus(taskId)
    if (r.status === 'completed' && r.urls?.length) return r.urls[0]
    if (r.status === 'failed') throw new Error(r.error || '图片任务失败')
    throw new Error(`仍在进行中: ${r.status}`)
  }
  if (kind === 'video') {
    const r = await queryVideo(taskId)
    if (r.status === 'SUCCESS' && r.videoUrl) return r.videoUrl
    if (r.status === 'FAILED') throw new Error(r.failReason || '视频任务失败')
    throw new Error(`仍在进行中: ${r.status}`)
  }
  if (kind === 'audio') {
    throw new Error('音频恢复请走 submit/query 新路径')
  }
  throw new Error(`不支持的恢复类型: ${kind}`)
}

export async function resumeCanvasResultNode(
  nodeId: string,
  kind: CanvasResultKind,
  data: Pick<CanvasImageResultNodeData | CanvasVideoResultNodeData | CanvasAudioResultNodeData, 'label' | 'pollUrl' | 'pollKind'>,
): Promise<{ url: string; fileId: string }> {
  const taskId = String((data as any).taskId || (data as any).pollUrl || '').trim()
  if (!taskId) throw new Error('没有可恢复的任务 ID')
  const canvasStore = useCanvasStore()
  canvasStore.updateNodeData(nodeId, {
    status: 'running',
    progress: Math.max(3, Number((data as any).progress || 3)),
    error: '',
    detail: '正在恢复任务',
  } as any)

  try {
    let mediaUrl: string
    let attempts = 0
    while (attempts < 120) {
      await new Promise(r => setTimeout(r, 5000))
      try {
        mediaUrl = await pollByKind(taskId, kind)
        break
      } catch (e: any) {
        if (e.message?.includes('仍在进行中')) { attempts++; continue }
        throw e
      }
      canvasStore.updateNodeData(nodeId, {
        status: 'running',
        progress: Math.min(94, 8 + Math.floor(attempts / 120 * 86)),
        detail: '恢复轮询中',
      } as any)
    }
    if (!mediaUrl!) throw new Error('恢复超时')

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

    const isFal = String(data.model || '').includes('-fal')
    let taskId: string
    if (isFal) {
      const falReq: FalSubmitRequest = {
        apiModel: data.model,
        prompt,
        images: imageInputs.all.length ? imageInputs.all : undefined,
        size: data.size || data.aspectRatio,
        sync: false,
      }
      const falRes = await submitImageFal(falReq)
      taskId = falRes.requestId || falRes.responseUrl || ''
      if (!taskId) throw new Error('FAL 未返回任务标识')
    } else {
      const imgVal = imageInputs.all.length > 1 ? imageInputs.all : (imageInputs.all[0] || undefined)
      const res = await submitImageAsync({
        model: data.model,
        prompt,
        aspectRatio: data.aspectRatio,
        resolution: data.resolution,
        size: data.size || undefined,
        image: Array.isArray(imgVal) ? imgVal as string[] : imgVal as string | undefined,
      } as any)
      taskId = res.taskId as string
    }

    useCanvasStore().updateNodeData(pending.id, { taskId, progress: 10, detail: '已提交，轮询中' } as any)

    let mediaUrl = ''
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000))
      input.onProgress?.(Math.min(94, 10 + Math.floor(i / 120 * 84)), '轮询中')
      try {
        if (isFal) {
          const q = await queryImageFal({ requestId: taskId, responseUrl: taskId })
          if (q.status === 'completed' && q.urls?.length) { mediaUrl = q.urls[0]; break }
          if (q.status === 'failed') throw new Error(q.error || 'FAL 失败')
        } else {
          const q = await queryImageStatus(taskId, data.model)
          if (q.status === 'completed' && q.urls?.length) { mediaUrl = q.urls[0]; break }
          if (q.status === 'failed') throw new Error(q.error || '图片任务失败')
        }
      } catch (e: any) {
        if (!e.message?.includes('仍在进行中') && !e.message?.includes('pending')) throw e
      }
    }
    if (!mediaUrl) throw new Error('图片生成超时')

    const safeUrl = assertSafeCanvasResultUrl(mediaUrl)
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
      taskId,
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
    validateCanvasAudioInputs(data.model, prompt, data as any, {} as any)
    input.onProgress?.(8, '已提交音频生成')
    useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: 8, prompt, detail: '已提交音频生成' } as any)

    const r = await submitAudio({
      mode: (data as any).mode || 'generate',
      version: (data as any).version,
      title: data.title,
      tags: data.tags,
      prompt,
    })
    const clipIds = r.clipIds
    if (!clipIds.length) throw new Error('未返回 clipId')
    useCanvasStore().updateNodeData(pending.id, { taskId: r.taskId, progress: 10, detail: '轮询中' } as any)

    let audioUrl = ''
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pct = Math.min(94, 10 + Math.floor(i / 120 * 84))
      input.onProgress?.(pct, '轮询中')
      useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: pct } as any)
      try {
        const q = await queryAudio(clipIds)
        if (q.status === 'SUCCESS' && q.tracks?.length) { audioUrl = q.tracks[0].audioUrl; break }
      } catch {}
    }
    if (!audioUrl) throw new Error('音频生成超时')

    const safeUrl = assertSafeCanvasResultUrl(audioUrl)
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

// RunningHub 节点运行器
export async function runCanvasRunningHubNode(input: RuntimeInput): Promise<{ url: string; fileId: string }> {
  const data = input.node.data as any
  const webappId = String(data.webappId || '').trim()
  if (!webappId) throw new Error('请先填写 webappId')

  // 构建 nodeInfoList
  const paramValues = data.paramValues || {}
  const appInfo = data.appInfo
  const nodeInfoList: any[] = []
  if (appInfo?.nodeInfoList) {
    for (const it of appInfo.nodeInfoList) {
      const k = `${it.nodeId}::${it.fieldName}`
      const v = paramValues[k]?.value ?? it.fieldValue ?? ''
      nodeInfoList.push({ nodeId: it.nodeId, fieldName: it.fieldName, fieldValue: v })
    }
  }

  const r = await submitRh({ webappId, nodeInfoList: nodeInfoList.length ? nodeInfoList : undefined })
  useCanvasStore().updateNodeData(input.node.id, { status: 'polling', taskId: r.taskId })

  let mediaUrl = ''
  let resultUrls: string[] = []
  for (let i = 0; i < 480; i++) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const q = await queryRh(r.taskId)
      if (q.status === 'SUCCESS' && q.urls?.length) { mediaUrl = q.urls[0]; resultUrls = q.urls; break }
      if (q.status === 'FAILED') throw new Error(q.failReason || 'RH 任务失败')
    } catch (e: any) { if (e.message?.includes('FAILED')) throw e }
  }
  if (!mediaUrl) throw new Error('RH 轮询超时')

  const safeUrl = assertSafeCanvasResultUrl(mediaUrl)
  // 判断输出类型
  const isVideo = /\.(mp4|webm|mov)/i.test(safeUrl)
  const isAudio = /\.(mp3|wav|ogg|m4a)/i.test(safeUrl)
  const kind: CanvasResultKind = isVideo ? 'video' : isAudio ? 'audio' : 'image'
  const ext = isVideo ? '.mp4' : isAudio ? '.mp3' : '.png'

  const fileStore = useFileStore()
  const file = await fileStore.addMedia(`RH结果${ext}`, safeUrl, kind, mimeForResult(kind, safeUrl))
  useCanvasStore().updateNodeData(input.node.id, {
    status: 'success',
    urls: resultUrls.length ? resultUrls : [safeUrl],
    imageUrl: safeUrl,
  } as any)
  return { url: safeUrl, fileId: file.id }
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

    const isFal = String(data.model || '').includes('-fal')
    let taskId: string
    if (isFal) {
      const falReq: VideoFalSubmitRequest = {
        apiModel: data.model,
        prompt,
        images: orderedImages.length ? orderedImages : undefined,
        aspect_ratio: data.aspectRatio,
        resolution: data.resolution,
        duration: data.duration != null ? String(data.duration) : undefined,
      }
      const falRes = await submitVideoFal(falReq)
      taskId = falRes.requestId || falRes.responseUrl || ''
      if (!taskId) throw new Error('FAL 未返回任务标识')
    } else {
      const model = String(data.model || '').startsWith('seedance') ? undefined : data.model
      if (model && model.startsWith('seedance')) {
        const r = await submitSeedance({
          model: data.model,
          prompt,
          duration: data.duration,
          ratio: data.aspectRatio,
          resolution: data.resolution,
          firstFrame: imageInputs.firstFrame,
          refImages: imageInputs.references.length ? imageInputs.references : undefined,
        })
        taskId = r.taskId
      } else {
        const r = await submitVideo({
          model: data.model,
          prompt,
          aspect_ratio: data.aspectRatio,
          resolution: data.resolution,
          duration: data.duration,
          imageUrl: imageInputs.firstFrame || orderedImages[0],
          imageUrls: orderedImages.length > 1 ? orderedImages : undefined,
        } as any)
        taskId = r.taskId
      }
    }

    useCanvasStore().updateNodeData(pending.id, { taskId, progress: 10, detail: '已提交，轮询中' } as any)

    let mediaUrl = ''
    const isSeedance = String(data.model || '').startsWith('seedance')
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pct = Math.min(94, 10 + Math.floor(i / 120 * 84))
      input.onProgress?.(pct, '轮询中')
      useCanvasStore().updateNodeData(pending.id, { status: 'running', progress: pct } as any)
      try {
        if (isFal) {
          const q = await queryVideoFal({ requestId: taskId, responseUrl: taskId })
          const falUrls = (q as any).urls || []
          if (q.status === 'completed' && falUrls.length) { mediaUrl = falUrls[0]; break }
          if (q.status === 'failed') throw new Error(q.error || 'FAL 失败')
        } else if (isSeedance) {
          const q = await querySeedance(taskId)
          if (q.status === 'succeeded' && q.videoUrl) { mediaUrl = q.videoUrl; break }
          if (q.status === 'failed') throw new Error(q.failReason || 'Seedance 失败')
        } else {
          const q = await queryVideo(taskId, data.model)
          if (q.status === 'SUCCESS' && q.videoUrl) { mediaUrl = q.videoUrl; break }
          if (q.status === 'FAILED') throw new Error(q.failReason || '视频任务失败')
        }
      } catch (e: any) {
        if (!e.message?.includes('FAILED') && !e.message?.includes('failed')) continue
        throw e
      }
    }
    if (!mediaUrl) throw new Error('视频生成超时')

    const safeUrl = assertSafeCanvasResultUrl(mediaUrl)
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
      taskId,
      fileId: file.id,
      detail: '生成完成',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
    return { url: safeUrl, fileId: file.id, taskId }
  } catch (err) {
    const message = (err as Error)?.message || String(err || '视频生成失败')
    useCanvasStore().updateNodeData(pending.id, { status: 'error', progress: 100, error: message, detail: '生成失败' } as any)
    throw err
  }
}
