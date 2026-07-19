import { SUPPORTED_TEXT_EXT } from '@/utils/fileProcessor'

export type ProjectResourceKind = 'document' | 'media' | 'canvas' | 'binary'
export type ProjectRuntime = 'desktop' | 'web'
export type ProjectTextEditorMode = 'rich' | 'plain'

export interface ProjectResource {
  runtime: ProjectRuntime
  owner: string
  path: string
  id?: string
  name: string
  isDirectory: boolean
  mimeType?: string
  size?: number
  updatedAt?: number
  kind: ProjectResourceKind
}

export interface ProjectTextContent {
  content: string
  size: number
  truncated: boolean
}

export interface ProjectResourceRevision {
  /** Adapter-owned opaque value. Callers only compare equality. */
  value: string
  size: number
  updatedAt?: number
}

export interface ProjectTextRead extends ProjectTextContent {
  revision: ProjectResourceRevision
}

const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|mp4|mov|avi|webm|mkv|mp3|wav|ogg|m4a|flac)$/i

export function classifyProjectResource(input: Pick<ProjectResource, 'path' | 'mimeType'>): ProjectResourceKind {
  if (/\.jccanvas$/i.test(input.path)) return 'canvas'
  if (input.mimeType?.startsWith('image/') || input.mimeType?.startsWith('video/') || input.mimeType?.startsWith('audio/') || MEDIA_EXT.test(input.path)) return 'media'
  if (input.mimeType?.startsWith('text/') || input.mimeType === 'application/json' || SUPPORTED_TEXT_EXT.test(input.path)) return 'document'
  return 'binary'
}

export function canEditProjectText(input: ProjectTextContent): boolean {
  return !input.truncated && !input.content.includes('\0')
}

export function projectTextEditorMode(resource: Pick<ProjectResource, 'kind' | 'path'>): ProjectTextEditorMode {
  return resource.kind === 'document' && /\.md$/i.test(resource.path) ? 'rich' : 'plain'
}

export function isSameProjectResource(a: ProjectResource | null | undefined, b: ProjectResource | null | undefined): boolean {
  return Boolean(a && b && a.runtime === b.runtime && a.owner === b.owner && a.path === b.path)
}

export function renamedProjectResource(resource: ProjectResource, path: string): ProjectResource {
  const normalized = path.replace(/^\/+/, '')
  return {
    ...resource,
    path: normalized,
    name: normalized.split('/').pop() || normalized,
    kind: resource.isDirectory ? 'binary' : classifyProjectResource({ path: normalized, mimeType: resource.mimeType }),
  }
}
