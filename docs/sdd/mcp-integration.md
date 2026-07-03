# MCP Integration — Phase 1 Design (SSE Transport)

> Date: 2026-05-30
> Status: Phase 2 Complete ✅
> Phase 1: SSE transport ✅
> Phase 2: stdio transport (Rust bridge) ✅
> Phase 3: MCP Resources/Prompts, marketplace (future)

## Product Principle

MCP (Model Context Protocol) extends 韭菜盒子 Studio's Tool ecosystem by allowing users to install and enable third-party MCP Servers. This does NOT change the product's core execution model:

> User manually enables MCP Server → MCP tools join the Tool pool → Same chatToolPolicy applies → manual/plain execution source unchanged.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Settings → MCP 管理                  │
│  ┌──────────────────────────────────────────────┐    │
│  │ Server Name | Transport | URL/Command | 开关  │    │
│  │ filesystem  | stdio    | npx ...     | ☐     │    │
│  │ github      | SSE      | https://... | ☑     │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│                 mcpStore.ts (Pinia)                    │
│  servers: McpServerConfig[]                            │
│  connections: Map<serverId, Client>                    │
│  connect(serverId) → init + listTools                  │
│  disconnect(serverId)                                  │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│              mcpClient.ts (SSE Transport)              │
│  @modelcontextprotocol/sdk Client                     │
│  - SSE transport (Phase 1)                            │
│  - stdio transport (Phase 2, via Rust bridge)         │
│  listTools() → ChatCompletionTool[]                    │
│  callTool(name, args) → ToolResult                     │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│           mcpToolAdapter.ts (Bridge Layer)             │
│  getMcpToolDefinitions() → ChatCompletionTool[]        │
│  executeMcpToolCall(name, args) → string               │
│  isMcpTool(name) → boolean                             │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│         toolConnectionAdapter.ts (Modified)            │
│  buildDefaultChatTools() now includes:                 │
│    ...builtinTools,                                    │
│    ...getMcpToolDefinitions()  ← NEW                   │
└──────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. MCP Tools are Tools, not a separate concept

MCP tools join the same `buildAvailableChatTools()` array as built-in tools. The only difference is how `executeToolCall()` dispatches them:

```ts
function executeToolCall(name, args) {
  if (isMcpTool(name)) return mcpClient.callTool(name, args)
  return builtinExecutors[name](args)
}
```

### 2. Same chatToolPolicy applies

MCP tools go through `filterApprovalToolsForPolicy` just like built-in tools. MCP tools default to `risk: 'safe'` unless the user marks them otherwise. `write` and `approval` risk tools are filtered out.

### 3. SSE transport only in Phase 1

- SSE transport works with our existing `rustFetch` HTTP bridge — no new Rust code needed.
- stdio transport requires a Rust `Command` spawn bridge, deferred to Phase 2.

### 4. MCP Server lifecycle is user-controlled

- Servers are NOT auto-started. User must toggle each server on.
- Connection happens lazily on first tool list request.
- Disconnection happens when user toggles off or app closes.

## Data Model

```ts
// src/stores/mcpStore.ts
interface McpServerConfig {
  id: string
  name: string
  transport: 'sse' | 'stdio'
  // SSE
  url?: string          // e.g., "https://mcp.example.com/sse"
  headers?: Record<string, string>
  // stdio (Phase 2)
  command?: string
  args?: string[]
  cwd?: string
  // State
  enabled: boolean
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  tools: McpToolDefinition[]
}

interface McpToolDefinition {
  name: string          // prefixed: "mcp__<server>__<tool>"
  description: string
  inputSchema: object   // JSON Schema
  serverId: string
  originalName: string  // original tool name from MCP server
}
```

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `docs/sdd/mcp-integration.md` | CREATE | This document |
| `src/stores/mcpStore.ts` | CREATE | MCP Server config & connection state |
| `src/services/mcpClient.ts` | CREATE | MCP SDK Client wrapper (SSE) |
| `src/runtime/connection/mcpToolAdapter.ts` | CREATE | Bridge: MCP tools → ChatCompletionTool[] |
| `src/runtime/connection/toolConnectionAdapter.ts` | MODIFY | Include MCP tools in buildDefaultChatTools |
| `src/composables/useChat.ts` | MODIFY | Dispatch MCP tool calls in executeToolCall |
| `src/components/settings/McpSettings.vue` | CREATE | MCP Server management UI |
| `src/components/settings/SettingsPanel.vue` | MODIFY | Add MCP settings tab/section |
| `public/skills/skill-builder/SKILL.md` | CREATE | Skill Seekers skill import |

## Security Considerations

1. **MCP tool names are prefixed**: `mcp__<serverId>__<originalName>` to prevent collision with built-in tools.
2. **Tool results are truncated** at 100KB to prevent context overflow.
3. **MCP Server URLs are validated** to only allow https:// (no file://, no internal IPs without user confirmation).
4. **chatToolPolicy applies equally** — MCP tools with `write` or `approval` risk are filtered.
5. **Server credentials (headers) stored in Keychain**, not localStorage.

## Phase 2 (✅ Complete)

- [x] stdio transport via Rust `mcp_spawn_stdio` / `mcp_write_stdin` / `mcp_kill_stdio` Commands
- [x] JS `McpStdioTransport` class implementing MCP SDK Transport interface
- [x] `mcpClient.ts` unified transport dispatch (SSE + stdio)
- [x] `McpSettings.vue` stdio transport enabled in UI
- [x] `resolve_local_binary()` PATH resolution for stdio commands

### Architecture: Rust-JS bridge

```
JS McpStdioTransport.start()
  → invoke('mcp_spawn_stdio', { command, args, cwd, onStdout: Channel })
  → Rust spawns child process via tokio::process::Command
  → stdout lines → Channel → JS McpStdioTransport._processLine()
  → JSON-RPC messages → MCP SDK Client
```

Key files:
- `src-tauri/src/lib.rs` — MCP stdio bridge (3 Tauri commands)
- `src/services/mcpStdioTransport.ts` — JS Transport implementation
- `src/services/mcpClient.ts` — Unified connectMcpServer (SSE + stdio dispatch)

## Phase 3 (Future)

- MCP Resources → KnowledgeConnection integration
- MCP Prompts → SkillConnection integration
- One-click MCP Server installation from marketplace
