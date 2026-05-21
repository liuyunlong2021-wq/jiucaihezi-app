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

const OFFICE_API_BASE = 'https://api.jiucaihezi.studio/api/office'

const OFFICE_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'office_create',
      description: '创建真实 Office 文件，支持 docx、pdf、xlsx、pptx。创建 Excel 时必须传入结构化 sheets/data；创建 PPTX 时 slides 每页必须带 bullets 或 paragraphs 正文，不能只传标题。',
      parameters: {
        type: 'object',
        properties: {
          doc_type: {
            type: 'string',
            enum: ['docx', 'pdf', 'xlsx', 'pptx'],
            description: '要创建的 Office 文件类型。',
          },
          filename: {
            type: 'string',
            description: '可选文件名，建议包含正确扩展名。',
          },
          content: {
            type: 'object',
            description: '文档结构 JSON。xlsx 使用 { sheets: { Sheet1: [{列名: 值}] } }，docx/pdf 使用 title/paragraphs/tables，pptx 使用 { title, subtitle, slides: [{ title, bullets:[...]}] } 且每页必须有正文。',
            additionalProperties: true,
          },
        },
        required: ['doc_type', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'office_read',
      description: '读取用户上传的 Office/PDF/CSV 文件内容。',
      parameters: {
        type: 'object',
        properties: {
          with_thumbnail: {
            type: 'boolean',
            description: '是否生成缩略图。',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'office_convert',
      description: '将用户上传的 Office 文件转换为目标格式，常用于转 PDF。',
      parameters: {
        type: 'object',
        properties: {
          target_format: {
            type: 'string',
            description: '目标格式，例如 pdf。',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'office_execute',
      description: '执行 Python 代码生成或处理复杂 Office 文件，用于复杂格式、公式、图表、样式、模板等场景。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 Python 代码。代码应把生成文件保存为 docx/pdf/xlsx/pptx/csv。',
          },
          language: {
            type: 'string',
            enum: ['python'],
            description: '执行语言，当前使用 python。',
          },
          timeout: {
            type: 'number',
            description: '执行超时时间，单位秒。',
          },
        },
        required: ['code'],
      },
    },
  },
]

export function getDefaultOfficeToolDefinitions(): ChatCompletionTool[] {
  return OFFICE_TOOL_DEFINITIONS
}

export function getOfficeToolDefinitions(agentId?: string, agentName?: string): ChatCompletionTool[] | undefined {
  const value = `${agentId || ''} ${agentName || ''}`.toLowerCase()
  if (!/docx|word|pdf|pptx|ppt|powerpoint|xlsx|xls|excel|exl|文档|演示|幻灯片|表格|电子表格/.test(value)) return undefined
  return OFFICE_TOOL_DEFINITIONS
}

function absolutizeDownloadUrl(url: string): string {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) return url
  return `https://api.jiucaihezi.studio${url.startsWith('/') ? '' : '/'}${url}`
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = String(dataUrl).match(/^data:([^;,]+)?(?:;base64)?,(.*)$/)
  if (!match) throw new Error('无效的 data URL')
  const mimeType = match[1] || 'application/octet-stream'
  const payload = match[2] || ''
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

function inferMimeType(filename: string): string {
  const lower = String(filename || '').toLowerCase()
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel'
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.md')) return 'text/markdown'
  return 'application/octet-stream'
}

function textToFileBlob(file: ChatMessageFile): Blob {
  return new Blob([file.content], { type: inferMimeType(file.name) })
}

function isOfficeFilename(filename: string): boolean {
  return /\.(docx?|xlsx?|pptx?|pdf|csv|txt|md)$/i.test(String(filename || ''))
}

function chooseInputFile(args: Record<string, unknown>, context?: OfficeToolContext): { blob: Blob; filename: string } | null {
  if (args.file_base64 && args.filename) {
    const base64 = String(args.file_base64)
    const filename = String(args.filename)
    const blob = base64.startsWith('data:')
      ? dataUrlToBlob(base64)
      : new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: inferMimeType(filename) })
    return { blob, filename }
  }

  const candidate = (context?.files || []).find(file => isOfficeFilename(file.name))
  if (!candidate) return null
  return {
    blob: textToFileBlob(candidate),
    filename: candidate.name,
  }
}

function appendUploadedFiles(form: FormData, context?: OfficeToolContext) {
  for (const file of context?.files || []) {
    if (!isOfficeFilename(file.name)) continue
    form.append('files', textToFileBlob(file), file.name)
  }
}

async function parseJsonResponse(res: Response) {
  const data = await res.json()
  if (data.download_url) data.download_url = absolutizeDownloadUrl(data.download_url)
  if (Array.isArray(data.output_files)) {
    data.output_files = data.output_files.map((item: Record<string, unknown>) => ({
      ...item,
      download_url: item.download_url ? absolutizeDownloadUrl(String(item.download_url)) : item.download_url,
    }))
  }
  return data
}

export async function executeOfficeToolCall(
  call: ToolCallLike,
  context?: OfficeToolContext,
): Promise<string> {
  const name = call.function.name
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: 'INVALID_TOOL_ARGUMENTS_JSON',
      tool: name,
      message: `工具 "${name}" 的参数不是合法 JSON，无法执行。`,
      detail: (err as Error).message,
      arguments: call.function.arguments,
    })
  }

  if (name === 'office_create' || name === 'create_document') {
    const form = new FormData()
    form.append('doc_type', String(args.doc_type || args.format || 'docx'))
    form.append('content', typeof args.content === 'string' ? args.content : JSON.stringify(args.content || args))
    if (args.filename) form.append('filename', String(args.filename))
    const res = await fetch(`${OFFICE_API_BASE}/create`, { method: 'POST', body: form })
    return JSON.stringify(await parseJsonResponse(res))
  }

  if (name === 'office_convert' || name === 'convert_document') {
    const form = new FormData()
    form.append('target_format', String(args.target_format || 'pdf'))
    const input = chooseInputFile(args, context)
    if (!input) {
      return JSON.stringify({
        status: 'error',
        error: '缺少待转换文件，请先上传 Word/PDF/Excel/PPT 文件后再重试。',
      })
    }
    form.append('file', input.blob, input.filename)
    const res = await fetch(`${OFFICE_API_BASE}/convert`, { method: 'POST', body: form })
    return JSON.stringify(await parseJsonResponse(res))
  }

  if (name === 'office_execute' || name === 'run_code' || name === 'code_execute') {
    const form = new FormData()
    form.append('code', String(args.code || ''))
    form.append('language', String(args.language || 'python'))
    form.append('timeout', String(args.timeout || 60))
    appendUploadedFiles(form, context)
    const res = await fetch(`${OFFICE_API_BASE}/execute`, { method: 'POST', body: form })
    return JSON.stringify(await parseJsonResponse(res))
  }

  if (name === 'office_read' || name === 'read_document') {
    const input = chooseInputFile(args, context)
    if (!input) {
      return JSON.stringify({
        status: 'error',
        error: '缺少待读取文件，请先上传 Word/PDF/Excel/PPT 文件后再重试。',
      })
    }
    const form = new FormData()
    form.append('file', input.blob, input.filename)
    if (args.with_thumbnail != null) form.append('with_thumbnail', String(args.with_thumbnail))
    const res = await fetch(`${OFFICE_API_BASE}/read`, { method: 'POST', body: form })
    return JSON.stringify(await parseJsonResponse(res))
  }

  return JSON.stringify({
    status: 'not_implemented',
    tool: name,
    note: `工具 "${name}" 暂未注册执行器。参数已记录。`,
    args,
  })
}
