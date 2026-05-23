import type { CanvasEdge, CanvasNode } from '@/types/canvas'

export function getCanvasNode(nodes: CanvasNode[], nodeId: string): CanvasNode | undefined {
  return nodes.find(node => node.id === nodeId)
}

export function getIncomingEdges(edges: CanvasEdge[], nodeId: string): CanvasEdge[] {
  return edges.filter(edge => edge.target === nodeId)
}

export function getOutgoingEdges(edges: CanvasEdge[], nodeId: string): CanvasEdge[] {
  return edges.filter(edge => edge.source === nodeId)
}

export function sortPromptEdges(edges: CanvasEdge[]): CanvasEdge[] {
  return [...edges].sort((a, b) => {
    const orderA = Number(a.data?.order || 9999)
    const orderB = Number(b.data?.order || 9999)
    if (orderA !== orderB) return orderA - orderB
    return Number(a.data?.createdAt || 0) - Number(b.data?.createdAt || 0)
  })
}

export function topologicalNodeOrder(nodes: CanvasNode[], edges: CanvasEdge[], selectedIds?: string[]): string[] {
  const allowed = new Set(selectedIds?.length ? selectedIds : nodes.map(node => node.id))
  const indegree = new Map<string, number>()
  const next = new Map<string, string[]>()

  for (const node of nodes) {
    if (!allowed.has(node.id)) continue
    indegree.set(node.id, 0)
    next.set(node.id, [])
  }

  for (const edge of edges) {
    if (!allowed.has(edge.source) || !allowed.has(edge.target)) continue
    next.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
  }

  const queue = Array.from(indegree.entries())
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
  const result: string[] = []

  while (queue.length) {
    const id = queue.shift()!
    result.push(id)
    for (const target of next.get(id) || []) {
      const count = (indegree.get(target) || 0) - 1
      indegree.set(target, count)
      if (count === 0) queue.push(target)
    }
  }

  for (const id of allowed) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}
