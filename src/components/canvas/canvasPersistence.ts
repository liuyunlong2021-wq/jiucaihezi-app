/**
 * Canvas scene persistence.
 * Desktop and Web both store project-owned documents.
 */
import { createCanvasDocument, migrateCanvasDocument } from '@/components/canvas/canvasDocument'
import { useProjectStore } from '@/stores/projectStore'
import type { CanvasDocumentV3, CanvasMediaKind, CanvasTaskTarget, PersistedCanvasDocument } from '@/types/canvas'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { webProjectFiles } from '@/utils/webProjectFiles'

const MAX_CANVAS_BYTES = 30_000_000
const CANVAS_DIRECTORY = 'jc-canvas'

export interface CanvasFile {
  path: string
  name: string
}

export type CanvasRestoreResult =
  | { status: 'ready'; document: CanvasDocumentV3 }
  | { status: 'missing' }
  | { status: 'error'; error: Error }

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

function assertCanvasPath(relativePath: string): void {
  if (!isCanvasPath(relativePath)) throw new Error('画布路径无效')
}

export function nextCanvasFileName(existingNames: string[]): string {
  const existing = new Set(existingNames)
  if (!existing.has('未命名画布.jccanvas')) return '未命名画布.jccanvas'
  let index = 2
  while (existing.has(`未命名画布 ${index}.jccanvas`)) index++
  return `未命名画布 ${index}.jccanvas`
}

export function copyCanvasDocument(document: CanvasDocumentV3, canvasId: string, updatedAt = Date.now()): CanvasDocumentV3 {
  return { ...document, canvasId, updatedAt }
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

function encodeUtf8Base64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

export function parseCanvasDocument(value: string): CanvasDocumentV3 {
  try {
    return migrateCanvasDocument(JSON.parse(value) as PersistedCanvasDocument)
  } catch {
    throw new Error('画布文件格式无效')
  }
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

function canvasTemporaryPath(relativePath: string): string {
  return `${relativePath}.tmp`
}

async function writeCanvas(document: CanvasDocumentV3, relativePath: string, owner: string): Promise<void> {
  const json = JSON.stringify(document)

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const temporaryPath = canvasTemporaryPath(relativePath)
    await invoke('dev_write_file_bytes', {
      input: {
        root: owner,
        relativePath: temporaryPath,
        dataBase64: encodeUtf8Base64(json),
      },
    })
    await invoke('dev_replace_file', {
      input: {
        root: owner,
        temporaryRelativePath: temporaryPath,
        targetRelativePath: relativePath,
      },
    })
    return
  }

  await webProjectFiles.write(owner, relativePath, json)
}

async function createCanvasAtPath(document: CanvasDocumentV3, relativePath: string, owner: string): Promise<void> {
  const key = canvasSaveKey(owner, relativePath)
  return enqueueCanvasSave(key, () => writeCanvas(document, relativePath, owner))
}

export async function saveCanvas(
  document: CanvasDocumentV3,
  relativePath = canvasDocumentRelativePath(document.canvasId),
  owner?: string,
): Promise<void> {
  assertCanvasPath(relativePath)
  const canvasOwner = requireCanvasOwner(owner)
  const key = canvasSaveKey(canvasOwner, relativePath)
  return enqueueCanvasSave(key, () => writeCanvas(document, relativePath, canvasOwner))
}

type CanvasRawRestoreResult =
  | { status: 'ready'; document: CanvasDocumentV3 }
  | { status: 'missing' }
  | { status: 'error'; error: Error }

async function restoreCanvasAtPathRaw(relativePath: string, canvasOwner: string): Promise<CanvasRawRestoreResult> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const exists = await invoke<boolean>('dev_file_exists', {
        input: { root: canvasOwner, relativePath },
      })
      if (!exists) return { status: 'missing' }
      const result = await invoke<{ content: string; truncated: boolean }>('dev_read_file', {
        input: {
          root: canvasOwner,
          relativePath,
          maxBytes: MAX_CANVAS_BYTES,
        },
      })
      if (result?.truncated) throw new Error('画布文件超过 30 MB，无法安全读取')
      if (!result?.content) throw new Error('画布文件为空')
      return { status: 'ready', document: parseCanvasDocument(result.content) }
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error : new Error(String(error)) }
    }
  }

  try {
    const file = await webProjectFiles.read(canvasOwner, relativePath)
    if (file.size > MAX_CANVAS_BYTES || new TextEncoder().encode(file.content).byteLength > MAX_CANVAS_BYTES) {
      throw new Error('画布文件超过 30 MB，无法安全读取')
    }
    if (!file.content) throw new Error('画布文件为空')
    return { status: 'ready', document: parseCanvasDocument(file.content) }
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
  if (isTauriRuntime()) {
    const projectRoot = requireCanvasOwner(owner)
    const { invoke } = await import('@tauri-apps/api/core')
    const entries = await invoke<Array<{ path: string; isDir: boolean }>>('dev_list_files', {
      input: { root: projectRoot, maxEntries: 1000 },
    })
    return entries
      .filter(entry => !entry.isDir && isCanvasPath(entry.path))
      .map(entry => ({ path: entry.path, name: entry.path.slice(CANVAS_DIRECTORY.length + 1) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  const ownerProjectId = requireWebProjectId(owner)
  return (await webProjectFiles.list(ownerProjectId))
    .filter(entry => !entry.isDir && isCanvasPath(entry.path))
    .map(entry => ({ path: entry.path, name: entry.path.slice(CANVAS_DIRECTORY.length + 1) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export async function createCanvasFile(owner?: string): Promise<{ file: CanvasFile; document: CanvasDocumentV3 }> {
  const canvasOwner = requireCanvasOwner(owner)
  const files = await listCanvasFiles(canvasOwner)
  const name = nextCanvasFileName(files.map(file => file.name))
  const document = createCanvasDocument({
    canvasId: crypto.randomUUID(),
    scene: [],
    assets: {},
  })
  const file = { path: canvasFilePath(name), name }
  await createCanvasAtPath(document, file.path, canvasOwner)
  return { file, document }
}

export async function copyCanvasFile(sourcePath: string, owner?: string): Promise<{ file: CanvasFile; document: CanvasDocumentV3 }> {
  assertCanvasPath(sourcePath)
  const canvasOwner = requireCanvasOwner(owner)
  const result = await restoreCanvasAtPath(sourcePath, canvasOwner)
  if (result.status !== 'ready') throw new Error('无法复制画布文件')
  const files = await listCanvasFiles(canvasOwner)
  const name = nextCanvasFileName(files.map(file => file.name))
  const document = copyCanvasDocument(result.document, crypto.randomUUID())
  const file = { path: canvasFilePath(name), name }
  await createCanvasAtPath(document, file.path, canvasOwner)
  return { file, document }
}

export async function renameCanvasFile(oldPath: string, name: string, owner?: string): Promise<CanvasFile> {
  assertCanvasPath(oldPath)
  const path = canvasFilePath(name)
  const canvasOwner = requireCanvasOwner(owner)
  if (path === oldPath) return { path, name: path.slice(CANVAS_DIRECTORY.length + 1) }
  const oldKey = canvasSaveKey(canvasOwner, oldPath)
  return enqueueCanvasSave(oldKey, async () => {
    const destination = await restoreCanvasAtPathRaw(path, canvasOwner)
    if (destination.status === 'ready') throw new Error('画布名称已存在')
    if (destination.status === 'error') throw destination.error

    const source = await restoreCanvasAtPathRaw(oldPath, canvasOwner)
    if (source.status !== 'ready') throw new Error('画布目标已失效')

    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_rename_file', { input: { root: canvasOwner, oldRelativePath: oldPath, newRelativePath: path } })
    } else {
      await webProjectFiles.rename(canvasOwner, oldPath, path.slice(CANVAS_DIRECTORY.length + 1))
    }

    return { path, name: path.slice(CANVAS_DIRECTORY.length + 1) }
  })
}

export async function deleteCanvasFile(path: string, owner?: string): Promise<void> {
  assertCanvasPath(path)
  const canvasOwner = requireCanvasOwner(owner)
  const key = canvasSaveKey(canvasOwner, path)
  return enqueueCanvasSave(key, async () => {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_delete_file', { input: { root: canvasOwner, relativePath: path } })
    } else {
      await webProjectFiles.remove(canvasOwner, path)
    }
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
    await writeCanvas(document, target.canvasPath, canvasOwner)
    return document
  })
}
