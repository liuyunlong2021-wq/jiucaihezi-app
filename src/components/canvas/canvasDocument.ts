import type {
  CanvasAsset,
  CanvasDocument,
  CanvasDocumentV2,
  CanvasSceneNode,
  PersistedCanvasDocument,
} from '@/types/canvas'

export interface CanvasDocumentInput {
  canvasId: string
  scene: CanvasSceneNode[]
  assets: Record<string, CanvasAsset>
  viewport?: CanvasDocumentV2['viewport']
  updatedAt?: number
  idFactory?: () => string
}

function defaultId(): string {
  return crypto.randomUUID()
}

function normalizeNode(
  node: CanvasSceneNode,
  assets: Record<string, CanvasAsset>,
  idFactory: () => string,
): CanvasSceneNode {
  const id = typeof node.id === 'string' && node.id ? node.id : idFactory()
  const normalized: CanvasSceneNode = { ...node, id }
  const asset = assets[id]

  if (asset && typeof node.url === 'string') normalized.url = asset.path
  if (Array.isArray(node.children)) {
    normalized.children = node.children.map(child => normalizeNode(child, assets, idFactory))
  }

  return normalized
}

export function createCanvasDocument(input: CanvasDocumentInput): CanvasDocumentV2 {
  const idFactory = input.idFactory || defaultId
  for (const asset of Object.values(input.assets)) {
    if (asset.path.startsWith('data:') || asset.path.startsWith('blob:')) {
      throw new Error('画布图片必须先保存到项目媒体目录')
    }
  }
  return {
    version: 2,
    canvasId: input.canvasId,
    updatedAt: input.updatedAt ?? Date.now(),
    viewport: input.viewport || { x: 0, y: 0, zoom: 1 },
    scene: input.scene.map(node => normalizeNode(node, input.assets, idFactory)),
    assets: input.assets,
  }
}

export function isCanvasDocumentV2(document: PersistedCanvasDocument): document is CanvasDocumentV2 {
  return document.version === 2
}

export function migrateCanvasDocument(document: PersistedCanvasDocument): CanvasDocumentV2 {
  if (isCanvasDocumentV2(document)) return createCanvasDocument(document)

  const assets: Record<string, CanvasAsset> = {}
  const scene = document.layers.map(layer => {
    assets[layer.id] = {
      id: layer.id,
      kind: 'image',
      path: layer.path,
      source: layer.source,
      model: layer.model,
      prompt: layer.prompt,
      createdAt: layer.createdAt,
    }
    return {
      tag: 'Image',
      id: layer.id,
      url: layer.path,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      locked: layer.locked,
    }
  })

  return createCanvasDocument({
    canvasId: document.canvasId,
    updatedAt: document.updatedAt,
    viewport: document.viewport,
    scene,
    assets,
  })
}
