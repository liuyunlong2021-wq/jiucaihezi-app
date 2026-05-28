import { useFileStore } from '@/composables/useFileStore'
import type { CanvasEdge, CanvasNode } from '@/types/canvas'
import { getCanvasNode, getIncomingEdges, sortPromptEdges } from '../utils/canvasGraph'

export interface CanvasMergedInput {
  text: string
  missing: string[]
}

function mentionPattern() {
  return /@\[([^|\]]+)\|([^\]]+)\]/g
}

function expandTextMentions(text: string, nodes: CanvasNode[]): string {
  return String(text || '').replace(mentionPattern(), (_match, nodeId, label) => {
    const node = getCanvasNode(nodes, String(nodeId))
    if (!node) return String(label || '')
    if (node.type === 'text') return String((node.data as any).content || label || '')
    if (node.type === 'llm' || node.type === 'tool') return String((node.data as any).outputContent || label || '')
    return String(label || '')
  })
}

function nodeText(node: CanvasNode): string {
  const data: any = node.data || {}
  if (node.type === 'text') return String(data.content || '')
  if (node.type === 'llm' || node.type === 'tool') return String(data.outputContent || '')
  if (node.type === 'imageResult' || node.type === 'videoResult') return String(data.url || '')
  return ''
}

function executableSourceNeedsOutput(node: CanvasNode): boolean {
  return node.type === 'llm' || node.type === 'tool'
}

async function convertSourcePathToMarkdown(sourcePath: string): Promise<string> {
  // 前端路径校验：禁止空路径、null 字节、路径遍历、相对路径
  const trimmed = (sourcePath || '').trim()
  if (!trimmed) throw new Error('画布文件节点未提供路径')
  if (trimmed.includes('\x00')) throw new Error('文件路径包含非法字符')
  if (trimmed.includes('..')) throw new Error('不允许路径遍历（..）')
  if (!trimmed.startsWith('/')) throw new Error('只支持绝对路径')

  const { invoke } = await import('@tauri-apps/api/core')
  const result = await invoke('document_path_to_markdown_file', {
    input: {
      sourcePath: trimmed,
      conversionMode: 'fast',
      outputFormat: 'md',
      timeoutSeconds: 120,
      maxChars: 120000,
      jobId: `canvas_input_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    },
  }) as { status: string; content?: string; message?: string; error?: string }
  if (result.status !== 'success' || !String(result.content || '').trim()) {
    throw new Error(result.message || result.error || '本地文件无法读取')
  }
  return String(result.content || '')
}

export async function mergePromptInputs(nodes: CanvasNode[], edges: CanvasEdge[], targetNodeId: string): Promise<CanvasMergedInput> {
  const fileStore = useFileStore()
  const incoming = sortPromptEdges(getIncomingEdges(edges, targetNodeId).filter(edge =>
    edge.data?.kind === 'prompt-order' || edge.data?.kind === 'default',
  ))
  const parts: string[] = []
  const missing: string[] = []

  for (const edge of incoming) {
    const source = getCanvasNode(nodes, edge.source)
    if (!source) {
      missing.push(edge.source)
      continue
    }

    let content = ''
    if (source.type === 'file') {
      const fileId = String((source.data as any).fileId || '')
      const sourcePath = String((source.data as any).sourcePath || '')
      const file = fileId ? await fileStore.getFile(fileId) : undefined
      if (file) {
        content = String(file.content || '')
      } else if (sourcePath) {
        try {
          content = await convertSourcePathToMarkdown(sourcePath)
        } catch {
          missing.push(String(source.data.label || sourcePath || source.id))
          continue
        }
      } else {
        missing.push(String(source.data.label || fileId || source.id))
        continue
      }
    } else {
      content = nodeText(source)
    }

    content = expandTextMentions(content, nodes)
    if (!content.trim()) {
      if (executableSourceNeedsOutput(source)) missing.push(String(source.data.label || source.id))
      continue
    }
    parts.push(`[用户画布输入开始: ${source.data.label || source.id}]\n${content.trim()}\n[用户画布输入结束]`)
  }

  return {
    text: parts.join('\n\n---\n\n'),
    missing,
  }
}

export function buildFinalPrompt(mergedText: string, ownPrompt: string): string {
  const parts: string[] = []
  if (mergedText.trim()) {
    parts.push('[以下是用户在画布中提供的输入内容，请据此完成用户任务]\n\n' + mergedText.trim())
  }
  if (String(ownPrompt || '').trim()) {
    parts.push(String(ownPrompt).trim())
  }
  return parts.join('\n\n---\n\n')
}

export interface CanvasImageInputs {
  all: string[]
  references: string[]
  firstFrame?: string
  lastFrame?: string
  videos: string[]
  audios: string[]
}

export function getImageInputs(nodes: CanvasNode[], edges: CanvasEdge[], targetNodeId: string): string[] {
  return getStructuredImageInputs(nodes, edges, targetNodeId).all
}

function collectMentionTextsFromPromptSources(nodes: CanvasNode[], edges: CanvasEdge[], targetNodeId: string): string[] {
  return getIncomingEdges(edges, targetNodeId)
    .filter(edge => edge.data?.kind === 'prompt-order' || edge.data?.kind === 'default')
    .map(edge => getCanvasNode(nodes, edge.source))
    .filter((node): node is CanvasNode => Boolean(node))
    .flatMap(node => [
      String((node.data as any).content || ''),
      String((node.data as any).prompt || ''),
      String((node.data as any).outputContent || ''),
    ])
}

export function getStructuredImageInputs(nodes: CanvasNode[], edges: CanvasEdge[], targetNodeId: string): CanvasImageInputs {
  const result: CanvasImageInputs = { all: [], references: [], videos: [], audios: [] }
  const incomingMedia = getIncomingEdges(edges, targetNodeId)
    .filter(edge => edge.data?.kind === 'image-role' || edge.data?.kind === 'media-role')
    .sort((a, b) => Number(a.data?.order || 999) - Number(b.data?.order || 999))
  for (const edge of incomingMedia) {
    if (edge.data?.kind !== 'image-role' && edge.data?.kind !== 'media-role') continue
    const node = getCanvasNode(nodes, edge.source)
    if (!node || (node.type !== 'imageResult' && node.type !== 'videoResult' && node.type !== 'audioResult' && node.type !== 'upload')) continue
    const url = String((node.data as any).url || (node.data as any).imageUrl || (node.data as any).videoUrl || (node.data as any).audioUrl || '')
    if (!url) continue
    if (node.type === 'audioResult') {
      result.audios.push(url)
      continue
    }
    if (node.type === 'videoResult') {
      result.videos.push(url)
      continue
    }
    result.all.push(url)
    if (edge.data?.role === 'first_frame') result.firstFrame = url
    else if (edge.data?.role === 'last_frame') result.lastFrame = url
    else result.references.push(url)
  }
  const target = getCanvasNode(nodes, targetNodeId)
  const texts = target
    ? [String((target.data as any).prompt || ''), String((target.data as any).content || ''), ...collectMentionTextsFromPromptSources(nodes, edges, targetNodeId)]
    : collectMentionTextsFromPromptSources(nodes, edges, targetNodeId)
  for (const text of texts) {
    for (const match of text.matchAll(mentionPattern())) {
      const node = getCanvasNode(nodes, match[1])
      if (!node || node.type !== 'imageResult') continue
      const url = String((node.data as any).url || '')
      if (!url || result.all.includes(url)) continue
      result.all.push(url)
      result.references.push(url)
    }
  }
  return result
}

export async function getIncomingFileInputs(nodes: CanvasNode[], edges: CanvasEdge[], targetNodeId: string) {
  const fileStore = useFileStore()
  const incoming = getIncomingEdges(edges, targetNodeId)
    .map(edge => getCanvasNode(nodes, edge.source))
    .filter((node): node is CanvasNode => Boolean(node && node.type === 'file'))

  const files = []
  for (const node of incoming) {
    const data: any = node.data || {}
    const file = data.fileId ? await fileStore.getFile(String(data.fileId)) : undefined
    files.push({
      node,
      file,
      fileId: String(data.fileId || ''),
      fileName: String(data.fileName || file?.name || data.label || '文件'),
      sourcePath: String(data.sourcePath || ''),
      content: String(file?.content || data.contentPreview || ''),
      mimeType: String(file?.mimeType || ''),
    })
  }
  return files
}
