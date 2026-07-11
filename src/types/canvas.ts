/** 画布上的一个图层 */
export interface CanvasLayer {
  id: string
  /** 文件路径（jc-media/images/xxx.png 或远程 URL） */
  path: string
  /** 在画布上的位置 */
  x: number
  y: number
  /** 图片实际尺寸 */
  width: number
  height: number
  /** 显示标签 */
  label: string
  /** 来源 */
  source: 'creation' | 'drop' | 'paste'
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
