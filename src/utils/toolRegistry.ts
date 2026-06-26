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

export function summarizeToolInvocation(toolName: string, args: Record<string, unknown> = {}): string {
  const card = getToolCardByName(toolName)
  if (!card) return String(toolName || '')

  const firstString = (...keys: string[]) => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }

  switch (card.id) {
    case 'browser_control':
      return firstString('url', 'query', 'action', 'selector') || card.name
    case 'document_read':
    case 'document_to_markdown':
      return firstString('filename', 'doc_type', 'target_format') || card.name
    case 'local_extract_attachment':
    case 'local_media_inspect':
    case 'local_media_plan':
    case 'local_media_process':
    case 'local_media_transcribe':
    case 'local_subtitle_burn':
    case 'local_media_url_download':
      return firstString('url', 'filename', 'action', 'target_format') || card.name
    case 'dev_detect_project':
      return card.name
    case 'dev_list_files':
    case 'dev_read_file':
    case 'dev_write_file':
    case 'dev_search_text':
    case 'dev_read_many_files':
    case 'dev_replace_in_file':
    case 'dev_get_diff':
      return firstString('path', 'relativePath', 'file') || card.name
    case 'dev_run_command':
    case 'command_exec':
      return firstString('command', 'cmd', 'workdir') || card.name
    case 'file_edit':
      return firstString('path', 'file', 'filename') || card.name
    case 'cron_task':
      return firstString('name', 'schedule', 'command', 'cmd') || card.name
    default:
      return card.name
  }
}
