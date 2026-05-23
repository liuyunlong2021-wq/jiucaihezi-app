import type { CanvasEdgeData, CanvasNodeData, CanvasNodeType } from '@/types/canvas'

export interface CanvasWorkflowTemplateNode {
  key: string
  type: CanvasNodeType
  label: string
  x: number
  y: number
  data?: Partial<CanvasNodeData>
}

export interface CanvasWorkflowTemplateEdge {
  source: string
  target: string
  data?: Partial<CanvasEdgeData>
}

export interface CanvasWorkflowTemplate {
  id: string
  title: string
  description: string
  icon: string
  nodes: CanvasWorkflowTemplateNode[]
  edges: CanvasWorkflowTemplateEdge[]
}

export const CANVAS_WORKFLOW_TEMPLATES: CanvasWorkflowTemplate[] = [
  {
    id: 'text-to-image', title: '文生图', description: '文本提示词生成一张图片', icon: 'image',
    nodes: [
      { key: 'prompt', type: 'text', label: '图片提示词', x: 0, y: 0, data: { content: '写下画面主体、风格、构图和细节。' } as any },
      { key: 'image', type: 'imageGen', label: '图片生成', x: 340, y: 0 },
    ],
    edges: [{ source: 'prompt', target: 'image' }],
  },
  {
    id: 'image-to-image', title: '图生图', description: '参考图片继续改图', icon: 'compare',
    nodes: [
      { key: 'source', type: 'imageResult', label: '参考图', x: 0, y: 0 },
      { key: 'prompt', type: 'text', label: '改图要求', x: 300, y: -120, data: { content: '说明要保留和要改变的部分。' } as any },
      { key: 'image', type: 'imageGen', label: '图生图', x: 660, y: 0 },
    ],
    edges: [
      { source: 'source', target: 'image', data: { kind: 'image-role', role: 'reference' } },
      { source: 'prompt', target: 'image' },
    ],
  },
  {
    id: 'text-to-video', title: '文生视频', description: '文本脚本生成视频', icon: 'movie',
    nodes: [
      { key: 'prompt', type: 'text', label: '视频脚本', x: 0, y: 0, data: { content: '写下镜头、动作、场景、节奏。' } as any },
      { key: 'video', type: 'videoGen', label: '视频生成', x: 340, y: 0 },
    ],
    edges: [{ source: 'prompt', target: 'video' }],
  },
  {
    id: 'image-to-video', title: '图生视频', description: '用图片作为首帧生成视频', icon: 'movie_filter',
    nodes: [
      { key: 'source', type: 'imageResult', label: '首帧图', x: 0, y: 0 },
      { key: 'prompt', type: 'text', label: '动作要求', x: 300, y: -120, data: { content: '描述主体如何运动，镜头如何推进。' } as any },
      { key: 'video', type: 'videoGen', label: '图生视频', x: 660, y: 0 },
    ],
    edges: [
      { source: 'source', target: 'video', data: { kind: 'media-role', role: 'first_frame' } },
      { source: 'prompt', target: 'video' },
    ],
  },
  {
    id: 'character-storyboard', title: '角色一致分镜', description: '角色设定到多镜头图片', icon: 'view_carousel',
    nodes: [
      { key: 'brief', type: 'text', label: '角色设定', x: 0, y: 0, data: { content: '角色外貌、服装、性格、时代背景。' } as any },
      { key: 'llm', type: 'llm', label: '分镜拆解', x: 340, y: 0, data: { prompt: '拆成 4 个可执行图片分镜提示词。' } as any },
      { key: 'image1', type: 'imageGen', label: '分镜图 1', x: 700, y: -90 },
      { key: 'image2', type: 'imageGen', label: '分镜图 2', x: 700, y: 130 },
    ],
    edges: [{ source: 'brief', target: 'llm' }, { source: 'llm', target: 'image1' }, { source: 'llm', target: 'image2' }],
  },
  {
    id: 'product-images', title: '商品图套装', description: '卖点文案生成多角度商品图', icon: 'inventory_2',
    nodes: [
      { key: 'brief', type: 'text', label: '商品卖点', x: 0, y: 0, data: { content: '商品名称、卖点、目标人群、场景。' } as any },
      { key: 'main', type: 'imageGen', label: '主图', x: 340, y: -120 },
      { key: 'scene', type: 'imageGen', label: '场景图', x: 340, y: 80 },
    ],
    edges: [{ source: 'brief', target: 'main' }, { source: 'brief', target: 'scene' }],
  },
  {
    id: 'picture-book', title: '绘本页', description: '故事文本生成绘本画面和旁白', icon: 'auto_stories',
    nodes: [
      { key: 'story', type: 'text', label: '故事段落', x: 0, y: 0, data: { content: '写下这一页的故事内容。' } as any },
      { key: 'llm', type: 'llm', label: '绘本改写', x: 340, y: 0, data: { prompt: '改写为绘本旁白，并给出画面提示词。' } as any },
      { key: 'image', type: 'imageGen', label: '绘本插图', x: 700, y: 0 },
    ],
    edges: [{ source: 'story', target: 'llm' }, { source: 'llm', target: 'image' }],
  },
]
