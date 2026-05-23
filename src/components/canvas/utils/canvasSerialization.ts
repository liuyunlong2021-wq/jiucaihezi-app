import type { CanvasDocumentV1, CanvasEdge, CanvasEdgeData, CanvasNode, CanvasNodeData, CanvasNodeType, CanvasViewport } from '@/types/canvas'
import { defaultCanvasDataForType } from './canvasNodeFactory'

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 }
const NODE_TYPES: CanvasNodeType[] = ['text', 'llm', 'imageGen', 'imageResult', 'audioGen', 'audioResult', 'videoGen', 'videoResult', 'file', 'tool', 'group']
const EDGE_ROLES: Array<CanvasEdgeData['role']> = ['reference', 'first_frame', 'last_frame', 'voice', 'music']

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function isPlainJson(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isPlainJson)
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    return Object.values(value as Record<string, unknown>).every(isPlainJson)
  }
  return false
}

function sanitizeData(data: unknown): CanvasNodeData {
  const source = isPlainJson(data) ? data as Record<string, unknown> : {}
  const now = Date.now()
  return {
    ...jsonClone(source),
    label: String(source.label || '未命名节点'),
    status: ['idle', 'queued', 'running', 'success', 'error', 'cancelled'].includes(String(source.status))
      ? source.status as CanvasNodeData['status']
      : 'idle',
    createdAt: Number(source.createdAt || now),
    updatedAt: Number(source.updatedAt || now),
  } as CanvasNodeData
}

export function sanitizeCanvasNode(node: Partial<CanvasNode> | null | undefined): CanvasNode | null {
  if (!node?.id || !node?.type) return null
  if (!NODE_TYPES.includes(node.type as CanvasNodeType)) return null
  const type = node.type as CanvasNodeType
  const position = node.position || { x: 0, y: 0 }
  const data = { ...defaultCanvasDataForType(type), ...sanitizeData(node.data) } as CanvasNodeData
  return {
    id: String(node.id),
    type,
    position: {
      x: Number(position.x || 0),
      y: Number(position.y || 0),
    },
    data,
    selected: Boolean(node.selected),
    zIndex: Number((node as any).zIndex || 0) || undefined,
  } as CanvasNode
}

export function sanitizeCanvasEdge(edge: Partial<CanvasEdge> | null | undefined): CanvasEdge | null {
  if (!edge?.id || !edge?.source || !edge?.target) return null
  const data = isPlainJson(edge.data) ? edge.data as unknown as Record<string, unknown> : {}
  return {
    id: String(edge.id),
    source: String(edge.source),
    target: String(edge.target),
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    type: edge.type || (data.kind === 'prompt-order' ? 'promptOrder' : data.kind === 'image-role' ? 'imageRole' : data.kind === 'media-role' ? 'mediaRole' : 'default'),
    data: {
      kind: data.kind === 'prompt-order' || data.kind === 'image-role' || data.kind === 'media-role'
        ? data.kind
        : 'default',
      order: data.order == null ? undefined : Number(data.order),
      role: EDGE_ROLES.includes(data.role as CanvasEdgeData['role']) ? data.role as CanvasEdgeData['role'] : undefined,
      createdAt: Number(data.createdAt || Date.now()),
    },
  } as CanvasEdge
}

export function sanitizeCanvasDocument(input: unknown): CanvasDocumentV1 {
  const raw = typeof input === 'string' ? safeJson(input) : input
  const source = raw && typeof raw === 'object' ? raw as Partial<CanvasDocumentV1> : {}
  const viewport = source.viewport || DEFAULT_VIEWPORT
  return {
    version: 1,
    id: String(source.id || 'default'),
    title: String(source.title || '我的画布'),
    updatedAt: Number(source.updatedAt || Date.now()),
    nodes: Array.isArray(source.nodes)
      ? source.nodes.map(sanitizeCanvasNode).filter(Boolean) as CanvasNode[]
      : [],
    edges: Array.isArray(source.edges)
      ? source.edges.map(sanitizeCanvasEdge).filter(Boolean) as CanvasEdge[]
      : [],
    viewport: {
      x: Number(viewport.x || 0),
      y: Number(viewport.y || 0),
      zoom: Number(viewport.zoom || 1),
    },
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function serializeCanvasDocument(doc: CanvasDocumentV1): string {
  return JSON.stringify(sanitizeCanvasDocument(doc))
}

export function parseCanvasDocument(raw: unknown): CanvasDocumentV1 {
  return sanitizeCanvasDocument(raw)
}
