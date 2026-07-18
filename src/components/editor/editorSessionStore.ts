import {
  isSameProjectResource,
  type ProjectResource,
  type ProjectResourceRevision,
} from '@/utils/projectResource'
import { ref } from 'vue'
import { flattenProjectResourceChange, type ProjectResourceChange, type ProjectResourceChangeEntry } from '@/services/projectFileService'

export type EditorSessionState = 'loading' | 'ready' | 'saving' | 'conflict' | 'deleted' | 'readonly' | 'error'

export interface EditorSession {
  tabId: string
  resource: ProjectResource | null
  title: string
  document: unknown
  markdown: string
  assets: unknown[]
  baseRevision?: ProjectResourceRevision
  savedDocumentVersion: number
  documentVersion: number
  loadToken: number
  state: EditorSessionState
  saveError?: string
  get dirty(): boolean
}

export type EditorResourceEffect =
  | { type: 'reload'; tabId: string; resource: ProjectResource }
  | { type: 'close'; tabId: string }

function nextTabId(): string {
  return globalThis.crypto?.randomUUID?.() || `editor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createSessionSaveQueue() {
  const queues = new Map<string, Promise<void>>()
  return {
    run<T>(tabId: string, action: () => Promise<T>): Promise<T> {
      const previous = (queues.get(tabId) || Promise.resolve()).catch(() => undefined)
      const current = previous.then(action)
      const tracked = current.then(() => undefined, () => undefined).finally(() => {
        if (queues.get(tabId) === tracked) queues.delete(tabId)
      })
      queues.set(tabId, tracked)
      return current
    },
  }
}

function createSession(
  resource: ProjectResource | null,
  document: unknown,
  markdown: string,
  revision?: ProjectResourceRevision,
): EditorSession {
  const session = {
    tabId: nextTabId(),
    resource,
    title: resource?.name || '未命名文档',
    document,
    markdown,
    assets: [],
    baseRevision: revision,
    savedDocumentVersion: 0,
    documentVersion: 0,
    loadToken: 0,
    state: 'ready' as EditorSessionState,
    get dirty() { return this.documentVersion !== this.savedDocumentVersion },
  }
  return session
}

export function createEditorSessionStore() {
  const sessions = new Map<string, EditorSession>()
  const seenOperationIds = new Set<string>()
  let activeTabId: string | null = null

  function get(tabId: string): EditorSession | undefined {
    return sessions.get(tabId)
  }

  function all(): EditorSession[] {
    return [...sessions.values()]
  }

  function active(): EditorSession | undefined {
    return activeTabId ? sessions.get(activeTabId) : undefined
  }

  function select(tabId: string): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (session) activeTabId = tabId
    return session
  }

  function openProject(resource: ProjectResource, document: unknown, markdown: string, revision: ProjectResourceRevision): EditorSession {
    const existing = all().find(session => isSameProjectResource(session.resource, resource))
    if (existing) {
      activeTabId = existing.tabId
      return existing
    }
    const session = createSession(resource, document, markdown, revision)
    sessions.set(session.tabId, session)
    activeTabId = session.tabId
    return session
  }

  function createDraft(document: unknown = { type: 'doc', content: [] }, markdown = ''): EditorSession {
    const session = createSession(null, document, markdown)
    sessions.set(session.tabId, session)
    activeTabId = session.tabId
    return session
  }

  function updateDocument(tabId: string, document: unknown, markdown: string, assets?: unknown[]): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (!session || session.state === 'deleted' || session.state === 'readonly' || session.state === 'error') return session
    const nextAssets = assets || session.assets
    if (session.markdown === markdown && JSON.stringify(session.document) === JSON.stringify(document) && JSON.stringify(session.assets) === JSON.stringify(nextAssets)) {
      return session
    }
    session.document = document
    session.markdown = markdown
    session.assets = nextAssets
    session.documentVersion += 1
    return session
  }

  function markSaving(tabId: string): number | undefined {
    const session = sessions.get(tabId)
    if (!session || !session.resource || session.state === 'deleted' || session.state === 'conflict') return undefined
    session.state = 'saving'
    return session.documentVersion
  }

  function markSaved(tabId: string, revision: ProjectResourceRevision, savedDocumentVersion: number): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (!session) return undefined
    session.baseRevision = revision
    session.state = 'ready'
    if (session.documentVersion === savedDocumentVersion) session.savedDocumentVersion = savedDocumentVersion
    return session
  }

  function replaceLoaded(tabId: string, document: unknown, markdown: string, revision: ProjectResourceRevision, assets: unknown[] = []): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (!session) return undefined
    session.document = document
    session.markdown = markdown
    session.assets = assets
    session.baseRevision = revision
    session.documentVersion += 1
    session.savedDocumentVersion = session.documentVersion
    session.loadToken += 1
    session.state = 'ready'
    session.saveError = undefined
    return session
  }

  function markSaveError(tabId: string, message: string): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (!session) return undefined
    session.state = 'error'
    session.saveError = message
    return session
  }

  function markConflict(tabId: string): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (!session) return undefined
    session.state = 'conflict'
    return session
  }

  function rebindToCreatedResource(tabId: string, resource: ProjectResource, revision: ProjectResourceRevision): EditorSession | undefined {
    const session = sessions.get(tabId)
    if (!session) return undefined
    session.resource = resource
    session.title = resource.name
    session.baseRevision = revision
    session.savedDocumentVersion = session.documentVersion
    session.state = 'ready'
    session.saveError = undefined
    return session
  }

  function canSaveToOriginal(tabId: string): boolean {
    const session = sessions.get(tabId)
    return Boolean(session?.resource && session.state !== 'deleted' && session.state !== 'conflict' && session.state !== 'readonly' && session.state !== 'error')
  }

  function dirtyResourcePaths(runtime: ProjectResource['runtime'], owner: string): string[] {
    return all()
      .filter(session => session.dirty && session.resource?.runtime === runtime && session.resource.owner === owner)
      .map(session => session.resource!.path)
  }

  function remove(tabId: string): void {
    sessions.delete(tabId)
    if (activeTabId === tabId) activeTabId = all()[0]?.tabId || null
  }

  function applyResourceChangeEntry(change: ProjectResourceChangeEntry, operationId = change.operationId): EditorResourceEffect[] {
    if (seenOperationIds.has(operationId)) return []
    seenOperationIds.add(operationId)
    if (seenOperationIds.size > 256) seenOperationIds.delete(seenOperationIds.values().next().value!)
    const effects: EditorResourceEffect[] = []
    for (const session of all()) {
      if (change.type === 'renamed' && isSameProjectResource(session.resource, change.oldResource)) {
        session.resource = change.resource
        session.title = change.resource.name
        continue
      }
      if (!isSameProjectResource(session.resource, change.resource)) continue
      if (change.type === 'deleted') {
        if (session.dirty) session.state = 'deleted'
        else {
          sessions.delete(session.tabId)
          effects.push({ type: 'close', tabId: session.tabId })
        }
        continue
      }
      if (change.type === 'changed') {
        if (session.state === 'saving') continue
        if (session.dirty) session.state = 'conflict'
        else effects.push({ type: 'reload', tabId: session.tabId, resource: change.resource })
      }
    }
    if (activeTabId && !sessions.has(activeTabId)) activeTabId = all()[0]?.tabId || null
    return effects
  }

  function applyResourceChange(change: ProjectResourceChange): EditorResourceEffect[] {
    if (change.type !== 'batch') return applyResourceChangeEntry(change)
    if (seenOperationIds.has(change.operationId)) return []
    seenOperationIds.add(change.operationId)
    if (seenOperationIds.size > 256) seenOperationIds.delete(seenOperationIds.values().next().value!)
    return flattenProjectResourceChange(change).flatMap((entry, index) => applyResourceChangeEntry(entry, `${change.operationId}:${index}`))
  }

  return {
    get,
    all,
    active,
    select,
    openProject,
    createDraft,
    updateDocument,
    markSaving,
    markSaved,
    replaceLoaded,
    markSaveError,
    markConflict,
    rebindToCreatedResource,
    canSaveToOriginal,
    dirtyResourcePaths,
    remove,
    applyResourceChange,
  }
}

export const projectEditorSessionStore = createEditorSessionStore()
export const projectEditorSessionEpoch = ref(0)
