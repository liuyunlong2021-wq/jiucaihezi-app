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
  getAssistantMessageContent,
  resolveApiConfig,
} from '@/utils/api'
import { getApiKey } from '@/services/newApiClient'
import { emitEvent } from '@/utils/eventBus'
import { useSessionStore } from '@/stores/sessionStore'
import type { SendMessageOptions, ChatMessage, AgentPhase } from './useChat'

// --- Constants and helpers (extracted/adapted from useChat.ts for cloud only) ---

const WEB_CLOUD_DEFAULT_MODEL = 'claude-sonnet-4-6'

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

function appendWebMessageAttachments(message: ChatMessage, content: string): string {
  const parts = [content.trim()].filter(Boolean)
  if (message.files?.length) {
    const files = message.files.map(file => {
      const name = String(file.name || '未命名文件')
      const body = chatContentToText(file.content).trim()
      return body ? `[附件: ${name}]\n${body.slice(0, 8000)}` : `[附件: ${name}]`
    })
    parts.push(files.join('\n\n'))
  }
  if (message.images?.length) {
    parts.push(`[图片附件: ${message.images.length} 张。Web 端当前不读取图片二进制内容。]`)
  }
  return parts.join('\n\n').trim()
}

function buildWebCloudMessageContent(message: ChatMessage, content: string): any {
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
  const imageParts = (message.images || [])
    .map(url => String(url || '').trim())
    .filter(Boolean)
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
  messages: ChatMessage[]  // passed in for independence, no closure over composable ref
): Promise<any[]> {
  const apiMessages: any[] = []
  const systemPrompt = [
    options.systemPrompt,
    await resolveWebSkillSystemPrompt(skillName, agentStore),
    '当前运行环境是 Web 端。不要调用本地 Shell、文件系统或桌面专属工具；只根据用户显式提供的文本、附件内容和当前对话回答。',
  ].filter(Boolean).join('\n\n')
  if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt })

  const history = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-24)

  for (const message of history) {
    const content = buildWebCloudMessageContent(message, chatContentToText(message.content))
    const hasContent = typeof content === 'string' ? Boolean(content.trim()) : content.length > 0
    if (!hasContent) continue
    apiMessages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: trimCloudChatContent(content),
    })
  }

  return apiMessages.length ? apiMessages : [{ role: 'user', content: '请继续。' }]
}

async function readOpenAiCompatibleStream(response: Response, onText: (text: string) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const data = await response.json()
    const text = chatContentToText(getAssistantMessageContent(data)).trim()
    onText(text)
    return text
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let streamDone = false
  try {
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        if (raw === '[DONE]') {
          streamDone = true
          break
        }
        try {
          const parsed = JSON.parse(raw)
          const delta = String(parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.delta?.reasoning_content || '')
          if (delta) {
            accumulated += delta
            onText(accumulated)
          }
        } catch {
          // Ignore keep-alive or provider-specific non-JSON stream rows.
        }
      }
    }
  } finally {
    // cleanup if needed
  }
  return accumulated
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

export function saveCloudSnapshot(sessionId: string, messages: ChatMessage[]): void {
  if (!sessionId || !messages.length) return
  const sessionStore = useSessionStore()
  // 关键：强制纯数据 + 递归清理数组/对象（content/images/files 等）
  const plainMessages = toPlainClone(messages)
  sessionStore.saveSession(sessionId, '', plainMessages).catch((e: any) => {
    console.warn('[JC] cloud saveSession failed:', e)
  })
  const last = plainMessages[plainMessages.length - 1]
  if (last) {
    sessionStore.saveSessionPreview(sessionId, '', last as any).catch((e: any) => {
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

  if (!getApiKey()) {
    // Note: caller already pushed user; we can still push a login prompt assistant here if desired,
    // but per SDD flow, the ensure already made the session visible.
    const loginPromptMsg: ChatMessage = {
      id: (webAssistantMsg.id || 'login') + '-login',
      role: 'assistant',
      content: '请先登录后再使用云端对话。已为你打开设置面板，点击「一键登录」即可开始使用；也可以在「API Key」里粘贴手动 Key。',
      timestamp: Date.now(),
      agentId: options.agentId,
      agentName: options.agentName || skillName,
      finishReason: 'web_cloud_login_required',
      continuationParentId: options._continuationParentId,
    }
    // In extraction, the caller manages messages array; for now we emit or let caller handle.
    // To keep behavior, push is left to caller if needed; here we just set on a temp or return early.
    webAssistantMsg.content = loginPromptMsg.content
    webAssistantMsg.finishReason = loginPromptMsg.finishReason
    emitEvent('switch-panel', 'settings')
    setPhase('idle')
    if (runId === activeRunId) {
      // caller will handle isStreaming etc.
    }
    return
  }

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
    const apiMessages = await buildWebCloudMessages(options, skillName, agentStore, currentMessages)
    const response = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: apiMessages,
        temperature: 0.3,
        max_tokens: 4096,
        stream: true,
        ...buildChatCompletionExtras(config),
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(buildChatErrorMessage(response.status, payload, '云端请求失败', config.apiKey))
    }

    const finalText = await readOpenAiCompatibleStream(response, text => {
      if (runId === activeRunId) webAssistantMsg.content = text
    })
    if (runId !== activeRunId || controller.signal.aborted) return
    webAssistantMsg.content = finalText || webAssistantMsg.content || '云端模型没有返回内容。'
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
    webAssistantMsg.content = `Web 云端对话失败：${detail}`
    webAssistantMsg.finishReason = 'web_cloud_error'
    setPhase('error', detail)
  }
}