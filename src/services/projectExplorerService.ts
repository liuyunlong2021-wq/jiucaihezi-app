import type { ProjectFileService } from '@/services/projectFileService'
import { canEditProjectText, type ProjectResource, type ProjectTextRead } from '@/utils/projectResource'

export type ProjectCanvasMediaKind = 'image' | 'video' | 'audio'

export type ProjectResourceOpenResult =
  | { type: 'editor'; resource: ProjectResource; text: ProjectTextRead }
  | { type: 'unsafe-text'; resource: ProjectResource }
  | { type: 'canvas'; resource: ProjectResource }
  | { type: 'media'; resource: ProjectResource; mediaKind: ProjectCanvasMediaKind }
  | { type: 'binary'; resource: ProjectResource }

export function projectCanvasMediaKind(resource: ProjectResource): ProjectCanvasMediaKind {
  if (resource.mimeType?.startsWith('audio/') || /\.(?:mp3|wav|ogg|m4a|flac)$/i.test(resource.path)) return 'audio'
  if (resource.mimeType?.startsWith('video/') || /\.(?:mp4|mov|avi|webm|mkv)$/i.test(resource.path)) return 'video'
  return 'image'
}

export async function openProjectResource(
  fileService: Pick<ProjectFileService, 'readText'>,
  resource: ProjectResource,
): Promise<ProjectResourceOpenResult> {
  if (resource.kind === 'canvas') return { type: 'canvas', resource }
  if (resource.kind === 'media') return { type: 'media', resource, mediaKind: projectCanvasMediaKind(resource) }
  if (resource.kind !== 'document') return { type: 'binary', resource }
  const text = await fileService.readText(resource)
  return canEditProjectText(text)
    ? { type: 'editor', resource, text }
    : { type: 'unsafe-text', resource }
}
