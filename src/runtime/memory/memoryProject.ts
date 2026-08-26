import {
  createRuntimeProjectFileService,
  flattenProjectResourceChange,
  type ProjectFileService,
} from '@/services/projectFileService'
import { executeWikiAction, type WikiWorkspace } from '@/runtime/direct/wikiRuntime'
import type { ProjectResource } from '@/utils/projectResource'
import {
  MEMORY_MEDIA_DIRECTORIES,
  MEMORY_PROJECT_SKELETON_DIRECTORIES,
  memoryMediaDirectoryFor,
} from '@/utils/memoryProjectPaths'

import {
  CONVERSATION_DIRECTORY,
  appendConversationTurn,
  createConversationTranscript,
  parseConversationTranscript,
  replaceConversationTurnAndTruncate,
  remapConversationAttachmentPaths,
  renameConversationTranscript,
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
  if (initialized) {
    await ensureMemoryDirectories(owner, files, resources)
    await migrateLegacyMemoryMaterials(owner, files)
  }
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
  await ensureMemoryDirectories(owner, files)
  await migrateLegacyMemoryMaterials(owner, files)
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

export async function appendMemoryRound(
  resource: ProjectResource,
  userTurn: ConversationTurn,
  assistantContent: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
  title?: string,
): Promise<MemoryConversation> {
  if (userTurn.role !== 'user') throw new Error('本轮消息必须来自用户')
  const assistantTurn: ConversationTurn = {
    id: uniqueId('turn'),
    role: 'assistant',
    content: String(assistantContent || '').trim(),
    createdAt: new Date().toISOString(),
  }
  return mutateConversation(resource, files, current => {
    const transcript = parseConversationTranscript(resource.path, current)
    if (transcript?.turns.some(turn => turn.id === userTurn.id)) return current
    const complete = appendConversationTurn(appendConversationTurn(current, userTurn), assistantTurn)
    return title ? renameConversationTranscript(complete, title) : complete
  })
}

export async function replaceMemoryRound(
  resource: ProjectResource,
  targetTurnId: string,
  userTurn: ConversationTurn,
  assistantContent: string,
  files: ProjectFileService = createRuntimeProjectFileService(),
  title?: string,
): Promise<MemoryConversation> {
  const assistantTurn: ConversationTurn = {
    id: uniqueId('turn'), role: 'assistant', content: String(assistantContent || '').trim(), createdAt: new Date().toISOString(),
  }
  return mutateConversation(resource, files, current => {
    const next = replaceConversationTurnAndTruncate(current, targetTurnId, userTurn, assistantTurn)
    return title ? renameConversationTranscript(next, title) : next
  })
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
    const transcript = parseConversationTranscript(resource.path, current.content)
    if (!transcript) throw new Error('选择的文件不是有效对话记录')
    const content = update(current.content)
    if (content === current.content) return { resource, transcript }
    const result = await files.writeText(resource, content, current.revision)
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
    async fingerprint() {
      throw new Error('初始化过程不支持来源指纹')
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

async function ensureMemoryDirectories(
  owner: string,
  files: ProjectFileService,
  current?: ProjectResource[],
): Promise<void> {
  const existing = new Set((current || await files.list(owner))
    .filter(resource => resource.isDirectory).map(resource => resource.path))
  for (const path of MEMORY_PROJECT_SKELETON_DIRECTORIES) {
    if (!existing.has(path)) await files.createFolder(owner, path)
  }
}

async function migrateLegacyMemoryMaterials(owner: string, files: ProjectFileService): Promise<void> {
  const resources = await files.list(owner)
  const directories = new Map(resources.filter(resource => resource.isDirectory).map(resource => [resource.path, resource]))
  const groups = new Map<string, ProjectResource[]>()
  const movedPaths = new Map<string, string>()
  for (const resource of resources) {
    if (resource.isDirectory) continue
    const target = legacyMaterialTarget(resource)
    if (target) groups.set(target, [...(groups.get(target) || []), resource])
  }
  for (const [target, sources] of groups) {
    const directory = directories.get(target)
    if (!directory) throw new Error(`素材目录不存在: ${target}`)
    const plan = await files.planBatch({ kind: 'move', resources: sources, targetDirectory: directory })
    const result = await files.executeBatch(plan, 'keep-both')
    if (result.failures.length) throw new Error(result.failures[0]!.message)
    if (result.change) {
      for (const change of flattenProjectResourceChange(result.change)) {
        if (change.type === 'renamed') movedPaths.set(change.oldResource.path, change.resource.path)
      }
    }
  }
  if (movedPaths.size) {
    for (const conversation of await listMemoryConversations(owner, files)) {
      await mutateConversation(conversation.resource, files, current =>
        remapConversationAttachmentPaths(conversation.resource.path, current, movedPaths),
      )
    }
  }

  const after = await files.list(owner)
  const paths = new Set(after.map(resource => resource.path))
  for (const path of [
    'jc-materials/originals', 'jc-materials/markdown', 'jc-materials',
    'jc-media/uploads', 'jc-media/images', 'jc-media/videos', 'jc-media/audios', 'jc-media',
  ]) {
    const directory = after.find(resource => resource.isDirectory && resource.path === path)
    if (!directory || [...paths].some(item => item.startsWith(`${path}/`))) continue
    await files.remove(directory)
    paths.delete(path)
  }
}

function legacyMaterialTarget(resource: ProjectResource): string | null {
  if (resource.path.startsWith('jc-materials/')) return MEMORY_MEDIA_DIRECTORIES.document
  if (resource.path.startsWith('jc-media/images/')) return MEMORY_MEDIA_DIRECTORIES.image
  if (resource.path.startsWith('jc-media/videos/')) return MEMORY_MEDIA_DIRECTORIES.video
  if (resource.path.startsWith('jc-media/audios/')) return MEMORY_MEDIA_DIRECTORIES.audio
  if (!resource.path.startsWith('jc-media/uploads/')) return null
  return memoryMediaDirectoryFor(resource.path, resource.mimeType)
}
