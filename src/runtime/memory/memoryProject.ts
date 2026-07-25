import {
  createRuntimeProjectFileService,
  type ProjectFileService,
} from '@/services/projectFileService'
import { executeWikiAction, type WikiWorkspace } from '@/runtime/direct/wikiRuntime'
import type { ProjectResource } from '@/utils/projectResource'

import {
  CONVERSATION_DIRECTORY,
  appendConversationTurn,
  createConversationTranscript,
  parseConversationTranscript,
  renameConversationTranscript,
  type ConversationAttachment,
  type ConversationTranscript,
  type ConversationTurn,
} from './conversationTranscript'

const MAX_WRITE_ATTEMPTS = 3

export interface MemoryConversation {
  resource: ProjectResource
  transcript: ConversationTranscript
}

export interface MemoryProjectState {
  initialized: boolean
  conversations: MemoryConversation[]
}

export async function inspectMemoryProject(
  owner: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
): Promise<MemoryProjectState> {
  const resources = await files.list(owner)
  const hasTree = (path: string) => resources.some(resource => resource.path === path || resource.path.startsWith(`${path}/`))
  const initialized = (hasTree('wiki') || hasTree('docs/wiki')) && hasTree(CONVERSATION_DIRECTORY)
  return {
    initialized,
    conversations: initialized ? await listMemoryConversations(owner, files) : [],
  }
}

export async function initializeMemoryProject(
  owner: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
): Promise<void> {
  await executeWikiAction(wikiWorkspace(owner, files), { action: 'scaffold', type: 'generic' })
  await files.createFolder(owner, CONVERSATION_DIRECTORY)
}

export async function listMemoryConversations(
  owner: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
): Promise<MemoryConversation[]> {
  const resources = await files.list(owner)
  const conversations = await Promise.all(resources
    .filter(resource => !resource.isDirectory && resource.path.startsWith(`${CONVERSATION_DIRECTORY}/`))
    .map(async resource => {
      try {
        const text = await files.readText(resource)
        const transcript = parseConversationTranscript(resource.path, text.content)
        return transcript ? { resource, transcript } : null
      } catch {
        return null
      }
    }))
  return conversations
    .filter((value): value is MemoryConversation => Boolean(value))
    .sort((left, right) => left.transcript.createdAt.localeCompare(right.transcript.createdAt))
}

export async function createMemoryConversation(
  owner: string,
  title = '新对话',
  files: ProjectFileService = createRuntimeProjectFileService(),
): Promise<MemoryConversation> {
  await files.createFolder(owner, CONVERSATION_DIRECTORY)
  const id = uniqueId('conversation')
  const path = `${CONVERSATION_DIRECTORY}/${id}.md`
  const resource = await files.createText(owner, path, createConversationTranscript(id, title))
  return loadMemoryConversation(resource, files)
}

export async function loadMemoryConversation(
  resource: ProjectResource,
  files: ProjectFileService = createRuntimeProjectFileService(),
): Promise<MemoryConversation> {
  const text = await files.readText(resource)
  const transcript = parseConversationTranscript(resource.path, text.content)
  if (!transcript) throw new Error('选择的文件不是有效对话记录')
  return { resource, transcript }
}

export async function appendMemoryTurn(
  resource: ProjectResource,
  role: ConversationTurn['role'],
  content: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
  attachments?: ConversationAttachment[],
  mode?: ConversationTurn['mode'],
): Promise<MemoryConversation> {
  const turn: ConversationTurn = {
    id: uniqueId('turn'),
    role,
    content: String(content || '').trim(),
    createdAt: new Date().toISOString(),
    attachments: attachments?.length ? attachments : undefined,
    mode,
  }
  return mutateConversation(resource, files, current => appendConversationTurn(current, turn))
}

export async function renameMemoryConversation(
  resource: ProjectResource,
  title: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
): Promise<MemoryConversation> {
  return mutateConversation(resource, files, current => renameConversationTranscript(current, title))
}

async function mutateConversation(
  resource: ProjectResource,
  files: ProjectFileService,
  update: (content: string) => string,
): Promise<MemoryConversation> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await files.readText(resource)
    if (!parseConversationTranscript(resource.path, current.content)) {
      throw new Error('选择的文件不是有效对话记录')
    }
    const result = await files.writeText(resource, update(current.content), current.revision)
    if (result.status === 'saved') return loadMemoryConversation(resource, files)
    if (result.status === 'missing') throw new Error('对话记录已被删除')
  }
  throw new Error('对话记录正在其他窗口更新，请重试')
}

function wikiWorkspace(owner: string, files: ProjectFileService): WikiWorkspace {
  return {
    async list() {
      return (await files.list(owner)).map(resource => ({
        path: resource.path,
        isDir: resource.isDirectory,
      }))
    },
    async read(path) {
      const resource = await findResource(owner, path, files)
      return (await files.readText(resource)).content
    },
    async write(path, content) {
      const existing = (await files.list(owner)).find(resource => resource.path === path)
      if (!existing) {
        await files.createText(owner, path, content)
        return
      }
      const current = await files.readText(existing)
      const result = await files.writeText(existing, content, current.revision)
      if (result.status !== 'saved') throw new Error(`Wiki 文件写入冲突: ${path}`)
    },
    async createDirectory(path) {
      await files.createFolder(owner, path)
    },
  }
}

async function findResource(owner: string, path: string, files: ProjectFileService): Promise<ProjectResource> {
  const resource = (await files.list(owner)).find(item => item.path === path)
  if (!resource || resource.isDirectory) throw new Error(`文件不存在: ${path}`)
  return resource
}

function uniqueId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}
