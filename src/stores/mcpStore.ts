import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem, removeItem } from '@/utils/idb'

// ─── Types ───────────────────────────────────────────

export interface McpServerConfig {
  id: string
  name: string
  transport: 'sse' | 'streamable-http' | 'stdio'
  /** SSE transport */
  url?: string
  headers?: Record<string, string>
  /** stdio transport (Phase 2) */
  command?: string
  args?: string[]
  cwd?: string
  auth?: 'oauth'
  oauthClientId?: string
  oauthRedirectUrl?: string
  oauthTokenProxyUrl?: string
  oauthAuthorizationServerUrl?: string
  oauthAuthorizationEndpoint?: string
  oauthTokenEndpoint?: string
  /** State */
  enabled: boolean
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
}

export interface McpToolSchema {
  name: string          // prefixed: "mcp__<server>__<tool>"
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
  originalName: string
}

// ─── Storage key ─────────────────────────────────────

const STORAGE_KEY = 'jc_mcp_servers_v1'
const OBSOLETE_BUILTIN_SERVER_IDS = new Set([
  'opencode-official',
  'skill-seekers',
  'notion',
  'linear',
  'slack',
  'filesystem',
])

async function loadServers(): Promise<McpServerConfig[]> {
  try {
    const raw = await getItem(STORAGE_KEY)
    const servers: McpServerConfig[] = raw ? JSON.parse(raw) : []
    const filtered = servers.filter(server => !OBSOLETE_BUILTIN_SERVER_IDS.has(server.id))
    if (filtered.length !== servers.length) saveServers(filtered)
    return filtered
  } catch {
    return []
  }
}

function saveServers(servers: McpServerConfig[]) {
  setItem(STORAGE_KEY, JSON.stringify(servers))
}

// ─── Store ───────────────────────────────────────────

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<McpServerConfig[]>([])
  const tools = ref<Map<string, McpToolSchema[]>>(new Map())
  const loaded = ref(false)

  // Lazy init
  async function ensureLoaded() {
    if (loaded.value) return
    servers.value = await loadServers()
    loaded.value = true
  }
  ensureLoaded()

  // ─── Computed ──────────────────────────────────────

  const enabledServers = computed(() =>
    servers.value.filter(s => s.enabled)
  )

  const connectedServers = computed(() =>
    servers.value.filter(s => s.enabled && s.status === 'connected')
  )

  const allMcpTools = computed((): McpToolSchema[] => {
    const result: McpToolSchema[] = []
    for (const s of connectedServers.value) {
      const serverTools = tools.value.get(s.id) || []
      result.push(...serverTools)
    }
    return result
  })

  // ─── Actions ───────────────────────────────────────

  function addServer(config: Omit<McpServerConfig, 'status' | 'error' | 'enabled'>) {
    const server: McpServerConfig = {
      ...config,
      enabled: false,
      status: 'disconnected',
    }
    servers.value.push(server)
    persist()
    return server
  }

  function removeServer(id: string) {
    servers.value = servers.value.filter(s => s.id !== id)
    tools.value.delete(id)
    persist()
  }

  function updateServer(id: string, patch: Partial<McpServerConfig>) {
    const server = servers.value.find(s => s.id === id)
    if (!server) return
    Object.assign(server, patch)
    persist()
  }

  function setServerStatus(id: string, status: McpServerConfig['status'], error?: string) {
    const server = servers.value.find(s => s.id === id)
    if (!server) return
    server.status = status
    server.error = error
    if (status === 'disconnected') {
      tools.value.delete(id)
    }
    persist()
  }

  function setServerTools(id: string, serverTools: McpToolSchema[]) {
    tools.value.set(id, serverTools)
  }

  function isServerEnabled(id: string): boolean {
    return Boolean(servers.value.find(s => s.id === id)?.enabled)
  }

  function isServerConnected(id: string): boolean {
    const server = servers.value.find(s => s.id === id)
    return Boolean(server?.enabled && server.status === 'connected')
  }

  function getMcpToolByName(toolName: string): McpToolSchema | null {
    return allMcpTools.value.find(tool => tool.name === toolName) || null
  }

  function toggleServer(id: string) {
    const server = servers.value.find(s => s.id === id)
    if (!server) return
    server.enabled = !server.enabled
    if (!server.enabled) {
      server.status = 'disconnected'
      tools.value.delete(id)
    }
    persist()
  }

  function persist() {
    saveServers(servers.value.map(s => ({
      ...s,
      status: 'disconnected' as const, // never persist connection state
      error: undefined,
    })))
  }

  return {
    servers,
    tools,
    ensureLoaded,
    enabledServers,
    allMcpTools,
    connectedServers,
    addServer,
    removeServer,
    updateServer,
    setServerStatus,
    setServerTools,
    isServerEnabled,
    isServerConnected,
    getMcpToolByName,
    toggleServer,
  }
})
