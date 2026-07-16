import { formatDownloadSize, type OfficeDownloadFile } from '@/utils/officeDownloads'
import type { ToolCall } from '@/composables/useChat'
import { getMcpToolLabel, isMcpToolName } from '@/runtime/tools/mcpBridge'

export type ToolDisplayStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ToolDisplayFile extends OfficeDownloadFile {
  sizeLabel: string
}

export interface ToolDisplayStep {
  toolCallId: string
  name: string
  phase: 'start' | 'executing' | 'result'
  result: string | null
  isError: boolean
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
  steps?: ToolDisplayStep[]
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
  skill: '加载 Skill',
  read: '读取文件',
  glob: '查找文件',
  grep: '搜索文件',
  write: '写入文件',
  edit: '编辑文件',
  terminal: '运行终端命令',
}

function toolLabel(name: string): string {
  if (isMcpToolName(name)) return getMcpToolLabel(name)
  return TOOL_LABELS[name] || name || '工具'
}

export function buildToolDisplayModel(input: ToolDisplayInput): ToolDisplayModel {
  const toolCalls = input.toolCalls || []
  const files = (input.files || []).map(file => ({
    ...file,
    sizeLabel: formatDownloadSize(file.size),
  }))
  const firstTool = toolCalls[0]
  const primaryToolLabel = firstTool ? toolLabel(firstTool.function.name) : '工具'
  const steps = input.steps || []

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

  if (input.status === 'failed') {
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

  if (steps.length) {
    const currentStep = steps[steps.length - 1]!
    if (currentStep.isError) {
      return {
        visible: true,
        status: 'failed',
        title: '工具执行失败',
        icon: 'error',
        primaryToolLabel: toolLabel(currentStep.name),
        files,
        showArgumentsByDefault: false,
      }
    }
    if (input.isRunning) {
      const active = currentStep.phase !== 'result'
      return {
        visible: true,
        status: 'running',
        title: active ? `正在${toolLabel(currentStep.name)}` : '正在整理结果',
        icon: 'sync',
        primaryToolLabel: toolLabel(currentStep.name),
        files,
        showArgumentsByDefault: false,
      }
    }
    if (steps.every(step => step.phase === 'result' && !step.isError)) {
      return {
        visible: true,
        status: 'succeeded',
        title: `已完成 ${steps.length} 步`,
        icon: 'check_circle',
        primaryToolLabel,
        files,
        showArgumentsByDefault: false,
      }
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
