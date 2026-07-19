import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import { invoke } from '@tauri-apps/api/core'
import { openExternal } from '@/utils/httpClient'
import {
  clearPendingMcpOAuthIntent,
  getPendingMcpOAuthCodeVerifier,
  prepareMcpOAuthIntent,
  saveMcpOAuthCodeVerifier,
} from './mcpOAuth'

export const MCP_OAUTH_CALLBACK_BASE_URL = 'https://api.jiucaihezi.studio/auth/mcp'

export class McpOAuthInteractionRequiredError extends Error {
  constructor() {
    super('MCP OAuth 需要重新连接')
  }
}

interface McpOAuthCredential {
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformationMixed
  discoveryState?: OAuthDiscoveryState
  codeVerifier?: string
}

export function mcpOAuthRedirectUrl(serverId: string): string {
  return `${MCP_OAUTH_CALLBACK_BASE_URL}/${encodeURIComponent(serverId)}/callback`
}

async function readCredential(serverId: string): Promise<McpOAuthCredential> {
  const raw = await invoke<string | null>('get_mcp_oauth_credential', { serverId })
  if (!raw) return {}
  try { return JSON.parse(raw) as McpOAuthCredential } catch { return {} }
}

async function updateCredential(serverId: string, update: (current: McpOAuthCredential) => McpOAuthCredential) {
  const next = update(await readCredential(serverId))
  await invoke('set_mcp_oauth_credential', { serverId, value: JSON.stringify(next) })
}

export function createMcpOAuthProvider(input: {
  serverId: string
  clientId?: string
  discoveryState?: OAuthDiscoveryState
  interactive?: boolean
}): OAuthClientProvider {
  const clientId = String(input.clientId || '').trim()
  if (!clientId) throw new Error(`MCP OAuth Client ID 未配置：${input.serverId}`)
  const redirectUrl = mcpOAuthRedirectUrl(input.serverId)
  const clientMetadata: OAuthClientMetadata = {
    client_name: '韭菜盒子 Studio',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }

  return {
    get redirectUrl() { return redirectUrl },
    get clientMetadata() { return clientMetadata },
    state: () => prepareMcpOAuthIntent(input.serverId),
    clientInformation: async () => (await readCredential(input.serverId)).clientInformation || { client_id: clientId },
    saveClientInformation: async clientInformation => updateCredential(input.serverId, current => ({ ...current, clientInformation })),
    tokens: async () => (await readCredential(input.serverId)).tokens,
    saveTokens: async tokens => {
      await updateCredential(input.serverId, current => ({ ...current, tokens }))
      clearPendingMcpOAuthIntent()
    },
    saveCodeVerifier: async codeVerifier => {
      await updateCredential(input.serverId, current => ({ ...current, codeVerifier }))
      saveMcpOAuthCodeVerifier(input.serverId, codeVerifier)
    },
    codeVerifier: async () => {
      const codeVerifier = (await readCredential(input.serverId)).codeVerifier
        || getPendingMcpOAuthCodeVerifier(input.serverId)
      if (!codeVerifier) throw new Error('OAuth 授权已过期，请重新连接')
      return codeVerifier
    },
    saveDiscoveryState: async discoveryState => updateCredential(input.serverId, current => ({ ...current, discoveryState })),
    discoveryState: async () => (await readCredential(input.serverId)).discoveryState || input.discoveryState,
    redirectToAuthorization: async authorizationUrl => {
      if (input.interactive === false) throw new McpOAuthInteractionRequiredError()
      await openExternal(authorizationUrl.href)
    },
    invalidateCredentials: async () => {
      clearPendingMcpOAuthIntent()
      await invoke('clear_mcp_oauth_credential', { serverId: input.serverId })
    },
  }
}
