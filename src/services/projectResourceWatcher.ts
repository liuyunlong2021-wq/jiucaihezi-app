import type { ProjectResource } from '@/utils/projectResource'
import type { ProjectResourceChange } from '@/services/projectFileService'

function resourceKey(resource: ProjectResource): string {
  return `${resource.runtime}:${resource.owner}:${resource.path}`
}

function resourceSignature(resource: ProjectResource): string {
  return `${resource.updatedAt || 0}:${resource.size || 0}:${resource.isDirectory ? 'dir' : 'file'}`
}

export function createProjectResourceWatcher() {
  const previous = new Map<string, { resource: ProjectResource; signature: string }>()
  const locallyAcknowledged = new Set<string>()
  let initialized = false

  function observe(resources: ProjectResource[]): ProjectResourceChange[] {
    const next = new Map(resources.map(resource => [resourceKey(resource), { resource, signature: resourceSignature(resource) }]))
    const changes: ProjectResourceChange[] = []
    if (initialized) {
      const consumedPrevious = new Set<string>()
      for (const resource of resources) {
        const key = resourceKey(resource)
        const previousEntry = previous.get(key)
        if (previousEntry) {
          if (previousEntry.signature === next.get(key)?.signature) continue
          if (locallyAcknowledged.delete(key)) continue
          const operationId = `external:${key}:${next.get(key)?.signature}`
          changes.push({
            type: 'changed',
            resource,
            transactionId: operationId,
            operationId,
            source: 'external',
            revision: { value: `${resource.updatedAt || 0}:${resource.size || 0}`, size: resource.size || 0, updatedAt: resource.updatedAt },
          })
          continue
        }
        const renamed = resource.id
          ? [...previous.entries()].find(([oldKey, entry]) => !consumedPrevious.has(oldKey) && entry.resource.id === resource.id)
          : undefined
        if (renamed) {
          const [oldKey, oldEntry] = renamed
          consumedPrevious.add(oldKey)
          if (locallyAcknowledged.delete(oldKey) || locallyAcknowledged.delete(key)) continue
          const operationId = `external:rename:${oldKey}:${key}`
          changes.push({ type: 'renamed', oldResource: oldEntry.resource, resource, transactionId: operationId, operationId, source: 'external' })
          continue
        }
        if (locallyAcknowledged.delete(key)) continue
        const operationId = `external:created:${key}`
        changes.push({
          type: 'created',
          resource,
          transactionId: operationId,
          operationId,
          source: 'external',
        })
      }
      for (const [key, entry] of previous) {
        if (next.has(key) || consumedPrevious.has(key) || locallyAcknowledged.delete(key)) continue
        const operationId = `external:deleted:${key}`
        changes.push({ type: 'deleted', resource: entry.resource, transactionId: operationId, operationId, source: 'external' })
      }
    }
    previous.clear()
    next.forEach((entry, key) => previous.set(key, entry))
    initialized = true
    return changes
  }

  function acknowledgeLocal(path: string, owner?: string, runtime?: ProjectResource['runtime']) {
    if (owner && runtime) {
      locallyAcknowledged.add(`${runtime}:${owner}:${path}`)
      return
    }
    for (const key of previous.keys()) {
      if (key.endsWith(`:${path}`) && (!owner || key.includes(`:${owner}:`)) && (!runtime || key.startsWith(`${runtime}:`))) {
        locallyAcknowledged.add(key)
      }
    }
  }

  return { observe, acknowledgeLocal }
}
