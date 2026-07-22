import { runDirectChatCompletion, type DirectApiMessage } from '@/runtime/direct/directEngine'

export interface WorkbenchAttachment {
  id: string
  name: string
  mime: string
  value: string
}

export interface SingleTurnWorkbenchRequest {
  modelId: string
  skill: { id: string; content: string }
  input: {
    fields: Record<string, string | string[]>
    attachments: WorkbenchAttachment[]
  }
  output: {
    heading: string
    format: 'text' | 'media-plan'
  }
}

export interface SingleTurnWorkbenchResult {
  content: string
  output: string
}

export interface SingleTurnWorkbenchApiRequest {
  model: string
  messages: DirectApiMessage[]
  tools: []
}

export function buildSingleTurnWorkbenchRequest(
  request: SingleTurnWorkbenchRequest,
): SingleTurnWorkbenchApiRequest {
  const fields = Object.fromEntries(
    Object.entries(request.input.fields).map(([key, value]) => [key, value]),
  )
  const attachments = request.input.attachments.map(({ id, name, mime, value }) => ({ id, name, mime, value }))
  const outputContract = request.output.format === 'media-plan'
    ? `最终答复必须以「${request.output.heading}」为标题，并只给出该媒体计划。`
    : `最终答复必须以「${request.output.heading}」为标题，并只给出面向用户的结果。`

  return {
    model: request.modelId,
    tools: [],
    messages: [
      {
        role: 'system',
        content: [
          request.skill.content.trim(),
          outputContract,
          '这是一次独立工作台调用。只分析本次字段和附件；不要调用任何工具、读取文件或请求其他上下文。',
        ].filter(Boolean).join('\n\n'),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: JSON.stringify(fields, null, 2) },
          ...attachments.map(attachment => attachment.mime.startsWith('image/')
            ? { type: 'image_url', image_url: { url: attachment.value } }
            : { type: 'file', file: { filename: attachment.name, file_data: attachment.value } }),
        ],
      },
    ],
  }
}

export async function runSingleTurnWorkbench(
  request: SingleTurnWorkbenchRequest,
  sendChatCompletion: (request: SingleTurnWorkbenchApiRequest) => Promise<Response>,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<SingleTurnWorkbenchResult> {
  const apiRequest = buildSingleTurnWorkbenchRequest(request)
  const result = await runDirectChatCompletion({
    messages: apiRequest.messages,
    tools: apiRequest.tools,
    allowToolCalls: false,
    signal,
    onText,
    sendChatCompletion: async payload => await sendChatCompletion({
      model: apiRequest.model,
      messages: payload.messages,
      tools: [],
    }),
  })
  const content = result.text.trim()
  return { content, output: extractSingleTurnWorkbenchResult(content, request.output.heading) }
}

export function extractSingleTurnWorkbenchResult(content: string, heading: string): string {
  const normalized = String(content || '').trim()
  if (!normalized || !heading.trim()) return normalized
  const headingIndex = normalized.indexOf(heading.trim())
  if (headingIndex < 0) return normalized
  return normalized.slice(headingIndex + heading.trim().length)
    .replace(/^\s*[:：#-]?\s*/, '')
    .trim() || normalized
}
