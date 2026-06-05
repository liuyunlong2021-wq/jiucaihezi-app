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

export const TOOL_CARDS: ToolCardDefinition[] = [
  {
    id: 'document_to_markdown',
    name: '格式转换',
    icon: 'text_snippet',
    category: '文档',
    description: '把本地资料转换成 Markdown。创建知识库请使用 Markdown 格式。',
    tags: ['Markdown', '格式转换'],
    aliases: ['document_to_markdown', 'to_markdown', 'tomd', 'convert_to_markdown', 'md_convert', 'markdown_convert'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'document_read',
    name: '文档读取',
    icon: 'description',
    category: '文档',
    description: '读取用户上传资料的本地提取文本。',
    tags: ['上传文件', '资料解析'],
    aliases: ['office_read', 'read_document', 'document_read', 'parse_document', 'extract_document'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'local_extract_attachment',
    name: '附件文本提取',
    icon: 'plagiarism',
    category: '文档',
    description: '读取当前对话上传附件的本地提取文本。',
    tags: ['附件', '文本'],
    aliases: ['local_extract_attachment', 'extract_attachment', 'read_attachment'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'local_media_inspect',
    name: '查看信息',
    icon: 'perm_media',
    category: '音视频',
    description: '查看音频、视频的大小、时长、画面和音轨信息。',
    tags: ['查看信息', '音频', '视频'],
    aliases: ['local_media_inspect', 'media_inspect', 'inspect_media'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'local_media_process',
    name: '压缩转格式',
    icon: 'movie_filter',
    category: '音视频',
    description: '压缩视频、转换格式、截取片段、抽取音频或静音。',
    tags: ['压缩', '转格式', '抽音频'],
    aliases: ['local_media_process', 'media_process', 'process_media', 'ffmpeg_process', 'local_media_plan', 'media_plan', 'plan_media_conversion'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'local_media_transcribe',
    name: '转文字',
    icon: 'record_voice_over',
    category: '音视频',
    description: '把音频或视频转成 TXT、SRT 或 VTT。',
    tags: ['转文字', '字幕', '音频'],
    aliases: ['local_media_transcribe', 'media_transcribe', 'audio_transcribe', 'speech_to_text'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'local_subtitle_burn',
    name: '视频上字幕',
    icon: 'subtitles',
    category: '音视频',
    description: '把 SRT 字幕合成到视频画面里。',
    tags: ['视频', '字幕', '合成'],
    aliases: ['local_subtitle_burn', 'subtitle_burn', 'burn_subtitles'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'local_media_url_download',
    name: '网页媒体采集',
    icon: 'download',
    category: '音视频',
    description: '从用户提供的链接下载视频、音频、字幕或元数据。',
    tags: ['视频下载', '字幕', '音频', '网页媒体'],
    aliases: ['local_media_url_download', 'media_url_download', 'media_url_capture', 'web_media_capture'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'browser_control',
    name: '浏览器',
    icon: 'public',
    category: '本地',
    description: '打开专用可见 Chrome，搜索、阅读网页、截图和必要的页面操作。',
    tags: ['Chrome', '搜索', '网页阅读'],
    aliases: [
      'browser',
      'browser_launch',
      'browser_search',
      'browser_open',
      'browser_read',
      'browser_state',
      'browser_screenshot',
      'browser_close',
      'browser_click',
      'browser_type',
      'web_search',
      'search',
      'web_open',
    ],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_detect_project',
    name: '项目识别',
    icon: 'data_object',
    category: '开发',
    description: '识别源码项目类型、包管理器和推荐检查命令。',
    tags: ['项目', '检测'],
    aliases: ['dev_detect_project', 'project_detect', 'detect_project'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_list_files',
    name: '项目文件列表',
    icon: 'account_tree',
    category: '开发',
    description: '查看已选择源码项目的文件结构。',
    tags: ['项目', '文件树'],
    aliases: ['dev_list_files', 'project_list_files', 'list_project_files'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_search_text',
    name: '项目文本搜索',
    icon: 'manage_search',
    category: '开发',
    description: '在源码项目内搜索代码和文本。',
    tags: ['搜索', '代码定位'],
    aliases: ['dev_search_text', 'project_search_text', 'search_project_text'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_read_file',
    name: '项目文件读取',
    icon: 'find_in_page',
    category: '开发',
    description: '读取已选择源码项目内的文本文件。',
    tags: ['读代码', '源码'],
    aliases: ['dev_read_file', 'project_read_file', 'read_project_file'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_read_many_files',
    name: '项目批量读取',
    icon: 'library_books',
    category: '开发',
    description: '一次读取多个相关源码文件。',
    tags: ['批量', '读代码'],
    aliases: ['dev_read_many_files', 'project_read_many_files', 'read_many_project_files'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_write_file',
    name: '项目文件写入',
    icon: 'edit_square',
    category: '开发',
    description: '写入或创建已选择源码项目内的文件。',
    tags: ['改代码', '写文件'],
    aliases: ['dev_write_file', 'project_write_file', 'write_project_file'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'dev_replace_in_file',
    name: '项目精准替换',
    icon: 'difference',
    category: '开发',
    description: '按 exact 文本片段精准替换源码内容。',
    tags: ['补丁', '修改'],
    aliases: ['dev_replace_in_file', 'project_replace_in_file', 'replace_project_text'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'dev_get_diff',
    name: '项目改动查看',
    icon: 'difference',
    category: '开发',
    description: '查看源码项目当前 Git diff。',
    tags: ['Diff', '变更'],
    aliases: ['dev_get_diff', 'project_get_diff', 'get_project_diff'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'dev_run_command',
    name: '项目命令执行',
    icon: 'terminal',
    category: '开发',
    description: '在已选择源码项目内运行构建、检查和打包命令。',
    tags: ['构建', '测试', '打包'],
    aliases: ['dev_run_command', 'project_run_command', 'run_project_command'],
    source: 'local',
    risk: 'approval',
  },
  {
    id: 'command_exec',
    name: '命令执行',
    icon: 'terminal',
    category: '开发',
    description: '执行本地命令或源码项目命令。',
    tags: ['命令', '终端'],
    aliases: ['bash', 'shell', 'exec', 'exec_command', 'run_command'],
    source: 'local',
    risk: 'approval',
  },
  {
    id: 'file_edit',
    name: '文件读写',
    icon: 'edit_document',
    category: '开发',
    description: '读取、写入或补丁修改本地文件。',
    tags: ['文件', '补丁'],
    aliases: ['file_read', 'file_write', 'read_file', 'write_file', 'apply_patch', 'patch_file'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'cron_task',
    name: '定时任务',
    icon: 'schedule',
    category: '自动化',
    description: '创建或管理本地定时任务。',
    tags: ['Cron', '定时'],
    aliases: ['create_cron', 'cron_create', 'schedule_task', 'cron_task'],
    source: 'local',
    risk: 'write',
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
