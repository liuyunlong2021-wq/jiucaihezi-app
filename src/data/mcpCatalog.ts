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
    id: 'jiucaihezi-creation',
    name: '韭菜盒子创作',
    icon: 'auto_awesome',
    category: '创作',
    transport: 'stdio',
    description: '把韭菜盒子的创作模型、任务、历史、项目落盘和画布能力提供给 Codex。',
    tasks: ['生成图片', '生成视频和音频', '读取创作历史', '放入项目画布'],
    auth: 'none',
    risk: 'medium',
    installHint: '桌面版一键解析当前安装目录和 Node.js 路径；不需要在 MCP 中填写 API Key。',
  },
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
    id: 'playwright',
    name: 'Playwright',
    icon: 'travel_explore',
    category: '浏览器',
    transport: 'stdio',
    description: '让 AI 操作本机浏览器，浏览网页、填写页面并处理上传与下载。',
    tasks: ['浏览网页', '操作页面', '上传与下载'],
    auth: 'none',
    risk: 'high',
    installHint: '仅桌面版可用。需要本机 Node.js；首次连接由 npx 下载官方 Playwright MCP。',
    command: 'npx',
    args: ['-y', '@playwright/mcp@0.0.79'],
  },
]
