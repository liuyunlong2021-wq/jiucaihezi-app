import type { Edge, Node } from '@vue-flow/core'

export type CanvasNodeType =
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

export type CanvasRunStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled'

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
  imageUrl?: string
  outputNodeId?: string
}

export interface CanvasImageResultNodeData extends CanvasNodeBaseData {
  url: string
  prompt?: string
  model?: string
}

export interface CanvasAudioGenNodeData extends CanvasNodeBaseData {
  model: string
  prompt: string
  outputNodeId?: string
}

export interface CanvasAudioResultNodeData extends CanvasNodeBaseData {
  url?: string
  prompt?: string
  model?: string
  taskId?: string
  sourcePath?: string
}

export interface CanvasVideoGenNodeData extends CanvasNodeBaseData {
  model: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  imageUrl?: string
  outputUrl?: string
  outputNodeId?: string
}

export interface CanvasVideoResultNodeData extends CanvasNodeBaseData {
  url?: string
  prompt?: string
  model?: string
  taskId?: string
  pollUrl?: string
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
