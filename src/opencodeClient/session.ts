import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { ChatMessage } from '@/composables/useChat'
import { mapOpenCodeMessagesToChatMessages } from './messageMapper'
import type { OpenCodePromptInput, OpenCodePromptPart, OpenCodeSessionInput } from './types'
import { createOpenCodeSessionCacheBucket } from './sessionCache'

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
  const agent = String(input.agent || '').trim()
  if (agent) parts.push({ type: 'agent', name: agent })
  for (const [index, imageUrl] of (input.images || []).entries()) {
    const mime = mimeFromDataUrl(imageUrl) || mimeFromFilename(imageUrl) || 'image/png'
    parts.push({
      type: 'file',
      mime,
      filename: `image-${index + 1}.${extensionFromMime(mime)}`,
      url: imageUrl,
    })
  }
  for (const [index, file] of (input.files || []).entries()) {
    const filename = safeFilename(file.name, `attachment-${index + 1}.txt`)
    const content = String(file.content || '')
    // Fix A: 文件内容内联为 text part，不使用 jiucaihezi:// 协议。
    // OpenCode 的 read 工具无法解析自定义协议，会导致 "Resource not found"。
    // 文本类文件（所有带 content 字段的）直接内联到 prompt 中。
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
        type: 'text',
        text: `\n\n[附件: ${filename}]\n${fence}\n${content}\n\`\`\``,
      })
    }
  }
  const text = String(input.text || '')
  if (text.trim()) parts.push({ type: 'text', text })
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

export async function updateOpenCodeSessionPermission(
  client: OpencodeClient,
  sessionID: string,
  permission: PermissionRuleset,
  input: { directory?: string; workspace?: string } = {},
): Promise<void> {
  await client.session.update({ sessionID, ...locationParams(input), permission })
}

export async function sendOpenCodePrompt(client: OpencodeClient, input: OpenCodePromptInput) {
  const response = unwrapData<any>(await client.session.prompt(buildPromptPayload(input)))
  const messages = mapOpenCodeMessagesToChatMessages(response?.info ? [response] : [])
  if (messages.length) messageCache.set(input.sessionID, messages)
  return messages
}

export function fireOpenCodePrompt(client: OpencodeClient, input: OpenCodePromptInput): void {
  const payload = buildPromptPayload(input)
  const anyClient = client as any
  const promptAsync = anyClient.session?.promptAsync || anyClient.v2?.session?.promptAsync
  const request = promptAsync
    ? promptAsync.call(anyClient.session?.promptAsync ? anyClient.session : anyClient.v2.session, payload)
    : client.session.prompt(payload)
  void Promise.resolve(request).catch((error) => {
    console.error('[OpenCode prompt error]', error)
  })
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
  options: { preferCache?: boolean; directory?: string; workspace?: string } = {},
): Promise<ChatMessage[]> {
  if (options.preferCache) {
    const cached = messageCache.get(sessionID)
    if (cached) return cached
  }
  const response = unwrapData<any>(await client.session.messages({
    sessionID,
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

/**
 * 带超时的 status 查询。对齐官方 orElseSucceed(fallback) 模式：
 * 超时或失败时返回 fallback 值，避免永久挂起导致 UI 卡死。
 * - fallbackType='busy'：轮询通道保守策略，不误判完成
 * - fallbackType='idle'：事件通道激进策略，API 失败默认认为已完成
 */
export async function getOpenCodeSessionStatusWithTimeout(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string } = {},
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
    return { __fallback: true, type: fallbackType }
  }
}
