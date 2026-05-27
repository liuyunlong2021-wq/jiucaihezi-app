import type { Connection } from '@vue-flow/core'
import type { CanvasEdge, CanvasEdgeData, CanvasNode, CanvasNodeData, CanvasNodeType } from '@/types/canvas'

export function canvasNow() {
  return Date.now()
}

export function createCanvasBaseData(label: string): CanvasNodeData {
  const t = canvasNow()
  return { label, status: 'idle', createdAt: t, updatedAt: t } as CanvasNodeData
}

export function defaultCanvasLabel(type: CanvasNodeType): string {
  const labels: Record<CanvasNodeType, string> = {
    text: '文本',
    llm: 'AI 文本',
    imageGen: '图片生成',
    imageResult: '图片节点',
    audioGen: '音频生成',
    audioResult: '音频节点',
    videoGen: '视频生成',
    videoResult: '视频结果',
    file: '文件',
    tool: '本地工具',
    group: '分组',
  }
  return labels[type]
}

export function defaultCanvasDataForType(type: CanvasNodeType): CanvasNodeData {
  const base = createCanvasBaseData(defaultCanvasLabel(type))
  if (type === 'text') return { ...base, content: '' } as CanvasNodeData
  if (type === 'llm') return { ...base, modelId: '', modelProviderId: '', prompt: '' } as CanvasNodeData
  if (type === 'imageGen') return { ...base, model: 'gpt-image-2', prompt: '', aspectRatio: '1:1', size: 'auto' } as CanvasNodeData
  if (type === 'imageResult') return { ...base, label: '图片节点', url: '', width: 260, height: 230 } as CanvasNodeData
  if (type === 'audioGen') return { ...base, model: 'suno_music', prompt: '', mv: 'chirp-fenix' } as CanvasNodeData
  if (type === 'audioResult') return { ...base, label: '音频节点', url: '', width: 280, height: 150 } as CanvasNodeData
  if (type === 'videoGen') return { ...base, model: 'grok-video-3', prompt: '', aspectRatio: '16:9', resolution: '720P', duration: 6 } as CanvasNodeData
  if (type === 'videoResult') return { ...base, label: '视频节点', url: '', width: 280, height: 230 } as CanvasNodeData
  if (type === 'file') return { ...base, fileId: '', fileName: '' } as CanvasNodeData
  if (type === 'group') return { ...base, label: '分组', width: 460, height: 300, color: 'olive' } as CanvasNodeData
  return { ...base, toolKind: 'tomd', input: '' } as CanvasNodeData
}

export function createCanvasNode(type: CanvasNodeType, data: CanvasNodeData, position: { x: number; y: number }): CanvasNode {
  return {
    id: `node_${canvasNow().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    position,
    data: {
      ...data,
      createdAt: data.createdAt || canvasNow(),
      updatedAt: canvasNow(),
    } as CanvasNodeData,
  }
}

export function resolveCanvasEdgeKind(sourceType?: CanvasNodeType, targetType?: CanvasNodeType): CanvasEdgeData['kind'] {
  if (sourceType === 'imageGen' && targetType === 'imageResult') return 'generated-output'
  if (sourceType === 'videoGen' && targetType === 'videoResult') return 'generated-output'
  if (sourceType === 'audioGen' && targetType === 'audioResult') return 'generated-output'
  if ((sourceType === 'text' || sourceType === 'llm' || sourceType === 'file' || sourceType === 'tool')
    && (targetType === 'llm' || targetType === 'imageGen' || targetType === 'videoGen' || targetType === 'audioGen')) {
    return 'prompt-order'
  }
  if (sourceType === 'imageResult' && targetType === 'imageGen') return 'image-role'
  if (sourceType === 'imageResult' && targetType === 'videoGen') return 'media-role'
  if (sourceType === 'videoResult' && targetType === 'videoGen') return 'media-role'
  if (sourceType === 'audioResult' && (targetType === 'videoGen' || targetType === 'audioGen')) return 'media-role'
  if (sourceType === 'group' || targetType === 'group') return 'default'
  return 'default'
}

export function edgeTypeForKind(kind: CanvasEdgeData['kind']) {
  if (kind === 'prompt-order') return 'promptOrder'
  if (kind === 'image-role') return 'imageRole'
  if (kind === 'media-role') return 'mediaRole'
  return 'default'
}

export function createCanvasEdge(
  connection: Connection,
  sourceType?: CanvasNodeType,
  targetType?: CanvasNodeType,
  existingTargetEdges: CanvasEdge[] = [],
  patch: Partial<CanvasEdgeData> = {},
): CanvasEdge | null {
  if (!connection.source || !connection.target || connection.source === connection.target) return null
  const t = canvasNow()
  const kind = patch.kind || resolveCanvasEdgeKind(sourceType, targetType)
  const promptOrder = kind === 'prompt-order'
    ? existingTargetEdges.filter(edge => edge.target === connection.target && edge.data?.kind === 'prompt-order').length + 1
    : undefined
  const data: CanvasEdgeData = {
    kind,
    order: patch.order ?? promptOrder,
    role: patch.role || (kind === 'media-role' ? 'first_frame' : kind === 'image-role' ? 'reference' : undefined),
    createdAt: t,
  }
  return {
    id: `edge_${t.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: edgeTypeForKind(kind),
    data,
  }
}
