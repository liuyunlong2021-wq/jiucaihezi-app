import type { ChatCompletionTool, OfficeToolContext, ToolCallLike } from '@/composables/officeTools'
import { isTauriRuntime } from './tauriEnv'
import { normalizeMarkdownOutputFilename } from './documentMarkdown'

export interface MediaAttachmentMetadata {
  name: string
  type?: string
  size?: number
  durationSeconds?: number
  width?: number
  height?: number
  cachedPath?: string
}

const AUDIO_VIDEO_EXT_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|m4v|webm|avi|mkv)$/i
const SUPPORTED_MEDIA_ACTIONS = new Set(['compress', 'convert', 'extract_audio', 'trim', 'mute'])
const SUPPORTED_TARGET_FORMATS = new Set(['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'aac', 'flac', 'ogg'])

export interface MediaCacheResult {
  inputPath: string
  filename: string
  size: number
}

export interface MediaProcessRequest {
  inputPath: string
  action: string
  targetFormat: string
  outputFilename: string
  startSeconds?: number
  endSeconds?: number
  crf?: number
}

interface CachedMediaSelection {
  name: string
  inputPath: string
}

export type MediaProcessInputResult =
  | { status: 'ready'; request: MediaProcessRequest }
  | { status: 'error'; message: string }

export function isAudioVideoFilename(filename: string): boolean {
  return AUDIO_VIDEO_EXT_RE.test(String(filename || ''))
}

function formatBytes(size?: number): string {
  if (!Number.isFinite(size || NaN)) return '未知大小'
  const value = Number(size)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function buildMediaAttachmentSummary(input: MediaAttachmentMetadata): string {
  const lines = [
    '[本地媒体文件]',
    `文件名: ${input.name}`,
    `类型: ${input.type || '未知类型'}`,
    `大小: ${formatBytes(input.size)}`,
  ]

  if (Number.isFinite(input.durationSeconds || NaN)) {
    lines.push(`时长: ${Number(input.durationSeconds).toFixed(1)} 秒`)
  }
  if (input.width && input.height) {
    lines.push(`画面: ${input.width}x${input.height}`)
  }
  if (input.cachedPath) {
    lines.push(`本地缓存: ${input.cachedPath}`)
  }

  lines.push('说明: 当前版本已完成本地元信息识别；压缩、转码、抽音频、截取、语音转文字和字幕烧录可调用本地媒体工具。')
  return lines.join('\n')
}

export function getLocalContentToolDefinitions(): ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'document_to_markdown',
        description: '把当前对话上传的文档、资料或文本附件转换成 Markdown。普通文档使用 MarkItDown，扫描 PDF 和图片型文档使用 RapidOCR。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '可选，指定附件名或部分文件名；不传则转换全部可读附件。' },
            max_chars: { type: 'number', description: '每个附件最多转换字符数，默认 200000。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_extract_attachment',
        description: '读取当前对话已上传附件的本地提取文本，适合分析 Markdown、TXT、CSV、JSON、代码文件和已解析文档。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '可选，指定附件名；不传则读取全部文本附件。' },
            max_chars: { type: 'number', description: '每个附件最多返回字符数，默认 120000。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_media_inspect',
        description: '查看当前对话已上传音频/视频的本地元信息，例如文件名、大小、时长、视频尺寸。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '可选，指定音频或视频附件名。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_media_plan',
        description: '为音频/视频转写、加字幕等尚未直连的任务生成本地执行计划；不会伪造已完成结果。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '源音频或视频文件名。' },
            action: { type: 'string', description: '处理动作，例如 compress、convert、extract_audio、add_subtitles、trim。' },
            target_format: { type: 'string', description: '目标格式，例如 mp4、mp3、wav、srt。' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_media_process',
        description: '调用本地 ffmpeg 处理当前对话上传的音频/视频，支持压缩、转码、抽音频、截取、静音。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '源音频或视频文件名，可填部分文件名。' },
            action: {
              type: 'string',
              enum: ['compress', 'convert', 'extract_audio', 'trim', 'mute'],
              description: '处理动作：compress 压缩，convert 转格式，extract_audio 抽音频，trim 截取，mute 静音。',
            },
            target_format: { type: 'string', description: '目标格式，例如 mp4、mp3、wav、webm。' },
            start_seconds: { type: 'number', description: 'trim 截取开始秒数。' },
            end_seconds: { type: 'number', description: 'trim 截取结束秒数。' },
            crf: { type: 'number', description: '视频压缩质量，18 高质量，23 平衡，28 更小。' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_media_transcribe',
        description: '调用本地 Whisper 运行时把当前对话上传的音频/视频转成文字、SRT 或 VTT 字幕。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '源音频或视频文件名，可填部分文件名。' },
            output_format: {
              type: 'string',
              enum: ['txt', 'srt', 'vtt', 'json'],
              description: '输出格式，默认 txt；需要字幕时用 srt 或 vtt。',
            },
            language: { type: 'string', description: '可选语言，例如 Chinese、zh、English、en。' },
            model: { type: 'string', description: 'Whisper 模型名，默认 base。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_subtitle_burn',
        description: '调用本地 ffmpeg 将 SRT 字幕烧录到当前对话上传的视频中，生成带字幕的视频。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '源视频文件名，可填部分文件名。' },
            subtitle_text: { type: 'string', description: 'SRT 字幕文本。' },
            subtitle_filename: { type: 'string', description: '可选，从已上传的 SRT/TXT 附件中按文件名读取字幕文本。' },
            output_filename: { type: 'string', description: '可选输出文件名，默认自动生成。' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'local_video_narrate',
        description: '一键视频解说管道：提取音频→Whisper转写字幕→返回SRT字幕文本。之后可调用解说搭子生成解说JSON，再调用字幕烧录合成成片。对照NarratoAI全流程。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '源视频文件名，可填部分文件名。' },
            language: { type: 'string', description: '可选语言，默认 auto 自动检测。' },
            model: { type: 'string', description: 'Whisper 模型名，默认 base（推荐 tiny/base/small/medium/large）。' },
          },
        },
      },
    },
  ]
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function matchesFilename(name: string, expected?: unknown): boolean {
  const query = String(expected || '').trim().toLowerCase()
  if (!query) return true
  return name.toLowerCase().includes(query)
}

function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false }
  return { content: content.slice(0, maxChars), truncated: true }
}

function getContextFiles(context?: OfficeToolContext) {
  return context?.files || []
}

function safeBaseName(filename: string): string {
  const clean = String(filename || 'media')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
  return clean || 'media'
}

function markdownBaseName(filename: string): string {
  const clean = String(filename || 'document')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    .trim()
  return clean || 'document'
}

function normalizeMarkdownFilename(filename: string): string {
  return normalizeMarkdownOutputFilename(filename)
}

function escapeMarkdownTitle(value: string): string {
  return String(value || 'document').replace(/[\r\n#]+/g, ' ').trim() || 'document'
}

function buildMarkdownFromAttachment(name: string, content: string): string {
  const title = escapeMarkdownTitle(markdownBaseName(name))
  return `# ${title}\n\n${String(content || '').trim()}\n`
}

function normalizeTargetFormat(value: unknown, fallback: string): string {
  const format = String(value || fallback).trim().toLowerCase().replace(/^\./, '')
  return SUPPORTED_TARGET_FORMATS.has(format) ? format : fallback
}

function defaultTargetFormat(action: string, args: Record<string, unknown>, sourceName: string): string {
  if (action === 'extract_audio') return normalizeTargetFormat(args.target_format, 'mp3')
  if (action === 'compress' || action === 'mute') return normalizeTargetFormat(args.target_format, 'mp4')
  if (action === 'trim') {
    const ext = sourceName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'mp4'
    return normalizeTargetFormat(args.target_format, ext)
  }
  return normalizeTargetFormat(args.target_format, 'mp4')
}

function outputSuffix(action: string): string {
  if (action === 'extract_audio') return 'audio'
  if (action === 'compress') return 'compressed'
  if (action === 'trim') return 'clip'
  if (action === 'mute') return 'silent'
  return 'converted'
}

function parseCachedPath(content: string): string {
  const match = String(content || '').match(/^本地缓存:\s*(.+)$/m)
  return match?.[1]?.trim() || ''
}

function selectCachedMedia(
  files: Array<{ name: string; content: string }>,
  filename?: unknown,
): CachedMediaSelection | null {
  const selected = files.find(file => (
    matchesFilename(file.name, filename) &&
    (isAudioVideoFilename(file.name) || file.content.includes('[本地媒体文件]'))
  ))
  if (!selected) return null
  const inputPath = parseCachedPath(selected.content)
  if (!inputPath) return null
  return { name: selected.name, inputPath }
}

function pickSubtitleText(args: Record<string, unknown>, files: Array<{ name: string; content: string }>): string {
  const direct = String(args.subtitle_text || '').trim()
  if (direct) return direct
  const subtitleFile = files.find(file => matchesFilename(file.name, args.subtitle_filename) && /\.(srt|vtt|txt)$/i.test(file.name))
  return subtitleFile?.content?.trim() || ''
}

export function buildMediaProcessInput(
  args: Record<string, unknown>,
  files: Array<{ name: string; content: string }>,
): MediaProcessInputResult {
  const action = String(args.action || '').trim().toLowerCase()
  if (!SUPPORTED_MEDIA_ACTIONS.has(action)) {
    return { status: 'error', message: `不支持的媒体处理动作: ${action || '空'}` }
  }

  const selected = selectCachedMedia(files, args.filename)
  if (!selected) {
    return { status: 'error', message: '未找到可处理的音频或视频附件，请先上传文件。' }
  }

  const targetFormat = defaultTargetFormat(action, args, selected.name)
  const outputFilename = `${safeBaseName(selected.name)}_${outputSuffix(action)}.${targetFormat}`
  const crf = Number(args.crf || 23)
  const startSeconds = args.start_seconds === undefined ? undefined : Number(args.start_seconds)
  const endSeconds = args.end_seconds === undefined ? undefined : Number(args.end_seconds)

  return {
    status: 'ready',
    request: {
      inputPath: selected.inputPath,
      action,
      targetFormat,
      outputFilename,
      crf: Number.isFinite(crf) ? Math.min(Math.max(crf, 18), 35) : 23,
      startSeconds: Number.isFinite(startSeconds) ? startSeconds : undefined,
      endSeconds: Number.isFinite(endSeconds) ? endSeconds : undefined,
    },
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function cacheMediaFileForLocalProcessing(file: File): Promise<MediaCacheResult | null> {
  if (!isTauriRuntime()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const dataBase64 = arrayBufferToBase64(await file.arrayBuffer())
  return await invoke('media_cache_file', {
    input: {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataBase64,
    },
  }) as MediaCacheResult
}

export function isLocalContentToolName(name: string): boolean {
  return getLocalContentToolDefinitions().some(tool => tool.function.name === name)
}

export async function executeLocalContentToolCall(call: ToolCallLike, context?: OfficeToolContext): Promise<string> {
  const name = call.function.name
  if (!isLocalContentToolName(name)) return ''

  const args = parseArgs(call.function.arguments)
  const files = getContextFiles(context)

  if (name === 'document_to_markdown') {
    const maxChars = Math.max(1, Math.min(Number(args.max_chars || 200000), 500000))
    const selected = files
      .filter(file => matchesFilename(file.name, args.filename))
      .filter(file => String(file.content || '').trim())

    if (selected.length === 0) {
      return JSON.stringify({
        status: 'error',
        error: 'NO_READABLE_ATTACHMENT',
        tool: name,
        message: '没有找到可转换的附件文本，请先上传文件，或选择可被解析的文档。',
      })
    }

    const outputs = selected.map(file => {
      const markdown = buildMarkdownFromAttachment(file.name, file.content)
      const truncated = truncateContent(markdown, maxChars)
      return {
        source: file.name,
        filename: normalizeMarkdownFilename(file.name),
        ...truncated,
      }
    })

    return JSON.stringify({
      status: 'success',
      tool: name,
      engine: 'attachment_text',
      files: outputs,
      count: outputs.length,
      message: outputs.length === 1
        ? `已将 ${outputs[0].source} 转换为 Markdown。`
        : `已将 ${outputs.length} 个附件转换为 Markdown。`,
    })
  }

  if (name === 'local_extract_attachment') {
    const maxChars = Math.max(1, Math.min(Number(args.max_chars || 120000), 500000))
    const selected = files.filter(file => matchesFilename(file.name, args.filename))
    return JSON.stringify({
      status: 'success',
      tool: name,
      files: selected.map(file => ({
        name: file.name,
        ...truncateContent(file.content, maxChars),
      })),
      count: selected.length,
    })
  }

  if (name === 'local_media_inspect') {
    const selected = files.filter(file => (
      matchesFilename(file.name, args.filename) &&
      (isAudioVideoFilename(file.name) || file.content.includes('[本地媒体文件]'))
    ))
    return JSON.stringify({
      status: 'success',
      tool: name,
      media: selected.map(file => ({ name: file.name, summary: file.content })),
      count: selected.length,
    })
  }

  if (name === 'local_media_plan') {
    const action = String(args.action || '').trim()
    const filename = String(args.filename || '').trim()
    const targetFormat = String(args.target_format || '').trim()
    return JSON.stringify({
      status: 'planned',
      tool: name,
      filename,
      action,
      target_format: targetFormat,
      local_executor_required: 'ffmpeg_or_whisper_runtime',
      steps: [
        '确认源文件可访问，并读取媒体元信息。',
        '根据动作选择白名单执行器，不开放任意 shell。',
        '执行处理后校验输出文件大小、格式和时长。',
        '把输出文件挂到对话下载区，并把执行日志回传给模型继续判断。',
      ],
      message: '这是本地处理规划；如用户确认执行，可继续调用音视频处理、语音转文字或字幕烧录工具。',
    })
  }

  if (name === 'local_media_process') {
    if (!isTauriRuntime()) {
      return JSON.stringify({
        status: 'error',
        error: 'TAURI_REQUIRED',
        tool: name,
        message: '本地媒体处理只能在桌面端使用。',
      })
    }
    const processInput = buildMediaProcessInput(args, files)
    if (processInput.status === 'error') {
      return JSON.stringify({
        status: 'error',
        error: 'MEDIA_PROCESS_INPUT_INVALID',
        tool: name,
        message: processInput.message,
      })
    }

    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
      const result = await invoke('media_process_file', { input: processInput.request }) as {
        outputPath: string
        outputFilename: string
        outputSize: number
        stdout: string
        stderr: string
        durationMs: number
      }
      const downloadUrl = convertFileSrc(result.outputPath)
      return JSON.stringify({
        status: 'success',
        tool: name,
        action: processInput.request.action,
        output_files: [{
          filename: result.outputFilename,
          download_url: downloadUrl,
          size: result.outputSize,
        }],
        result,
      })
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: 'MEDIA_PROCESS_FAILED',
        tool: name,
        message: (err as Error).message,
      })
    }
  }

  if (name === 'local_media_transcribe') {
    if (!isTauriRuntime()) {
      return JSON.stringify({
        status: 'error',
        error: 'TAURI_REQUIRED',
        tool: name,
        message: '本地语音转文字只能在桌面端使用。',
      })
    }
    const media = selectCachedMedia(files, args.filename)
    if (!media) {
      return JSON.stringify({
        status: 'error',
        error: 'MEDIA_INPUT_NOT_FOUND',
        tool: name,
        message: '未找到可转写的音频或视频附件，请先上传文件。',
      })
    }
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
      const result = await invoke('media_transcribe_file', {
        input: {
          inputPath: media.inputPath,
          outputFormat: String(args.output_format || 'txt'),
          language: args.language ? String(args.language) : undefined,
          model: args.model ? String(args.model) : undefined,
        },
      }) as {
        outputPath: string
        outputFilename: string
        outputSize: number
        text: string
        stdout: string
        stderr: string
        durationMs: number
      }
      return JSON.stringify({
        status: 'success',
        tool: name,
        text: result.text,
        output_files: [{
          filename: result.outputFilename,
          download_url: convertFileSrc(result.outputPath),
          size: result.outputSize,
        }],
        result,
      })
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: 'MEDIA_TRANSCRIBE_FAILED',
        tool: name,
        message: (err as Error).message,
      })
    }
  }

  if (name === 'local_subtitle_burn') {
    if (!isTauriRuntime()) {
      return JSON.stringify({
        status: 'error',
        error: 'TAURI_REQUIRED',
        tool: name,
        message: '本地字幕烧录只能在桌面端使用。',
      })
    }
    const media = selectCachedMedia(files, args.filename)
    const subtitleText = pickSubtitleText(args, files)
    if (!media) {
      return JSON.stringify({
        status: 'error',
        error: 'MEDIA_INPUT_NOT_FOUND',
        tool: name,
        message: '未找到可烧录字幕的视频附件，请先上传视频。',
      })
    }
    if (!subtitleText) {
      return JSON.stringify({
        status: 'error',
        error: 'SUBTITLE_TEXT_REQUIRED',
        tool: name,
        message: '请提供 SRT 字幕文本，或上传 SRT/TXT 字幕文件。',
      })
    }
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
      const result = await invoke('media_burn_subtitles', {
        input: {
          inputPath: media.inputPath,
          subtitleText,
          outputFilename: args.output_filename ? String(args.output_filename) : undefined,
        },
      }) as {
        outputPath: string
        outputFilename: string
        outputSize: number
        stdout: string
        stderr: string
        durationMs: number
      }
      return JSON.stringify({
        status: 'success',
        tool: name,
        output_files: [{
          filename: result.outputFilename,
          download_url: convertFileSrc(result.outputPath),
          size: result.outputSize,
        }],
        result,
      })
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: 'SUBTITLE_BURN_FAILED',
        tool: name,
        message: (err as Error).message,
      })
    }
  }

  if (name === 'local_video_narrate') {
    if (!isTauriRuntime()) {
      return JSON.stringify({
        status: 'error',
        error: 'TAURI_REQUIRED',
        tool: name,
        message: '视频解说管道只能在桌面端使用。需要 whisper.cpp + ffmpeg。',
      })
    }
    const media = selectCachedMedia(files, args.filename)
    if (!media) {
      return JSON.stringify({
        status: 'error',
        error: 'MEDIA_INPUT_NOT_FOUND',
        tool: name,
        message: '未找到可解说的视频附件，请先上传视频文件。',
      })
    }
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
      const result = await invoke('media_transcribe_file', {
        input: {
          inputPath: media.inputPath,
          outputFormat: 'srt',
          language: args.language ? String(args.language) : undefined,
          model: args.model ? String(args.model) : 'base',
        },
      }) as {
        outputPath: string; outputFilename: string; outputSize: number
        text: string; stdout: string; stderr: string; durationMs: number
      }
      return JSON.stringify({
        status: 'success',
        tool: name,
        transcript_srt: result.text,
        message: '字幕提取完成！现在可以：1) 使用「短剧解说工坊」或「影视解说工坊」搭子分析剧情并生成解说JSON；2) 然后调用 local_subtitle_burn 烧录字幕合成成片。',
        output_files: [{
          filename: result.outputFilename,
          download_url: convertFileSrc(result.outputPath),
          size: result.outputSize,
        }],
        result,
      })
    } catch (err) {
      return JSON.stringify({
        status: 'error',
        error: 'VIDEO_NARRATE_FAILED',
        tool: name,
        message: `视频解说管道失败: ${(err as Error).message}。请确认已安装 whisper.cpp (brew install whisper-cpp) 并下载模型文件 (~/Library/Caches/whisper/ggml-base.bin)。`,
      })
    }
  }

  return ''
}
