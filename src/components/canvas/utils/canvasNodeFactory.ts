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
  const labels: Record<string, string> = {
    text: '文本', llm: 'AI 文本',
    imageGen: '图片生成', imageResult: '图片节点',
    audioGen: '音频生成', audioResult: '音频节点',
    videoGen: '视频生成', videoResult: '视频结果',
    file: '文件', tool: '本地工具', group: '分组',
    // T8 迁入
    runninghub: 'RunningHub', runninghubWallet: 'RH钱包', seedance: 'Seedance',
    rhTools: 'RH超市', rhConfig: 'RH配置',
    upload: '上传素材', materialSet: '素材集', output: '输出预览',
    loop: '循环器', pickFromSet: '从合集获取', textSplit: '文本分割', framePair: '首尾帧',
    resize: '尺寸调整', combine: '合并', removeBg: '抠图', upscale: '放大', gridCrop: '宫格剪裁',
    imageCompare: '图像对比', drawingBoard: '画板', browserNode: '浏览器', frameExtractor: '抽帧',
    storyboardGrid: '分镜网格', cinematic: '电影感', videoMotion: '视频运镜', multiAngleVisual: '多角度',
    idea: '灵感', bp: '蓝图', relay: '中继', edit: '编辑', videoOutput: '视频输出',
    // context providers (webhuabu Phase 5)
    skill: 'Skill', toolset: '工具集',
  }
  return labels[type] || type
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
  // T8 迁入 — 核心
  if (type === 'runninghub') return { ...base, model: 'grok-video-3', prompt: '' } as CanvasNodeData
  if (type === 'runninghubWallet') return { ...base, model: 'grok-video-3', prompt: '' } as CanvasNodeData
  if (type === 'seedance') return { ...base, model: 'seedance-2-0-pro', prompt: '', aspectRatio: '16:9', duration: 5 } as CanvasNodeData
  if (type === 'rhTools') return { ...base, prompt: '' } as CanvasNodeData
  if (type === 'rhConfig') return { ...base, configJson: '' } as CanvasNodeData
  // T8 迁入 — 素材
  if (type === 'upload') return { ...base, uploadType: 'image', fileName: '' } as CanvasNodeData
  if (type === 'materialSet') return { ...base, materialSetKind: 'image', items: [] } as CanvasNodeData
  if (type === 'output') return { ...base, previewKind: 'image' } as CanvasNodeData
  // T8 迁入 — 流程
  if (type === 'loop') return { ...base, mode: 'serial', loopKind: 'image', currentIndex: 0, totalCount: 0, failCount: 0 } as CanvasNodeData
  if (type === 'pickFromSet') return { ...base, pickKind: 'image', pickIndex: 1 } as CanvasNodeData
  if (type === 'textSplit') return { ...base, splitMode: 'line' } as CanvasNodeData
  if (type === 'framePair') return { ...base } as CanvasNodeData
  // T8 迁入 — 图像处理
  if (type === 'resize') return { ...base, targetWidth: 512, targetHeight: 512 } as CanvasNodeData
  if (type === 'combine') return { ...base, layout: 'horizontal' } as CanvasNodeData
  if (type === 'removeBg') return { ...base } as CanvasNodeData
  if (type === 'upscale') return { ...base, scale: 2 } as CanvasNodeData
  if (type === 'gridCrop') return { ...base, rows: 2, cols: 3 } as CanvasNodeData
  if (type === 'imageCompare') return { ...base, mode: 'side-by-side' } as CanvasNodeData
  if (type === 'drawingBoard') return { ...base, strokeColor: '#000000', strokeWidth: 2 } as CanvasNodeData
  if (type === 'browserNode') return { ...base, url: '' } as CanvasNodeData
  if (type === 'frameExtractor') return { ...base, extractTime: 0 } as CanvasNodeData
  // T8 迁入 — 特殊/工具箱
  if (type === 'storyboardGrid') return { ...base, images: [] } as CanvasNodeData
  if (type === 'cinematic') return { ...base } as CanvasNodeData
  if (type === 'videoMotion') return { ...base } as CanvasNodeData
  if (type === 'multiAngleVisual') return { ...base, azimuth: 0, elevation: 0, distance: 5 } as CanvasNodeData
  // T8 迁入 — 辅助
  if (type === 'idea') return { ...base, content: '' } as CanvasNodeData
  if (type === 'bp') return { ...base, content: '' } as CanvasNodeData
  if (type === 'relay') return { ...base } as CanvasNodeData
  if (type === 'edit') return { ...base, editPrompt: '' } as CanvasNodeData
  if (type === 'videoOutput') return { ...base } as CanvasNodeData
  // webhuabu Phase 5: context provider 默认数据
  if (type === 'skill') return { ...base, label: 'Skill', skillId: '', skillName: '', skillContent: '', skillSource: '', applicability: [] } as CanvasNodeData
  if (type === 'toolset') return { ...base, label: '工具集', enabledTools: [] } as CanvasNodeData
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
  const genTypes = new Set(['imageGen', 'videoGen', 'audioGen', 'runninghub', 'runninghubWallet', 'seedance', 'rhTools'])
  const resultTypes = new Set(['imageResult', 'videoResult', 'audioResult'])
  const textTypes = new Set(['text', 'llm', 'file', 'tool', 'idea', 'cinematic', 'videoMotion', 'multiAngleVisual', 'bp', 'output'])
  if (sourceType && genTypes.has(sourceType) && targetType && resultTypes.has(targetType)) return 'generated-output'
  if (sourceType && resultTypes.has(sourceType) && targetType && genTypes.has(targetType)) return 'image-role'
  if (sourceType && textTypes.has(sourceType) && targetType && genTypes.has(targetType)) return 'prompt-order'
  if (sourceType && resultTypes.has(sourceType) && targetType && resultTypes.has(targetType)) return 'media-role'
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
