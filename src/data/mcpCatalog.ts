export type BuiltinMcpTransport = 'stdio' | 'sse' | 'streamable-http' | 'remote'

export interface BuiltinMcpCatalogEntry {
  id: string
  name: string
  icon: string
  category: string
  transport: BuiltinMcpTransport
  description: string
  tasks: string[]
  auth: 'none' | 'token' | 'oauth' | 'config'
  risk: 'low' | 'medium' | 'high'
  installHint: string
  command?: string
  args?: string[]
  url?: string
  oauthClientId?: string
  oauthTokenProxyUrl?: string
  oauthAuthorizationServerUrl?: string
  oauthAuthorizationEndpoint?: string
  oauthTokenEndpoint?: string
}

export const BUILTIN_MCP_CATALOG: BuiltinMcpCatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    icon: 'code',
    category: '开发',
    transport: 'streamable-http',
    description: '连接 GitHub 仓库、Issue、PR 等开发协作能力。',
    tasks: ['查询仓库', '查看 Issue', '创建或审查 PR'],
    auth: 'oauth',
    risk: 'medium',
    installHint: '需要 GitHub OAuth 或 MCP 专用凭据。启用前应限制仓库范围。',
    url: 'https://api.githubcopilot.com/mcp/',
    oauthClientId: import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID || '',
    oauthTokenProxyUrl: 'https://api.jiucaihezi.studio/auth/mcp/github/token',
    oauthAuthorizationServerUrl: 'https://github.com/login/oauth',
    oauthAuthorizationEndpoint: 'https://github.com/login/oauth/authorize',
    oauthTokenEndpoint: 'https://github.com/login/oauth/access_token',
  },
]
