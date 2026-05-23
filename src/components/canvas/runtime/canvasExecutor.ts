import { useCanvasStore } from '@/stores/canvasStore'
import { emitEvent } from '@/utils/eventBus'
import type { CanvasNode } from '@/types/canvas'
import { getIncomingEdges, topologicalNodeOrder } from '../utils/canvasGraph'
import { runCanvasLlmNode } from './canvasLlmRuntime'
import { runCanvasAudioNode, runCanvasImageNode, runCanvasVideoNode } from './canvasMediaRuntime'
import { runCanvasToolNode } from './canvasToolRuntime'

const EXECUTABLE_TYPES = new Set(['llm', 'imageGen', 'videoGen', 'audioGen', 'tool'])

function errorMessage(err: unknown): string {
  return (err as Error)?.message || String(err || '执行失败')
}

function isExecutable(node: CanvasNode | undefined): node is CanvasNode {
  return Boolean(node && EXECUTABLE_TYPES.has(String(node.type)))
}

function hasFailedDependency(node: CanvasNode, failed: Set<string>) {
  const canvasStore = useCanvasStore()
  return getIncomingEdges(canvasStore.edges, node.id).some(edge => failed.has(edge.source))
}

export async function runCanvasNode(nodeId: string): Promise<boolean> {
  const canvasStore = useCanvasStore()
  const node = canvasStore.nodes.find(item => item.id === nodeId)
  if (!isExecutable(node)) return true

  canvasStore.addExecutionLog(`开始执行：${node.data.label || node.id}`)
  canvasStore.setNodeStatus(node.id, {
    status: 'running',
    progress: 5,
    error: '',
    detail: '执行中',
  } as any)

  const progress = (value: number, message: string) => {
    canvasStore.setNodeStatus(node.id, {
      progress: Math.max(1, Math.min(99, Math.round(value))),
      detail: message || '执行中',
    } as any)
  }

  try {
    if (node.type === 'llm') {
      const result = await runCanvasLlmNode({
        node,
        nodes: canvasStore.nodes,
        edges: canvasStore.edges,
      })
      const existingOutputId = String((node.data as any).outputNodeId || '')
      const existingOutput = existingOutputId ? canvasStore.nodes.find(item => item.id === existingOutputId) : null
      const outputData = {
        label: `${node.data.label || 'AI 文本'}结果`,
        status: 'success',
        progress: 100,
        error: '',
        detail: '执行完成',
        content: result.content,
        fileId: result.fileId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any
      const outputNode = existingOutput
        ? (canvasStore.updateNodeData(existingOutput.id, outputData), existingOutput)
        : canvasStore.addNodeWithData('text', outputData, { x: node.position.x + 340, y: node.position.y })
      if (!existingOutput) canvasStore.addEdge(node.id, outputNode.id, { kind: 'prompt-order' })
      canvasStore.updateNodeData(node.id, {
        status: 'success',
        progress: 100,
        error: '',
        detail: '执行完成',
        outputContent: result.content,
        outputFileId: result.fileId,
        outputNodeId: outputNode.id,
        fileId: result.fileId,
      } as any)
      canvasStore.addExecutionLog(`执行完成：${node.data.label || node.id}`, 'success')
      emitEvent('refresh-file-list')
      return true
    }

    if (node.type === 'imageGen') {
      const result = await runCanvasImageNode({
        node,
        nodes: canvasStore.nodes,
        edges: canvasStore.edges,
        onProgress: progress,
      })
      canvasStore.updateNodeData(node.id, {
        status: 'success',
        progress: 100,
        error: '',
        detail: '执行完成',
        fileId: result.fileId,
      } as any)
      emitEvent('refresh-file-list')
      return true
    }

    if (node.type === 'audioGen') {
      const result = await runCanvasAudioNode({
        node,
        nodes: canvasStore.nodes,
        edges: canvasStore.edges,
        onProgress: progress,
      })
      canvasStore.updateNodeData(node.id, {
        status: 'success',
        progress: 100,
        error: '',
        detail: '执行完成',
        fileId: result.fileId,
      } as any)
      emitEvent('refresh-file-list')
      return true
    }

    if (node.type === 'videoGen') {
      const result = await runCanvasVideoNode({
        node,
        nodes: canvasStore.nodes,
        edges: canvasStore.edges,
        onProgress: progress,
      })
      canvasStore.updateNodeData(node.id, {
        status: 'success',
        progress: 100,
        error: '',
        detail: '执行完成',
        outputUrl: result.url,
        fileId: result.fileId,
      } as any)
      emitEvent('refresh-file-list')
      return true
    }

    if (node.type === 'tool') {
      const result = await runCanvasToolNode({
        node,
        nodes: canvasStore.nodes,
        edges: canvasStore.edges,
        onProgress: progress,
      })
      canvasStore.updateNodeData(node.id, {
        status: 'success',
        progress: 100,
        error: '',
        detail: '执行完成',
        outputContent: result.content,
        outputFileId: result.fileId,
        outputPath: result.outputPath,
        fileId: result.fileId,
      } as any)
      emitEvent('refresh-file-list')
      return true
    }

    return true
  } catch (err) {
    canvasStore.addExecutionLog(`执行失败：${node.data.label || node.id}，${errorMessage(err).slice(0, 120)}`, 'error')
    canvasStore.setNodeStatus(node.id, {
      status: 'error',
      progress: 100,
      error: errorMessage(err).slice(0, 500),
      detail: '执行失败',
    } as any)
    return false
  } finally {
    await canvasStore.saveNow()
  }
}

export async function runAllCanvasNodes() {
  const canvasStore = useCanvasStore()
  const orderedIds = topologicalNodeOrder(canvasStore.nodes, canvasStore.edges)
  const executableIds = orderedIds.filter(id => isExecutable(canvasStore.nodes.find(node => node.id === id)))
  const failed = new Set<string>()
  canvasStore.resetStopRequest()
  canvasStore.addExecutionLog('开始执行画布队列')

  for (const id of executableIds) {
    if (canvasStore.stopRequested) {
      canvasStore.addExecutionLog('队列已停止', 'error')
      break
    }
    const node = canvasStore.nodes.find(item => item.id === id)
    if (!node) continue
    canvasStore.setNodeStatus(id, { status: 'queued', progress: 0, error: '', detail: '等待执行' } as any)
  }

  for (const id of executableIds) {
    if (canvasStore.stopRequested) {
      canvasStore.addExecutionLog('队列已停止', 'error')
      break
    }
    const node = canvasStore.nodes.find(item => item.id === id)
    if (!node) continue
    if (hasFailedDependency(node, failed)) {
      canvasStore.setNodeStatus(id, {
        status: 'cancelled',
        progress: 0,
        error: '上游节点失败，已跳过。',
        detail: '已跳过',
      } as any)
      failed.add(id)
      continue
    }
    const ok = await runCanvasNode(id)
    if (!ok) failed.add(id)
  }
  canvasStore.addExecutionLog('画布队列结束', failed.size ? 'error' : 'success')
}

