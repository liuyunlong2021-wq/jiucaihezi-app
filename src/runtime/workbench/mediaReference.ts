import { resolveProductDefaultModelId, type MediaPlan } from './mediaPlan'
import type { ProjectResource } from '@/utils/projectResource'

export type MediaReferenceKind = 'image' | 'video'
export type MediaReferenceSource = 'attachment' | 'project' | 'canvas' | 'task'

export interface MediaReference {
  id: string
  kind: MediaReferenceKind
  source: MediaReferenceSource
  label: string
  value: string
  explicit: boolean
  invalidReason?: string
  locator:
    | { type: 'attachment'; messageId: string; index: number }
    | { type: 'project'; runtime: 'desktop' | 'web'; owner: string; path: string; id?: string }
    | { type: 'task'; taskId: string }
}

export interface MediaContextSnapshot {
  owner: string
  sessionId: string
  references: MediaReference[]
}

type ProjectMediaChange =
  | { type: 'renamed'; oldResource: ProjectResource; resource: ProjectResource }
  | { type: 'deleted'; resource: ProjectResource }

type ProjectReferenceLocator = Extract<MediaReference['locator'], { type: 'project' }>
interface MediaReferenceResolvers {
  readProject: (locator: ProjectReferenceLocator) => Promise<string>
  readTask: (taskId: string) => Promise<string>
}

export async function refreshMediaReferenceValues(
  references: MediaReference[],
  resolvers: MediaReferenceResolvers,
): Promise<MediaReference[]> {
  return Promise.all(
    references.map(async reference => {
      let value = reference.value
      if (reference.locator.type === 'project') {
        value = await resolvers.readProject(reference.locator)
      } else if (reference.locator.type === 'task') {
        value = await resolvers.readTask(reference.locator.taskId)
      }
      if (!value) throw new Error(`参考素材已失效：${reference.label}`)
      return { ...reference, value, invalidReason: undefined }
    }),
  )
}

export async function refreshMediaPlanReferenceValues(
  plan: MediaPlan,
  resolvers: MediaReferenceResolvers,
): Promise<MediaPlan> {
  if (!plan.mediaReferences) return plan
  const references = await refreshMediaReferenceValues(plan.mediaReferences, resolvers)
  return withMediaReferences(plan, references)
}

export function withMediaReferences(plan: MediaPlan, references: MediaReference[]): MediaPlan {
  const next: MediaPlan = {
    ...plan,
    mediaReferences: references,
    referenceImages: references
      .filter(reference => reference.kind === 'image')
      .map(reference => reference.value),
    referenceVideos: references
      .filter(reference => reference.kind === 'video')
      .map(reference => reference.value),
  }
  return plan.usesProductDefaultModel
    ? { ...next, modelId: resolveProductDefaultModelId(next) }
    : next
}

export function reconcileProjectMediaReferences(
  references: MediaReference[],
  change: ProjectMediaChange,
): MediaReference[] {
  const previous = change.type === 'renamed' ? change.oldResource : change.resource
  return references.map(reference => {
    const locator = reference.locator
    if (
      locator.type !== 'project' ||
      locator.runtime !== previous.runtime ||
      locator.owner !== previous.owner ||
      locator.path !== previous.path
    ) {
      return reference
    }
    if (change.type === 'deleted') return { ...reference, invalidReason: '项目素材已删除' }
    return {
      ...reference,
      label: change.resource.name,
      invalidReason: undefined,
      locator: {
        type: 'project',
        runtime: change.resource.runtime,
        owner: change.resource.owner,
        path: change.resource.path,
        id: change.resource.id,
      },
    }
  })
}

const MEDIA_PATH = /\.(?:png|jpe?g|gif|webp|mp4|mov|avi|webm|mkv)$/i

export function extractProjectMediaReferencePaths(text: string): string[] {
  const explicit = [...String(text || '').matchAll(/@\{([^}]+)\}/g)]
    .map(match => match[1].trim())
    .filter(path => MEDIA_PATH.test(path))
  if (explicit.length) return [...new Set(explicit)]

  const exact = String(text || '').trim()
  return MEDIA_PATH.test(exact) && /[\\/]/.test(exact) ? [exact] : []
}

export function normalizeProjectMediaReferencePath(
  rawPath: string,
  owner: string,
  runtime: 'desktop' | 'web',
): string | null {
  const path = String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
  const root = String(owner || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  const absolute = path.startsWith('/') || /^[a-z]:\//i.test(path)
  let relative = path

  if (absolute) {
    if (runtime !== 'desktop' || !root) return null
    const windows = /^[a-z]:\//i.test(path) && /^[a-z]:\//i.test(root)
    const comparablePath = windows ? path.toLowerCase() : path
    const comparableRoot = windows ? root.toLowerCase() : root
    if (!comparablePath.startsWith(`${comparableRoot}/`)) return null
    relative = path.slice(root.length + 1)
  }

  relative = relative.replace(/^\.\//, '').replace(/^\/+/, '')
  if (!relative || relative.split('/').some(part => part === '..' || !part)) return null
  return relative
}

interface RecentMediaTask {
  id: string
  type: string
  status: string
  resultUrl?: string
  sessionId?: string
  directory?: string
  projectId?: string
  projectPath?: string
  assetUri?: string
  createdAt: number
}

export function projectResourceForMediaTask(task: RecentMediaTask): ProjectResource | null {
  if (task.projectId && task.projectPath) {
    return {
      runtime: 'web',
      owner: task.projectId,
      path: task.projectPath,
      name: task.projectPath.split('/').pop() || task.projectPath,
      isDirectory: false,
      kind: 'media',
    }
  }
  if (task.directory && task.assetUri) {
    const path = normalizeProjectMediaReferencePath(task.assetUri, task.directory, 'desktop')
    if (path) {
      return {
        runtime: 'desktop',
        owner: task.directory,
        path,
        name: path.split('/').pop() || path,
        isDirectory: false,
        kind: 'media',
      }
    }
  }
  return null
}

interface ExplicitMediaInput {
  name: string
  kind: MediaReferenceKind
  value: string
  source: Exclude<MediaReferenceSource, 'task'>
  resource?: ProjectResource
}

export function buildExplicitMediaReferences(
  messageId: string,
  inputs: ExplicitMediaInput[],
): MediaReference[] {
  return inputs.map((input, index) => ({
    id: `ref_input_${messageId}_${index}`,
    kind: input.kind,
    source: input.source,
    label: input.name,
    value: input.value,
    explicit: true,
    locator: input.resource
      ? {
          type: 'project' as const,
          runtime: input.resource.runtime,
          owner: input.resource.owner,
          path: input.resource.path,
          id: input.resource.id,
        }
      : { type: 'attachment' as const, messageId, index },
  }))
}

export function buildRecentTaskReferences(
  tasks: RecentMediaTask[],
  context: { owner: string; sessionId: string; limit?: number },
): MediaReference[] {
  const eligible = tasks
    .filter(task => task.status === 'success')
    .filter(task => task.type === 'image' || task.type === 'video')
    .filter(task => Boolean(task.resultUrl))
    .filter(task => task.sessionId === context.sessionId)
    .filter(task => (task.directory || task.projectId) === context.owner)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-(context.limit || 5))

  let imageIndex = 0
  let videoIndex = 0
  return eligible.map(task => {
    const kind = task.type as 'image' | 'video'
    const index = kind === 'image' ? ++imageIndex : ++videoIndex
    return {
      id: `ref_task_${task.id}`,
      kind,
      source: 'task',
      label: `本对话生成${kind === 'image' ? '图' : '视频'} ${index}`,
      value: task.resultUrl!,
      explicit: false,
      locator: { type: 'task', taskId: task.id },
    }
  })
}

export function createMediaContextSnapshot(input: {
  owner: string
  sessionId: string
  explicitReferences?: MediaReference[]
  recentReferences?: MediaReference[]
}): MediaContextSnapshot {
  const references: MediaReference[] = []
  const seen = new Set<string>()
  for (const reference of [
    ...(input.explicitReferences || []),
    ...(input.recentReferences || []),
  ]) {
    if (seen.has(reference.id)) continue
    seen.add(reference.id)
    references.push(reference)
  }
  return { owner: input.owner, sessionId: input.sessionId, references }
}

export function buildMediaReferencePolicy(snapshot: MediaContextSnapshot): string {
  if (!snapshot.references.length) return '本轮没有可用参考素材。'
  return [
    '本轮可用参考素材（只能把下列 ID 写入 referenceIds）：',
    ...snapshot.references.map(
      reference =>
        `- ${reference.id} | ${reference.kind} | ${reference.label} | ${reference.source}`,
    ),
  ].join('\n')
}

export function materializeMediaPlanReferences(
  plan: MediaPlan,
  snapshot: MediaContextSnapshot,
): MediaPlan {
  const selectedIds = [
    ...snapshot.references.filter(reference => reference.explicit).map(reference => reference.id),
    ...(plan.referenceIds || []),
  ].filter((id, index, ids) => ids.indexOf(id) === index)
  const byId = new Map(snapshot.references.map(reference => [reference.id, reference]))
  const mediaReferences = selectedIds.map(id => {
    const reference = byId.get(id)
    if (!reference) throw new Error(`未知素材引用：${id}`)
    if (reference.invalidReason) throw new Error(reference.invalidReason)
    return reference
  })
  return withMediaReferences({ ...plan, mediaOwner: snapshot.owner }, mediaReferences)
}
