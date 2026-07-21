import {
  buildDirectMessages,
  type DirectApiMessage,
  type DirectAttachmentKind,
  type ResolvedDirectAttachment,
} from '@/utils/directMessageBuilder'
import { isLocalModelProviderId } from '@/utils/providerConfig'
import {
  filterSupportedAttachments,
  findMediaSpecialist,
  resolveModelInputModalities,
  type InputCapableModel,
} from './modelInputCapabilities'

export type MediaSpecialistConsent = 'always' | 'once' | 'reject'

export interface MediaUnderstandingResult {
  assetId: string
  specialistModel: 'gemini-3.5-flash'
  modality: DirectAttachmentKind
  summary: string
  observations: string[]
  timeline?: Array<{
    startMs: number
    endMs: number
    description: string
    dialogue?: string
  }>
  transcript?: string
  uncertainties: string[]
}

export type MediaAttachmentResolution =
  | { kind: 'direct'; directAttachments: ResolvedDirectAttachment[] }
  | {
      kind: 'local_tools_required'
      directAttachments: ResolvedDirectAttachment[]
      unsupportedAttachments: ResolvedDirectAttachment[]
      reason: 'specialist_unavailable' | 'specialist_disabled' | 'specialist_rejected' | 'specialist_failed'
    }
  | {
      kind: 'assisted'
      directAttachments: ResolvedDirectAttachment[]
      unsupportedAttachments: ResolvedDirectAttachment[]
      specialistModel: 'gemini-3.5-flash'
      consent: Exclude<MediaSpecialistConsent, 'reject'>
      results: MediaUnderstandingResult[]
    }

export interface ResolveMediaAttachmentsInput {
  primaryModel: InputCapableModel
  models: readonly InputCapableModel[]
  attachments: readonly ResolvedDirectAttachment[]
  userGoal: string
  enhancementEnabled?: boolean
  modelLocked?: boolean
  requestConsent: () => Promise<MediaSpecialistConsent>
  sendCompletion: (modelId: string, messages: DirectApiMessage[]) => Promise<string>
}

function parseJson(text: string): unknown {
  const trimmed = String(text || '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  return JSON.parse(fenced || trimmed)
}

function parseUnderstandingResults(
  text: string,
  attachments: readonly ResolvedDirectAttachment[],
): MediaUnderstandingResult[] {
  const parsed = parseJson(text) as { results?: unknown[] }
  if (!Array.isArray(parsed?.results)) throw new Error('媒体专家没有返回有效的结构化结果。')
  const byId = new Map(attachments.map(attachment => [attachment.id, attachment]))
  const results: MediaUnderstandingResult[] = parsed.results.map((raw: any) => {
    const attachment = byId.get(String(raw?.assetId || ''))
    if (!attachment) throw new Error('媒体专家返回了未知素材。')
    const summary = String(raw?.summary || '').trim()
    if (!summary) throw new Error(`媒体专家没有说明 ${attachment.name} 的内容。`)
    return {
      assetId: attachment.id,
      specialistModel: 'gemini-3.5-flash',
      modality: attachment.kind,
      summary,
      observations: Array.isArray(raw?.observations)
        ? raw.observations.map(String).filter(Boolean)
        : [],
      ...(Array.isArray(raw?.timeline) ? { timeline: raw.timeline } : {}),
      ...(typeof raw?.transcript === 'string' && raw.transcript.trim()
        ? { transcript: raw.transcript.trim() }
        : {}),
      uncertainties: Array.isArray(raw?.uncertainties)
        ? raw.uncertainties.map(String).filter(Boolean)
        : [],
    }
  })
  if (
    results.length !== attachments.length
    || new Set(results.map(result => result.assetId)).size !== attachments.length
  ) {
    throw new Error('媒体专家没有返回全部素材的结果。')
  }
  return results
}

function buildSpecialistMessages(
  userGoal: string,
  attachments: readonly ResolvedDirectAttachment[],
): DirectApiMessage[] {
  return buildDirectMessages({
    messages: [{ id: 'media-specialist-user', role: 'user', content: userGoal || '分析这些媒体' }],
    systemPrompt: [
      '你只负责读取用户提供的原始媒体，不负责回答最终问题。',
      '只返回 JSON：{"results":[{"assetId":"...","modality":"image|video|audio|file","summary":"...","observations":[],"timeline":[],"transcript":"","uncertainties":[]}]}。',
      `素材 ID：${attachments.map(item => `${item.id}=${item.name}`).join('；')}`,
      '只写实际看到或听到的事实；推测写入 uncertainties。',
    ].join('\n'),
    attachments: [...attachments],
    historyLimit: null,
    visionModel: true,
    apiFormat: 'openai',
    platform: 'web',
  })
}

export async function resolveMediaAttachments(
  input: ResolveMediaAttachmentsInput,
): Promise<MediaAttachmentResolution> {
  const { supported, unsupported } = filterSupportedAttachments(
    input.attachments,
    resolveModelInputModalities(input.primaryModel),
  )
  if (!unsupported.length) return { kind: 'direct', directAttachments: supported }

  const providerId = String(input.primaryModel.providerId || '')
  if (
    input.enhancementEnabled === false
    || input.modelLocked === true
    || isLocalModelProviderId(providerId)
  ) {
    return {
      kind: 'local_tools_required',
      directAttachments: supported,
      unsupportedAttachments: unsupported,
      reason: 'specialist_disabled',
    }
  }

  const specialist = findMediaSpecialist(
    input.models,
    providerId,
    Array.from(new Set(unsupported.map(item => item.kind))),
  )
  if (!specialist) {
    return {
      kind: 'local_tools_required',
      directAttachments: supported,
      unsupportedAttachments: unsupported,
      reason: 'specialist_unavailable',
    }
  }

  const consent = await input.requestConsent()
  if (consent === 'reject') {
    return {
      kind: 'local_tools_required',
      directAttachments: supported,
      unsupportedAttachments: unsupported,
      reason: 'specialist_rejected',
    }
  }

  const specialistModel = 'gemini-3.5-flash' as const
  let response: string
  try {
    response = await input.sendCompletion(
      specialistModel,
      buildSpecialistMessages(input.userGoal, unsupported),
    )
  } catch {
    return {
      kind: 'local_tools_required',
      directAttachments: supported,
      unsupportedAttachments: unsupported,
      reason: 'specialist_failed',
    }
  }
  try {
    return {
      kind: 'assisted',
      directAttachments: supported,
      unsupportedAttachments: unsupported,
      specialistModel,
      consent,
      results: parseUnderstandingResults(response, unsupported),
    }
  } catch {
    return {
      kind: 'local_tools_required',
      directAttachments: supported,
      unsupportedAttachments: unsupported,
      reason: 'specialist_failed',
    }
  }
}

export function formatMediaUnderstanding(results: readonly MediaUnderstandingResult[]): string {
  if (!results.length) return ''
  return [
    '以下内容由媒体专家读取原始附件后提供，最终判断仍由当前主模型完成：',
    JSON.stringify(results),
  ].join('\n')
}
