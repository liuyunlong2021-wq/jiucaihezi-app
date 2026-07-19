import type { ChatCompletionTool, ToolCallLike } from '@/composables/officeTools'
import { isTauriRuntime } from './tauriEnv'

export const DEV_PROJECT_ROOT_KEY = 'jc_dev_project_root'

export function normalizeProjectRelativePath(input: string): string {
  const raw = String(input || '').trim().replace(/\\/g, '/')
  if (!raw || raw === '.') return '.'
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    throw new Error('路径必须是项目内相对路径')
  }

  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('路径不能跳出项目目录')
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return parts.join('/') || '.'
}

export function hasUnsafeShellSyntax(command: string): boolean {
  return /(\|\||&&|[;|<>`$]\(?|\n|\r)/.test(String(command || ''))
}

export function isAllowedDevCommandProgram(program: string): boolean {
  return new Set([
    'pnpm',
    'npm',
    'yarn',
    'bun',
    'cargo',
    'node',
    'npx',
    'deno',
    'tsc',
    'vite',
    'tauri',
    'pytest',
    'ruff',
  ]).has(String(program || '').trim())
}

export function parseDevCommand(command: string): { program: string; args: string[] } {
  const value = String(command || '').trim()
  if (!value) throw new Error('缺少要执行的命令')
  if (hasUnsafeShellSyntax(value)) throw new Error('命令包含不支持的 shell 语法，请改为单条命令')

  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if ((char === '"' || char === "'") && !quote) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = ''
      continue
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (quote) throw new Error('命令引号未闭合')
  if (current) parts.push(current)

  const [program, ...args] = parts
  if (!program) throw new Error('缺少要执行的命令')
  if (!isAllowedDevCommandProgram(program)) {
    throw new Error(`不允许执行此命令入口: ${program}`)
  }
  return { program, args }
}

export function getDevProjectRoot(): string {
  return localStorage.getItem(DEV_PROJECT_ROOT_KEY) || ''
}

export function setDevProjectRoot(root: string): void {
  const value = String(root || '').trim()
  if (value) localStorage.setItem(DEV_PROJECT_ROOT_KEY, value)
  else localStorage.removeItem(DEV_PROJECT_ROOT_KEY)
}

export function clearDevProjectRoot(): void {
  localStorage.removeItem(DEV_PROJECT_ROOT_KEY)
}

export function buildMissingProjectRootResult(toolName: string): string {
  return JSON.stringify({
    status: 'error',
    error: 'DEV_PROJECT_ROOT_REQUIRED',
    tool: toolName,
    message: '请先选择一个源码项目文件夹。',
  })
}

export async function selectDevProjectRoot(): Promise<string> {
  if (!isTauriRuntime()) return ''
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择源码项目文件夹',
  })
  const root = Array.isArray(selected) ? selected[0] : selected
  if (typeof root === 'string' && root.trim()) {
    setDevProjectRoot(root)
    return root
  }
  return getDevProjectRoot()
}

export function getDevProjectToolDefinitions(): ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'dev_detect_project',
        description: '识别当前选择的源码项目类型、关键文件、包管理器和推荐检查命令。开发任务开始时优先调用。',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_list_files',
        description: '列出当前选择的源码项目文件。用于查看项目结构，自动跳过 node_modules、target、dist 等大目录。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '项目内相对目录，默认项目根目录。' },
            max_entries: { type: 'number', description: '最多返回条目数，默认 300。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_search_text',
        description: '在当前源码项目内搜索文本关键词，自动跳过 node_modules、target、dist 等大目录。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '要搜索的关键词或代码片段。' },
            path: { type: 'string', description: '项目内相对目录，默认项目根目录。' },
            max_results: { type: 'number', description: '最多返回匹配数，默认 80。' },
            context_lines: { type: 'number', description: '每条命中前后返回几行上下文，默认 1。' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_read_file',
        description: '读取当前源码项目内的文本文件内容。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '项目内相对文件路径。' },
            max_bytes: { type: 'number', description: '最多读取字节数，默认 120000。' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_read_many_files',
        description: '批量读取当前源码项目内多个文本文件，适合一次性获取相关上下文。',
        parameters: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: '项目内相对文件路径列表。',
            },
            max_bytes_per_file: { type: 'number', description: '每个文件最多读取字节数，默认 80000。' },
          },
          required: ['paths'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_write_file',
        description: '写入或创建当前源码项目内的文本文件。只能写项目目录内的相对路径。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '项目内相对文件路径。' },
            content: { type: 'string', description: '完整文件内容。' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_replace_in_file',
        description: '在当前源码项目内精准替换文件片段。必须提供 exact old_text 和 new_text；默认只允许命中一处。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '项目内相对文件路径。' },
            old_text: { type: 'string', description: '文件中必须原样存在的旧文本。' },
            new_text: { type: 'string', description: '替换后的新文本。' },
            replace_all: { type: 'boolean', description: '是否替换所有命中，默认 false。' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_get_diff',
        description: '查看当前源码项目的 Git diff，用于确认本轮代码改动。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '可选，项目内相对路径；不传则查看全部 diff。' },
            max_bytes: { type: 'number', description: '最多返回字节数，默认 200000。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dev_run_command',
        description: '在当前源码项目目录内执行单条开发命令，例如 pnpm build、cargo check、pnpm tauri build。不支持管道、重定向、&& 等 shell 语法。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '单条命令。' },
            workdir: { type: 'string', description: '项目内相对工作目录，默认项目根目录。' },
            timeout_seconds: { type: 'number', description: '超时时间，默认 120 秒。' },
          },
          required: ['command'],
        },
      },
    },
  ]
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function sanitizeToolError(err: unknown): string {
  const msg = (err as Error)?.message || String(err || '未知错误')
  return msg
    .replace(/(?:\/(?:Users|tmp|var|opt|home|private|etc|usr|Volumes|System|Library|Applications)\/[^\s,;:，。；：]*)/g, '[本地路径]')
    .replace(/(?:[A-Za-z]:\\[^\s,;:，。；：]*)/g, '[本地路径]')
}

export function isDevProjectToolName(name: string): boolean {
  return getDevProjectToolDefinitions().some(tool => tool.function.name === name)
}

export async function executeDevProjectToolCall(call: ToolCallLike): Promise<string> {
  const name = call.function.name
  if (!isDevProjectToolName(name)) return ''
  if (!isTauriRuntime()) {
    return JSON.stringify({ status: 'error', error: 'TAURI_REQUIRED', tool: name, message: '本地开发工具只能在桌面端使用。' })
  }

  const root = getDevProjectRoot()
  if (!root) return buildMissingProjectRootResult(name)

  const args = parseArgs(call.function.arguments)
  const { invoke } = await import('@tauri-apps/api/core')

  try {
    if (name === 'dev_detect_project') {
      const result = await invoke('dev_detect_project', {
        input: { root },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_list_files') {
      const relativePath = normalizeProjectRelativePath(String(args.path || '.'))
      const result = await invoke('dev_list_files', {
        input: {
          root,
          relativePath,
          maxEntries: Number(args.max_entries || 300),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_search_text') {
      const relativePath = normalizeProjectRelativePath(String(args.path || '.'))
      const result = await invoke('dev_search_text', {
        input: {
          root,
          relativePath,
          query: String(args.query || ''),
          maxResults: Number(args.max_results || 80),
          contextLines: Number(args.context_lines ?? 1),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_read_file') {
      const relativePath = normalizeProjectRelativePath(String(args.path || ''))
      const result = await invoke('dev_read_file', {
        input: {
          root,
          relativePath,
          maxBytes: Number(args.max_bytes || 120000),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_read_many_files') {
      const paths = Array.isArray(args.paths) ? args.paths : []
      const result = await invoke('dev_read_many_files', {
        input: {
          root,
          paths: paths.map(path => normalizeProjectRelativePath(String(path || ''))),
          maxBytesPerFile: Number(args.max_bytes_per_file || 80000),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_write_file') {
      const relativePath = normalizeProjectRelativePath(String(args.path || ''))
      const result = await invoke('dev_write_file', {
        input: {
          root,
          relativePath,
          content: String(args.content || ''),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_replace_in_file') {
      const relativePath = normalizeProjectRelativePath(String(args.path || ''))
      const result = await invoke('dev_replace_in_file', {
        input: {
          root,
          relativePath,
          oldText: String(args.old_text || ''),
          newText: String(args.new_text ?? ''),
          replaceAll: Boolean(args.replace_all),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_get_diff') {
      const relativePath = args.path ? normalizeProjectRelativePath(String(args.path || '')) : undefined
      const result = await invoke('dev_get_diff', {
        input: {
          root,
          relativePath,
          maxBytes: Number(args.max_bytes || 200000),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }

    if (name === 'dev_run_command') {
      const command = String(args.command || '')
      const parsed = parseDevCommand(command)
      // 用解析后的 program + args 重建规范命令，消除 JS/Rust 解析差异
      const canonicalCmd = [parsed.program, ...parsed.args]
        .map(a => /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
        .join(' ')
      const result = await invoke('dev_run_command', {
        input: {
          root,
          command: canonicalCmd,
          workdir: normalizeProjectRelativePath(String(args.workdir || '.')),
          timeoutSeconds: Number(args.timeout_seconds || 120),
        },
      })
      return JSON.stringify({ status: 'success', tool: name, result })
    }
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: 'DEV_TOOL_FAILED',
      tool: name,
      message: sanitizeToolError(err),
    })
  }

  return ''
}
