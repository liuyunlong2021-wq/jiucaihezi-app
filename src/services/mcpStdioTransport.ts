/**
 * McpStdioTransport — MCP SDK Transport using Tauri IPC for stdio processes.
 *
 * Uses Rust-side `mcp_spawn_stdio` to spawn child processes and
 * `mcp_write_stdin` / `mcp_kill_stdio` for communication.
 */
import { invoke } from '@tauri-apps/api/core'
import { Channel } from '@tauri-apps/api/core'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

/**
 * 本页面 realm 的标识。整页重载换代；模块热替换沿用，和 Harness 登记表一致。
 *
 * Rust 用 `(窗口 label, realm)` 判定一个 stdio 子进程是不是孤儿，两件事靠它分开：
 * - **dev 的 F5 整页重载**：同窗口、新 realm → 上一代留下的 Harness runner 必须收掉，
 *   否则同一会话下一轮 resume 撞 `already owned by an active write handle`；
 * - **多窗口**：不同 label → 另一个窗口正在跑的 runner 一个字都不能碰。
 *
 * 光靠窗口 label 做不到：重挂时 label 不变，两种情形长得一模一样。
 */
const page = globalThis as typeof globalThis & {
  __JC_MCP_REALM_ID__?: string
  __JC_HARNESS_REAP__?: Promise<number>
}
export const MCP_REALM_ID = page.__JC_MCP_REALM_ID__ ??= crypto.randomUUID()

/** 页面启动回收与新 runner 启动共用同一个闸门；模块热替换保留本页面代数。 */
export function prepareHarnessRuntime(): Promise<number> {
  return page.__JC_HARNESS_REAP__ ??= invoke<number>('mcp_reap_stale_harness', { realm: MCP_REALM_ID }).catch(error => {
    page.__JC_HARNESS_REAP__ = undefined
    throw error
  })
}

export interface McpStdioOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface McpStdioDiagnostics {
  command: string
  args: string[]
  cwd?: string
  methods: string[]
  stderr: string[]
  exitCode?: number | null
  signal?: string | null
}

export class McpStdioTransport implements Transport {
  private _handleId: string | null = null
  private _options: McpStdioOptions
  private _onMessage?: (message: JSONRPCMessage) => void
  private _onError?: (error: Error) => void
  private _onClose?: () => void
  private _stderr: string[] = []
  private _methods: string[] = []
  private _exit: { code?: number | null; signal?: string | null } = {}

  constructor(options: McpStdioOptions) {
    this._options = options
  }

  async start(): Promise<void> {
    if (this._options.args.some(arg => arg.endsWith('runner.mjs'))) await prepareHarnessRuntime()
    const channel = new Channel<string>()
    const stderr = new Channel<string>()
    stderr.onmessage = line => this._stderr.push(line)
    const exit = new Channel<string>()
    exit.onmessage = raw => {
      try { this._exit = JSON.parse(raw) } catch { /* diagnostics only */ }
      this._onClose?.()
      this.onclose?.()
    }
    channel.onmessage = (line: string) => {
      if (line === '__MCP_EOF__') {
        return
      }
      this._processLine(line)
    }

    try {
      this._handleId = await invoke<string>('mcp_spawn_stdio', {
        command: this._options.command,
        args: this._options.args,
        cwd: this._options.cwd || null,
        env: this._options.env || null,
        realm: MCP_REALM_ID,
        onStdout: channel,
        onStderr: stderr,
        onExit: exit,
      })
    } catch (err: any) {
      this._onError?.(new Error(`MCP stdio spawn failed: ${err}`))
      throw err
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._handleId) {
      throw new Error('MCP stdio transport not started')
    }

    const json = JSON.stringify(message)
    if ('method' in message && typeof message.method === 'string') this._methods.push(message.method)
    try {
      await invoke('mcp_write_stdin', {
        handleId: this._handleId,
        message: json,
      })
    } catch (err: any) {
      this._onError?.(new Error(`MCP stdio write failed: ${err}`))
      throw err
    }
  }

  async close(): Promise<void> {
    if (this._handleId) {
      await invoke('mcp_kill_stdio', { handleId: this._handleId })
      this._handleId = null
    }
    this._onClose?.()
  }

  onmessage?: (message: JSONRPCMessage) => void
  onerror?: (error: Error) => void
  onclose?: () => void

  private _processLine(line: string) {
    // Rust side uses BufReader::lines() which strips \n.
    // Each Channel message is already a complete JSON-RPC line.
    const raw = line.trim()
    if (!raw) return
    try {
      const msg = JSON.parse(raw) as JSONRPCMessage
      this._onMessage?.(msg)
      this.onmessage?.(msg)
    } catch {
      // Ignore non-JSON lines (e.g., stderr, logs)
    }
  }

  diagnostics(): McpStdioDiagnostics {
    return { ...this._options, methods: [...this._methods], stderr: [...this._stderr], ...this._exit }
  }
}
