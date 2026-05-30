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

export interface McpStdioOptions {
  command: string
  args: string[]
  cwd?: string
}

export class McpStdioTransport implements Transport {
  private _handleId: string | null = null
  private _options: McpStdioOptions
  private _onMessage?: (message: JSONRPCMessage) => void
  private _onError?: (error: Error) => void
  private _onClose?: () => void

  constructor(options: McpStdioOptions) {
    this._options = options
  }

  async start(): Promise<void> {
    const channel = new Channel<string>()
    channel.onmessage = (line: string) => {
      if (line === '__MCP_EOF__') {
        this._onClose?.()
        return
      }
      this._processLine(line)
    }

    try {
      this._handleId = await invoke<string>('mcp_spawn_stdio', {
        command: this._options.command,
        args: this._options.args,
        cwd: this._options.cwd || null,
        onStdout: channel,
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
      try {
        await invoke('mcp_kill_stdio', { handleId: this._handleId })
      } catch {
        // ignore
      }
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
}
