import type { OpencodeClient, Session } from '@opencode-ai/sdk/v2'
import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { ChatMessage } from '@/composables/useChat'
import { mapOpenCodeMessagesToChatMessages } from './messageMapper'
import type { OpenCodePromptInput, OpenCodePromptPart, OpenCodeSessionInput } from './types'
import { createOpenCodeSessionCacheBucket } from './sessionCache'
import { createOpenCodeId } from './identifier'

const messageCache = createOpenCodeSessionCacheBucket<ChatMessage[]>()

function unwrapData<T>(result: unknown): T {
  const value = result as { data?: T }
  if (value && typeof value === 'object' && 'data' in value) return value.data as T
  return result as T
}

function safeFilename(name: string, fallback: string): string {
  const normalized = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return normalized || fallback
}

function mimeFromDataUrl(url: string): string {
  const match = String(url || '').match(/^data:([^;,]+)[;,]/)
  return match?.[1] || ''
}

function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/svg+xml') return 'svg'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/markdown') return 'md'
  return 'txt'
}

function mimeFromFilename(name: string): string {
  const ext = String(name || '').split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'html' || ext === 'htm') return 'text/html'
  if (ext === 'json') return 'application/json'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  return 'text/plain'
}

function textFileDataUrl(content: string, mime: string): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`
}

function locationParams(input: { directory?: string; workspace?: string }) {
  return {
    ...(input.directory ? { directory: input.directory } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
  }
}

export function buildOpenCodePromptParts(input: {
  text?: string
  agent?: string
  images?: string[]
  files?: Array<{ name: string; content: string }>
  parts?: OpenCodePromptPart[]
}): OpenCodePromptPart[] {
  if (input.parts?.length) return input.parts
  const parts: OpenCodePromptPart[] = []
  const nextId = () => createOpenCodeId('part')
  for (const [index, imageUrl] of (input.images || []).entries()) {
    const mime = mimeFromDataUrl(imageUrl) || mimeFromFilename(imageUrl) || 'image/png'
    parts.push({
      id: nextId(),
      type: 'file',
      mime,
      filename: `image-${index + 1}.${extensionFromMime(mime)}`,
      url: imageUrl,
    })
  }
  for (const [index, file] of (input.files || []).entries()) {
    const filename = safeFilename(file.name, `attachment-${index + 1}.txt`)
    const content = String(file.content || '')
    if (content.trim()) {
      const ext = filename.split('.').pop()?.toLowerCase() || 'txt'
      const langMap: Record<string, string> = {
        md: 'markdown', json: 'json', ts: 'typescript', tsx: 'tsx',
        js: 'javascript', jsx: 'jsx', py: 'python', rs: 'rust',
        go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
        css: 'css', html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
        toml: 'toml', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
      }
      const lang = langMap[ext] || ''
      const fence = lang ? `\`\`\`${lang}` : '```'
      parts.push({
        id: nextId(),
        type: 'text',
        text: `\n\n[附件: ${filename}]\n${fence}\n${content}\n\`\`\``,
      })
    }
  }
  const text = String(input.text || '')
  if (text.trim()) parts.push({ id: nextId(), type: 'text', text })
  return parts
}

function buildPromptPayload(input: OpenCodePromptInput) {
  return {
    sessionID: input.sessionID,
    ...locationParams(input),
    model: input.model ? { providerID: input.model.providerID, modelID: input.model.modelID } : undefined,
    agent: input.agent,
    tools: input.tools,
    system: input.system,
    parts: buildOpenCodePromptParts(input),
  }
}

export async function createOpenCodeSession(client: OpencodeClient, input: OpenCodeSessionInput) {
  return unwrapData(await client.session.create({
    ...locationParams(input),
    title: input.title,
    agent: input.agent,
    model: input.model ? { providerID: input.model.providerID, id: input.model.modelID } : undefined,
    metadata: input.metadata,
    permission: input.permission,
  }))
}

// ─── 历史会话列表 · 照抄 OpenCode home.tsx L304-308 ───
// GET /session?directory=xxx&roots=true&limit=64
// 返回类型: Session[] (来自 SDK SessionListResponses)
export async function listOpenCodeSessions(
  client: OpencodeClient,
  input: {
    directory?: string
    workspace?: string
    roots?: boolean
    search?: string
    limit?: number
  } = {},
): Promise<Session[]> {
  const result = await client.session.list({
    directory: input.directory,
    workspace: input.workspace,
    roots: input.roots,
    search: input.search,
    limit: input.limit ?? 64,
  })
  const data = (result as any)?.data
  return Array.isArray(data) ? data : []
}

// ─── 单个会话详情 · 照抄 OpenCode server-session.ts L685 ───
// GET /session/:sessionID
export async function getOpenCodeSession(
  client: OpencodeClient,
  sessionID: string,
  input: { directory?: string; workspace?: string } = {},
): Promise<Session> {
  return unwrapData(await client.session.get({
    sessionID,
    ...locationParams(input),
  }))
}

export async function updateOpenCodeSessionPermission(
  client: OpencodeClient,
  sessionID: string,
  permission: PermissionRuleset,
  input: { directory?: string; workspace?: string } = {},
): Promise<void> {
  await client.session.update({ sessionID, ...locationParams(input), permission })
}

/** 更新 session 的 model（切模型时不重建 session，用 update 保持上下文） */
export async function updateOpenCodeSessionModel(
  client: OpencodeClient,
  sessionID: string,
  model: { providerID: string; modelID: string },
  input: { directory?: string; workspace?: string } = {},
): Promise<void> {
  // ponytail: SDK 类型不含 model 但运行时支持
  await (client.session.update as any)({ sessionID, ...locationParams(input), model: { providerID: model.providerID, id: model.modelID } })
}

/** fork session — 照抄 OpenCode SessionFork 端点，子 session 继承父 session 历史到 fork 点 */
export async function forkOpenCodeSession(
  client: OpencodeClient,
  parentSessionID: string,
  input: { directory?: string; messageID?: string } = {},
): Promise<Session> {
  // ponytail: SDK 类型定义与运行时 API 不完全匹配，用 as any 绕过
  const result = await (client.session.fork as any)({
    path: { id: parentSessionID },
    body: input.messageID ? { messageID: input.messageID } : undefined,
    query: input.directory ? { directory: input.directory } : undefined,
  })
  return unwrapData(result) as Session
}

/**
 * 发送 OpenCode prompt（fire-and-forget）。
 * ponytail: 照抄 OpenCode submit.ts — 用 promptAsync 立即返回 204，
 * AI 生成通过 SSE /event 流推送。调用方订阅事件流获取生成内容。
 */
export async function fireOpenCodePrompt(client: OpencodeClient, input: OpenCodePromptInput): Promise<void> {
  const payload = buildPromptPayload(input)
  // ponytail: promptAsync → POST /session/{id}/prompt_async → 204 No Content
  const response = await (client.session as any).promptAsync(payload)
  // promptAsync 返回 204，无 body。检查 HTTP 错误而非 data。
  const error = (response as any)?.error
  if (error) {
    const errMsg = error?.message || 'OpenCode prompt 提交失败，服务端无响应'
    throw new Error(errMsg)
  }
}

export async function abortOpenCodeSession(
  client: OpencodeClient,
  sessionID: string,
  input: { directory?: string; workspace?: string } = {},
): Promise<void> {
  await client.session.abort({ sessionID, ...locationParams(input) })
}

export async function listOpenCodeChatMessages(
  client: OpencodeClient,
  sessionID: string,
  options: { preferCache?: boolean; directory?: string; workspace?: string; limit?: number } = {},
): Promise<ChatMessage[]> {
  if (options.preferCache) {
    const cached = messageCache.get(sessionID)
    if (cached) return cached
  }
  // ponytail: 照抄 OpenCode server message handler — limit 默认 500
  // OpenCode server 默认 limit=50，长对话必然截断。
  // 天花板: 500 条消息足以覆盖 ~200 轮对话。若超此上限，缓存未命中时会重新全量拉取。
  const response = unwrapData<any>(await client.session.messages({
    sessionID,
    limit: options.limit ?? 500,
    ...locationParams(options),
  }))
  const messages = Array.isArray(response) ? response : response?.data || response?.messages || response?.items || []
  const mapped = mapOpenCodeMessagesToChatMessages(messages)
  messageCache.set(sessionID, mapped)
  return mapped
}

export async function prefetchOpenCodeSession(client: OpencodeClient, sessionID: string): Promise<void> {
  if (messageCache.has(sessionID)) return
  await listOpenCodeChatMessages(client, sessionID)
}

export async function getOpenCodeSessionStatus(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string } = {},
): Promise<Record<string, any>> {
  const response = unwrapData<any>(await client.session.status(locationParams(input)))
  return response && typeof response === 'object' ? response : {}
}

export function getOpenCodeStatusType(statusMap: Record<string, any> | null | undefined, sessionID = ''): string {
  if (!statusMap || typeof statusMap !== 'object') return ''

  const candidates: unknown[] = []
  const keyed = sessionID ? statusMap[sessionID] : undefined
  if (keyed) candidates.push(keyed)

  const collectSessionCandidate = (items: unknown) => {
    if (!sessionID || !Array.isArray(items)) return
    const match = items.find((item: any) => {
      const id = String(item?.id || item?.sessionID || item?.sessionId || '')
      return id === sessionID
    })
    if (match) candidates.unshift(match, (match as any).status)
  }

  collectSessionCandidate(statusMap.sessions)
  collectSessionCandidate(statusMap.data?.sessions)

  candidates.push(statusMap, statusMap.status, statusMap.data, statusMap.session)

  for (const candidate of candidates) {
    if (!candidate) continue
    if (typeof candidate === 'string') return candidate
    if (typeof candidate !== 'object') continue
    const record = candidate as Record<string, any>
    if (typeof record.type === 'string') return record.type
    if (typeof record.status === 'string') return record.status
    if (record.status && typeof record.status === 'object' && typeof record.status.type === 'string') {
      return record.status.type
    }
  }

  return ''
}

/**
 * 带超时的 status 查询。对齐官方 orElseSucceed(fallback) 模式：
 * 超时或失败时返回 fallback 值，避免永久挂起导致 UI 卡死。
 * - fallbackType='busy'：轮询通道保守策略，不误判完成
 * - fallbackType='idle'：事件通道激进策略，API 失败默认认为已完成
 */
export async function getOpenCodeSessionStatusWithTimeout(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string; sessionID?: string } = {},
  timeoutMs = 5_000,
  fallbackType: 'busy' | 'idle' = 'busy',
): Promise<Record<string, any>> {
  try {
    const result = await Promise.race([
      getOpenCodeSessionStatus(client, input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('status timeout')), timeoutMs)
      ),
    ])
    return result
  } catch {
    const sessionID = String((input as any).sessionID || '')
    return {
      __fallback: true,
      type: fallbackType,
      ...(sessionID ? { [sessionID]: { type: fallbackType } } : {}),
    }
  }
}
