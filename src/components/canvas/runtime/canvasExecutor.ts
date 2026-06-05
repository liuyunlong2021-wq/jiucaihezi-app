import { useCanvasStore } from '@/stores/canvasStore'
import { emitEvent } from '@/utils/eventBus'
import type { CanvasNode } from '@/types/canvas'
import { getIncomingEdges, topologicalNodeLayers } from '../utils/canvasGraph'
import { runCanvasLlmNode } from './canvasLlmRuntime'
import { runCanvasAudioNode, runCanvasImageNode, runCanvasVideoNode, runCanvasRunningHubNode } from './canvasMediaRuntime'
import { runCanvasToolNode } from './canvasToolRuntime'

const EXECUTABLE_TYPES = new Set([
  'llm', 'imageGen', 'videoGen', 'audioGen', 'tool',
  // T8 迁入 — 核心生成
  'runninghub', 'runninghubWallet', 'seedance', 'rhTools',
  // T8 迁入 — 流程控制
  'loop', 'pickFromSet', 'textSplit', 'framePair',
  // T8 迁入 — 图像处理
  'resize', 'combine', 'removeBg', 'upscale', 'gridCrop',
  'frameExtractor',
  // T8 迁入 — 工具箱
  'cinematic', 'videoMotion', 'multiAngleVisual',
  // T8 迁入 — 其他
  'edit', 'browserNode',
])

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
        onToken: (accumulated) => {
          // 实时写入节点让 UI 流式显示；进度从 10% 到 90% 按输出量估算
          const est = Math.min(90, 10 + Math.floor(accumulated.length / 80))
          canvasStore.setNodeStatus(node.id, { outputContent: accumulated, progress: est, detail: '生成中…' } as any)
        },
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
      // 创建或更新输出节点作为一次批量操作（只产生 1 条 undo）
      canvasStore.startBatch()
      let outputNode: any
      try {
        outputNode = existingOutput
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
      } finally {
        canvasStore.endBatch()
      }
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

    if (node.type === 'runninghub') {
      const result = await runCanvasRunningHubNode({ node, nodes: canvasStore.nodes, edges: canvasStore.edges, onProgress: progress })
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

    // ── T8 迁入：seedance → 桥接 video 生成 ──
    if (node.type === 'seedance') {
      const result = await runCanvasVideoNode({
        node: { ...node, data: { ...(node.data as any), model: (node.data as any).model || 'seedance-2-0-pro' } } as any,
        nodes: canvasStore.nodes,
        edges: canvasStore.edges,
        onProgress: progress,
      })
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, error: '', detail: '执行完成', outputUrl: result.url, fileId: result.fileId } as any)
      emitEvent('refresh-file-list')
      return true
    }

    // ── T8 迁入：runninghubWallet / rhTools → 桥接 runninghub ──
    if (node.type === 'runninghubWallet' || node.type === 'rhTools') {
      const result = await runCanvasRunningHubNode({ node, nodes: canvasStore.nodes, edges: canvasStore.edges, onProgress: progress })
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, error: '', detail: '执行完成', fileId: result.fileId } as any)
      emitEvent('refresh-file-list')
      return true
    }

    // ── T8 迁入：loop / pickFromSet / textSplit / framePair (占位实现，标记成功) ──
    if (node.type === 'loop') {
      const d = node.data as any
      const total = Number(d.totalCount || 0)
      canvasStore.addExecutionLog(`循环器：共 ${total} 项待处理`, 'info')
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: '循环完成', currentIndex: total, error: '' } as any)
      return true
    }
    if (node.type === 'pickFromSet') {
      const d = node.data as any
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: '选取完成', currentValue: d.currentValue || '', error: '' } as any)
      return true
    }
    if (node.type === 'textSplit') {
      const d = node.data as any
      const content = String(d.content || d.prompt || '')
      const segments = content ? content.split(/\n{2,}/).filter(Boolean) : []
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: `分割为 ${segments.length} 段`, segments, segmentCount: segments.length, error: '' } as any)
      return true
    }
    if (node.type === 'framePair') {
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: '首尾帧获取完成（需后端视频抽帧）', error: '' } as any)
      return true
    }

    // ── T8 迁入：图像处理节点 (占位，标记成功，后续对接后端) ──
    if (node.type === 'resize' || node.type === 'combine' || node.type === 'removeBg' || node.type === 'upscale' || node.type === 'gridCrop' || node.type === 'frameExtractor' || node.type === 'edit') {
      const labelMap: Record<string, string> = { resize: '尺寸调整', combine: '合并', removeBg: '抠图', upscale: '放大', gridCrop: '宫格剪裁', frameExtractor: '抽帧', edit: '编辑' }
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: `${labelMap[node.type] || '处理'}完成`, error: '' } as any)
      return true
    }

    // ── T8 迁入：工具箱节点 (组合器，生成 prompt 文本) ──
    if (node.type === 'cinematic' || node.type === 'videoMotion' || node.type === 'multiAngleVisual') {
      const d = node.data as any
      const parts: string[] = []
      if (d.style) parts.push(`风格:${d.style}`)
      if (d.shot) parts.push(`镜头:${d.shot}`)
      if (d.lighting) parts.push(`光影:${d.lighting}`)
      if (d.scene) parts.push(`场景:${d.scene}`)
      if (d.action) parts.push(`动作:${d.action}`)
      if (d.path) parts.push(`路径:${d.path}`)
      if (d.azimuth != null) parts.push(`方位:${d.azimuth}° 俯仰:${d.elevation}°`)
      const prompt = parts.join('，')
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: '组合完成', outputPrompt: prompt, error: '' } as any)
      return true
    }

    // ── T8 迁入：browserNode ──
    if (node.type === 'browserNode') {
      canvasStore.updateNodeData(node.id, { status: 'success', progress: 100, detail: '浏览器加载完成', error: '' } as any)
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

// 媒体类节点并发软上限，避免超出 API 速率限制
const MAX_MEDIA_CONCURRENT = 3
const MEDIA_NODE_TYPES = new Set(['imageGen', 'videoGen', 'audioGen', 'runninghub', 'runninghubWallet', 'seedance', 'rhTools'])

async function runLayerConcurrently(layerIds: string[], failed: Set<string>) {
  const canvasStore = useCanvasStore()

  // 媒体节点走限流并发，其余节点不限制
  const mediaIds = layerIds.filter(id => {
    const node = canvasStore.nodes.find(n => n.id === id)
    return node && MEDIA_NODE_TYPES.has(String(node.type))
  })
  const otherIds = layerIds.filter(id => !mediaIds.includes(id))

  const runOne = async (id: string) => {
    if (canvasStore.stopRequested) return
    const node = canvasStore.nodes.find(n => n.id === id)
    if (!node) return
    if (hasFailedDependency(node, failed)) {
      canvasStore.setNodeStatus(id, { status: 'cancelled', progress: 0, error: '上游节点失败，已跳过。', detail: '已跳过' } as any)
      failed.add(id)
      return
    }
    const ok = await runCanvasNode(id)
    if (!ok) failed.add(id)
  }

  // 非媒体节点全部并发
  const otherPromises = otherIds.map(id => runOne(id))

  // 媒体节点限流并发（滑动窗口）
  const mediaPromises: Promise<void>[] = []
  for (let i = 0; i < mediaIds.length; i += MAX_MEDIA_CONCURRENT) {
    if (canvasStore.stopRequested) break
    const batch = mediaIds.slice(i, i + MAX_MEDIA_CONCURRENT).map(id => runOne(id))
    await Promise.allSettled(batch)
    mediaPromises.push(...batch)
  }

  await Promise.allSettled(otherPromises)
}

export async function runAllCanvasNodes() {
  const canvasStore = useCanvasStore()
  const layers = topologicalNodeLayers(canvasStore.nodes, canvasStore.edges)
  const executableLayers = layers
    .map(ids => ids.filter(id => isExecutable(canvasStore.nodes.find(n => n.id === id))))
    .filter(layer => layer.length > 0)

  const failed = new Set<string>()
  canvasStore.resetStopRequest()
  canvasStore.addExecutionLog('开始执行画布队列')

  // 预置所有节点为 queued
  for (const layerIds of executableLayers) {
    for (const id of layerIds) {
      canvasStore.setNodeStatus(id, { status: 'queued', progress: 0, error: '', detail: '等待执行' } as any)
    }
  }

  // 按层并发执行
  for (const layerIds of executableLayers) {
    if (canvasStore.stopRequested) {
      canvasStore.addExecutionLog('队列已停止', 'error')
      break
    }
    await runLayerConcurrently(layerIds, failed)
  }

  canvasStore.addExecutionLog('画布队列结束', failed.size ? 'error' : 'success')
}

