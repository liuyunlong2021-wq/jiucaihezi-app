const MCP_OAUTH_INTENT_KEY = 'jcPendingMcpOAuthIntent'
const MCP_OAUTH_CALLBACK_TTL_MS = 15 * 60 * 1000

function defaultStorage(): Storage | undefined {
  return globalThis.sessionStorage
}

function randomState(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto?.getRandomValues?.(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function prepareMcpOAuthIntent(serverId: string, storage: Storage | undefined = defaultStorage()): string {
  const state = randomState()
  storage?.setItem(MCP_OAUTH_INTENT_KEY, JSON.stringify({ serverId, state, createdAt: Date.now() }))
  return state
}

export function consumeMcpOAuthCallbackUrl(input: {
  href?: string
  storage?: Storage
} = {}): { serverId: string; code: string } | null {
  const storage = input.storage || defaultStorage()
  if (!storage) return null

  try {
    const url = new URL(input.href || globalThis.location?.href || '', 'tauri://localhost')
    if (url.protocol !== 'jiucaihezi:' || url.hostname !== 'mcp' || url.pathname !== '/oauth/callback') return null
    const raw = storage.getItem(MCP_OAUTH_INTENT_KEY)
    storage.removeItem(MCP_OAUTH_INTENT_KEY)
    const intent = raw ? JSON.parse(raw) : null
    const serverId = String(url.searchParams.get('server') || '')
    const code = String(url.searchParams.get('code') || '')
    const state = String(url.searchParams.get('state') || '')
    if (!serverId || !code || !intent || intent.serverId !== serverId || intent.state !== state) return null
    if (Date.now() - Number(intent.createdAt || 0) > MCP_OAUTH_CALLBACK_TTL_MS) return null
    return { serverId, code }
  } catch {
    return null
  }
}
