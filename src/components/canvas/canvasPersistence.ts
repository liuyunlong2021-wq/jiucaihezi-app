/**
 * Canvas scene persistence.
 * Desktop and Web both store project-owned documents.
 */
import {
  CANVAS_DIRECTORY,
  canvasDocumentRelativePath,
  canvasFilePath,
  isCanvasPath,
} from '@/components/canvas/canvasDocument'
import { createProjectFileActions } from '@/services/projectFileActions'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { useProjectStore } from '@/stores/projectStore'
import type { CanvasDocumentV3, CanvasMediaKind, CanvasTaskTarget } from '@/types/canvas'
import type { ProjectResource, ProjectResourceRevision } from '@/utils/projectResource'
import { isTauriRuntime } from '@/utils/tauriEnv'

function canvasFileActions() {
  return createProjectFileActions(createRuntimeProjectFileService())
}

export interface CanvasFile {
  path: string
  name: string
}

export type CanvasRestoreResult =
  | { status: 'ready'; document: CanvasDocumentV3 }
  | { status: 'missing' }
  | { status: 'error'; error: Error }

function assertCanvasPath(relativePath: string): void {
  if (!isCanvasPath(relativePath)) throw new Error('画布路径无效')
}

function mediaKind(path: string): CanvasMediaKind {
  if (/\.(mp4|mov|avi|webm|mkv)$/i.test(path)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(path)) return 'audio'
  return 'image'
}

function requireProjectMediaPath(path: string): void {
  const parts = path.split('/')
  if (!path.startsWith('jc-media/') || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('画布结果必须先保存到项目媒体目录')
  }
}

export function applyCanvasTaskResult(document: CanvasDocumentV3, target: CanvasTaskTarget, path: string, updatedAt = Date.now()): CanvasDocumentV3 {
  if (target.canvasId !== document.canvasId) {
    throw new Error('画布目标已失效')
  }
  requireProjectMediaPath(path)
  const next = structuredClone(document)
  const id = crypto.randomUUID()
  const bounds = target.referenceBounds || { x: 80, y: 80, width: 320, height: 240 }
  const kind = mediaKind(path)
  next.assets[id] = {
    id,
    kind,
    resource: { path },
    source: 'creation',
    createdAt: updatedAt,
  }
  next.scene.push({
    tag: kind === 'image' ? 'Image' : kind === 'video' ? 'Group' : 'canvas-audio-card', id,
    ...(kind === 'image' ? { url: path } : kind === 'video' ? { name: 'canvas-video-reference' } : { assetId: id }),
    x: bounds.x + bounds.width + 24, y: bounds.y,
    width: kind === 'video' ? 320 : (bounds.width || 320),
    height: kind === 'video' ? 180 : kind === 'audio' ? 96 : (bounds.height || 240),
  })
  next.updatedAt = updatedAt
  return next
}

function requireWebProjectId(projectId?: string): string {
  const ownerProjectId = projectId ?? useProjectStore().webProjectId.value
  if (!ownerProjectId) throw new Error('请先选择 Web 项目')
  return ownerProjectId
}

function currentTauriProjectRoot(owner?: string): string | undefined {
  return (owner ?? useProjectStore().projectDir.value) || undefined
}

function requireCanvasOwner(owner?: string): string {
  if (!isTauriRuntime()) return requireWebProjectId(owner)
  const projectRoot = currentTauriProjectRoot(owner)
  if (!projectRoot) throw new Error('请先选择项目文件夹')
  return projectRoot
}

function isMissingCanvasFile(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('文件不存在:')
}

export interface CanvasSaveQueue {
  <T>(canvasKey: string, write: () => Promise<T>): Promise<T>
}

export function createCanvasSaveQueue(): CanvasSaveQueue {
  const queues = new Map<string, Promise<unknown>>()

  return <T>(canvasKey: string, write: () => Promise<T>): Promise<T> => {
    const previous = (queues.get(canvasKey) || Promise.resolve()).catch(() => undefined)
    const current = previous.then(write)
    let tracked: Promise<T>
    tracked = current.finally(() => {
      if (queues.get(canvasKey) === tracked) queues.delete(canvasKey)
    })
    queues.set(canvasKey, tracked)
    return tracked
  }
}

const enqueueCanvasSave = createCanvasSaveQueue()

function canvasSaveKey(owner: string, relativePath: string): string {
  return `${owner}:${relativePath}`
}

async function canvasResourceAtPath(owner: string, path: string): Promise<ProjectResource> {
  const resource = (await canvasFileActions().listCanvases(owner)).find(item => item.path === path)
  if (!resource) throw new Error(`文件不存在: ${path}`)
  return resource
}

async function writeCanvas(
  document: CanvasDocumentV3,
  relativePath: string,
  owner: string,
  revision?: ProjectResourceRevision,
  createIfMissing = false,
): Promise<void> {
  const actions = canvasFileActions()
  let resource: ProjectResource
  try {
    resource = await canvasResourceAtPath(owner, relativePath)
  } catch (error) {
    if (!createIfMissing || !isMissingCanvasFile(error)) throw error
    await actions.createCanvasAtPath({ owner, path: relativePath, document })
    return
  }
  const current = revision ? { resource, revision } : await actions.openCanvas(resource)
  const result = await actions.saveCanvas({ resource, document, revision: current.revision })
  if (result.status === 'saved') return
  if (result.status === 'missing') throw new Error(`文件不存在: ${relativePath}`)
  throw new Error('画布文件已被外部修改，请重新打开后再保存')
}

export async function saveCanvas(
  document: CanvasDocumentV3,
  relativePath = canvasDocumentRelativePath(document.canvasId),
  owner?: string,
): Promise<void> {
  assertCanvasPath(relativePath)
  const canvasOwner = requireCanvasOwner(owner)
  const key = canvasSaveKey(canvasOwner, relativePath)
  return enqueueCanvasSave(key, () => writeCanvas(document, relativePath, canvasOwner, undefined, true))
}

type CanvasRawRestoreResult =
  | { status: 'ready'; document: CanvasDocumentV3; resource: ProjectResource; revision: ProjectResourceRevision }
  | { status: 'missing' }
  | { status: 'error'; error: Error }

async function restoreCanvasAtPathRaw(relativePath: string, canvasOwner: string): Promise<CanvasRawRestoreResult> {
  try {
    const result = await canvasFileActions().openCanvas(await canvasResourceAtPath(canvasOwner, relativePath))
    return { status: 'ready', ...result }
  } catch (error) {
    if (isMissingCanvasFile(error)) return { status: 'missing' }
    return { status: 'error', error: error instanceof Error ? error : new Error(String(error)) }
  }
}

export async function restoreCanvasAtPath(relativePath: string, owner?: string): Promise<CanvasRestoreResult> {
  assertCanvasPath(relativePath)
  const canvasOwner = isTauriRuntime() ? currentTauriProjectRoot(owner) : requireWebProjectId(owner)
  if (!canvasOwner) return { status: 'missing' }
  const key = canvasSaveKey(canvasOwner, relativePath)
  return enqueueCanvasSave(key, () => restoreCanvasAtPathRaw(relativePath, canvasOwner))
}

export function restoreCanvas(canvasId: string, owner?: string): Promise<CanvasRestoreResult> {
  return restoreCanvasAtPath(canvasDocumentRelativePath(canvasId), owner)
}

export async function listCanvasFiles(owner?: string): Promise<CanvasFile[]> {
  const canvasOwner = requireCanvasOwner(owner)
  return (await canvasFileActions().listCanvases(canvasOwner))
    .map(resource => ({ path: resource.path, name: resource.path.slice(CANVAS_DIRECTORY.length + 1) }))
}

export async function createCanvasFile(owner?: string): Promise<{ file: CanvasFile; document: CanvasDocumentV3 }> {
  const canvasOwner = requireCanvasOwner(owner)
  const result = await canvasFileActions().createCanvas({ owner: canvasOwner })
  return { file: { path: result.resource.path, name: result.resource.name }, document: result.document }
}

export async function copyCanvasFile(sourcePath: string, owner?: string): Promise<{ file: CanvasFile; document: CanvasDocumentV3 }> {
  assertCanvasPath(sourcePath)
  const canvasOwner = requireCanvasOwner(owner)
  const result = await canvasFileActions().copyCanvas(await canvasResourceAtPath(canvasOwner, sourcePath))
  return { file: { path: result.resource.path, name: result.resource.name }, document: result.document }
}

export async function renameCanvasFile(oldPath: string, name: string, owner?: string): Promise<CanvasFile> {
  assertCanvasPath(oldPath)
  const path = canvasFilePath(name)
  const canvasOwner = requireCanvasOwner(owner)
  if (path === oldPath) return { path, name: path.slice(CANVAS_DIRECTORY.length + 1) }
  const oldKey = canvasSaveKey(canvasOwner, oldPath)
  return enqueueCanvasSave(oldKey, async () => {
    const actions = canvasFileActions()
    if ((await actions.listCanvases(canvasOwner)).some(resource => resource.path === path)) {
      throw new Error('画布名称已存在')
    }
    const resource = await canvasResourceAtPath(canvasOwner, oldPath)
    const renamed = await actions.rename(resource, path.split('/').pop()!)
    return { path: renamed.path, name: renamed.name }
  })
}

export async function deleteCanvasFile(path: string, owner?: string): Promise<void> {
  assertCanvasPath(path)
  const canvasOwner = requireCanvasOwner(owner)
  const key = canvasSaveKey(canvasOwner, path)
  return enqueueCanvasSave(key, async () => {
    await canvasFileActions().remove(await canvasResourceAtPath(canvasOwner, path))
  })
}

export async function writeCanvasTaskResult(
  target: CanvasTaskTarget,
  assetPath: string,
  owner?: string,
): Promise<CanvasDocumentV3> {
  assertCanvasPath(target.canvasPath)
  requireProjectMediaPath(assetPath)
  const canvasOwner = requireCanvasOwner(owner)
  const key = canvasSaveKey(canvasOwner, target.canvasPath)
  return enqueueCanvasSave(key, async () => {
    const result = await restoreCanvasAtPathRaw(target.canvasPath, canvasOwner)
    if (result.status !== 'ready') throw new Error('画布目标已失效')
    const document = applyCanvasTaskResult(result.document, target, assetPath)
    await writeCanvas(document, target.canvasPath, canvasOwner, result.revision)
    return document
  })
}
