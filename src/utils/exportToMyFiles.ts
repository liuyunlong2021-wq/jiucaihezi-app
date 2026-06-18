/**
 * P3.3: exportToMyFiles — 导出对话/文本/画布到 data/media/exports/
 *
 * - 桌面专属（依赖 Tauri FS + path 插件）
 * - 对话 → exports/会话名_日期.md
 * - 文本/画布由编辑器/画布各自触发，本模块提供 foundation
 * - 统一出口：点「我的文件」即可在 exports/ 找到
 */
import type { ChatMessage } from '@/composables/useChat'
import { isTauriRuntime } from '@/utils/tauriEnv'

/** 确保 {appDataDir}/data/media/exports/ 目录存在 */
export async function ensureMyFilesDir(): Promise<string> {
  if (!isTauriRuntime()) return ''
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
  const dataDir = await appDataDir()
  const dir = await join(dataDir, 'data', 'media', 'exports')
  try {
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true })
    }
  } catch {
    // 目录已存在或创建失败 — 由 writeFile 兜底
  }
  return dir + '/'
}

/** 格式化时间戳 -> YYYY-MM-DD */
function fmtDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 清洗文件名（去除 OS 非法字符） */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80)
}

/** 拼接 Markdown */
function messagesToMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  for (const msg of messages) {
    const role = msg.role === 'user' ? '🧑 用户' : msg.role === 'assistant' ? '🤖 助手' : msg.role === 'system' ? '⚙️ 系统' : msg.role === 'tool' ? `🔧 ${msg.toolName || '工具'}` : msg.role
    const ts = fmtDate(msg.timestamp)
    lines.push(`## ${role} — ${ts}`)
    lines.push('')
    lines.push(msg.content || '*(无内容)*')
    lines.push('')
    if (msg.reasoningContent) {
      lines.push('> **思考过程**')
      lines.push('> ' + msg.reasoningContent.replace(/\n/g, '\n> '))
      lines.push('')
    }
  }
  return lines.join('\n')
}

/** 导出对话到 data/media/exports/（桌面）或触发浏览器下载（Web） */
export async function exportConversationToMyFiles(
  title: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!isTauriRuntime()) {
    // Web: 触发浏览器下载
    downloadAsFile(
      messagesToMarkdown(title, messages),
      `${sanitizeFilename(title || '未命名对话')}_${fmtDate(Date.now())}.md`,
      'text/markdown',
    )
    return 'web-download'
  }

  const dir = await ensureMyFilesDir()
  if (!dir) return ''

  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')

  const safeTitle = sanitizeFilename(title || '未命名对话')
  const date = fmtDate(messages[messages.length - 1]?.timestamp || Date.now())
  const filename = `${safeTitle}_${date}.md`
  const filepath = await join(dir, filename)

  const markdown = messagesToMarkdown(title, messages)
  await writeFile(filepath, new TextEncoder().encode(markdown))

  return filepath
}

/** Web 端：触发浏览器下载 */
function downloadAsFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
