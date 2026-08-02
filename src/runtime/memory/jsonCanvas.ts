export type JsonCanvasNode = {
  id: string
  type: 'text' | 'file' | 'link' | 'group'
  x: number
  y: number
  width: number
  height: number
  text?: string
  file?: string
  url?: string
  label?: string
  color?: string
  [key: string]: unknown
}

export type JsonCanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  label?: string
  color?: string
  [key: string]: unknown
}

export type JsonCanvasDocument = {
  nodes: JsonCanvasNode[]
  edges: JsonCanvasEdge[]
  [key: string]: unknown
}

export function parseJsonCanvas(value: unknown): JsonCanvasDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Canvas 根节点必须是对象')
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new Error('Canvas 缺少 nodes 或 edges')
  const ids = new Set<string>()
  const nodes = input.nodes.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Canvas 节点 ${index + 1} 无效`)
    const node = raw as JsonCanvasNode
    if (!node.id || ids.has(node.id) || !['text', 'file', 'link', 'group'].includes(node.type)) throw new Error(`Canvas 节点 ${index + 1} 无效`)
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) throw new Error(`Canvas 节点 ${node.id} 尺寸无效`)
    ids.add(node.id)
    return { ...node }
  })
  const edges = input.edges.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Canvas 连线 ${index + 1} 无效`)
    const edge = raw as JsonCanvasEdge
    if (!edge.id || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) throw new Error(`Canvas 连线 ${index + 1} 引用了无效节点`)
    return { ...edge }
  })
  return { ...input, nodes, edges }
}

export function serializeJsonCanvas(document: JsonCanvasDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}
