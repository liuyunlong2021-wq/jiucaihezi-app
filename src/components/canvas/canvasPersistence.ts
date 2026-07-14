/**
 * Canvas scene persistence.
 * Desktop and Web both store project-owned documents.
 */
import { createCanvasDocument, migrateCanvasDocument } from '@/components/canvas/canvasDocument'
import { useProjectStore } from '@/stores/projectStore'
import type { CanvasDocumentV2, CanvasTaskTarget, PersistedCanvasDocument } from '@/types/canvas'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { webProjectFiles } from '@/utils/webProjectFiles'

const MAX_CANVAS_BYTES = 30_000_000
const CANVAS_DIRECTORY = 'jc-canvas'

export interface CanvasFile {
  path: string
  name: string
}

export type CanvasRestoreResult =
  | { status: 'ready'; document: CanvasDocumentV2 }
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

function assertCanvasPath(relativePath: string): void {
  const match = new RegExp(`^${CANVAS_DIRECTORY}/([^/\\\\]+)\\.jccanvas$`).exec(relativePath)
  if (!match || match[1] === '.' || match[1] === '..') throw new Error('画布路径无效')
}

export function nextCanvasFileName(existingNames: string[]): string {
  const existing = new Set(existingNames)
  if (!existing.has('未命名画布.jccanvas')) return '未命名画布.jccanvas'
  let index = 2
  while (existing.has(`未命名画布 ${index}.jccanvas`)) index++
  return `未命名画布 ${index}.jccanvas`
}

export function copyCanvasDocument(document: CanvasDocumentV2, canvasId: string, updatedAt = Date.now()): CanvasDocumentV2 {
  return { ...document, canvasId, updatedAt }
}

function mediaKind(path: string): 'image' | 'video' {
  return /\.(mp4|mov|avi|webm|mkv)$/i.test(path) ? 'video' : 'image'
}

function requireProjectMediaPath(path: string): void {
  const parts = path.split('/')
  if (!path.startsWith('jc-media/') || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('画布结果必须先保存到项目媒体目录')
  }
}

export function applyCanvasTaskResult(document: CanvasDocumentV2, target: CanvasTaskTarget, path: string, updatedAt = Date.now()): CanvasDocumentV2 {
  if (target.canvasId !== document.canvasId) {
    throw new Error('画布目标已失效')
  }
  requireProjectMediaPath(path)
  const next = structuredClone(document)
  const id = crypto.randomUUID()
  const bounds = target.referenceBounds || { x: 80, y: 80, width: 320, height: 240 }
  next.assets[id] = {
    id,
    kind: mediaKind(path),
    path,
    source: 'creation',
    createdAt: updatedAt,
  }
  next.scene.push({
    tag: mediaKind(path) === 'video' ? 'Group' : 'Image', id,
    ...(mediaKind(path) === 'image' ? { url: path } : { name: 'canvas-video-reference' }),
    x: bounds.x + bounds.width + 24, y: bounds.y,
    width: mediaKind(path) === 'video' ? 320 : (bounds.width || 320),
    height: mediaKind(path) === 'video' ? 180 : (bounds.height || 240),
  })
  next.updatedAt = updatedAt
  return next
}

async function getProjectDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    const { useProjectStore } = await import('@/stores/projectStore')
    return useProjectStore().projectDir.value || null
  } catch {
    return null
  }
}

function requireWebProjectId(projectId?: string): string {
  const ownerProjectId = projectId ?? useProjectStore().webProjectId.value
  if (!ownerProjectId) throw new Error('请先选择 Web 项目')
  return ownerProjectId
}

function isMissingCanvasFile(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('文件不存在:')
}

function encodeUtf8Base64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

export function parseCanvasDocument(value: string): CanvasDocumentV2 {
  try {
    return migrateCanvasDocument(JSON.parse(value) as PersistedCanvasDocument)
  } catch {
    throw new Error('画布文件格式无效')
  }
}

export function createCanvasSaveQueue() {
  const queues = new Map<string, Promise<void>>()

  return (canvasId: string, write: () => Promise<void>): Promise<void> => {
    const previous = queues.get(canvasId) || Promise.resolve()
    const current = previous.catch(() => undefined).then(write)
    let tracked: Promise<void>
    tracked = current.finally(() => {
      if (queues.get(canvasId) === tracked) queues.delete(canvasId)
    })
    queues.set(canvasId, tracked)
    return tracked
  }
}

const enqueueCanvasSave = createCanvasSaveQueue()

function canvasTemporaryPath(relativePath: string): string {
  return `${relativePath}.tmp`
}

async function writeCanvas(document: CanvasDocumentV2, relativePath: string, projectId?: string): Promise<void> {
  const json = JSON.stringify(document)

  if (isTauriRuntime()) {
    const projectDir = await getProjectDir()
    if (!projectDir) throw new Error('请先选择项目文件夹')

    const { invoke } = await import('@tauri-apps/api/core')
    const temporaryPath = canvasTemporaryPath(relativePath)
    await invoke('dev_write_file_bytes', {
      input: {
        root: projectDir,
        relativePath: temporaryPath,
        dataBase64: encodeUtf8Base64(json),
      },
    })
    await invoke('dev_replace_file', {
      input: {
        root: projectDir,
        temporaryRelativePath: temporaryPath,
        targetRelativePath: relativePath,
      },
    })
    return
  }

  await webProjectFiles.write(requireWebProjectId(projectId), relativePath, json)
}

export async function saveCanvas(
  document: CanvasDocumentV2,
  relativePath = canvasDocumentRelativePath(document.canvasId),
  projectId?: string,
): Promise<void> {
  assertCanvasPath(relativePath)
  if (isTauriRuntime()) return enqueueCanvasSave(relativePath, () => writeCanvas(document, relativePath))

  const ownerProjectId = requireWebProjectId(projectId)
  return enqueueCanvasSave(`${ownerProjectId}:${relativePath}`, () => writeCanvas(document, relativePath, ownerProjectId))
}

export async function restoreCanvasAtPath(relativePath: string, projectId?: string): Promise<CanvasRestoreResult> {
  assertCanvasPath(relativePath)
  if (isTauriRuntime()) {
    const projectDir = await getProjectDir()
    if (!projectDir) return { status: 'missing' }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const exists = await invoke<boolean>('dev_file_exists', {
        input: { root: projectDir, relativePath },
      })
      if (!exists) return { status: 'missing' }
      const result = await invoke<{ content: string; truncated: boolean }>('dev_read_file', {
        input: {
          root: projectDir,
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

  const ownerProjectId = requireWebProjectId(projectId)
  try {
    const file = await webProjectFiles.read(ownerProjectId, relativePath)
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

export function restoreCanvas(canvasId: string): Promise<CanvasRestoreResult> {
  return restoreCanvasAtPath(canvasDocumentRelativePath(canvasId))
}

export async function listCanvasFiles(projectId?: string): Promise<CanvasFile[]> {
  if (isTauriRuntime()) {
    const projectDir = await getProjectDir()
    if (!projectDir) throw new Error('请先选择项目文件夹')
    const { invoke } = await import('@tauri-apps/api/core')
    const entries = await invoke<Array<{ path: string; isDir: boolean }>>('dev_list_files', {
      input: { root: projectDir, maxEntries: 1000 },
    })
    return entries
      .filter(entry => !entry.isDir && entry.path.startsWith(`${CANVAS_DIRECTORY}/`) && entry.path.endsWith('.jccanvas'))
      .map(entry => ({ path: entry.path, name: entry.path.slice(CANVAS_DIRECTORY.length + 1) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  const ownerProjectId = requireWebProjectId(projectId)
  return (await webProjectFiles.list(ownerProjectId))
    .filter(entry => !entry.isDir && entry.path.startsWith(`${CANVAS_DIRECTORY}/`) && entry.path.endsWith('.jccanvas'))
    .filter(entry => !entry.path.slice(CANVAS_DIRECTORY.length + 1).includes('/'))
    .map(entry => ({ path: entry.path, name: entry.path.slice(CANVAS_DIRECTORY.length + 1) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export async function createCanvasFile(projectId?: string): Promise<{ file: CanvasFile; document: CanvasDocumentV2 }> {
  const ownerProjectId = isTauriRuntime() ? undefined : requireWebProjectId(projectId)
  const files = await listCanvasFiles(ownerProjectId)
  const name = nextCanvasFileName(files.map(file => file.name))
  const document = createCanvasDocument({
    canvasId: crypto.randomUUID(),
    scene: [],
    assets: {},
  })
  const file = { path: canvasFilePath(name), name }
  await saveCanvas(document, file.path, ownerProjectId)
  return { file, document }
}

export async function copyCanvasFile(sourcePath: string): Promise<{ file: CanvasFile; document: CanvasDocumentV2 }> {
  assertCanvasPath(sourcePath)
  const projectId = isTauriRuntime() ? undefined : requireWebProjectId()
  const result = await restoreCanvasAtPath(sourcePath, projectId)
  if (result.status !== 'ready') throw new Error('无法复制画布文件')
  const files = await listCanvasFiles(projectId)
  const name = nextCanvasFileName(files.map(file => file.name))
  const document = copyCanvasDocument(result.document, crypto.randomUUID())
  const file = { path: canvasFilePath(name), name }
  await saveCanvas(document, file.path, projectId)
  return { file, document }
}

export async function renameCanvasFile(oldPath: string, name: string): Promise<CanvasFile> {
  assertCanvasPath(oldPath)
  const path = canvasFilePath(name)
  if (isTauriRuntime()) {
    const projectDir = await getProjectDir()
    if (!projectDir) throw new Error('请先选择项目文件夹')
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('dev_rename_file', { input: { root: projectDir, oldRelativePath: oldPath, newRelativePath: path } })
    return { path, name: path.slice(CANVAS_DIRECTORY.length + 1) }
  }

  const ownerProjectId = requireWebProjectId()
  await webProjectFiles.rename(ownerProjectId, oldPath, path.slice(CANVAS_DIRECTORY.length + 1))
  return { path, name: path.slice(CANVAS_DIRECTORY.length + 1) }
}

export async function deleteCanvasFile(path: string): Promise<void> {
  assertCanvasPath(path)
  if (isTauriRuntime()) {
    const projectDir = await getProjectDir()
    if (!projectDir) throw new Error('请先选择项目文件夹')
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('dev_delete_file', { input: { root: projectDir, relativePath: path } })
    return
  }

  await webProjectFiles.remove(requireWebProjectId(), path)
}

export async function writeCanvasTaskResult(
  target: CanvasTaskTarget,
  assetPath: string,
  projectId?: string,
): Promise<CanvasDocumentV2> {
  assertCanvasPath(target.canvasPath)
  requireProjectMediaPath(assetPath)
  const ownerProjectId = isTauriRuntime() ? undefined : requireWebProjectId(projectId)
  const result = await restoreCanvasAtPath(target.canvasPath, ownerProjectId)
  if (result.status !== 'ready') throw new Error('画布目标已失效')
  const document = applyCanvasTaskResult(result.document, target, assetPath)
  await saveCanvas(document, target.canvasPath, ownerProjectId)
  return document
}
