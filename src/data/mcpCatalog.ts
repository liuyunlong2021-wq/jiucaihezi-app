import { gatewayJson } from '@/services/newApiClient'
import { CANVAS_AGENT_PACKAGE } from '@/services/canvasAgentConnection'
import { COMFY_MCP_INSTALL } from '@/services/comfyMcp'

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
  oauthTokenProxyUrl?: string
  oauthAuthorizationServerUrl?: string
  oauthAuthorizationEndpoint?: string
  oauthTokenEndpoint?: string
}

export const BUILTIN_MCP_CATALOG: BuiltinMcpCatalogEntry[] = [
  {
    id: 'comfyui', name: 'ComfyUI（官方）', icon: 'account_tree', category: '创作', transport: 'stdio',
    description: '使用 Comfy 官方 MCP 构建和执行工作流、查询模型与任务、取回生成结果。先启动本机 ComfyUI，检查服务可用后，在输入框选择 @MCP → ComfyUI 并提出生成要求。',
    tasks: ['构建与执行工作流', '查询和取消任务', '取回生成结果'], auth: 'none', risk: 'high',
    installHint: `仅桌面版，需要 Python ≥3.10。官方安装命令：${COMFY_MCP_INSTALL}。ComfyUI 本身需已安装。当前官方版本仅支持本机或局域网裸 HTTP 地址。`,
    command: 'comfy-mcp', args: [],
  },
  {
    id: 'infinite-canvas',
    name: '无限画布',
    icon: 'dashboard',
    category: '创作',
    transport: 'stdio',
    description: '连接无限画布，让 AI 读取画布、编辑节点与连线，并在画布生成图片、视频和音频。',
    tasks: ['读取与编辑画布', '创建节点与连线', '画布媒体生成'],
    auth: 'none',
    risk: 'high',
    installHint: '仅桌面版可用，需要本机 Node.js/npm。连接后自动打开画布并填写连接信息；生图 API Key 在画布网页配置。',
    command: 'npx',
    args: ['-y', CANVAS_AGENT_PACKAGE, 'mcp'],
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

/**
 * GitHub 的 OAuth client id 与 client secret 成对存放在 Gateway，属于 Gateway 的配置，
 * 所以连接时向 Gateway 取；不再用 `VITE_GITHUB_OAUTH_CLIENT_ID` 在构建期塞进产物。
 */
export async function resolveMcpOAuthClientId(entry: BuiltinMcpCatalogEntry): Promise<string> {
  if (entry.id !== 'github') return ''
  const payload = await gatewayJson<{ client_id?: string }>('/auth/mcp/github/config')
  return String(payload.client_id || '').trim()
}
