/**
 * composables/chatCloud.ts
 * 
 * Cloud (web) lightweight chat implementation - extracted for true independence.
 * 
 * Per SDD: only depends on sessionStore + newApiClient/utils (no OpenCode, no opencodeClient, no timeline, no project dir).
 * 
 * Implements:
 * - sendWebCloudMessage for the NewAPI stream path.
 * - ensureCloudConversation: ensures a session is registered in sessionStore so it appears in FileTreePanel history immediately (inspired by old "先记录用户消息" so session stays in second column).
 * - saveCloudSnapshot: persists after stream for title/preview/messages.
 * 
 * The web branch in useChat will delegate here.
 * 
 * Preview: updated only after stream end, using last assistant message (first ~80 chars).
 */

import { useAgentStore } from '@/stores/agentStore'
import {
  buildChatCompletionExtras,
  buildChatErrorMessage,
  buildHeaders,
  resolveApiConfig,
} from '@/utils/api'
import { emitEvent } from '@/utils/eventBus'
import { useSessionStore } from '@/stores/sessionStore'
import { jinaWebSearch } from '@/utils/webSearch'
import {
  appendSystemEvidence,
  runDirectChatCompletion,
  type DirectChatCompletionRequest,
} from '@/runtime/direct/directEngine'
import {
  formatAttachmentsForLLM,
  trimAttachmentDocsByBudget,
  type AttachmentDocument,
} from '@/utils/webChatAttachments'
import { supportsVision } from '@/utils/providerConfig'
import type { SendMessageOptions, ChatMessage, AgentPhase } from './useChat'

// --- Constants and helpers (extracted/adapted from useChat.ts for cloud only) ---

const WEB_CLOUD_DEFAULT_MODEL = 'claude-sonnet-4-6'

const DIRECT_WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: '当用户问题需要最新事实、新闻、数据或超出知识截止的信息时，使用此工具通过 Jina 进行联网搜索。',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: '搜索关键词（中英文均可）' },
      },
      required: ['query'],
    },
  },
}

function chatContentToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item
      if (item?.type === 'text') return String(item.text || '')
      if (item?.type === 'image_url') return '[图片]'
      return safeJson(item, 600)
    }).filter(Boolean).join('\n')
  }
  return safeJson(value, 1200)
}

function safeJson(value: unknown, maxLength = 1200): string {
  if (typeof value === 'string') return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
  try {
    const text = JSON.stringify(value, null, 2)
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  } catch {
    return String(value)
  }
}

function buildWebCloudMessageContent(message: ChatMessage, content: string, visionModel: boolean = true): any {
  const parts = [content.trim()].filter(Boolean)
  if (message.files?.length) {
    const files = message.files.map(file => {
      const name = String(file.name || '未命名文件')
      const body = chatContentToText(file.content).trim()
      return body ? `[附件: ${name}]\n${body.slice(0, 8000)}` : `[附件: ${name}]`
    })
    parts.push(files.join('\n\n'))
  }

  const text = parts.join('\n\n').trim() || (message.images?.length ? '请分析用户上传的图片。' : '')

  // Non-vision models: strip all images, only text goes through
  // blob: and data: URLs must NEVER be sent as model-visible URLs
  if (!visionModel) {
    return text
  }

  // Vision models: include image_url parts, but filter out blob:/data:/internal refs
  const imageParts = (message.images || [])
    .map(url => String(url || '').trim())
    .filter(Boolean)
    .filter(url => !url.startsWith('blob:') && !url.startsWith('jc-media://') && !url.startsWith('data:'))
    .map(url => ({
      type: 'image_url' as const,
      image_url: { url, detail: 'auto' as const },
    }))

  if (!imageParts.length) return text
  return [
    { type: 'text' as const, text },
    ...imageParts,
  ]
}

function trimCloudChatContent(content: any, maxTextLength = 16000): any {
  if (typeof content === 'string') return content.slice(0, maxTextLength)
  return content.map((part: any) => {
    if (part.type === 'text') return { ...part, text: part.text.slice(0, maxTextLength) }
    return part
  })
}

function selectedProviderLooksLocal(providerId: string): boolean {
  return providerId === 'local-mlx' || providerId === 'local-ollama'
}

async function resolveSkillUriContent(skillContent: string): Promise<string> {
  const clean = String(skillContent || '').trim()
  if (!clean.startsWith('skill://')) return clean
  const relativePath = clean
    .replace(/^skill:\/\//, '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  if (!relativePath || relativePath.includes('..') || relativePath.includes('\0')) return ''
  const response = await fetch(`/skills/${relativePath}`)
  if (!response.ok) return ''
  return (await response.text()).slice(0, 80_000)
}

async function resolveWebSkillSystemPrompt(skillName: string, agentStore: ReturnType<typeof useAgentStore>): Promise<string> {
  const name = String(skillName || '').trim()
  if (!name) return ''
  const candidates = [
    ...agentStore.loadSkills(),
    ...agentStore.getPresetSkills(),
  ]
  const selected = candidates.find(skill => skill.name === name || skill.id === name)
  if (!selected) return ''
  const skillMd = await resolveSkillUriContent(String(selected.skillContent || ''))
  if (!skillMd.trim()) {
    return [
      `当前用户选择的 Skill：${selected.name}`,
      selected.description ? `Skill 描述：${selected.description}` : '',
    ].filter(Boolean).join('\n')
  }
  return [
    `当前用户选择的 Skill：${selected.name}`,
    '请严格按照下面的 SKILL.md 执行，但不要声称你正在调用外部工具。',
    '<SKILL.md>',
    skillMd,
    '</SKILL.md>',
  ].join('\n')
}

function resolveWebCloudModelId(options: SendMessageOptions, agentStore: ReturnType<typeof useAgentStore>): string {
  const storedProviderId = typeof localStorage !== 'undefined' ? localStorage.getItem('jcModelProviderId') : ''
  const storedModelId = typeof localStorage !== 'undefined' ? localStorage.getItem('jcModel') : ''
  const providerId = String(options.modelProviderId || storedProviderId || '')
  const modelId = String(options.modelId || agentStore.currentModel || storedModelId || '').trim()
  if (!modelId || selectedProviderLooksLocal(providerId) || modelId.startsWith('local-mlx/')) {
    return WEB_CLOUD_DEFAULT_MODEL
  }
  return modelId
}

async function buildWebCloudMessages(
  options: SendMessageOptions,
  skillName: string,
  agentStore: ReturnType<typeof useAgentStore>,
  messages: ChatMessage[],
  modelId: string,
): Promise<any[]> {
  const apiMessages: any[] = []
  const systemPrompt = [
    options.systemPrompt,
    await resolveWebSkillSystemPrompt(skillName, agentStore),
    '当前运行环境是 Web 端。不要调用本地 Shell、文件系统或桌面专属工具；只根据用户显式提供的文本、附件内容和当前对话回答。',
  ].filter(Boolean).join('\n\n')
  if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt })

  // Determine if the current model supports vision
  const visionModel = supportsVision(modelId)

  // Collect parsed attachments from the last user message for injection
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  let parsedAttachments: AttachmentDocument[] = []
  if (lastUserMsg?.parsedAttachments?.length) {
    const { included } = trimAttachmentDocsByBudget(lastUserMsg.parsedAttachments)
    parsedAttachments = included
  }

  const history = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-24)

  for (let i = 0; i < history.length; i++) {
    const message = history[i]
    const isLastUser = message === lastUserMsg
    let content: any

    if (isLastUser && parsedAttachments.length > 0) {
      // Inject parsed attachment content into the last user message
      const userText = chatContentToText(message.content)
      const attachmentBlock = formatAttachmentsForLLM(parsedAttachments)
      const fullText = attachmentBlock
        ? `${attachmentBlock}\n\n用户问题:\n${userText}`
        : userText

      // Build images: only include if model supports vision
      // Non-vision models: OCR text from parsedAttachments is the primary evidence
      let imageParts: any[] = []
      if (visionModel) {
        imageParts = (message.images || [])
          .map(url => String(url || '').trim())
          .filter(Boolean)
          .filter(url => !url.startsWith('blob:') && !url.startsWith('jc-media://') && !url.startsWith('data:'))
          .map(url => ({
            type: 'image_url' as const,
            image_url: { url, detail: 'auto' as const },
          }))
      }

      if (imageParts.length > 0) {
        content = [
          { type: 'text' as const, text: fullText },
          ...imageParts,
        ]
      } else {
        content = fullText
      }
    } else {
      content = buildWebCloudMessageContent(message, chatContentToText(message.content), visionModel)
    }

    const hasContent = typeof content === 'string' ? Boolean(content.trim()) : content.length > 0
    if (!hasContent) continue
    apiMessages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: trimCloudChatContent(content),
    })
  }

  return apiMessages.length ? apiMessages : [{ role: 'user', content: '请继续。' }]
}

// --- Main exported cloud functions ---

/**
 * 递归纯数据克隆：剥离所有不可结构化克隆的类型（Blob/File/Function/ArrayBuffer/TypedArray），
 * 确保传入 IndexedDB 的 messages/items 永远是纯可克隆数据。
 */
function toPlainClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Blob || value instanceof File || typeof value === 'function' || value instanceof ArrayBuffer || value instanceof Uint8Array) {
    return '[non-cloneable]' as any
  }
  if (Array.isArray(value)) {
    return value.map(v => toPlainClone(v)) as any
  }
  const plain: any = {}
  for (const k in value) {
    if (Object.prototype.hasOwnProperty.call(value, k)) {
      plain[k] = toPlainClone((value as any)[k])
    }
  }
  return plain
}

export function ensureCloudConversation(firstUserMessage: string): string {
  const sessionStore = useSessionStore()
  if (!sessionStore.activeSessionId) {
    const id = sessionStore.startNewSession(firstUserMessage.substring(0, 50) || '新云端对话')
    sessionStore.switchSession(id)
    // 立即插入 pending 条目到 sessions.value，确保历史列表"立刻"可见（per SDD + 老版本精神）
    sessionStore.sessions.unshift({
      id,
      title: firstUserMessage.substring(0, 50) || '新云端对话',
      preview: firstUserMessage.substring(0, 96),
      agentId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 1,
    })
    emitEvent('refresh-file-list', { category: 'history' })
    return id
  }
  return sessionStore.activeSessionId
}

export async function saveCloudSnapshot(sessionId: string, messages: ChatMessage[]): Promise<void> {
  if (!sessionId || !messages.length) return
  console.log('[JC:cloud] saveCloudSnapshot 开始, sessionId:', sessionId, 'messages count:', messages.length)
  const sessionStore = useSessionStore()
  // 关键：强制纯数据 + 递归清理数组/对象（content/images/files 等）
  const plainMessages = toPlainClone(messages)
  await sessionStore.saveSession(sessionId, '', plainMessages).catch((e: any) => {
    console.warn('[JC] cloud saveSession failed:', e)
  })
  const last = plainMessages[plainMessages.length - 1]
  if (last) {
    await sessionStore.saveSessionPreview(sessionId, '', last as any).catch((e: any) => {
      console.warn('[JC] cloud saveSessionPreview failed:', e)
    })
  }
  emitEvent('refresh-file-list', { category: 'history' })
}

export async function sendWebCloudMessage(
  options: SendMessageOptions,
  runId: number,
  controller: AbortController,
  webAssistantMsg: ChatMessage,  // pre-created by caller; we mutate its content/finishReason during stream
  setPhase: (phase: AgentPhase, detail?: string) => void,
  activeRunId: number,
  currentMessages: ChatMessage[]  // for buildWebCloudMessages, passed to avoid composable closure
) {
  const agentStore = useAgentStore()
  const selectedSkill = options.agentId ? agentStore.getSkillById(options.agentId) : null
  const skillName = selectedSkill?.name || options.skillName || options.agentName || ''

  // Note: caller (useChat) is responsible for pushing the assistantMsg before calling this.
  // We only update the passed webAssistantMsg during streaming.

  try {
    setPhase('thinking', '正在连接云端模型')
    const modelId = resolveWebCloudModelId(options, agentStore)
    const config = await resolveApiConfig({
      forceCloud: true,
      modelId,
      modelProviderId: 'jiucaihezi',
    })
    if (runId !== activeRunId || controller.signal.aborted) return

    setPhase('replying', '云端模型正在回复')
    let apiMessages = await buildWebCloudMessages(options, skillName, agentStore, currentMessages, modelId)
    const searchEnabled = typeof localStorage !== 'undefined' && localStorage.getItem('jcWebSearchEnabled') === 'true'
    if (searchEnabled) {
      const query = getLatestUserText(currentMessages).slice(0, 300)
      if (query) {
        const search = await jinaWebSearch(query, 5)
        if (search.markdown && !search.error) {
          apiMessages = appendSystemEvidence(apiMessages, search.markdown)
        }
      }
    }
    console.log('[JC:cloud] 准备 fetch, apiBase:', config.apiBase, 'model:', config.model, 'messages count:', apiMessages.length)
    const bodyPayload: any = {
      model: config.model,
      messages: apiMessages,
      temperature: 0.3,
      max_tokens: 4096,
      stream: true,
      ...buildChatCompletionExtras(config),
    }
    const sendChatCompletion = async (request: DirectChatCompletionRequest): Promise<Response> => {
      const response = await fetch(`${config.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(config),
        signal: controller.signal,
        body: JSON.stringify({
          ...bodyPayload,
          messages: request.messages,
          ...(request.tools?.length ? { tools: request.tools } : {}),
        }),
      })
      console.log('[JC:cloud] fetch 响应状态:', response.status)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(buildChatErrorMessage(response.status, payload, '云端请求失败', config.apiKey))
      }
      return response
    }

    const directResult = await runDirectChatCompletion({
      messages: apiMessages,
      tools: searchEnabled ? [DIRECT_WEB_SEARCH_TOOL] : undefined,
      onText: text => {
        if (runId === activeRunId) webAssistantMsg.content = text
      },
      runWebSearch: async query => {
        const search = await jinaWebSearch(query, 5)
        return search.markdown || search.error || 'No search results'
      },
      sendChatCompletion,
    })
    const effectiveContent = directResult.text
    console.log('[JC:cloud] 流结束, finalText 长度:', effectiveContent?.length || 0)
    if (runId !== activeRunId || controller.signal.aborted) return
    webAssistantMsg.content = effectiveContent || webAssistantMsg.content || '云端模型没有返回内容。'
    webAssistantMsg.finishReason = 'stop'
    // 防御：确保 content 是纯字符串（防止流式过程中混入非 string）
    if (webAssistantMsg) {
      webAssistantMsg.content = typeof webAssistantMsg.content === 'string'
        ? webAssistantMsg.content
        : chatContentToText(webAssistantMsg.content)
    }
    setPhase('done')
  } catch (error) {
    if (runId !== activeRunId) return
    if (controller.signal.aborted) {
      webAssistantMsg.finishReason = 'abort'
      setPhase('idle')
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    if (detail.includes('当前没有可用于模型调用的 API Key')) {
      webAssistantMsg.content = '请先登录后再使用云端对话。已为你打开设置面板，点击「一键登录」即可开始使用；也可以在「API Key」里粘贴手动 Key。'
      webAssistantMsg.finishReason = 'web_cloud_login_required'
      emitEvent('switch-panel', 'settings')
      setPhase('idle')
    } else {
      webAssistantMsg.content = `Web 云端对话失败：${detail}`
      webAssistantMsg.finishReason = 'web_cloud_error'
      setPhase('error', detail)
    }
  }
}

function getLatestUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    return chatContentToText(message.content).trim()
  }
  return ''
}
