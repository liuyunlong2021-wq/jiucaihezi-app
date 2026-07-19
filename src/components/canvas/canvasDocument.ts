import type {
  CanvasAsset,
  CanvasDocument,
  CanvasDocumentV2,
  CanvasDocumentV3,
  CanvasSceneNode,
  PersistedCanvasDocument,
} from '@/types/canvas'
import type { ProjectResourceRevision } from '@/utils/projectResource'

export interface CanvasDocumentInput {
  canvasId: string
  scene: CanvasSceneNode[]
  assets: Record<string, CanvasAsset | CanvasDocumentV2['assets'][string]>
  viewport?: CanvasDocumentV3['viewport']
  updatedAt?: number
  idFactory?: () => string
}

export const CANVAS_DIRECTORY = 'jc-canvas'

export function canvasDocumentRelativePath(canvasId: string): string {
  return `${CANVAS_DIRECTORY}/${canvasId}.jccanvas`
}

export function canvasDocumentTemporaryPath(canvasId: string): string {
  return `${canvasDocumentRelativePath(canvasId)}.tmp`
}

export function canvasFilePath(name: string): string {
  const baseName = name.trim().replace(/\.jccanvas$/i, '')
  if (!baseName || baseName === '.' || baseName === '..' || /[\\/]/.test(baseName)) {
    throw new Error('画布名称无效')
  }
  return `${CANVAS_DIRECTORY}/${baseName}.jccanvas`
}

export function isCanvasPath(relativePath: string): boolean {
  const match = new RegExp(`^${CANVAS_DIRECTORY}/([^/\\\\]+)\\.jccanvas$`).exec(relativePath)
  return Boolean(match && match[1] !== '.' && match[1] !== '..')
}

export function nextCanvasFileName(existingNames: string[]): string {
  const existing = new Set(existingNames)
  if (!existing.has('未命名画布.jccanvas')) return '未命名画布.jccanvas'
  let index = 2
  while (existing.has(`未命名画布 ${index}.jccanvas`)) index++
  return `未命名画布 ${index}.jccanvas`
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

  if (asset?.kind === 'image' && typeof node.url === 'string') normalized.url = asset.resource.path
  if (Array.isArray(node.children)) {
    normalized.children = node.children.map(child => normalizeNode(child, assets, idFactory))
  }

  return normalized
}

function assertProjectRelativePath(path: string): void {
  const parts = path.split('/')
  if (!path || path.startsWith('/') || path.includes('\\') || path.startsWith('data:') || path.startsWith('blob:') || /^https?:/i.test(path) || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('画布素材必须使用项目相对路径')
  }
}

function normalizeRevision(revision: unknown): ProjectResourceRevision | undefined {
  if (revision === undefined) return undefined
  if (!revision || typeof revision !== 'object') throw new Error('画布素材版本无效')
  const value = (revision as ProjectResourceRevision).value
  const size = (revision as ProjectResourceRevision).size
  const updatedAt = (revision as ProjectResourceRevision).updatedAt
  if (!value || typeof value !== 'string' || !Number.isFinite(size) || size < 0 || (updatedAt !== undefined && !Number.isFinite(updatedAt))) {
    throw new Error('画布素材版本无效')
  }
  return { value, size, ...(updatedAt === undefined ? {} : { updatedAt }) }
}

function normalizeAsset(asset: CanvasAsset | CanvasDocumentV2['assets'][string]): CanvasAsset {
  const resource = 'resource' in asset ? asset.resource : { path: asset.path }
  const revision = normalizeRevision(resource.revision)
  assertProjectRelativePath(resource.path)
  if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') {
    throw new Error('画布素材类型无效')
  }
  return {
    ...asset,
    resource: {
      ...(resource.id ? { id: resource.id } : {}),
      ...(revision ? { revision } : {}),
      path: resource.path,
    },
  }
}

export function createCanvasDocument(input: CanvasDocumentInput): CanvasDocumentV3 {
  const idFactory = input.idFactory || defaultId
  const assets = Object.fromEntries(Object.entries(input.assets).map(([id, asset]) => [id, normalizeAsset(asset)]))
  return {
    version: 3,
    canvasId: input.canvasId,
    updatedAt: input.updatedAt ?? Date.now(),
    viewport: input.viewport || { x: 0, y: 0, zoom: 1 },
    scene: input.scene.map(node => normalizeNode(node, assets, idFactory)),
    assets,
  }
}

export function isCanvasDocumentV2(document: PersistedCanvasDocument): document is CanvasDocumentV2 {
  return document.version === 2
}

export function isCanvasDocumentV3(document: PersistedCanvasDocument): document is CanvasDocumentV3 {
  return document.version === 3
}

export function migrateCanvasDocument(document: PersistedCanvasDocument): CanvasDocumentV3 {
  if (isCanvasDocumentV3(document) || isCanvasDocumentV2(document)) return createCanvasDocument(document)

  const assets: Record<string, CanvasDocumentV2['assets'][string]> = {}
  const scene = document.layers.map(layer => {
    const kind = layer.kind === 'video' ? 'video' : 'image'
    assets[layer.id] = {
      id: layer.id,
      kind,
      path: layer.path,
      source: layer.source,
      model: layer.model,
      prompt: layer.prompt,
      createdAt: layer.createdAt,
    }
    return {
      tag: kind === 'video' ? 'Group' : 'Image',
      id: layer.id,
      ...(kind === 'video' ? { name: 'canvas-video-reference' } : { url: layer.path }),
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

export function parseCanvasDocument(value: string): CanvasDocumentV3 {
  try {
    return migrateCanvasDocument(JSON.parse(value) as PersistedCanvasDocument)
  } catch {
    throw new Error('画布文件格式无效')
  }
}

export function copyCanvasDocument(document: CanvasDocumentV3, canvasId: string, updatedAt = Date.now()): CanvasDocumentV3 {
  return { ...document, canvasId, updatedAt }
}

export function unreferencedCanvasAssetIds(scene: CanvasSceneNode[], candidateIds: Iterable<string>): string[] {
  const candidates = new Set(candidateIds)
  const referenced = new Set<string>()
  const visit = (node: CanvasSceneNode) => {
    if (typeof node.id === 'string' && candidates.has(node.id)) referenced.add(node.id)
    if (typeof node.assetId === 'string' && candidates.has(node.assetId)) referenced.add(node.assetId)
    node.children?.forEach(visit)
  }
  scene.forEach(visit)
  return [...candidates].filter(id => !referenced.has(id))
}
