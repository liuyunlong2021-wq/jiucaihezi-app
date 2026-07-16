export interface DirectMessageFile { name: string; content: string }
export type DirectApiMessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
export interface DirectApiMessage { role: 'system' | 'user' | 'assistant'; content: DirectApiMessageContent }
export interface BuildDirectMessagesInput {
  messages: Array<{ id: string; role: string; content: unknown; files?: Array<{ name: string; content: string }>; images?: string[] }>
  systemPrompt?: string; skillSystemPrompt?: string; images?: string[]; files?: DirectMessageFile[]
  visionModel: boolean; apiFormat: 'openai' | 'ollama'; platform: 'desktop' | 'web'
}
function chatContentToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((item: any) => typeof item === 'string' ? item : item?.type === 'text' ? String(item.text || '') : '').filter(Boolean).join('\n')
  return String(value)
}
function appendFiles(content: string, files?: DirectMessageFile[]): string {
  if (!files?.length) return content
  const blocks = files.map(f => { const name = String(f.name || 'file'); const body = String(f.content || '').trim(); return body ? `[附件: ${name}]\n${body.slice(0, 8000)}` : `[附件: ${name}]` }).join('\n\n')
  return [content, blocks].filter(Boolean).join('\n\n')
}
function buildSystemPrompt(args: BuildDirectMessagesInput): string {
  const platformHint = args.platform === 'web' ? '当前运行环境是 Web 端。不要调用本地 Shell、文件系统或桌面专属工具。' : '当前使用直连模式。不要虚构没有实际调用过的工具。'
  return [args.systemPrompt, args.skillSystemPrompt, platformHint].filter(Boolean).join('\n\n')
}
function buildHistoryMessageText(msg: BuildDirectMessagesInput['messages'][0]): string | null {
  if (msg.role === 'system') return null
  let text = chatContentToText(msg.content)
  if (msg.role === 'user') text = appendFiles(text, msg.files)
  return text || null
}
export function buildDirectMessages(args: BuildDirectMessagesInput): DirectApiMessage[] {
  const result: DirectApiMessage[] = []
  const sys = buildSystemPrompt(args)
  if (sys) result.push({ role: 'system', content: sys })
  const history = args.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-24)
  if (!history.length) { result.push({ role: 'user', content: '请继续。' }); return result }
  const lastIdx = history.length - 1
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]; const isLast = i === lastIdx
    if (isLast && msg.role === 'user') {
      let text = chatContentToText(msg.content); text = appendFiles(text, args.files ?? msg.files)
      const hasImages = (args.images ?? msg.images ?? []).length > 0
      if (hasImages && args.visionModel && args.apiFormat === 'openai') {
        const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [{ type: 'text', text: text || '请查看以下图片。' }]
        for (const url of args.images ?? msg.images ?? []) { if (url) parts.push({ type: 'image_url', image_url: { url } }) }
        result.push({ role: 'user', content: parts })
      } else if (hasImages && args.visionModel && args.apiFormat === 'ollama') {
        result.push({ role: 'user', content: text || '请查看以下图片。' })
      } else if (hasImages && !args.visionModel) {
        result.push({ role: 'user', content: text + `\n\n[附带 ${(args.images ?? msg.images ?? []).length} 张图片，当前模型不支持视觉]` })
      } else {
        result.push({ role: 'user', content: text || '请继续。' })
      }
    } else {
      const text = buildHistoryMessageText(msg); if (!text) continue
      result.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text.slice(0, 16000) })
    }
  }
  return result.length > 1 ? result : [...result, { role: 'user', content: '请继续。' }]
}
