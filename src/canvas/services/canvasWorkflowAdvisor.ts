/**
 * canvasWorkflowAdvisor.ts — AI 意图工作流推荐
 *
 * 用户描述需求 → LLM 分析 → 返回推荐的节点/边蓝图 → 调用方确认后一键展开到画布
 *
 * 当前状态：接口定义 + 解析骨架，不含 LLM 调用实现（P3 后续迭代）
 */

import type { CanvasEdgeData, CanvasNodeData, CanvasNodeType } from '@/types/canvas'
import { useCanvasStore } from '@/stores/canvasStore'

// ── 工作流类型 ────────────────────────────────────────────────

export type WorkflowType =
  | 'text_to_image'          // 文本 → 图片
  | 'text_to_video'          // 文本 → 视频
  | 'image_to_video'         // 图片 → 视频
  | 'image_series'           // 文本 → 多图分镜
  | 'storyboard'             // 角色参考 + 多镜头分镜板
  | 'multi_angle'            // 单角色 → 多角度生成
  | 'picture_book'           // 绘本：故事文本 + 多页插图
  | 'plain_llm'              // 纯文字生成，不含媒体节点

// ── 工作流建议结果 ────────────────────────────────────────────

export interface WorkflowNodeSpec {
  /** 映射键，用于 edges 中引用 */
  key: string
  type: CanvasNodeType
  label: string
  /** 相对于展开基准点的偏移 */
  x: number
  y: number
  data?: Partial<CanvasNodeData>
}

export interface WorkflowEdgeSpec {
  fromKey: string
  toKey: string
  kind: CanvasEdgeData['kind']
  role?: CanvasEdgeData['role']
}

export interface WorkflowAdvice {
  workflowType: WorkflowType
  /** 0.0–1.0，LLM 给出的置信度 */
  confidence: number
  /** LLM 给出的选择理由（可直接展示给用户） */
  reasoning: string
  nodes: WorkflowNodeSpec[]
  edges: WorkflowEdgeSpec[]
}

// ── 内置工作流模板（无 LLM 调用，离线可用）────────────────────

const BUILTIN_TEMPLATES: Record<WorkflowType, Omit<WorkflowAdvice, 'reasoning' | 'confidence'>> = {
  text_to_image: {
    workflowType: 'text_to_image',
    nodes: [
      { key: 'prompt', type: 'text',      label: '提示词',   x: 0,   y: 0 },
      { key: 'gen',    type: 'imageGen',  label: '图片生成', x: 340, y: 0 },
      { key: 'result', type: 'imageResult', label: '图片结果', x: 680, y: 0 },
    ],
    edges: [
      { fromKey: 'prompt', toKey: 'gen',    kind: 'prompt-order' },
      { fromKey: 'gen',    toKey: 'result', kind: 'default' },
    ],
  },
  text_to_video: {
    workflowType: 'text_to_video',
    nodes: [
      { key: 'prompt', type: 'text',       label: '提示词',   x: 0,   y: 0 },
      { key: 'gen',    type: 'videoGen',   label: '视频生成', x: 340, y: 0 },
      { key: 'result', type: 'videoResult', label: '视频结果', x: 680, y: 0 },
    ],
    edges: [
      { fromKey: 'prompt', toKey: 'gen',    kind: 'prompt-order' },
      { fromKey: 'gen',    toKey: 'result', kind: 'default' },
    ],
  },
  image_to_video: {
    workflowType: 'image_to_video',
    nodes: [
      { key: 'prompt', type: 'text',       label: '视频要求',   x: 340, y: -120 },
      { key: 'image',  type: 'upload',     label: '参考图',     x: 0,   y: 0 },
      { key: 'gen',    type: 'videoGen',   label: '图生视频',   x: 680, y: 0 },
      { key: 'result', type: 'videoResult', label: '视频结果',  x: 1020, y: 0 },
    ],
    edges: [
      { fromKey: 'prompt', toKey: 'gen',    kind: 'prompt-order' },
      { fromKey: 'image',  toKey: 'gen',    kind: 'media-role', role: 'first_frame' },
      { fromKey: 'gen',    toKey: 'result', kind: 'default' },
    ],
  },
  image_series: {
    workflowType: 'image_series',
    nodes: [
      { key: 'llm',    type: 'llm',        label: 'AI 分镜',   x: 0,   y: 0 },
      { key: 'split',  type: 'textSplit',  label: '文本分段',  x: 340, y: 0 },
      { key: 'gen',    type: 'imageGen',   label: '批量生成',  x: 680, y: 0 },
    ],
    edges: [
      { fromKey: 'llm',   toKey: 'split', kind: 'prompt-order' },
      { fromKey: 'split', toKey: 'gen',   kind: 'prompt-order' },
    ],
  },
  storyboard: {
    workflowType: 'storyboard',
    nodes: [
      { key: 'char',  type: 'upload',     label: '角色参考',   x: 0,   y: 0 },
      { key: 'shot1', type: 'imageGen',   label: '镜头 1',     x: 400, y: -180 },
      { key: 'shot2', type: 'imageGen',   label: '镜头 2',     x: 400, y: 0 },
      { key: 'shot3', type: 'imageGen',   label: '镜头 3',     x: 400, y: 180 },
    ],
    edges: [
      { fromKey: 'char', toKey: 'shot1', kind: 'image-role', role: 'reference' },
      { fromKey: 'char', toKey: 'shot2', kind: 'image-role', role: 'reference' },
      { fromKey: 'char', toKey: 'shot3', kind: 'image-role', role: 'reference' },
    ],
  },
  multi_angle: {
    workflowType: 'multi_angle',
    nodes: [
      { key: 'char',    type: 'upload',       label: '角色参考',     x: 0,   y: 0 },
      { key: 'prompt',  type: 'text',          label: '角色描述',     x: 0,   y: -120 },
      { key: 'front',   type: 'imageGen',      label: '正面',         x: 400, y: -270 },
      { key: 'side',    type: 'imageGen',      label: '侧面',         x: 400, y: -90 },
      { key: 'back',    type: 'imageGen',      label: '背面',         x: 400, y: 90 },
      { key: 'top',     type: 'imageGen',      label: '俯视',         x: 400, y: 270 },
    ],
    edges: [
      { fromKey: 'prompt', toKey: 'front', kind: 'prompt-order' },
      { fromKey: 'prompt', toKey: 'side',  kind: 'prompt-order' },
      { fromKey: 'prompt', toKey: 'back',  kind: 'prompt-order' },
      { fromKey: 'prompt', toKey: 'top',   kind: 'prompt-order' },
      { fromKey: 'char', toKey: 'front',   kind: 'image-role', role: 'reference' },
      { fromKey: 'char', toKey: 'side',    kind: 'image-role', role: 'reference' },
      { fromKey: 'char', toKey: 'back',    kind: 'image-role', role: 'reference' },
      { fromKey: 'char', toKey: 'top',     kind: 'image-role', role: 'reference' },
    ],
  },
  picture_book: {
    workflowType: 'picture_book',
    nodes: [
      { key: 'story',  type: 'llm',       label: '故事生成',   x: 0,   y: 0 },
      { key: 'split',  type: 'textSplit', label: '按页分段',   x: 340, y: 0 },
      { key: 'illus',  type: 'imageGen',  label: '插图生成',   x: 680, y: 0 },
    ],
    edges: [
      { fromKey: 'story', toKey: 'split', kind: 'prompt-order' },
      { fromKey: 'split', toKey: 'illus', kind: 'prompt-order' },
    ],
  },
  plain_llm: {
    workflowType: 'plain_llm',
    nodes: [
      { key: 'prompt', type: 'text', label: '输入',   x: 0,   y: 0 },
      { key: 'llm',    type: 'llm',  label: 'AI 文本', x: 340, y: 0 },
    ],
    edges: [
      { fromKey: 'prompt', toKey: 'llm', kind: 'prompt-order' },
    ],
  },
}

// ── 公开 API ──────────────────────────────────────────────────

/**
 * 根据工作流类型返回内置模板建议（离线版本，不调用 LLM）。
 * TODO P3 实现：分析用户输入后调用 LLM，返回 LLM 驱动的 WorkflowAdvice。
 */
export function getWorkflowTemplate(type: WorkflowType): WorkflowAdvice {
  const tmpl = BUILTIN_TEMPLATES[type]
  return {
    ...tmpl,
    confidence: 1,
    reasoning: `使用内置「${type}」工作流模板`,
  }
}

/**
 * 将 WorkflowAdvice 展开到画布，使用 startBatch/endBatch 保证只产生 1 条 undo 记录。
 * @param advice 工作流建议
 * @param basePosition 展开的画布基准坐标
 */
export function applyWorkflowAdvice(
  advice: WorkflowAdvice,
  basePosition: { x: number; y: number } = { x: 120, y: 120 },
): void {
  const canvasStore = useCanvasStore()
  const idMap = new Map<string, string>()

  canvasStore.startBatch()
  try {
    for (const nodeSpec of advice.nodes) {
      const node = canvasStore.addNodeWithData(
        nodeSpec.type,
        {
          label: nodeSpec.label,
          ...(nodeSpec.data || {}),
        } as CanvasNodeData,
        { x: basePosition.x + nodeSpec.x, y: basePosition.y + nodeSpec.y },
      )
      idMap.set(nodeSpec.key, node.id)
    }

    for (const edgeSpec of advice.edges) {
      const sourceId = idMap.get(edgeSpec.fromKey)
      const targetId = idMap.get(edgeSpec.toKey)
      if (!sourceId || !targetId) continue
      canvasStore.addEdge(sourceId, targetId, {
        kind: edgeSpec.kind,
        role: edgeSpec.role,
      })
    }
  } finally {
    canvasStore.endBatch()
  }
}
