import type { Edge, Node } from '@vue-flow/core'

export type CanvasNodeType =
  // Core (已有)
  | 'text'
  | 'llm'
  | 'imageGen'
  | 'imageResult'
  | 'audioGen'
  | 'audioResult'
  | 'videoGen'
  | 'videoResult'
  | 'file'
  | 'tool'
  | 'group'
  // T8 迁入 — 核心生成
  | 'runninghub'
  | 'runninghubWallet'
  | 'seedance'
  | 'rhTools'
  | 'rhConfig'
  // T8 迁入 — 素材输入输出
  | 'upload'
  | 'materialSet'
  | 'output'
  // T8 迁入 — 流程控制
  | 'loop'
  | 'pickFromSet'
  | 'textSplit'
  | 'framePair'
  // T8 迁入 — 图像处理
  | 'resize'
  | 'combine'
  | 'removeBg'
  | 'upscale'
  | 'gridCrop'
  | 'imageCompare'
  | 'drawingBoard'
  | 'browserNode'
  | 'frameExtractor'
  // T8 迁入 — 特殊/工具箱
  | 'storyboardGrid'
  | 'cinematic'
  | 'videoMotion'
  | 'multiAngleVisual'
  // T8 迁入 — 辅助
  | 'idea'
  | 'bp'
  | 'relay'
  | 'edit'
  | 'videoOutput'

export type CanvasRunStatus = 'idle' | 'queued' | 'running' | 'generating' | 'submitting' | 'polling' | 'success' | 'error' | 'cancelled'

export type CanvasEdgeKind =
  | 'default'
  | 'prompt-order'
  | 'image-role'
  | 'media-role'
  | 'generated-output'

export type CanvasToolKind = 'tomd' | 'browser-read'

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasNodeBaseData {
  label: string
  status: CanvasRunStatus
  progress?: number
  error?: string
  detail?: string
  fileId?: string
  publicName?: string
  publicEnabled?: boolean
  width?: number
  height?: number
  collapsed?: boolean
  createdAt: number
  updatedAt: number
  /** 允许节点存储任意额外字段（对标 T8 动态 data 模型） */
  [key: string]: any
}

export interface CanvasTextNodeData extends CanvasNodeBaseData {
  content: string
}

export interface CanvasLlmNodeData extends CanvasNodeBaseData {
  modelId: string
  modelProviderId: string
  agentId?: string
  vaultId?: string
  systemPrompt?: string
  prompt: string
  outputContent?: string
  outputFileId?: string
  outputNodeId?: string
}

export interface CanvasImageGenNodeData extends CanvasNodeBaseData {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  size?: string
  imageUrl?: string
  outputNodeId?: string
}

export interface CanvasImageResultNodeData extends CanvasNodeBaseData {
  url: string
  prompt?: string
  model?: string
  taskId?: string
  pollUrl?: string
  pollKind?: 'image' | 'video' | 'audio'
}

export interface CanvasAudioGenNodeData extends CanvasNodeBaseData {
  model: string
  prompt: string
  title?: string
  tags?: string
  negativeTags?: string
  mv?: string
  text?: string
  refText?: string
  voicePrompt?: string
  language?: string
  startTime?: string
  endTime?: string
  outputNodeId?: string
}

export interface CanvasAudioResultNodeData extends CanvasNodeBaseData {
  url?: string
  prompt?: string
  model?: string
  taskId?: string
  pollUrl?: string
  pollKind?: 'image' | 'video' | 'audio'
  sourcePath?: string
}

export interface CanvasVideoGenNodeData extends CanvasNodeBaseData {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  text?: string
  outputWidth?: number
  outputHeight?: number
  value?: number
  outputUrl?: string
  outputNodeId?: string
}

export interface CanvasRunningHubNodeData extends CanvasNodeBaseData {
  model: string
  prompt?: string
  webappId?: string
  nodeInfoList?: any[]
  outputNodeId?: string
}

export interface CanvasSeedanceNodeData extends CanvasNodeBaseData {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  outputNodeId?: string
}

// ===== T8 迁入 — 素材输入输出节点 =====

export interface CanvasUploadNodeData extends CanvasNodeBaseData {
  uploadType?: 'image' | 'video' | 'audio'
  url?: string
  fileName?: string
  mimeType?: string
}

export interface CanvasMaterialSetNodeData extends CanvasNodeBaseData {
  /** 推荐的媒体类型过滤（可选） */
  materialSetKind?: 'image' | 'video' | 'audio' | 'mixed'

  /** 
   * 存储的媒体资产列表（推荐使用新格式）
   * 兼容旧的 string[] 格式
   */
  assets?: import('@/canvas/types/mediaAsset').CanvasMediaAsset[]

  /** 旧格式兼容字段（逐步废弃） */
  items?: string[]
  itemLabels?: string[]
}

export interface CanvasOutputNodeData extends CanvasNodeBaseData {
  // 透传上游任意类型数据
  url?: string
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  outputText?: string
  previewKind?: 'text' | 'image' | 'video' | 'audio'
}

// ===== T8 迁入 — 流程控制节点 =====

export interface CanvasLoopNodeData extends CanvasNodeBaseData {
  mode?: 'serial' | 'parallel'
  loopKind?: 'text' | 'image' | 'video' | 'audio'
  currentIndex?: number
  totalCount?: number
  results?: string[]
  failCount?: number
}

export interface CanvasPickFromSetNodeData extends CanvasNodeBaseData {
  pickKind?: 'text' | 'image' | 'video' | 'audio'
  pickIndex?: number
  currentValue?: string
}

export interface CanvasTextSplitNodeData extends CanvasNodeBaseData {
  splitMode?: 'line' | 'paragraph' | 'custom' | 'storyboard' | 'regex' | 'markdown-heading' | 'numbered' | 'char-chunk'
  separator?: string
  segments?: string[]
  segmentCount?: number
}

export interface CanvasFramePairNodeData extends CanvasNodeBaseData {
  videoUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
}

// ===== T8 迁入 — 图像处理节点（共通过 imageUrl → 处理 → imageUrl）=====

export interface CanvasResizeNodeData extends CanvasNodeBaseData {
  imageUrl?: string
  targetWidth?: number
  targetHeight?: number
  scale?: number
}

export interface CanvasCombineNodeData extends CanvasNodeBaseData {
  imageUrls?: string[]
  layout?: 'horizontal' | 'vertical' | 'grid'
}

export interface CanvasRemoveBgNodeData extends CanvasNodeBaseData {
  imageUrl?: string
}

export interface CanvasUpscaleNodeData extends CanvasNodeBaseData {
  imageUrl?: string
  scale?: number
}

export interface CanvasGridCropNodeData extends CanvasNodeBaseData {
  imageUrl?: string
  rows?: number
  cols?: number
}

export interface CanvasImageCompareNodeData extends CanvasNodeBaseData {
  imageA?: string
  imageB?: string
  mode?: 'slider' | 'side-by-side' | 'overlay' | 'diff'
}

export interface CanvasDrawingBoardNodeData extends CanvasNodeBaseData {
  strokeColor?: string
  strokeWidth?: number
  imageUrl?: string
}

export interface CanvasBrowserNodeData extends CanvasNodeBaseData {
  url?: string
  outputText?: string
  outputImage?: string
}

export interface CanvasFrameExtractorNodeData extends CanvasNodeBaseData {
  videoUrl?: string
  extractTime?: number
  imageUrl?: string
}

// ===== T8 迁入 — 特殊/工具箱节点 =====

export interface CanvasStoryboardGridNodeData extends CanvasNodeBaseData {
  images?: string[]
}

export interface CanvasCinematicNodeData extends CanvasNodeBaseData {
  style?: string
  shot?: string
  lighting?: string
  color?: string
  texture?: string
  favorites?: string
  outputPrompt?: string
}

export interface CanvasVideoMotionNodeData extends CanvasNodeBaseData {
  scene?: string
  action?: string
  path?: string
  rhythm?: string
  stability?: string
  subject?: string
  favorites?: string
  outputPrompt?: string
}

export interface CanvasMultiAngleVisualNodeData extends CanvasNodeBaseData {
  azimuth?: number
  elevation?: number
  distance?: number
  batchAngles?: string
  promptPreset?: string
  outputPrompt?: string
}

// ===== T8 迁入 — 辅助节点 =====

export interface CanvasIdeaNodeData extends CanvasNodeBaseData {
  content: string
  tags?: string
}

export interface CanvasBpNodeData extends CanvasNodeBaseData {
  content: string
  blueprintJson?: string
}

export interface CanvasRelayNodeData extends CanvasNodeBaseData {
  // 透传任意数据，不加工
  passthroughText?: string
  passthroughUrl?: string
}

export interface CanvasEditNodeData extends CanvasNodeBaseData {
  imageUrl?: string
  editPrompt?: string
  outputUrl?: string
}

export interface CanvasVideoOutputNodeData extends CanvasNodeBaseData {
  videoUrl?: string
  posterUrl?: string
}

// rhConfig 节点（隐藏，兼容 T8 老画布）
export interface CanvasRhConfigNodeData extends CanvasNodeBaseData {
  configJson?: string
}

// runninghubWallet / rhTools 复用 runninghub 数据结构
export interface CanvasRunningHubWalletNodeData extends CanvasNodeBaseData {
  model: string
  prompt?: string
  webappId?: string
  nodeInfoList?: any[]
  outputNodeId?: string
}

export interface CanvasRhToolsNodeData extends CanvasNodeBaseData {
  model?: string
  prompt?: string
  webappId?: string
  nodeInfoList?: any[]
  outputNodeId?: string
}

export interface CanvasVideoResultNodeData extends CanvasNodeBaseData {
  url?: string
  prompt?: string
  model?: string
  taskId?: string
  pollUrl?: string
  pollKind?: 'image' | 'video' | 'audio'
}

export interface CanvasFileNodeData extends CanvasNodeBaseData {
  fileId: string
  fileName?: string
  fileCategory?: string
  sourcePath?: string
  contentPreview?: string
}

export interface CanvasGroupNodeData extends CanvasNodeBaseData {
  color?: string
}

export interface CanvasToolNodeData extends CanvasNodeBaseData {
  toolKind: CanvasToolKind
  input?: string
  outputContent?: string
  outputFileId?: string
  outputPath?: string
}

export type CanvasNodeData =
  | CanvasTextNodeData
  | CanvasLlmNodeData
  | CanvasImageGenNodeData
  | CanvasImageResultNodeData
  | CanvasAudioGenNodeData
  | CanvasAudioResultNodeData
  | CanvasVideoGenNodeData
  | CanvasVideoResultNodeData
  | CanvasFileNodeData
  | CanvasToolNodeData
  | CanvasGroupNodeData
  // T8 迁入
  | CanvasRunningHubNodeData
  | CanvasRunningHubWalletNodeData
  | CanvasRhToolsNodeData
  | CanvasRhConfigNodeData
  | CanvasSeedanceNodeData
  | CanvasUploadNodeData
  | CanvasMaterialSetNodeData
  | CanvasOutputNodeData
  | CanvasLoopNodeData
  | CanvasPickFromSetNodeData
  | CanvasTextSplitNodeData
  | CanvasFramePairNodeData
  | CanvasResizeNodeData
  | CanvasCombineNodeData
  | CanvasRemoveBgNodeData
  | CanvasUpscaleNodeData
  | CanvasGridCropNodeData
  | CanvasImageCompareNodeData
  | CanvasDrawingBoardNodeData
  | CanvasBrowserNodeData
  | CanvasFrameExtractorNodeData
  | CanvasStoryboardGridNodeData
  | CanvasCinematicNodeData
  | CanvasVideoMotionNodeData
  | CanvasMultiAngleVisualNodeData
  | CanvasIdeaNodeData
  | CanvasBpNodeData
  | CanvasRelayNodeData
  | CanvasEditNodeData
  | CanvasVideoOutputNodeData

export interface CanvasEdgeData {
  kind: CanvasEdgeKind
  order?: number
  role?: 'reference' | 'first_frame' | 'last_frame' | 'voice' | 'music'
  createdAt: number
}

export type CanvasNode = Node<CanvasNodeData, any, CanvasNodeType> & {
  type: CanvasNodeType
  data: CanvasNodeData
  selected?: boolean
  zIndex?: number
}
export type CanvasEdge = Edge<CanvasEdgeData, any>

export interface CanvasDocumentV1 {
  version: 1
  id: string
  title: string
  updatedAt: number
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
}

export const CANVAS_DOCUMENT_KEY = 'jc_canvas_document_v1'
