import type { ProjectResourceRevision } from '@/utils/projectResource'

/** 画布上的一个图层 */
export interface CanvasLayer {
  id: string
  /** 文件路径（jc-media/images/xxx.png 或远程 URL） */
  path: string
  /** 在画布上的位置 */
  x: number
  y: number
  /** 素材类型 */
  kind?: CanvasMediaKind
  /** 素材实际尺寸 */
  width: number
  height: number
  /** 显示标签 */
  label: string
  /** 来源 */
  source: 'creation' | 'drop' | 'paste' | 'import'
  /** 生成模型（creation 来源时） */
  model?: string
  /** 生成 prompt（creation 来源时） */
  prompt?: string
  /** 是否锁定 */
  locked: boolean
  createdAt: number
}

/** 标注数据（Phase 1+ 使用） */
export interface CanvasAnnotation {
  id: string
  type: 'arrow' | 'brush' | 'text' | 'rect'
  targetLayerId: string
  text?: string
  points: { x: number; y: number }[]
  color: string
  strokeWidth: number
}

/** 画布持久化 JSON */
export interface CanvasDocument {
  version: 1
  canvasId: string
  updatedAt: number
  viewport: { x: number; y: number; zoom: number }
  layers: CanvasLayer[]
  annotations: CanvasAnnotation[]
}

export interface CanvasSceneNode {
  id?: string
  tag?: string
  url?: string
  children?: CanvasSceneNode[]
  [key: string]: unknown
}

export type CanvasMediaKind = 'image' | 'video' | 'audio'

export interface CanvasAssetRef {
  /** Project-relative path. Desktop absolute paths and runtime URLs are never persisted. */
  path: string
  /** Stable Web project-file id when one is available. */
  id?: string
  revision?: ProjectResourceRevision
}

export interface CanvasAsset {
  id: string
  kind: CanvasMediaKind
  resource: CanvasAssetRef
  source: CanvasLayer['source']
  model?: string
  prompt?: string
  mimeType?: string
  /** Keep the user's layout when its referenced project media has been deleted. */
  missing?: boolean
  duration?: number
  width?: number
  height?: number
  parentAssetId?: string
  createdAt: number
}

/** V2 persisted asset, kept only for document migration. */
export interface CanvasAssetV2 {
  id: string
  kind: 'image' | 'video'
  path: string
  source: CanvasLayer['source']
  model?: string
  prompt?: string
  duration?: number
  width?: number
  height?: number
  parentAssetId?: string
  createdAt: number
}

export interface CanvasDocumentV2 {
  version: 2
  canvasId: string
  updatedAt: number
  viewport: { x: number; y: number; zoom: number }
  scene: CanvasSceneNode[]
  assets: Record<string, CanvasAssetV2>
}

export interface CanvasDocumentV3 {
  version: 3
  canvasId: string
  updatedAt: number
  viewport: { x: number; y: number; zoom: number }
  scene: CanvasSceneNode[]
  assets: Record<string, CanvasAsset>
}

export interface CanvasTaskTarget {
  canvasId: string
  canvasPath: string
  /** Immutable project root (Desktop) or project ID (Web); absent only on legacy persisted tasks. */
  owner?: string
  operation: 'append'
  referenceNodeIds: string[]
  referenceBounds?: { x: number; y: number; width: number; height: number }
}

export type PersistedCanvasDocument = CanvasDocument | CanvasDocumentV2 | CanvasDocumentV3
