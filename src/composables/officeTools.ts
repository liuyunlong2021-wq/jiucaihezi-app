export interface ChatMessageFile {
  name: string
  content: string
}

export interface ChatMessageImage {
  url: string
}

export interface OfficeToolContext {
  files?: ChatMessageFile[]
  images?: string[]
}

export interface ToolCallLike {
  function: {
    name: string
    arguments: string
  }
}

export interface ChatCompletionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const OFFICE_TOOL_DEFINITIONS: ChatCompletionTool[] = []

export function getDefaultOfficeToolDefinitions(): ChatCompletionTool[] {
  return OFFICE_TOOL_DEFINITIONS
}

export function getOfficeToolDefinitions(agentId?: string, agentName?: string): ChatCompletionTool[] | undefined {
  const value = (String(agentId || '') + ' ' + String(agentName || '')).toLowerCase()
  if (!/docx|word|pdf|pptx|ppt|powerpoint|xlsx|xls|excel|exl|文档|演示|幻灯片|表格|电子表格/.test(value)) return undefined
  return OFFICE_TOOL_DEFINITIONS.length ? OFFICE_TOOL_DEFINITIONS : undefined
}

function isOfficeFilename(filename: string): boolean {
  return /\.(docx?|xlsx?|pptx?|pdf|csv|txt|md)$/i.test(String(filename || ''))
}

function chooseInputFile(args: Record<string, unknown>, context?: OfficeToolContext): ChatMessageFile | null {
  const filename = String(args.filename || '').trim().toLowerCase()
  const files = context?.files || []
  if (filename) {
    const exact = files.find(file => file.name.toLowerCase() === filename)
    if (exact) return exact
    const partial = files.find(file => file.name.toLowerCase().includes(filename))
    if (partial) return partial
  }
  return files.find(file => isOfficeFilename(file.name)) || null
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function disabledOfficeResult(tool: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: 'disabled',
    tool,
    local_only: true,
    ...extra,
    message,
  })
}

export async function executeOfficeToolCall(
  call: ToolCallLike,
  context?: OfficeToolContext,
): Promise<string> {
  const name = call.function.name
  const args = parseArgs(call.function.arguments)

  if (name === 'office_read' || name === 'read_document') {
    const input = chooseInputFile(args, context)
    if (!input) {
      return JSON.stringify({
        status: 'error',
        error: 'NO_READABLE_ATTACHMENT',
        tool: name,
        message: '缺少待读取文件，请先上传 Word/PDF/Excel/PPT/Markdown/TXT 文件后再重试。',
      })
    }
    return JSON.stringify({
      status: 'success',
      tool: name,
      engine: 'local_attachment_text',
      files: [{ name: input.name, content: input.content }],
      message: '已读取本地附件 ' + input.name + ' 的已提取文本。',
    })
  }

  if (name === 'office_create' || name === 'create_document') {
    return disabledOfficeResult(
      name,
      '桌面版已关闭线上 Office 生成。当前本地 Office 写出器尚未接入，请先导出 Markdown/TXT/HTML/CSV，或使用本地格式转换工具处理文件。',
      { requested_type: String(args.doc_type || args.format || '') },
    )
  }

  if (name === 'office_convert' || name === 'convert_document') {
    const input = chooseInputFile(args, context)
    return disabledOfficeResult(
      name,
      '桌面版已关闭线上 Office 转换。请在工具仓库使用“格式转换”执行本地 ToMD；其他格式写出器未接入前不再调用远程转换。',
      { source: input?.name || '', target_format: String(args.target_format || '') },
    )
  }

  if (name === 'office_execute' || name === 'run_code' || name === 'code_execute') {
    return disabledOfficeResult(
      name,
      '桌面版已关闭线上代码/Office 执行。需要本地执行时请使用开发工具白名单或后续接入的本地写出器，不再把文件处理发到服务器。',
    )
  }

  return JSON.stringify({
    status: 'not_implemented',
    tool: name,
    note: '工具 "' + name + '" 暂未注册执行器。参数已记录。',
    args,
  })
}
