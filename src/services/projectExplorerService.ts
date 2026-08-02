import type { ProjectFileService } from '@/services/projectFileService'
import { parseConversationTranscript, type ConversationTranscript } from '@/runtime/memory/conversationTranscript'
import { canEditProjectText, projectTextEditorMode, type ProjectResource, type ProjectTextRead } from '@/utils/projectResource'
import { parseScene3DDocument, type Scene3DDocument } from '@/runtime/memory/scene3d'
import { parseJsonCanvas, type JsonCanvasDocument } from '@/runtime/memory/jsonCanvas'

export type ProjectCanvasMediaKind = 'image' | 'video' | 'audio'
export type ProjectPreviewMediaKind = ProjectCanvasMediaKind | 'model3d'

export type ProjectResourceOpenResult =
  | { type: 'conversation'; resource: ProjectResource; text: ProjectTextRead; transcript: ConversationTranscript }
  | { type: 'editor'; resource: ProjectResource; text: ProjectTextRead; editorMode: 'rich' | 'plain' }
  | { type: 'unsafe-text'; resource: ProjectResource }
  | { type: 'canvas'; resource: ProjectResource }
  | { type: 'project-map'; resource: ProjectResource; text: ProjectTextRead; document: JsonCanvasDocument }
  | { type: 'scene3d'; resource: ProjectResource; text: ProjectTextRead; document: Scene3DDocument }
  | { type: 'media'; resource: ProjectResource; mediaKind: ProjectPreviewMediaKind }
  | { type: 'binary'; resource: ProjectResource }

export function projectCanvasMediaKind(resource: ProjectResource): ProjectCanvasMediaKind {
  if (resource.mimeType?.startsWith('audio/') || /\.(?:mp3|wav|ogg|m4a|flac)$/i.test(resource.path)) return 'audio'
  if (resource.mimeType?.startsWith('video/') || /\.(?:mp4|mov|avi|webm|mkv)$/i.test(resource.path)) return 'video'
  return 'image'
}

export function projectPreviewMediaKind(resource: ProjectResource): ProjectPreviewMediaKind {
  if (resource.mimeType?.startsWith('model/') || /\.(?:glb|gltf)$/i.test(resource.path)) return 'model3d'
  return projectCanvasMediaKind(resource)
}

export async function openProjectResource(
  fileService: Pick<ProjectFileService, 'readText'>,
  resource: ProjectResource,
): Promise<ProjectResourceOpenResult> {
  if (resource.kind === 'canvas') return { type: 'canvas', resource }
  if (resource.kind === 'project-map') {
    const text = await fileService.readText(resource)
    if (!canEditProjectText(text)) return { type: 'unsafe-text', resource }
    try { return { type: 'project-map', resource, text, document: parseJsonCanvas(JSON.parse(text.content)) } }
    catch { return { type: 'editor', resource, text, editorMode: 'plain' } }
  }
  if (resource.kind === 'media') return { type: 'media', resource, mediaKind: projectPreviewMediaKind(resource) }
  if (resource.kind !== 'document') return { type: 'binary', resource }
  const text = await fileService.readText(resource)
  if (/\.jcscene$/i.test(resource.path)) {
    if (text.truncated) return { type: 'unsafe-text', resource }
    try {
      return { type: 'scene3d', resource, text, document: parseScene3DDocument(JSON.parse(text.content)) }
    } catch {
      return { type: 'editor', resource, text, editorMode: 'plain' }
    }
  }
  const transcript = canEditProjectText(text)
    ? parseConversationTranscript(resource.path, text.content)
    : null
  if (transcript) return { type: 'conversation', resource, text, transcript }
  return canEditProjectText(text)
    ? { type: 'editor', resource, text, editorMode: projectTextEditorMode(resource) }
    : { type: 'unsafe-text', resource }
}
