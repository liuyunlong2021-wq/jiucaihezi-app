import type { ProjectFileService } from '@/services/projectFileService'
import { parseConversationTranscript, type ConversationTranscript } from '@/runtime/memory/conversationTranscript'
import { canEditProjectText, projectTextEditorMode, type ProjectResource, type ProjectTextRead } from '@/utils/projectResource'

export type ProjectCanvasMediaKind = 'image' | 'video' | 'audio'

export type ProjectResourceOpenResult =
  | { type: 'conversation'; resource: ProjectResource; text: ProjectTextRead; transcript: ConversationTranscript }
  | { type: 'editor'; resource: ProjectResource; text: ProjectTextRead; editorMode: 'rich' | 'plain' }
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
  const transcript = canEditProjectText(text)
    ? parseConversationTranscript(resource.path, text.content)
    : null
  if (transcript) return { type: 'conversation', resource, text, transcript }
  return canEditProjectText(text)
    ? { type: 'editor', resource, text, editorMode: projectTextEditorMode(resource) }
    : { type: 'unsafe-text', resource }
}
