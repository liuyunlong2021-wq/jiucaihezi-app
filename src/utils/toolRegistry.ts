export type ToolSource = 'cloud' | 'local'
export type ToolRisk = 'safe' | 'approval' | 'write'

export interface ToolCardDefinition {
  id: string
  name: string
  icon: string
  category: string
  description: string
  tags: string[]
  aliases: string[]
  source: ToolSource
  risk: ToolRisk
}

// 工具仓库已瘦身：所有自定义工具改为 GitHub 推荐安装。
// 仅保留 MCP 扩展入口。OpenCode 原生工具由 OpenCode 服务端提供。
export const TOOL_CARDS: ToolCardDefinition[] = [
  {
    id: 'mcp_extensions',
    name: '高级扩展',
    icon: 'extension',
    category: '扩展',
    description: 'MCP 服务器扩展 — 接入外部工具、数据库和 API。',
    tags: ['MCP', '扩展'],
    aliases: ['mcp', 'mcp_extensions', 'extension'],
    source: 'local',
    risk: 'safe',
  },
]

const aliasToCard = new Map<string, ToolCardDefinition>()

for (const card of TOOL_CARDS) {
  aliasToCard.set(normalizeToolName(card.id), card)
  for (const alias of card.aliases) {
    aliasToCard.set(normalizeToolName(alias), card)
  }
}

export function normalizeToolName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/[\s.-]+/g, '_')
}

export function getToolCardByName(toolName: string): ToolCardDefinition | null {
  return aliasToCard.get(normalizeToolName(toolName)) || null
}

export function summarizeToolInvocation(toolName: string, _args: Record<string, unknown> = {}): string {
  const card = getToolCardByName(toolName)
  // ponytail: TOOL_CARDS 瘦身后只剩 mcp_extensions，所有 case 都走 default。
  // 保留函数签名不变，调用方无需修改。未来加回工具卡片时恢复 switch。
  return card ? card.name : String(toolName || '')
}
