/**
 * composables/useChat.ts — 聊天核心逻辑（工具调用完全体）
 *
 * 韭菜盒子一体化聊天链路：
 *   - Agent 状态机 (8 态)
 *   - tool_call 解析 + 执行 + 回送闭环
 *   - ToolProgress 实时追踪
 *   - SSE 流式解析
 */
import { ref, computed } from 'vue'
import { approximateTokenSize } from 'tokenx'
import { resolveApiConfig, resolveLocalMlxApiConfig, resolveLocalOllamaApiConfig, buildHeaders, buildChatErrorMessage, buildChatCompletionExtras, buildProviderNetworkErrorMessage, type ApiConfig } from '@/utils/api'
import { recallKnowledgeWithTrace } from '@/composables/useBrain'
import type { RecallKnowledgeResult } from '@/composables/useBrain'
import { jinaWebSearch, isWebSearchEnabled } from '@/utils/webSearch'
import { LOCAL_MLX_PROVIDER_ID, LOCAL_OLLAMA_PROVIDER_ID, supportsVision } from '@/utils/providerConfig'
import { describeImages } from '@/utils/imageBridge'
import { getCloudRequiredMessage, isCloudLoggedIn } from '@/services/newApiAuth'
import {
  executeOfficeToolCall,
  type ChatCompletionTool,
  type OfficeToolContext,
} from '@/composables/officeTools'
import { useFileStore } from '@/composables/useFileStore'
import { useToolStore } from '@/stores/toolStore'
import { useAgentStore } from '@/stores/agentStore'
import { useVaultStore } from '@/stores/vaultStore'
import { canExecuteToolCall } from '@/utils/chatToolPolicy'
import { buildLongFormSystemInstruction } from '@/utils/longFormPolicy'
import { executeBrowserToolCall } from '@/utils/browserTools'
import {
  executeDevProjectToolCall,
  getDevProjectRoot,
} from '@/utils/devProjectTools'
import { executeLocalContentToolCall } from '@/utils/localContentTools'
import { executeTodoToolCall } from '@/utils/todoTools'
import { executeMcpToolCall, isMcpToolName } from '@/runtime/connection/mcpToolAdapter'
import { runSkillTests, aggregateBenchmark } from '@/utils/skillTestRunner'
import { dedupeOfficeDownloadFiles, extractOfficeDownloadFiles, type OfficeDownloadFile } from '@/utils/officeDownloads'
import { resolveTextModelSelection } from '@/utils/modelSelection'
import { recordAuditedChatRun } from '@/utils/chatRunAudit'
import type { RunTrace, RunTraceSummary } from '@/utils/runTrace'
import type { RecallKnowledgeHit } from '@/utils/vaultRecallTrace'
import { getCachedProviderCapabilityProbe } from '@/utils/providerCapabilityProbe'
import { buildResponsesRequestBody, normalizeResponsesFinishReason, normalizeResponsesText } from '@/utils/llmRuntime'
import {
  buildReasoningChatExtras,
  resolveRecallRuntimeBudget,
  resolveRuntimeProfile,
  type RuntimeCapabilityTier,
  type RuntimeProfile,
} from '@/utils/runtimeCapabilities'
import { getModelContextWindow } from '@/data/modelContextWindows'
import {
  loadPublicSkillContent,
  resolveSelectedSkillCandidate,
} from '@/runtime/connection/skillConnectionAdapter'
import {
  buildDefaultChatTools,
  buildDefaultToolRequestOptions,
  isOfficeToolName,
} from '@/runtime/connection/toolConnectionAdapter'
import {
  buildChatRuntimeConnection,
  type BuildChatRuntimeConnectionResult,
} from '@/runtime/connection/chatRuntimeConnection'
import type { ConnectionSource, KnowledgeConnectionMode } from '@/runtime/connection/types'
import { ConversationContextEngine, type ConversationContextResult } from '@/runtime/conversationContext'

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
  officeDownloadFiles?: OfficeDownloadFile[] // Office 工具生成的真实文件
  images?: string[]            // 图片附件（base64 data URLs）
  files?: Array<{ name: string; content: string }>  // 文本文件附件
  finishReason?: string        // 上游结束原因，用于长文续写提示
  reasoningContent?: string    // 思考链内容（DeepSeek-R1/Claude 4.5 等模型的 reasoning）
  isMediaTask?: boolean        // 是否为媒体生成任务占位消息
  mediaTaskId?: string         // 媒体任务 ID（isMediaTask 为 true 时有效）
  searchResults?: { title: string; url: string; snippet: string }[]  // 搜索引用
  knowledgeHits?: RecallKnowledgeHit[]  // 知识库引用
  traceSummary?: RunTraceSummary // 本轮上下文摘要
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

// Agent 状态机
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

// Agent 状态
const agentPhase = ref<AgentPhase>('idle')
const agentDetail = ref('')          // 状态详情文字
const currentToolProgress = ref<ToolProgress | null>(null)
const toolHistory = ref<ToolProgress[]>([])   // 本轮所有工具调用记录

// 上下文管理（Cherry Studio 风格：按消息条数截断）
const DEFAULT_CONTEXT_COUNT = 20
const STREAM_UI_FLUSH_INTERVAL_MS = 80
let lastRuntimeContextSignature: string | null = null
// 默认输出上限 8K；长文模型可突破至 64K（按模型动态设置）
const DEFAULT_MAX_OUTPUT_TOKENS = 8192
interface UseChatRuntimeDeps {
  isCloudLoggedIn: () => Promise<boolean>
  recallKnowledgeWithTrace: (userMsg: string, opts?: Record<string, unknown>) => Promise<RecallKnowledgeResult>
}

interface RuntimeContextBaseline {
  agentId?: string | null
  skillContent?: string | null
  vaultId?: string | null
}

let testDeps: Partial<UseChatRuntimeDeps> | null = null

function getUseChatRuntimeDeps(): UseChatRuntimeDeps {
  return {
    isCloudLoggedIn: testDeps?.isCloudLoggedIn || isCloudLoggedIn,
    recallKnowledgeWithTrace: testDeps?.recallKnowledgeWithTrace || recallKnowledgeWithTrace,
  }
}

export function __setUseChatTestDeps(deps: Partial<UseChatRuntimeDeps> | null): void {
  const env = (import.meta as any).env
  const nodeEnv = (globalThis as any).process?.env
  const allowed = Boolean(env?.DEV || env?.VITEST || nodeEnv?.NODE_ENV === 'test' || nodeEnv?.VITEST)
  if (!allowed) throw new Error('__setUseChatTestDeps is only available in dev/test builds')
  testDeps = deps
}

/** 按模型 ID 返回合理的 max_tokens（输出上限），避免 Claude 长篇被截断 */
function getMaxTokensForModel(modelId?: string): number {
  if (!modelId) return DEFAULT_MAX_OUTPUT_TOKENS
  const id = modelId.toLowerCase()
  // Claude Sonnet 4.x 输出上限 64K
  if (id.includes('claude-sonnet-4')) return 64000
  // Claude Opus 4.x 输出上限 32K
  if (id.includes('claude-opus-4')) return 32000
  // GPT-5.x 输出上限 32K
  if (id.includes('gpt-5')) return 32000
  // GPT-4o 输出上限 16K
  if (id.includes('gpt-4o')) return 16384
  // DeepSeek-R1 / V3 输出 8K
  if (id.includes('deepseek')) return 8192
  // Gemini 3 Pro 输出 8K
  if (id.includes('gemini-3')) return 8192
  // Gemini 2.5 Pro 输出 16K
  if (id.includes('gemini-2.5')) return 16384
  // Doubao 1.5-pro 输出 8K
  if (id.includes('doubao')) return 8192
  // 默认 8K
  return DEFAULT_MAX_OUTPUT_TOKENS
}

function knowledgeModeForTier(tier: RuntimeCapabilityTier, vaultId?: string): KnowledgeConnectionMode {
  if (!vaultId) return 'off'
  if (tier === 'fast') return 'quick'
  if (tier === 'deep' || tier === 'full-vault') return 'deep'
  return 'standard'
}

let overflowRetried = false
const conversationContextEngine = new ConversationContextEngine()

interface ConversationContextSnapshotInput {
  selectedSkillId?: string
  primaryVaultId?: string | null
  enabledToolNames: string[]
  modelId: string
  providerId?: string
  contextMode: string
}

// ─── 内部工具 ───

function createMessageId(role: string): string {
  return role + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

// ─── Cherry Studio 风格：消息过滤管线 ───

/** 去掉"清除上下文"之前的所有消息 */
function filterAfterContextClear(msgs: ChatMessage[]): ChatMessage[] {
  const idx = [...msgs].reverse().findIndex(m => m.role === 'system' && m.content.startsWith('[上下文已清除'))
  if (idx === -1) return msgs
  return msgs.slice(msgs.length - idx)
}

/** 去掉连续重复的 user 消息（只保留最后一个） */
function filterAdjacentUserMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.filter((m, i, arr) =>
    !(m.role === 'user' && i + 1 < arr.length && arr[i + 1].role === 'user'),
  )
}

/** 去掉空内容消息 */
function filterEmptyMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.filter(m => {
    if (m.role === 'tool') return true
    return Boolean(String(m.content || '').trim())
  })
}

/** 去掉首部非 user 消息（必须以 user 开头，API 要求）*/
function filterUserRoleStartMessages(msgs: ChatMessage[]): ChatMessage[] {
  const firstUser = msgs.findIndex(m => m.role === 'user')
  if (firstUser === -1) return msgs
  return msgs.slice(firstUser)
}

function buildRuntimeContextSignature(input: {
  agentId?: string
  skillContent?: string
  vaultId?: string
  localToolsEnabled: boolean
}): string {
  return JSON.stringify({
    skill: input.agentId || '',
    skillContent: input.skillContent || '',
    knowledge: input.vaultId || '',
    tools: input.localToolsEnabled ? 'on' : 'off',
  })
}

function isolateContextOnRuntimeChange(signature: string) {
  if (lastRuntimeContextSignature && lastRuntimeContextSignature !== signature && messages.value.length > 0) {
    messages.value.push({
      id: createMessageId('system'),
      role: 'system',
      content: '[上下文已清除: 运行配置已变更]',
      timestamp: Date.now(),
    })
  }
  lastRuntimeContextSignature = signature
}

function stripAssistantRuntimeAnnotations(content?: string | null): string {
  return String(content || '').replace(/\n\n⚠️ 已达到本次输出上限，可以点击“继续写”接着生成。$/u, '')
}

function limitContextMessages(msgs: ChatMessage[], contextCountOverride?: number): ChatMessage[] {
  const count = Math.max(1, contextCountOverride || DEFAULT_CONTEXT_COUNT)
  if (msgs.length <= count) return msgs
  return msgs.slice(-count)
}

function isRuntimeConnectionCompatible(
  connection: BuildChatRuntimeConnectionResult<ChatCompletionTool, RecallKnowledgeHit> | undefined,
  input: {
    agentId?: string
    vaultId?: string
    localToolsEnabled: boolean
  },
): boolean {
  if (!connection) return false
  const runtime = connection.runtime
  if ((runtime.skill?.id || '') !== (input.agentId || '')) return false
  if ((runtime.knowledge.primaryVaultId || '') !== (input.vaultId || '')) return false
  if (Boolean(runtime.tools.enabled) !== Boolean(input.localToolsEnabled)) return false
  return true
}

/** 去掉尾部 assistant（最后一条不能是 assistant）*/
function filterLastAssistantMessage(msgs: ChatMessage[]): ChatMessage[] {
  const arr = [...msgs]
  while (arr.length > 0 && arr[arr.length - 1].role === 'assistant') {
    arr.pop()
  }
  return arr
}

/** 去掉只有错误内容的 assistant + 关联的 user */
function filterErrorOnlyMessagesWithRelated(msgs: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.role === 'assistant' && (!msg.content || msg.content.trim().startsWith('⚠️'))) {
      if (result.length > 0 && result[result.length - 1].role === 'user') {
        result.pop()
      }
      continue
    }
    result.push(msg)
  }
  return result
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

function findUserMessage(messageId: string): ChatMessage | null {
  const msg = messages.value.find(m => m.id === messageId)
  return msg?.role === 'user' && msg.id === messageId ? msg : null
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
  agentDetail.value = ''
}

function finishController(runId: number, controller: AbortController) {
  if (!isCurrentRun(runId) || abortController.value !== controller) return
  abortController.value = null
  isStreaming.value = false
}

// ingestAssistantOutput 已禁用 —— 知识库只接受用户手动添加，杜绝 AI 自动写入污染
// 手动入口保留在 FileTreePanel.vue 的 "提炼" 按钮中

async function attachAutoOfficeDownload(message: ChatMessage) {
  if (message.officeDownloadFiles?.length || !message.content.trim() || message.content.trim().startsWith('⚠️')) return
  const filesInText = extractOfficeDownloadFiles(message.content)
  if (filesInText.length) message.officeDownloadFiles = filesInText
}

async function recordConversationContextAfterAssistant(
  context: ConversationContextResult | undefined,
  userMessageId: string | undefined,
  assistantMessage: ChatMessage,
  snapshot?: ConversationContextSnapshotInput,
) {
  if (!context || !userMessageId || !assistantMessage?.id) return
  try {
    await conversationContextEngine.afterAssistantMessage({
      sessionId: context.trace.sessionId,
      runtimeSegmentId: context.runtimeSegmentId,
      runId: `run_${assistantMessage.id}`,
      sourceMessageIds: [userMessageId, assistantMessage.id],
      userMessageId,
      assistantMessageId: assistantMessage.id,
      userContent: findUserMessage(userMessageId)?.content || '',
      assistantContent: assistantMessage.content || '',
      selectedSkillId: snapshot?.selectedSkillId,
      primaryVaultId: snapshot?.primaryVaultId,
      enabledToolNames: snapshot?.enabledToolNames,
      modelId: snapshot?.modelId,
      providerId: snapshot?.providerId,
      contextMode: snapshot?.contextMode,
      loadLevel: context.loadLevel,
      promptPlan: context.trace as unknown as Record<string, unknown>,
      now: Date.now(),
    })
  } catch {
    // Conversation memory indexing must never block chat output.
  }
}

function buildLocalCapabilityInstruction(hasAgent: boolean): string {
  return `

<local_capability>
本地能力已开启。${hasAgent ? '当前Skill可以调度工具完成文件读取、格式转换和必要的本地处理。' : '未选择Skill时，你使用隐藏的默认执行器调度工具，消息仍按普通助手回复。'}
只在用户任务需要读取文件、生成文件、格式转换、计算、浏览或自动化时调用工具；不要为了展示能力而调用工具。
复杂任务、开发任务、审计任务或用户要求"逐步执行"时，先调用 todo_create 创建简短待办清单；每完成或阻塞一步时调用 todo_update，最后用自然语言总结。
生成交付物时，优先使用本地 Markdown、TXT、HTML、CSV、SRT、媒体处理和格式转换工具；本地 Office 写出器未接入前不要声称已生成 Word、Excel、PPT、PDF。
用户要求“转 Markdown / 转 MD / ToMD”或上传资料让你转换时，优先调用 document_to_markdown，不要调用旧的远端 Office 链路。
用户上传文档、音频、视频后，可先读取附件提取文本或媒体元信息；压缩、转码、抽音频、截取、静音可调用本地媒体处理工具；语音转写、字幕烧录等未直连能力只能给计划，不要伪造完成。
浏览器、源码项目命令等高风险操作必须谨慎，等待本地运行层确认，不要编造已完成的本地操作。
</local_capability>`
}

function buildDevProjectInstruction(): string {
  if (!getDevProjectRoot()) return ''
  return `

<dev_project>
用户已经选择了一个源码项目。本地开发工具可用：识别项目、列文件、搜代码、批量读文件、精准替换、查看 diff、写文件、运行构建/检查命令。
使用这些工具时只传项目内相对路径，不要传绝对路径。
修改代码前先搜索并读取相关文件；优先使用精准替换，不要整文件重写；运行命令后根据 stdout/stderr 判断下一步；不要使用 rm、管道、重定向、&& 或多条 shell 命令。
</dev_project>`
}

/**
 * 执行工具调用
 * 内置工具 + 本地执行器
 */
/** 工具参数最大 JSON 大小（防止 DoS） */
const MAX_TOOL_ARGS_LENGTH = 100_000

/** 校验工具参数：必须为对象、大小合理、无危险模式 */
function validateToolArgs(name: string, rawArgs: string): Record<string, unknown> {
  if (rawArgs.length > MAX_TOOL_ARGS_LENGTH) {
    throw new Error(`工具 "${name}" 参数过大 (${rawArgs.length} 字符)，拒绝执行`)
  }
  const parsed = JSON.parse(rawArgs || '{}')
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`工具 "${name}" 参数必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

// ─── Skill Creator 工具执行器 ───
// 单会话应用，模块级状态安全

let _lastTestResults: any[] = []
let _lastBenchmark: any = null

// ─── 清理 SKILL.md：去除 LLM 可能添加的非标准 frontmatter 字段 ───
function sanitizeSkillMd(md: string): string {
  // 去除非标准字段: model, model_id, temperature, max_tokens 等
  const nonStandard = ['model', 'model_id', 'temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty']
  for (const field of nonStandard) {
    md = md.replace(new RegExp('^' + field + ':\\s*.+\\n', 'gm'), '')
  }
  return md.trim()
}

async function executeSkillCreatorTool(call: ToolCall): Promise<string> {
  const name = call.function.name
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(call.function.arguments || '{}') } catch {}

  if (name === 'save_skill') {
    const rawMd = (args.skill_md as string) || ''
    const skillMd = sanitizeSkillMd(rawMd)
    if (!skillMd.includes('---') || !skillMd.includes('name:')) {
      return JSON.stringify({ status: 'error', message: 'skill_md 格式不正确，需要包含 YAML frontmatter' })
    }
    // 简单解析 name（去除 YAML 引号）
    const nameMatch = skillMd.match(/^---\nname:\s*(.+)/m)
    const rawName = (nameMatch?.[1] || '未命名Skill').trim()
    const skillName = rawName.replace(/^["']|["']$/g, '')
    const descMatch = skillMd.match(/^---[\s\S]*?description:\s*(.+)/m)
    const rawDesc = (descMatch?.[1] || skillMd.slice(0, 120)).trim()
    const skillDesc = rawDesc.replace(/^["']|["']$/g, '')
    const skill = {
      id: 'skill_' + Date.now().toString(36),
      name: skillName,
      description: skillDesc || skillMd.slice(0, 120),
      triggers: [] as string[],
      skillContent: skillMd,
      references: [] as string[],
      examples: [] as string[],
      version: 1,
      source: 'user' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evolutionLog: [] as any[],
    }
    try {
      const agentStore = useAgentStore()
      agentStore.createAgent(skill as any)
      agentStore.moveToMy(skill.id)
      return JSON.stringify({ status: 'ok', name: skillName, id: skill.id, message: `Skill「${skillName}」已创建保存。告诉用户可以在左侧「我的Skill」中找到它。` })
    } catch (e: any) {
      return JSON.stringify({ status: 'error', message: `保存失败: ${e.message}` })
    }
  }

  if (name === 'run_skill_tests') {
    const draftMd = (args.draft_skill_md as string) || ''
    const testCases = (args.test_cases as any[]) || []
    if (!draftMd || !testCases.length) return JSON.stringify({ status: 'error', message: '缺少 draft_skill_md 或 test_cases' })

    const results = await runSkillTests(draftMd, testCases)
    _lastTestResults = results.results

    // 自动聚合 benchmark，一次返回完整结果
    const skillName = (args.skill_name as string) || '未命名Skill'
    const bm = aggregateBenchmark(results.results, skillName)
    _lastBenchmark = bm

    return JSON.stringify({
      summary: results.summary,
      benchmark: bm.run_summary,
      notes: bm.notes,
      eval_count: testCases.length,
    })
  }

  return JSON.stringify({ status: 'not_implemented', tool: name })
}

// ─── 主工具执行器 ───

async function executeToolCall(call: ToolCall, context?: OfficeToolContext): Promise<string> {
  const name = call.function.name
  let args: Record<string, unknown> = {}
  try {
    args = validateToolArgs(name, call.function.arguments || '{}')
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: 'INVALID_TOOL_ARGUMENTS_JSON',
      tool: name,
      message: `工具 "${name}" 的参数不是合法 JSON，无法执行。`,
      detail: (err as Error).message,
    })
  }

  const todoResult = await executeTodoToolCall(call)
  if (todoResult) return todoResult

  const devProjectResult = await executeDevProjectToolCall(call)
  if (devProjectResult) return devProjectResult

  const localContentResult = await executeLocalContentToolCall(call, context)
  if (localContentResult) return localContentResult

  const browserToolResult = await executeBrowserToolCall(call)
  if (browserToolResult) return browserToolResult

  if (isOfficeToolName(name)) {
    return executeOfficeToolCall(call, context)
  }

  // skill-creator Skill的 2 个工具
  if (name === 'run_skill_tests' || name === 'save_skill') {
    return executeSkillCreatorTool(call)
  }

  // MCP 工具调用
  if (isMcpToolName(name)) {
    return executeMcpToolCall(name, args)
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
  reasoningText: string
  toolCalls: ToolCall[]
  finishReason: string
}

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (fullText: string) => void,
  onReasoning: (reasoning: string) => void,
  onToolCallDelta: (toolCalls: ToolCall[]) => void,
  onFinish: (result: SSEResult) => void,
  onError: (err: Error) => void
) {
  const decoder = new TextDecoder()
  let buffer = ''
  let fullReply = ''
  let reasoningText = ''
  let finishReason = ''
  let lastFlushAt = 0

  // 累积 tool_calls（流式模式下 tool_calls 是分片到达的）
  const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map()

  function flushDelta(force = false) {
    const now = Date.now()
    if (!force && now - lastFlushAt < STREAM_UI_FLUSH_INTERVAL_MS) return
    lastFlushAt = now
    if (fullReply) onDelta(fullReply)
    if (reasoningText) onReasoning(reasoningText)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        flushDelta(true)
        const toolCalls = buildToolCalls(toolCallAccum)
        onFinish({ fullText: fullReply, reasoningText, toolCalls, finishReason })
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          flushDelta(true)
          const toolCalls = buildToolCalls(toolCallAccum)
          onFinish({ fullText: fullReply, reasoningText, toolCalls, finishReason })
          try { await reader.cancel() } catch {}
          return
        }
        try {
          const j = JSON.parse(data)
          finishReason = j.choices?.[0]?.finish_reason || finishReason
          const delta = j.choices?.[0]?.delta

          // ★ 分离正文与思考链：reasoning_content 单独累积，不与 content 混排
          const reasoningDelta = delta?.reasoning || delta?.reasoning_content || ''
          const contentDelta = delta?.content || ''

          if (reasoningDelta) {
            reasoningText += reasoningDelta
          }
          if (contentDelta) {
            fullReply += contentDelta
          }
          if (reasoningDelta || contentDelta) {
            flushDelta()
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
    flushDelta(true)
    if ((err as Error).name === 'AbortError') {
      onError(new Error('⚠️ 生成已手动停止'))
    } else {
      onError(err as Error)
    }
  }
}

async function readOllamaChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (fullText: string) => void,
): Promise<{ fullText: string; finishReason: string }> {
  const decoder = new TextDecoder()
  let buffer = ''
  let fullReply = ''
  let finishReason = ''
  let lastFlushAt = 0

  function flushDelta(force = false) {
    if (!fullReply) return
    const now = Date.now()
    if (!force && now - lastFlushAt < STREAM_UI_FLUSH_INTERVAL_MS) return
    lastFlushAt = now
    onDelta(fullReply)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      flushDelta(true)
      return { fullText: fullReply, finishReason }
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const data = line.trim()
      if (!data) continue
      try {
        const parsed = JSON.parse(data)
        const delta = parsed?.message?.content || parsed?.response || ''
        if (delta) {
          fullReply += delta
          flushDelta()
        }
        if (parsed?.done) {
          finishReason = parsed?.done_reason || parsed?.finish_reason || ''
          flushDelta(true)
          return { fullText: fullReply, finishReason }
        }
      } catch {}
    }
  }
}

function formatStreamErrorMessage(err: Error): string {
  const message = err.message || ''
  if (err.name === 'AbortError' || message.includes('生成已手动停止')) {
    return '\n\n⚠️ 生成已手动停止'
  }

  const normalized = message.toLowerCase()
  const isNetworkError = err.name === 'TypeError'
    || normalized.includes('network')
    || normalized.includes('failed to fetch')
    || normalized.includes('load failed')
    || normalized.includes('terminated')
    || normalized.includes('body stream')

  if (isNetworkError) {
    return '\n\n⚠️ ' + buildProviderNetworkErrorMessage(err)
  }

  return '\n\n⚠️ ' + (message.startsWith('⚠️') ? message.slice(2) : message)
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

// ─── useChat composable ───

function parseToolArgs(raw: string): Record<string, unknown> {
  const text = String(raw || '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function extractToolError(raw: string): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { error?: unknown; message?: unknown }
    const error = parsed.error || parsed.message
    if (typeof error === 'string' && error.trim()) return error.trim()
  } catch {}
  return '执行失败'
}

export function useChat() {
  const toolStore = useToolStore()
  const agentStore = useAgentStore()
  // gatewayStore removed - using isCloudLoggedIn() instead

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
      modelId?: string
      modelProviderId?: string
      capabilityTier?: RuntimeCapabilityTier
      connectionSource?: ConnectionSource
      runtimeConnection?: BuildChatRuntimeConnectionResult<ChatCompletionTool, RecallKnowledgeHit>
      _parallel?: boolean  // 内部标记：多模型并行调用，跳过 isStreaming 检查
    } = {}
  ) {
    const hasAttachments = Boolean(options.images?.length || options.files?.length)
    if ((!userText.trim() && !hasAttachments) || (isStreaming.value && !options._parallel)) return

    const runtimeDeps = getUseChatRuntimeDeps()
    const runId = beginRun()
    overflowRetried = false
    const requestedLocalToolsEnabled = toolStore.localToolsEnabled

    // 3. Connection 组装：Skill + Knowledge + Tool + LLM
    const selectedSkill = resolveSelectedSkillCandidate({
      agentId: options.agentId,
      explicitSystemPrompt: options.systemPrompt,
      agents: agentStore.agents,
      currentAgent: agentStore.currentAgent,
      getSkillById: agentStore.getSkillById?.bind(agentStore),
    })

    isolateContextOnRuntimeChange(buildRuntimeContextSignature({
      agentId: options.agentId,
      skillContent: selectedSkill.skill?.skillContent || options.systemPrompt,
      vaultId: options.vaultId,
      localToolsEnabled: requestedLocalToolsEnabled,
    }))

    // 先记录用户消息，再请求配置和模型；即使 Key/API 在请求前失败，会话也能留在第二列。
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

    // 1. 解析 API 配置
    let config: ApiConfig
    const isMemberAccount = await runtimeDeps.isCloudLoggedIn()
    // 本地模型（Ollama/MLX）始终可用，无需登录
    const allowLocalModel = true
    const requestedLocalMlx = options.modelProviderId === LOCAL_MLX_PROVIDER_ID
    const requestedLocalOllama = options.modelProviderId === LOCAL_OLLAMA_PROVIDER_ID
    const requestedModelId = (requestedLocalMlx || requestedLocalOllama)
      ? (options.modelId || localStorage.getItem('jcModel') || '')  // 本地模型直接用原 ID
      : isMemberAccount
        ? (options.modelId || localStorage.getItem('jcModel') || '')
        : resolveTextModelSelection(options.modelId || localStorage.getItem('jcModel') || '', [
        { id: 'gpt-5.4', capability: 'text' },
        { id: 'claude-sonnet-4-6', capability: 'text' },
        { id: 'gemini-3.1-pro', capability: 'text' },
      ])
    try {
      config = requestedLocalMlx
        ? await resolveLocalMlxApiConfig(requestedModelId, { startLocal: false })
        : requestedLocalOllama
          ? await resolveLocalOllamaApiConfig(requestedModelId)
          : await resolveApiConfig({
            forceCloud: true,
            allowAnonymous: !isMemberAccount && !options.agentId && !options.vaultId && !hasAttachments,
            modelId: requestedModelId,
            modelProviderId: options.modelProviderId,
          })
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
        content: '⚠️ 请先在设置中登录韭菜盒子账号。',
        timestamp: Date.now(),
      })
      return
    }

    if (!isCurrentRun(runId)) return

    const effectiveLocalToolsEnabled = requestedLocalToolsEnabled  // 本地工具无需登录

    if ((options.agentId || options.vaultId) && !isMemberAccount) {
      messages.value.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: getCloudRequiredMessage(options.agentId ? 'skill' : 'knowledge'),
        timestamp: Date.now(),
      })
      return
    }

    const isLocalMlxChat = config.providerId === LOCAL_MLX_PROVIDER_ID
    const isLocalOllamaChat = config.providerId === LOCAL_OLLAMA_PROVIDER_ID
    const runtimeProfile = resolveRuntimeProfile({
      modelId: requestedModelId || config.model,
      providerId: config.providerId,
      requestedTier: options.capabilityTier || 'balanced',
      preferResponses: localStorage.getItem('jcPreferResponsesRuntime') === 'true',
      providerCapability: getCachedProviderCapabilityProbe(config.providerId, config.apiBase),
    })
    const recallBudget = resolveRecallRuntimeBudget(runtimeProfile.capabilityTier)

    const actualRuntime: RunTrace['runtime'] = isLocalMlxChat || isLocalOllamaChat
      ? 'local'
      : runtimeProfile.runtime === 'responses' && !effectiveLocalToolsEnabled
        ? 'responses'
        : 'chat-completions'

    // 联网搜索（Jina API，用户开关控制）
    let webSearchResults: { title: string; url: string; snippet: string }[] | undefined
    let webSearchEvidencePrompt = ''
    if (!isLocalMlxChat && !isLocalOllamaChat && isWebSearchEnabled()) {
      setPhase('thinking', '联网搜索中...')
      try {
        const jinaResult = await jinaWebSearch(userText, 5)
        if (jinaResult.error) {
          setPhase('thinking', `搜索失败: ${jinaResult.error.substring(0, 50)}`)
        } else if (jinaResult.markdown && jinaResult.results.length > 0) {
          webSearchEvidencePrompt = [
            '以下搜索结果已通过 API 自动获取，只能作为资料引用；请直接据此回答，无需再调用浏览器搜索工具。',
            jinaResult.markdown,
          ].join('\n\n')
          webSearchResults = jinaResult.results.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content.substring(0, 150),
          }))
          setPhase('thinking', `已搜索到 ${jinaResult.results.length} 条结果`)
        } else {
          setPhase('thinking', '搜索无结果')
        }
      } catch {
        setPhase('thinking', '搜索异常，继续回答')
      }
    }

    const localToolInstruction = !isLocalMlxChat && !isLocalOllamaChat && effectiveLocalToolsEnabled
      ? buildLocalCapabilityInstruction(Boolean(options.agentId)) + buildDevProjectInstruction()
      : ''
    const providedRuntimeConnection = isRuntimeConnectionCompatible(options.runtimeConnection, {
      agentId: options.agentId,
      vaultId: options.vaultId,
      localToolsEnabled: effectiveLocalToolsEnabled,
    }) ? options.runtimeConnection : undefined
    const conversationContext = providedRuntimeConnection
      ? undefined
      : await conversationContextEngine.build({
        userId: 'local',
        sessionId: options.sessionId || 'unsaved-session',
        userInput: userText,
        currentMessages: messages.value,
        selectedSkillId: options.agentId,
        primaryVaultId: options.vaultId || null,
        secondaryVaultIds: [],
        enabledToolNames: effectiveLocalToolsEnabled
          ? buildDefaultChatTools({
            agentId: options.agentId,
            agentName: options.agentName,
            localToolsEnabled: effectiveLocalToolsEnabled,
          }).map(tool => tool.function.name)
          : [],
        modelId: requestedModelId || config.model,
        providerId: config.providerId,
        contextBudget: getModelContextWindow(requestedModelId || config.model, config.providerId),
        contextMode: runtimeProfile.contextMode,
        now: Date.now(),
      })
    const chatConnection = providedRuntimeConnection || await buildChatRuntimeConnection<ChatCompletionTool, RecallKnowledgeHit>({
      source: options.connectionSource || (options.agentId ? 'manual' : 'plain'),
      userInput: userText,
      selectedSkill: selectedSkill.skill,
      selectedBy: 'user',
      loadSkillContent: loadPublicSkillContent,
      knowledge: {
        mode: knowledgeModeForTier(runtimeProfile.capabilityTier, options.vaultId),
        citationMode: 'summary',
        primaryVaultId: options.vaultId,
        skillId: options.agentId,
        skillHint: selectedSkill.skillHint,
        recallOptions: { ...recallBudget },
        recallKnowledge: runtimeDeps.recallKnowledgeWithTrace,
      },
      tools: {
        enabled: !isLocalMlxChat && !isLocalOllamaChat && effectiveLocalToolsEnabled,
        source: 'global',
        getTools: () => buildDefaultChatTools({
          agentId: options.agentId,
          agentName: options.agentName,
          localToolsEnabled: effectiveLocalToolsEnabled,
        }),
      },
      llm: {
        modelId: requestedModelId || config.model,
        providerId: config.providerId,
        runtime: actualRuntime,
        contextBudget: getModelContextWindow(requestedModelId || config.model, config.providerId),
      },
      prompt: {
        conversationContextEvidencePrompt: conversationContext?.evidencePrompt,
        conversationContext: conversationContext ? {
          runtimeSegmentId: conversationContext.runtimeSegmentId,
          loadLevel: conversationContext.loadLevel,
          memoryHitCount: conversationContext.memoryHits.length,
          degraded: Boolean(conversationContext.degradation),
        } : undefined,
        webSearchEvidencePrompt,
        localToolInstruction,
        longFormInstruction: buildLongFormSystemInstruction(userText),
        contextMode: runtimeProfile.contextMode,
      },
    })
    const systemPrompt = chatConnection.systemPrompt
    const contextPrompt = chatConnection.contextPrompt
    const recalled = chatConnection.knowledge.recall

    const traceSummary = recordChatRunTrace({
      runId,
      model: requestedModelId || config.model,
      runtime: actualRuntime,
      agentId: options.agentId,
      vaultId: options.vaultId,
      sections: chatConnection.plan.sections,
      contextMode: runtimeProfile.contextMode,
      knowledgeHits: recalled.hits,
      knowledgeSearched: recalled.searched,
      staticKnowledgeInjected: recalled.staticKnowledgeInjected,
      exposedTools: chatConnection.tools.map(tool => tool.function.name),
      promptPreview: systemPrompt,
    })
    if (chatConnection.skillError) {
      console.warn('[connection] skill resolution warning:', chatConnection.skillError)
    }

    // 4. 重置本轮状态
    toolHistory.value = []
    currentToolProgress.value = null
    setPhase('sending')

    // 5. 图片桥接：非 vision 模型 + 有图片 → 用轻量 vision 模型描述图片 → 注入文本
    const needsBridge = !isLocalMlxChat && !isLocalOllamaChat
      && !supportsVision(requestedModelId)
      && Boolean(userMsg.images?.length)
    if (needsBridge && userMsg.images) {
      setPhase('thinking', '图片桥接中...')
      const bridgeCtrl = new AbortController()
      const descMap = await describeImages(userMsg.images, config, bridgeCtrl.signal)
      const descs: string[] = []
      for (const img of userMsg.images) {
        descs.push(descMap.get(img) || '[图片]')
      }
      ;(userMsg as any).imageDescriptions = descs
      if (!isCurrentRun(runId)) return
    }

    if (isLocalMlxChat) {
      await runLocalMlxChat(config, systemPrompt, {
        ...options,
        modelId: requestedModelId,
        _contextPrompt: contextPrompt,
        _knowledgeHits: recalled.hits,
        _traceSummary: traceSummary,
        _conversationContext: conversationContext,
        _userMessageId: userMsg.id,
        _snapshot: {
          selectedSkillId: options.agentId,
          primaryVaultId: options.vaultId || null,
          enabledToolNames: chatConnection.tools.map(tool => tool.function.name),
          modelId: requestedModelId || config.model,
          providerId: config.providerId,
          contextMode: runtimeProfile.contextMode,
        },
      }, runId)
      return
    }

    if (isLocalOllamaChat) {
      await runLocalOllamaChat(config, systemPrompt, {
        ...options,
        _contextPrompt: contextPrompt,
        _knowledgeHits: recalled.hits,
        _traceSummary: traceSummary,
        _conversationContext: conversationContext,
        _userMessageId: userMsg.id,
        _snapshot: {
          selectedSkillId: options.agentId,
          primaryVaultId: options.vaultId || null,
          enabledToolNames: chatConnection.tools.map(tool => tool.function.name),
          modelId: requestedModelId || config.model,
          providerId: config.providerId,
          contextMode: runtimeProfile.contextMode,
        },
      }, runId)
      return
    }

    if (runtimeProfile.runtime === 'responses' && !effectiveLocalToolsEnabled) {
      await runResponsesChat(config, systemPrompt, {
        ...options,
        _searchResults: webSearchResults,
        _contextPrompt: contextPrompt,
        _knowledgeHits: recalled.hits,
        _runtimeProfile: runtimeProfile,
        _traceSummary: traceSummary,
        _conversationContext: conversationContext,
        _userMessageId: userMsg.id,
        _snapshot: {
          selectedSkillId: options.agentId,
          primaryVaultId: options.vaultId || null,
          enabledToolNames: chatConnection.tools.map(tool => tool.function.name),
          modelId: requestedModelId || config.model,
          providerId: config.providerId,
          contextMode: runtimeProfile.contextMode,
        },
      }, runId)
      return
    }

    // 开始 tool loop（传递联网搜索结果用于引用卡片）
    await runToolLoop(config, systemPrompt, {
      ...options,
      _searchResults: webSearchResults,
      _contextPrompt: contextPrompt,
      _knowledgeHits: recalled.hits,
      _runtimeProfile: runtimeProfile,
      _traceSummary: traceSummary,
      _availableTools: chatConnection.tools as ChatCompletionTool[],
      _conversationContext: conversationContext,
      _userMessageId: userMsg.id,
      _snapshot: {
        selectedSkillId: options.agentId,
        primaryVaultId: options.vaultId || null,
        enabledToolNames: chatConnection.tools.map(tool => tool.function.name),
        modelId: requestedModelId || config.model,
        providerId: config.providerId,
        contextMode: runtimeProfile.contextMode,
      },
    }, runId)
  }

  async function runLocalOllamaChat(
    config: ApiConfig,
    systemPrompt: string,
    options: {
      agentId?: string
      agentName?: string
      vaultId?: string
      images?: string[]
      files?: Array<{ name: string; content: string }>
      modelId?: string
      modelProviderId?: string
      capabilityTier?: RuntimeCapabilityTier
      _contextPrompt?: string
      _knowledgeHits?: RecallKnowledgeHit[]
      _traceSummary?: RunTraceSummary
      _conversationContext?: ConversationContextResult
      _userMessageId?: string
      _snapshot?: ConversationContextSnapshotInput
    },
    runId: number,
  ) {
    const apiMessages = buildApiMessages(systemPrompt, options.modelId, resolveContextCount(options.agentId), options._contextPrompt)
      .map(message => {
        const role = String(message.role || 'user')
        const content = typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content || '')
        return { role, content }
      })
      .filter(message => message.role === 'system' || message.role === 'user' || message.role === 'assistant')

    const aiMsg: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agentId: options.agentId,
      agentName: options.agentName,
      vaultId: options.vaultId,
      knowledgeHits: options._knowledgeHits,
      traceSummary: options._traceSummary,
    }
    messages.value.push(aiMsg)
    const aiMsgId = aiMsg.id

    isStreaming.value = true
    const controller = new AbortController()
    abortController.value = controller
    setPhase('thinking')
    let firstOutputTimedOut = false
    let firstOutputTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      firstOutputTimedOut = true
      controller.abort()
    }, 90000)
    const clearFirstOutputTimer = () => {
      if (!firstOutputTimer) return
      clearTimeout(firstOutputTimer)
      firstOutputTimer = null
    }

    try {
      const res = await fetch(config.apiBase.replace(/\/+$/, '') + '/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: apiMessages,
          stream: true,
          keep_alive: '10m',
          options: {
            num_predict: getMaxTokensForModel(options.modelId),
          },
        }),
      })

      if (!res.ok) {
        clearFirstOutputTimer()
        const raw = await res.text()
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = `Ollama ${res.status}: ${raw || '请求失败'}`
        })
        if (didWriteError && isCurrentRun(runId)) setPhase('error', `Ollama ${res.status}`)
        finishController(runId, controller)
        return
      }

      if (!res.body) {
        clearFirstOutputTimer()
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = '⚠️ Ollama 响应为空，无法读取流式内容。'
        })
        if (didWriteError && isCurrentRun(runId)) setPhase('error', '空响应')
        finishController(runId, controller)
        return
      }

      const reader = res.body.getReader()
      const result = await readOllamaChatStream(reader, (fullText) => {
        clearFirstOutputTimer()
        if (updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = fullText
        }) && agentPhase.value !== 'replying') {
          setPhase('replying')
        }
      })
      clearFirstOutputTimer()

      const didUpdateFinal = updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = result.fullText
        msg.finishReason = result.finishReason || undefined
      })
      if (!didUpdateFinal) {
        finishController(runId, controller)
        return
      }

      if (isCurrentRun(runId)) {
        setPhase('done')
        currentToolProgress.value = null
      }
      const finalMsg = findAssistantMessage(runId, aiMsgId)
      if (finalMsg) {
        await recordConversationContextAfterAssistant(options._conversationContext, options._userMessageId, finalMsg, options._snapshot)
        finishController(runId, controller)
        return
      }
      finishController(runId, controller)
    } catch (err) {
      clearFirstOutputTimer()
      if (!isCurrentRun(runId)) return
      const message = (err as Error).message
      const errMsg = firstOutputTimedOut
        ? '\n\n⚠️ Ollama 90 秒内没有输出。请确认 Ollama 已启动，并且这个模型能在 Ollama 里正常运行。'
        : formatStreamErrorMessage(err as Error)
      const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = (msg.content || '') + errMsg
        msg.finishReason = (err as Error).name === 'AbortError' || message.includes('生成已手动停止')
          ? 'abort'
          : 'network_error'
      })
      if (didWriteError) setPhase('error', message)
      finishController(runId, controller)
    }
  }

  async function runLocalMlxChat(
    initialConfig: ApiConfig,
    systemPrompt: string,
    options: {
      agentId?: string
      agentName?: string
      vaultId?: string
      images?: string[]
      files?: Array<{ name: string; content: string }>
      modelId?: string
      modelProviderId?: string
      capabilityTier?: RuntimeCapabilityTier
      _contextPrompt?: string
      _knowledgeHits?: RecallKnowledgeHit[]
      _traceSummary?: RunTraceSummary
      _conversationContext?: ConversationContextResult
      _userMessageId?: string
      _snapshot?: ConversationContextSnapshotInput
    },
    runId: number,
  ) {
    const apiMessages = buildApiMessages(systemPrompt, options.modelId, resolveContextCount(options.agentId), options._contextPrompt)
    const aiMsg: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '正在启动本地模型...',
      timestamp: Date.now(),
      agentId: options.agentId,
      agentName: options.agentName,
      vaultId: options.vaultId,
      knowledgeHits: options._knowledgeHits,
      traceSummary: options._traceSummary,
    }
    messages.value.push(aiMsg)
    const aiMsgId = aiMsg.id

    isStreaming.value = true
    const controller = new AbortController()
    abortController.value = controller
    setPhase('thinking', '正在启动本地模型')
    let localFirstOutputTimedOut = false
    let localFirstOutputTimer: ReturnType<typeof setTimeout> | null = null
    const clearLocalFirstOutputTimer = () => {
      if (!localFirstOutputTimer) return
      clearTimeout(localFirstOutputTimer)
      localFirstOutputTimer = null
    }

    try {
      const config = await resolveLocalMlxApiConfig(options.modelId || initialConfig.model)
      if (!isCurrentRun(runId)) {
        finishController(runId, controller)
        return
      }
      updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = ''
      })
      localFirstOutputTimer = setTimeout(() => {
        localFirstOutputTimedOut = true
        controller.abort()
      }, 90000)

      const res = await fetch(config.apiBase + '/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: buildHeaders(config),
        body: JSON.stringify({
          model: config.model,
          messages: apiMessages,
          stream: true,
          max_tokens: getMaxTokensForModel(options.modelId),
          ...buildChatCompletionExtras(config),
        }),
      })

      if (!res.ok) {
        clearLocalFirstOutputTimer()
        const raw = await res.text()
        let parsed = null
        try { parsed = raw ? JSON.parse(raw) : null } catch {}
        // 上下文溢出 → 自动压缩重试
        if (isContextOverflowError(res.status, raw) && !overflowRetried) {
          overflowRetried = true
          const compressed = await compressContext(messages.value, options.modelId)
          const prev = messages.value
          messages.value = compressed
          try {
            finishController(runId, controller)
            setPhase('thinking', '压缩上下文中...')
            await runToolLoop(config, systemPrompt, { ...options, _overflowRetry: true } as any, runId)
          } finally {
            messages.value = prev
          }
          return
        }
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = buildChatErrorMessage(res.status, parsed, raw || '请求失败', config.apiKey)
        })
        if (didWriteError && isCurrentRun(runId)) setPhase('error', `API ${res.status}`)
        finishController(runId, controller)
        return
      }

      if (!res.body) {
        clearLocalFirstOutputTimer()
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = '⚠️ 本地模型响应为空，无法读取流式内容。'
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
            clearLocalFirstOutputTimer()
            if (updateAssistantMessage(runId, aiMsgId, (msg) => {
              msg.content = fullText
            }) && agentPhase.value !== 'replying') {
              setPhase('replying')
            }
          },
          (_reasoning) => {},
          () => {},
          (r) => {
            clearLocalFirstOutputTimer()
            resolve(r)
          },
          (err) => {
            clearLocalFirstOutputTimer()
            reject(err)
          },
        )
      })

      const didUpdateFinal = updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = result.finishReason === 'length'
          ? `${result.fullText}\n\n⚠️ 已达到本次输出上限，可以点击“继续写”接着生成。`
          : result.fullText
        msg.reasoningContent = result.reasoningText || undefined
        msg.finishReason = result.finishReason || undefined
      })
      if (!didUpdateFinal) {
        finishController(runId, controller)
        return
      }

      if (isCurrentRun(runId)) {
        setPhase('done')
        currentToolProgress.value = null
      }
      const finalMsg = findAssistantMessage(runId, aiMsgId)
      if (finalMsg) {
        await recordConversationContextAfterAssistant(options._conversationContext, options._userMessageId, finalMsg, options._snapshot)
        finishController(runId, controller)
        return
      }
      finishController(runId, controller)
    } catch (err) {
      clearLocalFirstOutputTimer()
      if (!isCurrentRun(runId)) return
      const message = (err as Error).message
      const errMsg = localFirstOutputTimedOut
        ? '\n\n⚠️ 本地模型 90 秒内没有输出。通常是模型包不兼容、旧模型进程残留，或当前模型过大导致加载卡住。请在设置里停止/重新扫描本地模型后再试。'
        : formatStreamErrorMessage(err as Error)
      const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = (msg.content || '') + errMsg
        msg.finishReason = (err as Error).name === 'AbortError' || message.includes('生成已手动停止')
          ? 'abort'
          : 'network_error'
      })
      if (didWriteError) setPhase('error', message)
      finishController(runId, controller)
    }
  }

  async function runResponsesChat(
    config: ApiConfig,
    systemPrompt: string,
    options: {
      agentId?: string
      agentName?: string
      vaultId?: string
      images?: string[]
      files?: Array<{ name: string; content: string }>
      modelId?: string
      modelProviderId?: string
      capabilityTier?: RuntimeCapabilityTier
      _searchResults?: { title: string; url: string; snippet: string }[]
      _contextPrompt?: string
      _knowledgeHits?: RecallKnowledgeHit[]
      _runtimeProfile?: RuntimeProfile
      _traceSummary?: RunTraceSummary
      _conversationContext?: ConversationContextResult
      _userMessageId?: string
      _snapshot?: ConversationContextSnapshotInput
    },
    runId: number,
  ) {
    const apiMessages = buildApiMessages(systemPrompt, options.modelId, resolveContextCount(options.agentId), options._contextPrompt)
    const aiMsg: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agentId: options.agentId,
      agentName: options.agentName,
      vaultId: options.vaultId,
      searchResults: options._searchResults,
      knowledgeHits: options._knowledgeHits,
      traceSummary: options._traceSummary,
    }
    messages.value.push(aiMsg)
    const aiMsgId = aiMsg.id

    isStreaming.value = true
    const controller = new AbortController()
    abortController.value = controller
    setPhase('thinking')

    try {
      const res = await fetch(config.apiBase + '/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: buildHeaders(config),
        body: JSON.stringify(buildResponsesRequestBody({
          model: config.model,
          systemPrompt,
          messages: apiMessages.map(message => ({
            role: String(message.role || 'user'),
            content: (message as any).content ?? '',
          })),
          maxOutputTokens: getMaxTokensForModel(options.modelId),
          reasoningEffort: options._runtimeProfile?.reasoningEffort,
        })),
      })

      if (!res.ok) {
        const raw = await res.text()
        let parsed = null
        try { parsed = raw ? JSON.parse(raw) : null } catch {}
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          msg.content = buildChatErrorMessage(res.status, parsed, raw || '请求失败', config.apiKey)
        })
        if (didWriteError && isCurrentRun(runId)) setPhase('error', `Responses ${res.status}`)
        finishController(runId, controller)
        return
      }

      const payload = await res.json()
      const text = normalizeResponsesText(payload)
      const finishReason = normalizeResponsesFinishReason(payload)
      const didUpdateFinal = updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = finishReason === 'length'
          ? `${text || ''}\n\n⚠️ 已达到本次输出上限，可以点击“继续写”接着生成。`.trim()
          : text || '⚠️ Responses API 返回为空。'
        msg.finishReason = finishReason || (text ? undefined : 'empty_response')
      })
      if (!didUpdateFinal) {
        finishController(runId, controller)
        return
      }

      if (isCurrentRun(runId)) {
        setPhase('done')
        currentToolProgress.value = null
      }
      const finalMsg = findAssistantMessage(runId, aiMsgId)
      if (finalMsg) await recordConversationContextAfterAssistant(options._conversationContext, options._userMessageId, finalMsg, options._snapshot)
      finishController(runId, controller)
    } catch (err) {
      if (!isCurrentRun(runId)) return
      const message = (err as Error).message
      const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
        msg.content = (msg.content || '') + formatStreamErrorMessage(err as Error)
        msg.finishReason = (err as Error).name === 'AbortError' || message.includes('生成已手动停止')
          ? 'abort'
          : 'network_error'
      })
      if (didWriteError) setPhase('error', message)
      finishController(runId, controller)
    }
  }

  /**
   * ★ 核心: Tool 调用循环
   * 持续调用 LLM，直到不再返回 tool_calls
   */
  async function runToolLoop(
    config: ApiConfig,
    systemPrompt: string,
    options: {
      agentId?: string
      agentName?: string
      vaultId?: string
      images?: string[]
      files?: Array<{ name: string; content: string }>
      modelId?: string
      modelProviderId?: string
      capabilityTier?: RuntimeCapabilityTier
      _searchResults?: { title: string; url: string; snippet: string }[]
      _contextPrompt?: string
      _knowledgeHits?: RecallKnowledgeHit[]
      _runtimeProfile?: RuntimeProfile
      _traceSummary?: RunTraceSummary
      _availableTools?: ChatCompletionTool[]
      _conversationContext?: ConversationContextResult
      _userMessageId?: string
      _snapshot?: ConversationContextSnapshotInput
    },
    runId: number,
  ) {
    const MAX_TOOL_ROUNDS = options.agentId === 'preset_skill-creator' ? 15 : 10
    let round = 0
    let pendingOfficeDownloadFiles: OfficeDownloadFile[] = []

    while (round < MAX_TOOL_ROUNDS) {
      if (!isCurrentRun(runId)) return
      round++

      // 构建 API 消息（包括 tool results）
      const apiMessages = buildApiMessages(systemPrompt, options.modelId, resolveContextCount(options.agentId), options._contextPrompt)
      const effectiveLocalToolsEnabled = toolStore.localToolsEnabled  // 本地工具无需登录
      const toolPolicyInput = { ...options, localToolsEnabled: effectiveLocalToolsEnabled }
      const availableTools = effectiveLocalToolsEnabled
        ? (options._availableTools || buildDefaultChatTools(toolPolicyInput))
        : []
      const exposedToolNames = new Set(availableTools.map(tool => tool.function.name))
      const toolRequestOptions = buildDefaultToolRequestOptions(toolPolicyInput, availableTools)

      // 准备 AI 回复占位；引用和 trace 只挂到最终自然语言回答，避免落在空的 tool-call 气泡上。
      const aiMsg: ChatMessage = {
        id: createMessageId('assistant'),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        agentId: options.agentId,
        agentName: options.agentName,
        vaultId: options.vaultId,
        officeDownloadFiles: pendingOfficeDownloadFiles.length ? [...pendingOfficeDownloadFiles] : undefined,
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
            ...toolRequestOptions,
            stream: true,
            max_tokens: getMaxTokensForModel(options.modelId),
            // 单次长文输出给足预算；超过后通过“继续写”分段续写，比无限长连接更稳定。
            ...buildReasoningChatExtras(options._runtimeProfile || resolveRuntimeProfile({
              modelId: options.modelId || config.model,
              providerId: config.providerId,
              requestedTier: options.capabilityTier || 'balanced',
            }), {
              enabled: localStorage.getItem('jcGatewayReasoningExtras') === 'true',
            }),
            ...buildChatCompletionExtras(config),
          }),
        })

        if (!res.ok) {
          const raw = await res.text()
          let parsed = null
          try { parsed = raw ? JSON.parse(raw) : null } catch {}
          const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
            msg.content = buildChatErrorMessage(res.status, parsed, raw || '请求失败', config.apiKey)
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
            (_reasoning) => {
              if (updateAssistantMessage(runId, aiMsgId, (msg) => {
                msg.reasoningContent = _reasoning
              })) { /* reasoning accumulated in message */ }
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
          msg.content = result.finishReason === 'length'
            ? `${result.fullText}\n\n⚠️ 已达到本次输出上限，可以点击“继续写”接着生成。`
            : result.fullText
          msg.reasoningContent = result.reasoningText || undefined
          msg.toolCalls = result.toolCalls.length > 0 ? result.toolCalls : undefined
          msg.officeDownloadFiles = pendingOfficeDownloadFiles.length ? [...pendingOfficeDownloadFiles] : undefined
          msg.finishReason = result.finishReason || undefined
          if (!(result.finishReason === 'tool_calls' || result.toolCalls.length > 0)) {
            msg.searchResults = options._searchResults
            msg.knowledgeHits = options._knowledgeHits
            msg.traceSummary = options._traceSummary
          }
        })
        if (!didUpdateFinal) {
          finishController(runId, controller)
          return
        }

        // ★ 判断是否有 tool_calls 需要执行
        if (result.finishReason === 'tool_calls' || result.toolCalls.length > 0) {
          if (!toolStore.localToolsEnabled) {
            updateAssistantMessage(runId, aiMsgId, (msg) => {
              msg.content = '⚠️ 工具已关闭，本次工具调用已停止。请重新发送消息继续。'
              msg.toolCalls = undefined
              msg.finishReason = 'tool_disabled'
            })
            if (isCurrentRun(runId)) {
              setPhase('done')
              currentToolProgress.value = null
            }
            finishController(runId, controller)
            return
          }
          // 执行所有 tool calls
          for (const call of result.toolCalls) {
            if (!toolStore.localToolsEnabled) {
              updateAssistantMessage(runId, aiMsgId, (msg) => {
                msg.content = '⚠️ 工具已关闭，已停止后续工具流程。请重新发送消息继续。'
                msg.toolCalls = undefined
                msg.finishReason = 'tool_disabled'
              })
              if (isCurrentRun(runId)) {
                setPhase('done')
                currentToolProgress.value = null
              }
              finishController(runId, controller)
              return
            }
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
            toolStore.markRunning(call.function.name, call.id, parseToolArgs(call.function.arguments))

            // 执行
            let toolResult: string
            try {
              if (!canExecuteToolCall(call.function.name, { isMember: true, exposedToolNames })) {
                throw new Error('使用云端模型需要先登录，请在设置中登录')
              }
              toolResult = await executeToolCall(call, {
                files: options.files,
                images: options.images,
              })
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
            if (progress.isError) {
              toolStore.markError(call.function.name, call.id, extractToolError(toolResult), parseToolArgs(call.function.arguments))
            } else {
              toolStore.markDone(call.function.name, call.id, parseToolArgs(call.function.arguments))
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

            const officeFiles = extractOfficeDownloadFiles(toolResult)
            if (officeFiles.length) {
              pendingOfficeDownloadFiles = dedupeOfficeDownloadFiles([
                ...pendingOfficeDownloadFiles,
                ...officeFiles,
              ])
            }

            // 添加 tool result 消息
            const toolMsg: ChatMessage = {
              id: createMessageId('tool'),
              role: 'tool',
              content: toolResult,
              timestamp: Date.now(),
              vaultId: options.vaultId,
              toolCallId: call.id,
              toolName: call.function.name,
              officeDownloadFiles: officeFiles.length ? officeFiles : undefined,
            }
            messages.value.push(toolMsg)
          }

          // 继续循环 — 将 tool results 回送给 LLM
          if (!toolStore.localToolsEnabled) {
            updateAssistantMessage(runId, aiMsgId, (msg) => {
              msg.content = '⚠️ 工具已关闭，已停止后续工具流程。请重新发送消息继续。'
              msg.toolCalls = undefined
              msg.finishReason = 'tool_disabled'
            })
            if (isCurrentRun(runId)) {
              setPhase('done')
              currentToolProgress.value = null
            }
            finishController(runId, controller)
            return
          }
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
          await attachAutoOfficeDownload(finalMsg)
          await recordConversationContextAfterAssistant(options._conversationContext, options._userMessageId, finalMsg, options._snapshot)
          finishController(runId, controller)
          return
        }
        finishController(runId, controller)
        return

      } catch (err) {
        if (!isCurrentRun(runId)) return
        const message = (err as Error).message
        const errMsg = formatStreamErrorMessage(err as Error)
        const didWriteError = updateAssistantMessage(runId, aiMsgId, (msg) => {
          // 保留已输出的内容，错误信息追加到末尾（不覆盖几千字的输出）
          msg.content = (msg.content || '') + errMsg
          msg.finishReason = (err as Error).name === 'AbortError' || message.includes('生成已手动停止')
            ? 'abort'
            : 'network_error'
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
      content: `⚠️ 工具调用轮次超限 (最多 ${MAX_TOOL_ROUNDS} 轮)，已自动停止。`,
      timestamp: Date.now(),
    })
    setPhase('done')
    isStreaming.value = false
    abortController.value = null
  }

  /**
   * 估算消息的 token 数（粗略：1 token ≈ 4 字符英文 / 2 字符中文）
   */
  /**
   * 上下文组装（Cherry Studio 风格）
   * 按消息条数截断，不做压缩
   * 知识库内容通过 recallKnowledge 作为 user-side evidence/context 注入
   */

  /** 从 agentStore 读取当前Skill的 contextCount 配置 */
  function resolveContextCount(agentId?: string): number {
    if (!agentId) return DEFAULT_CONTEXT_COUNT
    try {
      const agentStore = useAgentStore()
      const agent = agentStore.agents?.find((a: any) => a.id === agentId) || agentStore.currentAgent
      return (agent as any)?.contextCount ?? DEFAULT_CONTEXT_COUNT
    } catch {
      return DEFAULT_CONTEXT_COUNT
    }
  }

  function recordChatRunTrace(input: {
    runId: number
    model: string
    runtime: RunTrace['runtime']
    agentId?: string
    vaultId?: string
    sections: RunTrace['contextPlan']['sections']
    contextMode?: RunTrace['contextPlan']['mode']
    knowledgeHits: RecallKnowledgeHit[]
    knowledgeSearched?: boolean
    staticKnowledgeInjected?: boolean
    exposedTools?: string[]
    promptPreview: string
  }): RunTraceSummary | undefined {
    try {
      const agentStore = useAgentStore()
      const vaultStore = useVaultStore()
      const agent = input.agentId
        ? agentStore.agents?.find((a: any) => a.id === input.agentId)
        : null
      const vault = input.vaultId
        ? vaultStore.vaults?.find(v => v.id === input.vaultId)
        : null
      return recordAuditedChatRun({
        runId: `chat_${input.runId}`,
        timestamp: Date.now(),
        model: input.model,
        runtime: input.runtime,
        agent,
        vault,
        contextMode: input.contextMode,
        sections: input.sections,
        knowledgeHits: input.knowledgeHits,
        knowledgeSearched: input.knowledgeSearched,
        staticKnowledgeInjected: input.staticKnowledgeInjected,
        exposedTools: input.exposedTools,
        promptPreview: input.promptPreview,
      })
    } catch {
      // Trace must never block chat execution.
      return undefined
    }
  }

  function buildApiMessages(systemPrompt: string, modelId?: string, _contextCountOverride?: number, contextPrompt?: string) {
    const supportsImg = supportsVision(modelId)

    // 1. Cherry Studio 过滤管线（补全至 6 步）
    let filtered = filterAfterContextClear(messages.value)
    filtered = filterErrorOnlyMessagesWithRelated(filtered)   // 去错误对
    filtered = filterLastAssistantMessage(filtered)            // 去尾 asst
    filtered = filterAdjacentUserMessages(filtered)           // 去邻 user
    filtered = filterEmptyMessages(filtered)                  // 去空

    // 3. 必须以 user 开头
    const startFiltered = filterUserRoleStartMessages(filtered)

    // 4. 清理孤立的 tool call 对（防止 API 400: function_call_output requires matching call_id）
    //    确保每个 tool 消息都有对应的 assistant+tool_calls，反之亦然
    const cleaned: typeof startFiltered = []
    for (let i = 0; i < startFiltered.length; i++) {
      const m = startFiltered[i]
      if (m.role === 'tool') {
        // tool 消息必须紧跟在带 tool_calls 的 assistant 消息之后
        // 检查前面是否有匹配的 assistant
        const hasMatchingAssistant = cleaned.some(
          prev => prev.role === 'assistant' && prev.toolCalls?.some(tc => tc.id === m.toolCallId)
        )
        if (!hasMatchingAssistant) continue // 跳过孤立的 tool 消息
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        // 检查后续是否有对应的 tool 结果消息
        const callIds = new Set(m.toolCalls.map(tc => tc.id))
        const resultIds = new Set(
          startFiltered.slice(i + 1)
            .filter(next => next.role === 'tool' && next.toolCallId && callIds.has(next.toolCallId))
            .map(next => next.toolCallId!)
        )
        const hasAllToolResults = Array.from(callIds).every(callId => resultIds.has(callId))
        if (!hasAllToolResults) {
          // 没有对应的 tool 结果 → 只保留文本内容，不发送 tool_calls
          cleaned.push({ ...m, toolCalls: undefined } as typeof m)
          continue
        }
      }
      cleaned.push(m)
    }

    // 5. 组装 API 消息
    const apiMessages: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }]
    const evidenceContext = String(contextPrompt || '').trim()
    if (evidenceContext) {
      apiMessages.push({ role: 'user', content: evidenceContext })
    }
    const historyMessages = filterUserRoleStartMessages(limitContextMessages(cleaned, _contextCountOverride))
    for (const m of historyMessages) {
      if (m.role === 'tool') {
        if (!m.toolCallId) continue // 没有 toolCallId 的 tool 消息直接跳过
        const content = (m.content?.length || 0) > 8000
          ? m.content!.substring(0, 8000) + '...(已截断)'
          : m.content
        apiMessages.push({ role: 'tool', content, tool_call_id: m.toolCallId })
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        apiMessages.push({ role: 'assistant', content: stripAssistantRuntimeAnnotations(m.content) || null, tool_calls: m.toolCalls })
      } else if (m.role === 'user' && (m.images?.length || m.files?.length)) {
        // 当前模型不支持 vision → 所有图片统一扁平化为文本，不传 image_url
        if (!supportsImg && m.images?.length) {
          const imgDescs = (m as any).imageDescriptions as string[] | undefined
          let text = m.content || ''
          for (let i = 0; i < m.images.length; i++) {
            const desc = imgDescs?.[i]
            text += desc
              ? `\n\n[图片${i + 1}: ${desc}]`
              : `\n\n[图片${i + 1}]`
          }
          if (m.files) {
            for (const f of m.files) {
              text += `\n\n[文件: ${f.name}]\n${f.content}`
            }
          }
          apiMessages.push({ role: 'user', content: text })
        } else {
          // 模型支持 vision → 正常传 image_url
          const parts: Array<Record<string, unknown>> = []
          if (m.content) parts.push({ type: 'text', text: m.content })
          if (m.images) {
            for (const img of m.images) {
              parts.push({ type: 'image_url', image_url: { url: img } })
            }
          }
          if (m.files) {
            for (const f of m.files) {
              parts.push({ type: 'text', text: `\n\n[文件: ${f.name}]\n${f.content}` })
            }
          }
          apiMessages.push({ role: 'user', content: parts })
        }
      } else {
        apiMessages.push({
          role: m.role,
          content: m.role === 'assistant' ? stripAssistantRuntimeAnnotations(m.content) : m.content,
        })
      }
    }
    return apiMessages
  }

  /**
   * 上下文溢出时自动压缩旧消息为摘要。
   * 取最早 50% 消息 → 调 haiku-4-5 摘要 → 保留最近 10 条原始。
   */
  async function compressContext(msgs: ChatMessage[], modelId?: string): Promise<ChatMessage[]> {
    if (msgs.length <= 15) return msgs
    const pivot = Math.floor(msgs.length * 0.5)
    const oldOnes = msgs.slice(0, pivot)
    const recentOnes = msgs.slice(-10)
    const oldText = oldOnes
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `[${m.role}]: ${(m.content || '').substring(0, 300)}`)
      .join('\n')
    if (!oldText.trim()) return msgs

    try {
      const res = await fetch('https://api.jiucaihezi.studio/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await (await import('@/services/newApiClient')).getApiKey()}` },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          messages: [{ role: 'user', content: `请用中文摘要以下对话要点，不超过300字：\n${oldText}` }],
          max_tokens: 500,
        }),
      })
      if (!res.ok) return msgs
      const data = await res.json()
      const summary = data?.choices?.[0]?.message?.content || ''
      if (!summary.trim()) return msgs

      const summaryMsg: ChatMessage = {
        id: createMessageId('system'),
        role: 'user',
        content: `[历史摘要] ${summary.trim()}`,
        timestamp: Date.now(),
      }
      return [summaryMsg, ...recentOnes]
    } catch {
      return msgs
    }
  }

  function isContextOverflowError(status: number, rawText: string): boolean {
    if (status !== 400 && status !== 413) return false
    const lower = rawText.toLowerCase()
    return lower.includes('context') || lower.includes('token') || lower.includes('length') || lower.includes('too large')
  }

  /** 停止生成 */
  function stopStream() {
    cancelCurrentRun()
  }

  /** 清空消息（含清除上下文标记） */
  function clearMessages() {
    cancelCurrentRun()
    lastRuntimeContextSignature = null
    messages.value = [
      {
        id: createMessageId('system'),
        role: 'system',
        content: '[上下文已清除]',
        timestamp: Date.now(),
      },
    ]
    setPhase('idle')
    toolHistory.value = []
    currentToolProgress.value = null
  }

  /** 加载历史消息 */
  function loadMessages(history: ChatMessage[], baseline?: RuntimeContextBaseline) {
    cancelCurrentRun()
    lastRuntimeContextSignature = baseline
      ? buildRuntimeContextSignature({
        agentId: baseline.agentId || undefined,
        skillContent: baseline.skillContent || undefined,
        vaultId: baseline.vaultId || undefined,
        localToolsEnabled: toolStore.localToolsEnabled,
      })
      : null
    messages.value = history
    setPhase('idle')
    toolHistory.value = []
    currentToolProgress.value = null
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
  }
}
