import { LOCAL_MLX_PROVIDER_ID, LOCAL_OLLAMA_PROVIDER_ID } from './providerConfig'
import type { ProviderCapabilityProbe } from './providerCapabilityProbe'

export type LlmRuntimeKind = 'chat-completions' | 'responses' | 'local'
export type ResponsesReasoningEffort = 'low' | 'medium' | 'high'

export interface ResponsesInputMessage {
  role: string
  content: unknown
}

export interface BuildResponsesRequestBodyInput {
  model: string
  systemPrompt: string
  messages: ResponsesInputMessage[]
  maxOutputTokens?: number
  reasoningEffort?: ResponsesReasoningEffort
}

export function chooseLlmRuntime(input: {
  providerId: string
  modelId: string
  responsesCapable?: boolean
  preferResponses?: boolean
  providerCapability?: ProviderCapabilityProbe | null
}): LlmRuntimeKind {
  if (input.providerId === LOCAL_MLX_PROVIDER_ID || input.providerId === LOCAL_OLLAMA_PROVIDER_ID) return 'local'
  const responsesCapable = input.responsesCapable === true || input.providerCapability?.supportsResponses === true
  if (input.preferResponses && responsesCapable) return 'responses'
  return 'chat-completions'
}

export function normalizeResponsesText(payload: unknown): string {
  const data = payload as any
  if (typeof data?.output_text === 'string') return data.output_text.trim()
  const parts: string[] = []
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      const text = content?.text || content?.output_text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('').trim()
}

export function normalizeResponsesFinishReason(payload: unknown): string | undefined {
  const data = payload as any
  const reason = String(data?.incomplete_details?.reason || data?.incomplete_reason || '').trim()
  if (data?.status === 'incomplete') {
    if (reason === 'max_output_tokens' || reason === 'max_tokens' || reason === 'length') return 'length'
    return reason || 'incomplete'
  }
  return undefined
}

export function buildResponsesRequestBody(input: BuildResponsesRequestBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    instructions: String(input.systemPrompt || ''),
    input: (input.messages || [])
      .filter(message => message.role !== 'system')
      .map(message => ({
        role: normalizeResponsesRole(message.role),
        content: normalizeResponsesContent(message.content),
      })),
  }
  if (input.maxOutputTokens) body.max_output_tokens = input.maxOutputTokens
  if (input.reasoningEffort) body.reasoning = { effort: input.reasoningEffort }
  return body
}

function normalizeResponsesRole(role: string): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user'
}

function normalizeResponsesContent(content: unknown): string {
  if (typeof content === 'string') return content
  return JSON.stringify(content || '')
}
