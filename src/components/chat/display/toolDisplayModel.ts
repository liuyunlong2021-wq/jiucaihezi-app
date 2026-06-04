import { formatDownloadSize, type OfficeDownloadFile } from '@/utils/officeDownloads'
import type { ToolCall } from '@/composables/useChat'
import { getMcpToolLabel, isMcpToolName } from '@/runtime/tools/mcpBridge'

export type ToolDisplayStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ToolDisplayFile extends OfficeDownloadFile {
  sizeLabel: string
}

export interface ToolDisplayModel {
  visible: boolean
  status: ToolDisplayStatus
  title: string
  icon: string
  primaryToolLabel: string
  files: ToolDisplayFile[]
  showArgumentsByDefault: boolean
}

export interface ToolDisplayInput {
  toolCalls?: ToolCall[]
  files?: OfficeDownloadFile[]
  toolResult?: string
  isRunning?: boolean
  status?: ToolDisplayStatus
}

const TOOL_LABELS: Record<string, string> = {
  office_create: '创建文档',
  create_document: '创建文档',
  office_convert: '转换文档',
  convert_document: '转换文档',
  office_execute: '执行代码',
  run_code: '执行代码',
  document_to_markdown: '资料转 Markdown',
  browser_search: '浏览器搜索',
  browser_open: '打开网页',
  graphify_build: '构建知识图谱',
  graphify_query: '查询知识图谱',
}

function toolLabel(name: string): string {
  if (isMcpToolName(name)) return getMcpToolLabel(name)
  return TOOL_LABELS[name] || name || '工具'
}

function hasToolError(result?: string): boolean {
  if (!result) return false
  try {
    const parsed = JSON.parse(result) as { error?: unknown; status?: unknown }
    return Boolean(parsed.error || parsed.status === 'error')
  } catch {
    return /(?:error|错误|失败|failed)/i.test(result)
  }
}

function hasToolCancellation(result?: string): boolean {
  if (!result) return false
  try {
    const parsed = JSON.parse(result) as { status?: unknown; reason?: unknown; cancelled?: unknown }
    return parsed.cancelled === true || parsed.status === 'cancelled' || parsed.reason === 'tool_disabled'
  } catch {
    return /(?:cancelled|canceled|已取消|工具已关闭|tool_disabled)/i.test(result)
  }
}

export function buildToolDisplayModel(input: ToolDisplayInput): ToolDisplayModel {
  const toolCalls = input.toolCalls || []
  const files = (input.files || []).map(file => ({
    ...file,
    sizeLabel: formatDownloadSize(file.size),
  }))
  const firstTool = toolCalls[0]
  const primaryToolLabel = firstTool ? toolLabel(firstTool.function.name) : '工具'

  if (!toolCalls.length && !files.length && !input.toolResult) {
    return {
      visible: false,
      status: 'idle',
      title: '',
      icon: 'build',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  if (input.status === 'cancelled') {
    return {
      visible: true,
      status: 'cancelled',
      title: '工具已取消',
      icon: 'cancel',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  if (hasToolCancellation(input.toolResult)) {
    return {
      visible: true,
      status: 'cancelled',
      title: '工具已取消',
      icon: 'cancel',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  if (hasToolError(input.toolResult)) {
    return {
      visible: true,
      status: 'failed',
      title: '工具执行失败',
      icon: 'error',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  if (files.length) {
    return {
      visible: true,
      status: 'succeeded',
      title: `已生成 ${files.length} 个文件`,
      icon: 'draft',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  if (input.toolResult) {
    return {
      visible: true,
      status: 'succeeded',
      title: '工具已完成',
      icon: 'check_circle',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  if (input.isRunning) {
    return {
      visible: true,
      status: 'running',
      title: `正在${primaryToolLabel}`,
      icon: 'sync',
      primaryToolLabel,
      files,
      showArgumentsByDefault: false,
    }
  }

  return {
    visible: true,
    status: 'queued',
    title: `准备使用 ${toolCalls.length || 1} 个工具`,
    icon: 'build',
    primaryToolLabel,
    files,
    showArgumentsByDefault: false,
  }
}
