export type ToolSource = 'cloud' | 'local' | 'openclaw'
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
    description: '读取用户上传的文档、资料和表格内容。',
    tags: ['上传文件', '资料解析'],
    aliases: ['office_read', 'read_document', 'document_read', 'parse_document', 'extract_document'],
    source: 'cloud',
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
    name: '音视频识别',
    icon: 'perm_media',
    category: '音视频',
    description: '识别上传音频、视频的大小、时长和画面信息。',
    tags: ['音频', '视频', '元信息'],
    aliases: ['local_media_inspect', 'media_inspect', 'inspect_media'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'local_media_plan',
    name: '音视频处理规划',
    icon: 'movie_edit',
    category: '音视频',
    description: '为压缩、转码、抽音频、字幕等任务生成本地执行计划。',
    tags: ['转码', '压缩', '字幕'],
    aliases: ['local_media_plan', 'media_plan', 'plan_media_conversion'],
    source: 'local',
    risk: 'safe',
  },
  {
    id: 'local_media_process',
    name: '音视频处理',
    icon: 'movie_filter',
    category: '音视频',
    description: '调用本地 ffmpeg 压缩、转码、截取、静音或抽取音频。',
    tags: ['ffmpeg', '转码', '抽音频'],
    aliases: ['local_media_process', 'media_process', 'process_media', 'ffmpeg_process'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'local_media_transcribe',
    name: '语音转文字',
    icon: 'record_voice_over',
    category: '音视频',
    description: '调用本地 Whisper 把音频或视频转成文字、SRT 或 VTT。',
    tags: ['转写', '字幕', 'Whisper'],
    aliases: ['local_media_transcribe', 'media_transcribe', 'audio_transcribe', 'speech_to_text'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'local_subtitle_burn',
    name: '字幕烧录',
    icon: 'subtitles',
    category: '音视频',
    description: '调用本地 ffmpeg 将 SRT 字幕烧录进视频。',
    tags: ['字幕', 'SRT', '视频'],
    aliases: ['local_subtitle_burn', 'subtitle_burn', 'burn_subtitles'],
    source: 'local',
    risk: 'write',
  },
  {
    id: 'office_generate',
    name: 'Office 生成',
    icon: 'article',
    category: 'Office',
    description: '生成 Word、PPT、Excel 等办公文件。',
    tags: ['Word', 'PPT', 'Excel'],
    aliases: ['office_create', 'create_document', 'create_docx', 'create_pptx', 'create_xlsx'],
    source: 'cloud',
    risk: 'write',
  },
  {
    id: 'office_convert',
    name: 'Office 转换',
    icon: 'published_with_changes',
    category: 'Office',
    description: '把文档转换成 PDF 或其他格式。',
    tags: ['PDF', '格式转换'],
    aliases: ['office_convert', 'convert_document', 'document_convert'],
    source: 'cloud',
    risk: 'write',
  },
  {
    id: 'code_execute',
    name: '代码执行',
    icon: 'code',
    category: '计算',
    description: '运行 Python 等代码，用于计算、制表和生成文件。',
    tags: ['Python', '计算'],
    aliases: ['office_execute', 'run_code', 'code_execute', 'python_execute'],
    source: 'cloud',
    risk: 'approval',
  },
  {
    id: 'browser_control',
    name: '浏览器',
    icon: 'public',
    category: '本地',
    description: '打开网页、点击、填写表单和读取网页内容。',
    tags: ['网页', '自动操作'],
    aliases: ['browser', 'browser_open', 'browser_click', 'browser_type', 'browser_screenshot', 'web_open'],
    source: 'openclaw',
    risk: 'approval',
  },
  {
    id: 'file_read',
    name: '文件读取',
    icon: 'folder_open',
    category: '本地',
    description: '读取本机允许范围内的文件内容。',
    tags: ['本地文件', '读取'],
    aliases: ['read', 'read_file', 'file_read', 'fs_read'],
    source: 'openclaw',
    risk: 'safe',
  },
  {
    id: 'file_write',
    name: '文件写入',
    icon: 'save',
    category: '本地',
    description: '写入或生成本机文件。',
    tags: ['保存文件', '生成'],
    aliases: ['write', 'write_file', 'file_write', 'fs_write'],
    source: 'openclaw',
    risk: 'write',
  },
  {
    id: 'file_edit',
    name: '文件编辑',
    icon: 'edit_document',
    category: '本地',
    description: '修改已有文件内容或应用补丁。',
    tags: ['编辑', '补丁'],
    aliases: ['edit', 'file_edit', 'apply_patch', 'patch_file'],
    source: 'openclaw',
    risk: 'write',
  },
  {
    id: 'command_exec',
    name: '命令执行',
    icon: 'terminal',
    category: '本地',
    description: '运行构建、检测、脚本等本地命令。',
    tags: ['命令', '脚本'],
    aliases: ['exec', 'bash', 'shell', 'command', 'run_command', 'terminal'],
    source: 'openclaw',
    risk: 'approval',
  },
  {
    id: 'cron_task',
    name: '定时任务',
    icon: 'schedule',
    category: '自动化',
    description: '创建和管理定时提醒、周期任务。',
    tags: ['提醒', '周期执行'],
    aliases: ['cron', 'create_cron', 'schedule_task', 'timer_task'],
    source: 'openclaw',
    risk: 'approval',
  },
  {
    id: 'knowledge_graph',
    name: '知识图谱',
    icon: 'hub',
    category: '知识库',
    description: '构建和查询资料之间的关系。',
    tags: ['Graph', '查询'],
    aliases: ['build_knowledge_graph', 'graphify_build', 'query_knowledge_graph', 'graphify_query'],
    source: 'cloud',
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
    case 'command_exec':
      return firstString('command', 'cmd', 'script') || card.name
    case 'browser_control':
      return firstString('url', 'action', 'selector') || card.name
    case 'file_read':
    case 'file_write':
    case 'file_edit':
      return firstString('path', 'file', 'filename') || card.name
    case 'office_generate':
    case 'office_convert':
    case 'document_read':
    case 'document_to_markdown':
      return firstString('filename', 'doc_type', 'target_format') || card.name
    case 'code_execute':
      return firstString('language', 'code') || card.name
    case 'cron_task':
      return firstString('schedule', 'cron', 'command', 'task') || card.name
    case 'knowledge_graph':
      return firstString('question', 'query', 'backend') || card.name
    case 'local_extract_attachment':
    case 'local_media_inspect':
    case 'local_media_plan':
    case 'local_media_process':
    case 'local_media_transcribe':
    case 'local_subtitle_burn':
      return firstString('filename', 'action', 'target_format') || card.name
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
      return firstString('command', 'workdir') || card.name
    default:
      return card.name
  }
}
