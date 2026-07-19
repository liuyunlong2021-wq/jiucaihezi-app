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
  env?: Record<string, string>
  secretEnvVar?: string
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
  {
    id: 'obsidian',
    name: 'Obsidian',
    icon: 'book_2',
    category: '知识库',
    transport: 'stdio',
    description: '让 AI 通过 MCP 读写和搜索你的 Obsidian 本地笔记。',
    tasks: ['搜索笔记', '读取笔记', '写入笔记'],
    auth: 'config',
    risk: 'medium',
    installHint: '需要本机 Node.js，以及 Obsidian Local REST API 插件的 API Key。首次添加时输入一次，密钥只保存在本机系统钥匙串。',
    command: 'npx',
    args: ['-y', 'obsidian-mcp-server@3.2.9'],
    env: {
      MCP_TRANSPORT_TYPE: 'stdio',
      OBSIDIAN_BASE_URL: 'https://127.0.0.1:27124',
      OBSIDIAN_VERIFY_SSL: 'false',
    },
    secretEnvVar: 'OBSIDIAN_API_KEY',
  },
]
