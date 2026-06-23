/**
 * simulateHeavyCanvas.ts
 * 
 * 用于 Phase 0 性能测试的辅助工具
 * 可以模拟一个有 30 个节点的复杂画布场景，用于验证冻结策略和 Resize 性能。
 */

export function createSimulatedNodes(count = 30) {
  const nodes = []
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `sim-node-${i}`,
      type: i % 3 === 0 ? 'llm' : 'text',
      position: { x: 100 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 160 },
      data: {
        width: 200 + Math.random() * 60,
        height: 140 + Math.random() * 40,
        label: `节点 ${i}`,
        collapsed: Math.random() > 0.7
      }
    })
  }
  return nodes
}

/**
 * 模拟在重负载下进行多次 resize 操作
 * 用于手动或自动化测试冻结策略效果
 */
export async function simulateHeavyResizeOperations(
  onResize: (id: string, width: number, height: number) => void,
  iterations = 120
) {
  const nodes = createSimulatedNodes(30)
  console.log(`[Benchmark] 开始模拟 ${iterations} 次重负载 resize 操作...`)

  for (let i = 0; i < iterations; i++) {
    const node = nodes[i % nodes.length]
    const newW = 220 + Math.sin(i / 8) * 80
    const newH = 150 + Math.cos(i / 12) * 60

    onResize(node.id, Math.round(newW), Math.round(newH))

    // 模拟真实拖拽的 16ms 间隔
    if (i % 8 === 0) {
      await new Promise(r => setTimeout(r, 16))
    }
  }

  console.log('[Benchmark] 模拟 resize 操作完成')
}