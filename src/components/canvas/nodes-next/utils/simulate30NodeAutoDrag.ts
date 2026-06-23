/**
 * simulate30NodeAutoDrag.ts
 *
 * 更完整的 30 节点自动模拟拖拽（用于真实性能验证）
 *
 * 目标：
 * - 加载多样化 节点（Text, LLM, Context Providers, MediaGen, Group, Loop 等）
 * - 自动执行多轮真实拖拽序列（多节点同时拖、路径移动）
 * - 期间启用全局冻结策略 + Jank 测量
 * - 输出标准 Benchmark 报告（Avg/Max Jank）
 *
 * 使用方式（画布打开后在控制台执行）：
 *   window.v8RunFullAuto30NodeDragBenchmark()
 */

import { useCanvasStore } from '@/stores/canvasStore'
import { globalFreezeManager } from '../composables/useGlobalFreezeManager'
import { startJankMeasurement, stopJankMeasurement, getBenchmarkResult, logBenchmark } from './performanceBenchmark'

const canvasStore = useCanvasStore()

export function createDiverse30NodeCanvas() {
  const nodes: any[] = []
  const edges: any[] = []

  // 多样化节点类型（优先使用已注册的 类型）
  const nodeTypes = [
    'text', 'llm', 'skill', 'toolset',
    'imageGen', 'videoGen', 'audioGen',
    'imageResult', 'videoResult', 'audioResult',
    'group', 'loop', 'textSplit'
  ]

  for (let i = 0; i < 30; i++) {
    const type = nodeTypes[i % nodeTypes.length]
    const x = 120 + (i % 8) * 195
    const y = 110 + Math.floor(i / 8) * 175

    nodes.push({
      id: `auto-drag-${i}`,
      type,
      position: { x, y },
      data: {
        label: `节点${i}`,
        content: 'Auto drag test content for performance benchmark',
        collapsed: i % 4 === 0,
        // 为部分节点添加模拟 context 连接
        ...(type === 'llm' ? { modelId: 'claude-sonnet-4-6' } : {})
      }
    })
  }

  // 创建一些有意义的连线（模拟真实 prompt-flow + context）
  for (let i = 0; i < 18; i++) {
    const source = `auto-drag-${i}`
    const target = `auto-drag-${(i + 4) % 30}`

    let sourceHandle = 'right-text'
    let targetHandle = 'left-prompt'

    if (['skill', 'toolset'].includes(nodes[i % 30].type)) {
      sourceHandle = 'right-context'
      targetHandle = 'left-context'
    }

    edges.push({
      id: `e-auto-${i}`,
      source,
      target,
      sourceHandle,
      targetHandle
    })
  }

  canvasStore.replaceNodes(nodes)
  canvasStore.replaceEdges(edges)

  console.log('[AutoDrag] 已加载 30 节点多样化重负载画布（含 Group/LLM/Context/Media 等）')
}

export async function runAutomaticDragSequence(durationMs = 6500) {
  console.log('[AutoDrag] 开始自动拖拽序列...')

  const nodes = canvasStore.nodes
  if (nodes.length < 20) {
    console.warn('[AutoDrag] 节点数量不足，建议先调用 loadHeavyCanvas')
    return
  }

  globalFreezeManager.freeze() // 模拟真实交互开始

  const startTime = performance.now()
  let dragCount = 0

  while (performance.now() - startTime < durationMs) {
    // 随机选择 1~4 个节点进行“拖拽”
    const dragNodes = [...nodes]
      .sort(() => Math.random() - 0.5)
      .slice(0, 1 + Math.floor(Math.random() * 3))

    for (const node of dragNodes) {
      const dx = (Math.random() - 0.5) * 38
      const dy = (Math.random() - 0.5) * 38

      const newPos = {
        x: Math.max(40, node.position.x + dx),
        y: Math.max(40, node.position.y + dy)
      }

      // Use replaceNodes to update position (store doesn't expose updateNodePosition in types)
      const updated = (canvasStore as any).nodes.map((n: any) => n.id === node.id ? { ...n, position: newPos } : n)
      canvasStore.replaceNodes(updated)
      dragCount++
    }

    // 模拟真实 16ms 帧率
    await new Promise(r => setTimeout(r, 16))
  }

  globalFreezeManager.unfreeze()
  console.log(`[AutoDrag] 自动拖拽序列完成，共执行约 ${dragCount} 次位置更新`)
}

export async function runFull30NodeAutoDragBenchmark() {
  console.log('%c[Canvas] === 启动完整 30 节点自动模拟拖拽基准 ===', 'color:#10b981; font-size:13px')

  // 1. 准备重负载画布
  createDiverse30NodeCanvas()

  await new Promise(r => setTimeout(r, 120)) // 等待渲染

  // 2. 开始 Jank 测量
  startJankMeasurement(7200)

  // 3. 执行自动拖拽
  await runAutomaticDragSequence(6200)

  // 4. 停止测量并报告
  stopJankMeasurement()

  await new Promise(r => setTimeout(r, 80))

  const result = getBenchmarkResult('30-Node Full Auto Drag Simulation', 200)
  logBenchmark(result)

  if (result.passed) {
    console.log('%c✅ 30节点自动拖拽基准通过（Max Jank < 200ms）', 'color:#10b981; font-weight:bold')
  } else {
    console.log('%c❌ 基准未通过，需要进一步优化', 'color:#ef4444; font-weight:bold')
  }

  return result
}

// 暴露到全局
if (typeof window !== 'undefined') {
  (window as any).v8RunFullAuto30NodeDragBenchmark = runFull30NodeAutoDragBenchmark
}
