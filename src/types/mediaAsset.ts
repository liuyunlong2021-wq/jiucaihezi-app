export type MediaAssetKind = 'image' | 'video' | 'audio'

export type MediaAssetOrigin =
  | 'creation-panel'
  | 'canvas'
  | 'chat'
  | 'upload'
  | 'import'

export interface MediaAsset {
  id: string
  kind: MediaAssetKind
  name: string
  mimeType: string
  localFileId?: string
  localPath?: string
  originalUrl?: string
  prompt?: string
  model?: string
  provider?: string
  taskId?: string
  origin: MediaAssetOrigin
  parentAssetIds?: string[]
  params?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface SendMediaAssetToCanvasPayload {
  id: string
  fileId?: string
  taskId?: string
  kind: MediaAssetKind
  name: string
  url: string
  prompt?: string
  model?: string
}
