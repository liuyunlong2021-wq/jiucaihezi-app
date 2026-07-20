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
import { supportsVision } from '@/utils/providerConfig'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { resolveWebSkillSystemPrompt } from '@/utils/skillContentResolver'
import { buildWebSkillCatalogPrompt, loadWebSkillCatalog } from '@/utils/skillContentResolver'
import { buildDirectMessages } from '@/utils/directMessageBuilder'
import { MEDIA_PLAN_POLICY } from '@/runtime/workbench/mediaPlan'
import {
  buildCreativeContext,
  readCreativeProjectMemory,
} from '@/runtime/direct/creativeMemory'
import { buildWebProjectToolDefinitions, createWebProjectToolExecutor } from '@/runtime/direct/webProjectTools'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { useProjectStore } from '@/stores/projectStore'
import { DEFAULT_TEXT_MODEL } from '@/utils/modelSelection'
import type { SendMessageOptions, ChatMessage, AgentPhase } from '../useChat'

// --- Constants and helpers (extracted/adapted from useChat.ts for cloud only) ---

const WEB_CLOUD_DEFAULT_MODEL = DEFAULT_TEXT_MODEL

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



function resolveWebCloudModelId(options: SendMessageOptions, agentStore: ReturnType<typeof useAgentStore>): string {
  const storedProviderId = typeof localStorage !== 'undefined' ? localStorage.getItem('jcModelProviderId') : ''
  const storedModelId = typeof localStorage !== 'undefined' ? localStorage.getItem('jcModel') : ''
  const providerId = String(options.modelProviderId || storedProviderId || '')
  const modelId = String(options.modelId || agentStore.currentModel || storedModelId || '').trim()
  if (!modelId || (providerId === 'local-mlx' || providerId === 'local-ollama') || modelId.startsWith('local-mlx/')) {
    return WEB_CLOUD_DEFAULT_MODEL
  }
  return modelId
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
  getActiveRunId: () => number,
  currentMessages: ChatMessage[]  // passed to buildDirectMessages & getLatestUserText
) {
  const agentStore = useAgentStore()
  const projectId = useProjectStore().webProjectId.value
  const selectedSkill = options.agentId ? agentStore.getSkillById(options.agentId) : null
  const skillName = selectedSkill?.name || options.skillName || options.agentName || ''
  const projectMemoryFiles = projectId ? {
    async read(path: string) {
      try { return (await webProjectFiles.read(projectId, path)).content } catch { return null }
    },
  } : undefined

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
    if (runId !== getActiveRunId() || controller.signal.aborted) return

    setPhase('replying', '云端模型正在回复')
    const visionModel = supportsVision(modelId, 'jiucaihezi')
    const skillPrompt = await resolveWebSkillSystemPrompt(
      skillName,
      [...agentStore.loadSkills(), ...agentStore.getPresetSkills()],
    )
    const [projectMemory] = await Promise.all([readCreativeProjectMemory(projectMemoryFiles)])
    const contextWindow = getModelContextWindow(modelId, 'jiucaihezi')
    const context = buildCreativeContext({
      messages: currentMessages,
      modelId,
      contextWindow,
      reservedTokens: Math.min(16_384, Math.floor(contextWindow / 4)),
      projectMemory,
    })
    const automaticSkillPrompt = buildWebSkillCatalogPrompt(await loadWebSkillCatalog())
    let apiMessages = buildDirectMessages({
      messages: context.messages,
      historyLimit: null,
      systemPrompt: [options.systemPrompt, context.systemPrompt].filter(Boolean).join('\n\n'),
      skillSystemPrompt: [options.mediaPlanPolicy || MEDIA_PLAN_POLICY, skillPrompt, automaticSkillPrompt].filter(Boolean).join('\n\n'),
      images: options.images,
      files: options.files,
      visionModel,
      apiFormat: 'openai',
      platform: 'web',
    })
    // builder 之后 push assistant
    currentMessages.push(webAssistantMsg)
    // 关键：重新取响应式代理，否则后续 mutate 的是裸对象，UI 不会重新渲染（与 main / 桌面直连路径一致）
    webAssistantMsg = currentMessages[currentMessages.length - 1]
    const searchEnabled = typeof localStorage !== 'undefined' && localStorage.getItem('jcWebSearchEnabled') === 'true'
    if (searchEnabled) {
      const query = getLatestUserText(currentMessages).slice(0, 300)
      if (query) {
        const search = await jinaWebSearch(query, 5)
        if (search.markdown && !search.error) {
          apiMessages = appendSystemEvidence(apiMessages as any, search.markdown) as any
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

    // 带 CORS/网络重试的 fetch 封装（Web 端跨域请求可能遇 Cloudflare 挑战页无 CORS 头）
    async function fetchWithCorsRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
      let lastError: unknown
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const resp = await fetch(url, init)
          return resp
        } catch (err: any) {
          lastError = err
          // TypeError 通常是 CORS 或网络错误（Failed to fetch），可重试
          const isNetworkError = err instanceof TypeError &&
            (err.message === 'Failed to fetch' ||
             err.message.includes('fetch') ||
             err.message.includes('NetworkError'))
          if (attempt < maxRetries && isNetworkError && !controller.signal.aborted) {
            console.warn(`[JC:cloud] 网络/CORS 错误，${1000 * (attempt + 1)}ms 后重试 (${attempt + 1}/${maxRetries}):`, err.message)
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
            continue
          }
          throw err
        }
      }
      throw lastError
    }

    const sendChatCompletion = async (request: DirectChatCompletionRequest): Promise<Response> => {
      const response = await fetchWithCorsRetry(`${config.apiBase}/v1/chat/completions`, {
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

    const projectToolExecutor = createWebProjectToolExecutor({
      projectId,
      files: webProjectFiles,
    })
    const executeTool = async (call: Parameters<typeof projectToolExecutor>[0]) => {
      if (controller.signal.aborted || runId !== getActiveRunId()) throw new DOMException('Aborted', 'AbortError')
      let result: { content: string }
      let toolStatus: 'succeeded' | 'failed' = 'succeeded'
      try {
        if (call.function.name !== 'web_search') result = await projectToolExecutor(call)
        else {
          const args = JSON.parse(call.function.arguments || '{}')
          const query = String(args?.query || '').trim()
          if (!query) throw new Error('query is required')
          const search = await jinaWebSearch(query, 5)
          result = { content: search.markdown || search.error || 'No search results' }
        }
      } catch (error) {
        if (controller.signal.aborted || runId !== getActiveRunId()) {
          throw new DOMException('Aborted', 'AbortError')
        }
        result = { content: `Tool error: ${error instanceof Error ? error.message : String(error)}` }
        toolStatus = 'failed'
      }
      if (controller.signal.aborted || runId !== getActiveRunId()) {
        throw new DOMException('Aborted', 'AbortError')
      }
      webAssistantMsg.toolProgress = (webAssistantMsg.toolProgress || []).map(step =>
        step.toolCallId === call.id
          ? { ...step, phase: 'result', result: result.content, isError: toolStatus === 'failed', finishedAtMs: Date.now() }
          : step,
      )
      currentMessages.push({
        id: `tool_${call.id}_${Date.now().toString(36)}`,
        role: 'tool', content: result.content, timestamp: Date.now(),
        toolCallId: call.id, toolName: call.function.name, toolStatus,
      })
      webAssistantMsg.toolStatus = toolStatus
      return result
    }
    let directRoundText = ''
    const directResult = await runDirectChatCompletion({
      messages: apiMessages,
      tools: [...buildWebProjectToolDefinitions(), ...(searchEnabled ? [DIRECT_WEB_SEARCH_TOOL] : [])],
      onText: text => {
        directRoundText = text
        webAssistantMsg.content = text
      },
      onToolCalls: calls => {
        webAssistantMsg.content = ''
        webAssistantMsg.toolCalls = [...(webAssistantMsg.toolCalls || []), ...calls]
        webAssistantMsg.toolProgress = [...(webAssistantMsg.toolProgress || []), ...calls.map(call => ({
          toolCallId: call.id,
          name: call.function.name,
          phase: 'executing' as const,
          args: call.function.arguments,
          result: null,
          isError: false,
          startedAtMs: Date.now(),
          finishedAtMs: null,
        }))]
      },
      executeTool,
      signal: controller.signal,
      sendChatCompletion,
    })
    const effectiveContent = directResult.text
    console.log('[JC:cloud] 流结束, finalText 长度:', effectiveContent?.length || 0)
    if (runId !== getActiveRunId() || controller.signal.aborted) return
    webAssistantMsg.content = effectiveContent || directRoundText || '云端模型没有返回内容。'
    webAssistantMsg.finishReason = 'stop'
    // 防御：确保 content 是纯字符串（防止流式过程中混入非 string）
    if (webAssistantMsg) {
      webAssistantMsg.content = typeof webAssistantMsg.content === 'string'
        ? webAssistantMsg.content
        : chatContentToText(webAssistantMsg.content)
    }
    setPhase('done')
  } catch (error) {
    if (runId !== getActiveRunId()) return
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
