/**
 * composables/useChat.ts — 聊天核心逻辑（工具调用完全体）
 *
 * 对标 OpenClaw-Admin stores/chat.ts:
 *   - Agent 状态机 (8 态)
 *   - tool_call 解析 + 执行 + 回送闭环
 *   - ToolProgress 实时追踪
 *   - SSE 流式解析
 */
import { ref, computed } from 'vue'
import { resolveApiConfig, buildHeaders, buildChatErrorMessage, type ApiConfig } from '@/utils/api'
import { ingestConversation, recallKnowledge } from '@/composables/useBrain'
import { useFileStore } from '@/composables/useFileStore'
import { webSearch } from '@/utils/webSearch'

// ─── 类型定义 ───

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  agentId?: string
  agentName?: string
  vaultId?: string
  toolCalls?: ToolCall[]       // AI 请求的工具调用
  toolCallId?: string          // tool result 对应的 call id
  toolName?: string            // tool result 对应的工具名
  images?: string[]            // 图片附件（base64 data URLs）
  files?: Array<{ name: string; content: string }>  // 文本文件附件
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolProgress {
  toolCallId: string
  name: string
  phase: 'start' | 'executing' | 'result'
  args: string
  result: string | null
  isError: boolean
  startedAtMs: number
  finishedAtMs: number | null
}

// Agent 状态机 (对标 OpenClaw AgentPhase)
export type AgentPhase =
  | 'idle'       // 空闲
  | 'sending'    // 发送中
  | 'thinking'   // AI 思考中
  | 'tool'       // 调用工具中
  | 'replying'   // 流式回复中
  | 'done'       // 完成
  | 'error'      // 错误

// ─── 全局响应式状态 ───

const messages = ref<ChatMessage[]>([])
const isStreaming = ref(false)
const abortController = ref<AbortController | null>(null)
let activeRunId = 0

// 联网搜索开关（持久化到 localStorage）
const webSearchEnabled = ref(localStorage.getItem('jc_web_search') === 'true')
const webSearching = ref(false)  // 搜索中状态

// Agent 状态
const agentPhase = ref<AgentPhase>('idle')
const agentDetail = ref('')          // 状态详情文字
const currentToolProgress = ref<ToolProgress | null>(null)
const toolHistory = ref<ToolProgress[]>([])   // 本轮所有工具调用记录

// 上下文压缩常量
const MAX_CONTEXT_TOKENS = 128000
const COMPRESS_THRESHOLD = 0.85  // 85% 水位线触发压缩
const KEEP_RECENT_MESSAGES = 12  // 保留最近 6 轮 (user+assistant)

// ─── 内部工具 ───

function createMessageId(role: string): string {
  return role + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

function setPhase(phase: AgentPhase, detail = '') {
  agentPhase.value = phase
  agentDetail.value = detail
}

function beginRun(): number {
  activeRunId += 1
  return activeRunId
}

function invalidateRun() {
  activeRunId += 1
}

function isCurrentRun(runId: number): boolean {
  return runId === activeRunId
}

function findAssistantMessage(runId: number, messageId: string): ChatMessage | null {
  if (!isCurrentRun(runId)) return null
  const msg = messages.value.find(m => m.id === messageId)
  return msg?.role === 'assistant' && msg.id === messageId ? msg : null
}

function updateAssistantMessage(
  runId: number,
  messageId: string,
  update: (message: ChatMessage) => void,
): boolean {
  const msg = findAssistantMessage(runId, messageId)
  if (!msg) return false
  update(msg)
  return true
}

function clearStreamingState() {
  abortController.value = null
  isStreaming.value = false
  setPhase('idle')
  currentToolProgress.value = null
}

function cancelCurrentRun() {
  invalidateRun()
  abortController.value?.abort()
  clearStreamingState()
}

function finishController(runId: number, controller: AbortController) {
  if (!isCurrentRun(runId) || abortController.value !== controller) return
  abortController.value = null
  isStreaming.value = false
}

async function ingestAssistantOutput(message: ChatMessage, options: {
  agentId?: string
  vaultId?: string
  sessionId?: string
}) {
  const content = message.content.trim()
  if (!options.vaultId || !content || content.startsWith('⚠️')) return
  await ingestConversation(options.agentId || message.agentId || 'general', `助手: ${content}`, {
    vaultId: options.vaultId,
    sessionId: options.sessionId,
    sourceMessageIds: [message.id],
  })
}

// ─── 内置工具执行器（小白按钮映射的后端） ───

// ─── Office 后端服务地址 ───
const OFFICE_API_BASE = 'https://api.jiucaihezi.studio/office'

/**
 * 执行工具调用
 * 内置工具 + Office 后端对接
 */
async function executeToolCall(call: ToolCall): Promise<string> {
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

  // 内置工具：搜索
  if (name === 'web_search' || name === 'search') {
    try {
      const query = String(args.query || args.q || '')
      if (!query) return JSON.stringify({ status: 'error', error: '缺少搜索关键词' })
      const results = await webSearch(query)
      return JSON.stringify({ status: 'success', results })
    } catch (err) {
      return JSON.stringify({ status: 'error', error: (err as Error).message })
    }
  }

  // ─── Office 工具：创建文档 ───
  if (name === 'office_create' || name === 'create_document') {
    try {
      const form = new FormData()
      form.append('doc_type', String(args.doc_type || args.format || 'docx'))
      form.append('content', typeof args.content === 'string' ? args.content : JSON.stringify(args.content || args))
      if (args.filename) form.append('filename', String(args.filename))
      const res = await fetch(`${OFFICE_API_BASE}/create`, { method: 'POST', body: form })
      const data = await res.json()
      if (data.download_url) {
        data.download_url = OFFICE_API_BASE.replace('/office', '') + data.download_url
      }
      return JSON.stringify(data)
    } catch (err) {
      return JSON.stringify({ status: 'error', error: (err as Error).message })
    }
  }

  // ─── Office 工具：格式转换 ───
  if (name === 'office_convert' || name === 'convert_document') {
    try {
      const form = new FormData()
      form.append('target_format', String(args.target_format || 'pdf'))
      // 如果有 base64 文件内容
      if (args.file_base64 && args.filename) {
        const binary = atob(String(args.file_base64))
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes])
        form.append('file', blob, String(args.filename))
      }
      const res = await fetch(`${OFFICE_API_BASE}/convert`, { method: 'POST', body: form })
      const data = await res.json()
      if (data.download_url) {
        data.download_url = OFFICE_API_BASE.replace('/office', '') + data.download_url
      }
      return JSON.stringify(data)
    } catch (err) {
      return JSON.stringify({ status: 'error', error: (err as Error).message })
    }
  }

  // ─── Office 工具：执行代码 ───
  if (name === 'office_execute' || name === 'run_code' || name === 'code_execute') {
    try {
      const form = new FormData()
      form.append('code', String(args.code || ''))
      form.append('language', String(args.language || 'python'))
      form.append('timeout', String(args.timeout || 60))
      const res = await fetch(`${OFFICE_API_BASE}/execute`, { method: 'POST', body: form })
      const data = await res.json()
      // 补全下载链接
      if (data.output_files) {
        for (const f of data.output_files) {
          if (f.download_url) {
            f.download_url = OFFICE_API_BASE.replace('/office', '') + f.download_url
          }
        }
      }
      return JSON.stringify(data)
    } catch (err) {
      return JSON.stringify({ status: 'error', error: (err as Error).message })
    }
  }

  // ─── Office 工具：读取文档 ───
  if (name === 'office_read' || name === 'read_document') {
    return JSON.stringify({
      status: 'info',
      note: '文档读取需要用户先上传文件。请让用户通过聊天界面上传文件后重试。',
    })
  }

  // ─── Graphify 知识图谱 ───
  if (name === 'build_knowledge_graph' || name === 'graphify_build') {
    try {
      const form = new FormData()
      form.append('backend', String(args.backend || 'claude'))
      if (args.api_key) form.append('api_key', String(args.api_key))
      const res = await fetch(OFFICE_API_BASE.replace('/office', '/graphify/build'), { method: 'POST', body: form })
      return JSON.stringify(await res.json())
    } catch (err) {
      return JSON.stringify({ status: 'error', error: (err as Error).message })
    }
  }

  if (name === 'query_knowledge_graph' || name === 'graphify_query') {
    try {
      const form = new FormData()
      form.append('question', String(args.question || args.query || ''))
      if (args.graph_file) form.append('graph_file', String(args.graph_file))
      const res = await fetch(OFFICE_API_BASE.replace('/office', '/graphify/query'), { method: 'POST', body: form })
      return JSON.stringify(await res.json())
    } catch (err) {
      return JSON.stringify({ status: 'error', error: (err as Error).message })
    }
  }

  // 内置工具：文件读取
  if (name === 'read_file' || name === 'file_read') {
    return JSON.stringify({
      status: 'simulated',
      note: `文件读取需要后端支持。路径: ${args.path || ''}`,
    })
  }

  // 默认：返回工具不支持
  return JSON.stringify({
    status: 'not_implemented',
    tool: name,
    note: `工具 "${name}" 暂未注册执行器。参数已记录。`,
    args: args,
  })
}

// ─── SSE 流解析器（增强版：解析 tool_calls） ───

interface SSEResult {
  fullText: string
  toolCalls: ToolCall[]
  finishReason: string
}

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (fullText: string) => void,
  onToolCallDelta: (toolCalls: ToolCall[]) => void,
  onFinish: (result: SSEResult) => void,
  onError: (err: Error) => void
) {
  const decoder = new TextDecoder()
  let buffer = ''
  let fullReply = ''
  let finishReason = ''

  // 累积 tool_calls（流式模式下 tool_calls 是分片到达的）
  const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        const toolCalls = buildToolCalls(toolCallAccum)
        onFinish({ fullText: fullReply, toolCalls, finishReason })
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          finishReason = j.choices?.[0]?.finish_reason || finishReason
          const delta = j.choices?.[0]?.delta

          // 文本内容
          if (delta?.content) {
            fullReply += delta.content
            onDelta(fullReply)
          }

          // ★ 关键：解析 tool_calls delta
          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCallAccum.has(idx)) {
                toolCallAccum.set(idx, {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  args: '',
                })
              }
              const entry = toolCallAccum.get(idx)!
              if (tc.id) entry.id = tc.id
              if (tc.function?.name) entry.name = tc.function.name
              if (tc.function?.arguments) entry.args += tc.function.arguments
            }
            onToolCallDelta(buildToolCalls(toolCallAccum))
          }
        } catch {}
      }
    }
  } catch (err) {
    // 中途断连时，先确保已读到的内容通过 onDelta 写入 msg.content
    // 这样外层 catch 追加错误信息时不会丢失已输出的几千字
    if (fullReply) {
      onDelta(fullReply)
    }
    if ((err as Error).name === 'AbortError') {
      onError(new Error('⚠️ 生成已手动停止'))
    } else {
      onError(err as Error)
    }
  }
}

function buildToolCalls(accum: Map<number, { id: string; name: string; args: string }>): ToolCall[] {
  return Array.from(accum.values())
    .filter(tc => tc.id && tc.name)
    .map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.args },
    }))
}

// ─── 上下文自动压缩 (MEM1 记忆飞轮) ───

/**
 * autoCompressIfNeeded — 当 Token 水位超 85% 时自动触发
 *
 * 策略 (Context-Engineering / MEM1 论文的简化实现):
 * 1. 保留: System Prompt + 最近 N 轮对话 (绝对不碰)
 * 2. 压缩: 中间的旧对话 → 快速模型摘要 → 存入知识库 Wiki
 * 3. 替换: 旧对话从 messages 中移除，以 <history_summary> 代替
 */
async function autoCompressIfNeeded(agentId: string, vaultId?: string, sessionId?: string) {
  if (!vaultId) return

  const totalChars = messages.value.reduce((s, m) => s + m.content.length, 0)
  const estimatedTokens = Math.ceil(totalChars / 2.5)

  // 还没到红线，跳过
  if (estimatedTokens < MAX_CONTEXT_TOKENS * COMPRESS_THRESHOLD) return

  // 太短没必要压
  if (messages.value.length <= KEEP_RECENT_MESSAGES + 2) return

  const oldMessages = messages.value.slice(0, -KEEP_RECENT_MESSAGES)
  const recentMessages = messages.value.slice(-KEEP_RECENT_MESSAGES)

  // ─── Step 1: 把旧对话存入 useBrain 的 raw/ (为后续 Wiki 编译备料) ───
  const oldText = oldMessages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(0, 8000)

  await ingestConversation(agentId || 'general', oldText, {
    vaultId,
    sessionId,
    sourceMessageIds: oldMessages.map(m => m.id),
  })

  // ─── Step 2: 快速模型生成摘要 ───
  let summary = ''
  try {
    const config = await resolveApiConfig()
    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        messages: [
          {
            role: 'system',
            content: '你是上下文压缩专家。将以下对话压缩为一份精炼的状态摘要(300字以内)。\n\n规则：\n1. 保留所有关键决策、人名、数字、设定要点\n2. 用结构化列表组织\n3. 标注每个要点属于哪个主题\n4. 输出纯中文摘要，不要任何前缀说明',
          },
          { role: 'user', content: oldText },
        ],
        max_tokens: 600,
        temperature: 0.2,
        stream: false,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      summary = data.choices?.[0]?.message?.content || ''
    }
  } catch (e) {
    console.warn('[Context Compress] 摘要生成失败，降级为截断模式:', e)
  }

  // 降级：如果 API 失败，手动截取关键句
  if (!summary) {
    summary = oldMessages
      .filter(m => m.role === 'assistant')
      .map(m => m.content.slice(0, 100))
      .slice(-5)
      .join('\n')
  }

  // ─── Step 3: 存入知识库文件 (Col2 知识库 Tab) ───
  try {
    const fileStore = useFileStore()
    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    const dateStr = new Date().toLocaleDateString('zh-CN')
    await fileStore.addFile({
      category: 'knowledge',
      vaultId,
      kind: 'summary',
      sourceSessionId: sessionId,
      sourceMessageIds: oldMessages.map(m => m.id),
      name: `记忆折叠_${dateStr}_${timeStr}`,
      content: `# 上下文压缩摘要\n\n> 压缩时间: ${new Date().toLocaleString('zh-CN')}\n> 搭子: ${agentId || '通用'}\n> 压缩前消息数: ${oldMessages.length}\n\n${summary}`,
      mimeType: 'text/markdown',
      size: summary.length,
      metadata: { type: 'context_compression', agentId, compressedAt: Date.now() },
    })
  } catch (e) {
    console.warn('[Context Compress] 知识库存储失败:', e)
  }

  // ─── Step 4: 替换旧消息为摘要系统消息 ───
  messages.value = [
    {
      id: createMessageId('system'),
      role: 'system' as const,
      content: `<history_summary>\n${summary}\n</history_summary>`,
      timestamp: Date.now(),
    },
    ...recentMessages,
  ]

  console.log(`[Context Compress] 压缩 ${oldMessages.length} 条旧消息 → 摘要 ${summary.length} 字，Token 水位重置`)
}

// ─── useChat composable ───

export function useChat() {
  /**
   * 发送消息并获取流式回复（含工具调用闭环）
   *
   * 流程:
   *   用户消息 → LLM → tool_calls?
   *     YES → 执行 tool → 回送 result → LLM → tool_calls? → ...
   *     NO  → 最终回复 → 结束
   */
  async function sendMessage(
    userText: string,
    options: {
      systemPrompt?: string
      agentId?: string
      agentName?: string
      vaultId?: string
      sessionId?: string
      images?: string[]  // 图片附件（base64 data URLs）
      files?: Array<{ name: string; content: string }>  // 文本文件附件
    } = {}
  ) {
    const hasAttachments = Boolean(options.images?.length || options.files?.length)
    if ((!userText.trim() && !hasAttachments) || isStreaming.value) return
    const runId = beginRun()

    // 1. 解析 API 配置
    let config: ApiConfig
    try {
      config = await resolveApiConfig()
    } catch (err) {
      if (!isCurrentRun(runId)) return
      messages.value.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: (err as Error).message,
        timestamp: Date.now(),
      })
      return
    }

    if (!isCurrentRun(runId)) return

    if (!config.apiKey) {
      messages.value.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: '⚠️ 未检测到 API Key，请点击左下角设置。',
        timestamp: Date.now(),
      })
      return
    }

    if (!isCurrentRun(runId)) return

    // 1.5 上下文自动压缩 (MEM1 记忆飞轮)
    await autoCompressIfNeeded(options.agentId || '', options.vaultId, options.sessionId)

    // 2. 添加用户消息（包含附件）
    const userMsg: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: userText.trim(),
      timestamp: Date.now(),
      agentId: options.agentId,
      vaultId: options.vaultId,
      images: options.images,
      files: options.files,
    }
    messages.value.push(userMsg)

    // 3. 知识回忆（只读取当前 Vault 的 IndexedDB Knowledge + 钉选）
    let systemPrompt = options.systemPrompt || '你是韭菜盒子的AI助手，请用中文回复。'
    const recalled = await recallKnowledge(userText, {
      vaultId: options.vaultId,
      skillId: options.agentId,
    })
    if (recalled) {
      systemPrompt += recalled
    }

    // 3.5 联网搜索：在发给 LLM 之前先搜索全网
    if (webSearchEnabled.value) {
      try {
        webSearching.value = true
        setPhase('thinking', '🌐 正在搜索全网...')
        const searchResult = await webSearch(userText)
        if (searchResult.markdown) {
          systemPrompt += '\n\n' + searchResult.markdown
          console.log(`[WebSearch] 搜索完成: ${searchResult.results.length} 条结果, ~${searchResult.tokenEstimate} tokens, ${searchResult.searchTime}ms`)
        }
      } catch (err) {
        console.warn('[WebSearch] 搜索失败，降级为无搜索:', (err as Error).message)
      } finally {
        webSearching.value = false
      }
    }

    // 4. 重置本轮状态
    toolHistory.value = []
    currentToolProgress.value = null
    setPhase('sending')

    // 5. 开始 tool loop
    await runToolLoop(config, systemPrompt, options, runId)
  }

  /**
   * ★ 核心: Tool 调用循环
   * 持续调用 LLM，直到不再返回 tool_calls
   */
  async function runToolLoop(
    config: ApiConfig,
    systemPrompt: string,
    options: { agentId?: string; agentName?: string; vaultId?: string },
    runId: number,
  ) {
    const MAX_TOOL_ROUNDS = 10
    let round = 0

    while (round < MAX_TOOL_ROUNDS) {
      if (!isCurrentRun(runId)) return
      round++

      // 构建 API 消息（包括 tool results）
      const apiMessages = buildApiMessages(systemPrompt)

      // 准备 AI 回复占位
      const aiMsg: ChatMessage = {
        id: createMessageId('assistant'),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        agentId: options.agentId,
        agentName: options.agentName,
        vaultId: options.vaultId,
      }
      messages.value.push(aiMsg)
      const aiMsgId = aiMsg.id

      // 流式请求
      isStreaming.value = true
      const controller = new AbortController()
      abortController.value = controller
      setPhase('thinking')

      try {
        const res = await fetch(config.apiBase + '/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: buildHeaders(config),
          body: JSON.stringify({
            model: config.model,
            messages: apiMessages,
            stream: true,
            // ChatGPT 风格：不设 max_tokens，让模型自行决定输出长度
            // 模型会根据上下文自动分配输出 token
          }),
        })

        if (!res.ok) {
          const raw = await res.text()
          let parsed = null
          try { parsed = raw ? JSON.parse(raw) : null } catch {}
          const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
            msg.content = buildChatErrorMessage(res.status, parsed, raw || '请求失败')
          })
          if (didWriteError && isCurrentRun(runId)) setPhase('error', `API ${res.status}`)
          finishController(runId, controller)
          return
        }

        // 读取 SSE 流
        if (!res.body) {
          const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
            msg.content = '⚠️ API 响应为空，无法读取流式内容。'
          })
          if (didWriteError && isCurrentRun(runId)) setPhase('error', '空响应')
          finishController(runId, controller)
          return
        }

        const reader = res.body.getReader()
        const result = await new Promise<SSEResult>((resolve, reject) => {
          readSSEStream(
            reader,
            (fullText) => {
              if (updateAssistantMessage(runId, aiMsgId, (msg) => {
                msg.content = fullText
              }) && agentPhase.value !== 'replying') {
                setPhase('replying')
              }
            },
            (toolCalls) => {
              if (!findAssistantMessage(runId, aiMsgId)) return
              // 实时显示 tool_calls
              if (agentPhase.value !== 'tool') {
                const names = toolCalls.map(tc => tc.function.name).join(', ')
                setPhase('tool', names)
              }
            },
            (r) => resolve(r),
            (err) => reject(err),
          )
        })

        // 更新最终消息
        const didUpdateFinal = updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = result.fullText
          msg.toolCalls = result.toolCalls.length > 0 ? result.toolCalls : undefined
        })
        if (!didUpdateFinal) {
          finishController(runId, controller)
          return
        }

        // ★ 判断是否有 tool_calls 需要执行
        if (result.finishReason === 'tool_calls' || result.toolCalls.length > 0) {
          // 执行所有 tool calls
          for (const call of result.toolCalls) {
            if (!findAssistantMessage(runId, aiMsgId)) {
              finishController(runId, controller)
              return
            }
            // 更新进度
            const progress: ToolProgress = {
              toolCallId: call.id,
              name: call.function.name,
              phase: 'executing',
              args: call.function.arguments,
              result: null,
              isError: false,
              startedAtMs: Date.now(),
              finishedAtMs: null,
            }
            currentToolProgress.value = progress
            setPhase('tool', call.function.name)

            // 执行
            let toolResult: string
            try {
              toolResult = await executeToolCall(call)
              try {
                const parsedToolResult = JSON.parse(toolResult) as { status?: string; error?: unknown }
                if (parsedToolResult.status === 'error' || parsedToolResult.error) {
                  progress.isError = true
                }
              } catch {}
            } catch (err) {
              toolResult = JSON.stringify({ error: (err as Error).message })
              progress.isError = true
            }

            if (!findAssistantMessage(runId, aiMsgId)) {
              finishController(runId, controller)
              return
            }

            // 更新进度
            progress.phase = 'result'
            progress.result = toolResult
            progress.finishedAtMs = Date.now()
            currentToolProgress.value = { ...progress }
            toolHistory.value.push({ ...progress })

            // 添加 tool result 消息
            const toolMsg: ChatMessage = {
              id: createMessageId('tool'),
              role: 'tool',
              content: toolResult,
              timestamp: Date.now(),
              vaultId: options.vaultId,
              toolCallId: call.id,
              toolName: call.function.name,
            }
            messages.value.push(toolMsg)
          }

          // 继续循环 — 将 tool results 回送给 LLM
          finishController(runId, controller)
          continue
        }

        // 无 tool_calls → 正常结束
        if (isCurrentRun(runId)) {
          setPhase('done')
          currentToolProgress.value = null
        }
        const finalMsg = findAssistantMessage(runId, aiMsgId)
        if (finalMsg) {
          await ingestAssistantOutput(finalMsg, options)
        }
        finishController(runId, controller)
        return

      } catch (err) {
        if (!isCurrentRun(runId)) return
        const message = (err as Error).message
        const errMsg = (err as Error).name === 'AbortError'
          ? '\n\n⚠️ 生成已手动停止'
          : '\n\n⚠️ ' + (message.startsWith('⚠️') ? message.slice(2) : message)
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          // 保留已输出的内容，错误信息追加到末尾（不覆盖几千字的输出）
          msg.content = (msg.content || '') + errMsg
        })
        if (didWriteError) setPhase('error', message)
        finishController(runId, controller)
        return
      }
    }

    // 超过最大轮次
    if (!isCurrentRun(runId)) return
    messages.value.push({
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '⚠️ 工具调用轮次超限 (最多 10 轮)，已自动停止。',
      timestamp: Date.now(),
    })
    setPhase('done')
    isStreaming.value = false
    abortController.value = null
  }

  /**
   * 估算消息的 token 数（粗略：1 token ≈ 4 字符英文 / 2 字符中文）
   */
  function estimateTokens(content: unknown): number {
    const text = typeof content === 'string' ? content : JSON.stringify(content || '')
    // 中英文混合：取较大估算值
    const enTokens = text.length / 4
    const zhChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    return Math.ceil(enTokens + zhChars * 0.5)
  }

  /**
   * 构建 API 消息列表（ChatGPT 风格：智能截断上下文）
   *
   * 策略：
   * - 保留 system prompt
   * - 从最新消息往前取，直到达到上下文预算
   * - 旧消息中的 base64 图片替换为占位符（节省 token）
   * - 上下文预算 = 模型窗口 - 预留输出空间
   */
  function buildApiMessages(systemPrompt: string) {
    // 上下文预算：预留 32K 给输出，其余给输入
    const MAX_INPUT_TOKENS = 200000 // ~200K tokens 输入预算，适配大部分模型
    const systemTokens = estimateTokens(systemPrompt)
    let remainingBudget = MAX_INPUT_TOKENS - systemTokens

    // 将消息转为 API 格式（从最新到最旧）
    const allMessages = messages.value.filter(m => m.role !== 'system')
    const selected: Array<Record<string, unknown>> = []

    // 从最新消息往前扫描
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      const isRecent = (allMessages.length - 1 - i) < 6 // 最近 3 轮（6 条消息）

      let formatted: Record<string, unknown>

      if (m.role === 'tool') {
        formatted = { role: 'tool', content: m.content, tool_call_id: m.toolCallId }
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        formatted = { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls }
      } else if (m.role === 'user' && (m.images?.length || m.files?.length)) {
        const contentParts: Array<Record<string, unknown>> = []
        if (m.content) contentParts.push({ type: 'text', text: m.content })

        // 图片：最近消息保留，旧消息移除 base64（节省大量 token）
        // 仅发送 Bedrock/Claude 支持的格式，避免 400 错误
        if (m.images) {
          const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
          for (const img of m.images) {
            if (!isRecent && img.startsWith('data:')) {
              contentParts.push({ type: 'text', text: '[图片已省略]' })
              continue
            }
            // 检查 data URL MIME 是否被支持
            if (img.startsWith('data:')) {
              const mime = img.match(/^data:([^;,]+)/)?.[1] || ''
              if (mime && !ALLOWED_MIME.includes(mime)) {
                contentParts.push({ type: 'text', text: `[不支持的图片格式: ${mime}]` })
                continue
              }
            }
            contentParts.push({ type: 'image_url', image_url: { url: img } })
          }
        }
        if (m.files) {
          for (const f of m.files) {
            contentParts.push({ type: 'text', text: `\n\n[文件: ${f.name}]\n${f.content}` })
          }
        }
        formatted = { role: 'user', content: contentParts }
      } else {
        formatted = { role: m.role, content: m.content }
      }

      const msgTokens = estimateTokens(formatted.content)

      // 最近 3 轮必须保留（即使超预算）
      if (!isRecent && msgTokens > remainingBudget) break

      remainingBudget -= msgTokens
      selected.unshift(formatted)
    }

    return [
      { role: 'system', content: systemPrompt },
      ...selected,
    ]
  }

  /** 停止生成 */
  function stopStream() {
    cancelCurrentRun()
  }

  /** 清空消息 */
  function clearMessages() {
    cancelCurrentRun()
    messages.value = []
    setPhase('idle')
    toolHistory.value = []
    currentToolProgress.value = null
  }

  /** 加载历史消息 */
  function loadMessages(history: ChatMessage[]) {
    cancelCurrentRun()
    messages.value = history
    setPhase('idle')
    toolHistory.value = []
    currentToolProgress.value = null
  }

  /** 切换联网搜索开关 */
  function toggleWebSearch() {
    webSearchEnabled.value = !webSearchEnabled.value
    localStorage.setItem('jc_web_search', String(webSearchEnabled.value))
  }

  return {
    messages,
    isStreaming,
    sendMessage,
    stopStream,
    clearMessages,
    loadMessages,
    // 工具调用状态（供 UI 消费）
    agentPhase,
    agentDetail,
    currentToolProgress,
    toolHistory,
    // 联网搜索
    webSearchEnabled,
    webSearching,
    toggleWebSearch,
  }
}
