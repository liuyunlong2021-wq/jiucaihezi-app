import type { ChatCompletionTool, ToolCallLike } from '@/composables/officeTools'
import { isTauriRuntime } from './tauriEnv'

export const BROWSER_SAFE_TOOL_NAMES = new Set([
  'browser_launch',
  'browser_search',
  'browser_open',
  'browser_read',
  'browser_state',
  'browser_screenshot',
  'browser_close',
])

export const BROWSER_APPROVAL_TOOL_NAMES = new Set([
  'browser_click',
  'browser_type',
])

export const BROWSER_TOOL_ALIASES: Record<string, string> = {
  browser: 'browser_open',
  web_open: 'browser_open',
  browser_open_url: 'browser_open',
  browser_capture: 'browser_screenshot',
  web_search: 'browser_search',
  search: 'browser_search',
  browser_stop: 'browser_close',
}

export interface BrowserToolDefinitionOptions {
  includeApproval?: boolean
}

export function normalizeBrowserToolName(name: string): string {
  const normalized = String(name || '').trim().toLowerCase().replace(/[\s.-]+/g, '_')
  return BROWSER_TOOL_ALIASES[normalized] || normalized
}

function normalizeLegacyBrowserAction(args: Record<string, unknown>): string {
  const action = String(args.action || '').trim().toLowerCase().replace(/[\s.-]+/g, '_')
  const map: Record<string, string> = {
    launch: 'browser_launch',
    open: 'browser_open',
    goto: 'browser_open',
    search: 'browser_search',
    read: 'browser_read',
    state: 'browser_state',
    screenshot: 'browser_screenshot',
    capture: 'browser_screenshot',
    close: 'browser_close',
    click: 'browser_click',
    type: 'browser_type',
    input: 'browser_type',
  }
  return map[action] || 'browser_open'
}

export function isBrowserToolName(name: string): boolean {
  const normalized = normalizeBrowserToolName(name)
  return BROWSER_SAFE_TOOL_NAMES.has(normalized) || BROWSER_APPROVAL_TOOL_NAMES.has(normalized)
}

export function getBrowserToolDefinitions(options: BrowserToolDefinitionOptions = {}): ChatCompletionTool[] {
  const safeTools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'browser_launch',
        description: '打开韭菜盒子专用的可见 Google Chrome 浏览器窗口。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_search',
        description: '用专用可见 Chrome 打开 Google 搜索并读取搜索结果。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词。' },
            max_results: { type: 'number', description: '最多返回结果数，默认 6。' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_open',
        description: '用专用浏览器打开一个网页地址。只用于 http/https 网页。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要打开的网页地址。' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_read',
        description: '读取当前浏览器页面标题、网址和正文文本。',
        parameters: {
          type: 'object',
          properties: {
            max_chars: { type: 'number', description: '最多返回字符数，默认 40000。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_state',
        description: '读取当前页面正文摘要和可点击/可输入元素列表，用于决定下一步操作。',
        parameters: {
          type: 'object',
          properties: {
            max_chars: { type: 'number', description: '正文最多返回字符数，默认 8000。' },
            max_elements: { type: 'number', description: '最多返回页面元素数量，默认 80。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: '截取当前浏览器页面截图，返回 PNG base64。',
        parameters: {
          type: 'object',
          properties: {
            full_page: { type: 'boolean', description: '是否截取长页面，默认 false。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: '关闭韭菜盒子专用浏览器窗口。',
        parameters: { type: 'object', properties: {} },
      },
    },
  ]

  if (!options.includeApproval) return safeTools

  return [
    ...safeTools,
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: '在当前浏览器页面点击一个 CSS 选择器对应的元素。',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器。' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description: '在当前浏览器页面向一个输入框输入文字。',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器。' },
            text: { type: 'string', description: '要输入的文字。' },
          },
          required: ['selector', 'text'],
        },
      },
    },
  ]
}

function sanitizeToolError(err: unknown): string {
  const msg = (err as Error)?.message || String(err || '未知错误')
  return msg
    .replace(/(?:\/(?:Users|tmp|var|opt|home|private|etc|usr|Volumes|System|Library|Applications)\/[^\s,;:，。；：]*)/g, '[本地路径]')
    .replace(/(?:[A-Za-z]:\\[^\s,;:，。；：]*)/g, '[本地路径]')
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function camelizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return {
    url: args.url,
    query: args.query ?? args.q,
    maxResults: args.max_results ?? args.maxResults,
    maxChars: args.max_chars ?? args.maxChars,
    maxElements: args.max_elements ?? args.maxElements,
    fullPage: args.full_page ?? args.fullPage,
    selector: args.selector,
    text: args.text,
  }
}

export function buildBrowserInvokePayload(toolName: string, args: Record<string, unknown>): { command: string; payload: Record<string, unknown> } {
  const rawName = String(toolName || '').trim().toLowerCase().replace(/[\s.-]+/g, '_')
  const name = rawName === 'browser'
    ? normalizeLegacyBrowserAction(args)
    : normalizeBrowserToolName(toolName)
  const input = camelizeArgs(args)
  if (name === 'browser_launch' || name === 'browser_close') {
    return { command: name, payload: {} }
  }
  return { command: name, payload: { input } }
}

export async function executeBrowserToolCall(call: ToolCallLike): Promise<string> {
  const rawName = String(call.function.name || '').trim().toLowerCase().replace(/[\s.-]+/g, '_')
  const args = parseArgs(call.function.arguments)
  const name = rawName === 'browser'
    ? normalizeLegacyBrowserAction(args)
    : normalizeBrowserToolName(call.function.name)
  if (!isBrowserToolName(name)) return ''
  if (!isTauriRuntime()) {
    return JSON.stringify({
      status: 'error',
      error: 'TAURI_REQUIRED',
      tool: name,
      message: '浏览器工具只能在桌面端使用。',
    })
  }

  // URL scheme 校验：只允许 http/https
  if (name === 'browser_open') {
    const rawUrl = String(args.url || '').trim()
    if (!rawUrl) {
      return JSON.stringify({ status: 'error', error: 'INVALID_URL', tool: name, message: '请提供有效的网页地址。' })
    }
    let parsedUrl: URL
    try { parsedUrl = new URL(rawUrl) } catch {
      return JSON.stringify({ status: 'error', error: 'INVALID_URL', tool: name, message: '网页地址格式不正确。' })
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return JSON.stringify({ status: 'error', error: 'UNSUPPORTED_URL_SCHEME', tool: name, message: '只支持 http/https 网页地址。' })
    }
  }

  const { command, payload } = buildBrowserInvokePayload(name, args)
  const { invoke } = await import('@tauri-apps/api/core')

  try {
    const result = await invoke(command, payload)
    return JSON.stringify({ status: 'success', tool: name, result })
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: 'BROWSER_TOOL_FAILED',
      tool: name,
      message: sanitizeToolError(err),
    })
  }
}
