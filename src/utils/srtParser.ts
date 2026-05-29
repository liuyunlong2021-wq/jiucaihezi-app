/**
 * SRT 字幕解析工具
 * 对照 NarratoAI: app/services/subtitle_text.py
 * 功能: 解析 .srt 文件 → 结构化字幕数组
 */

export interface SrtEntry {
  index: number
  startMs: number   // 开始时间(毫秒)
  endMs: number     // 结束时间(毫秒)
  startText: string // "00:00:05,390"
  endText: string   // "00:00:10,430"
  text: string      // 字幕文本
}

export interface SrtParseResult {
  entries: SrtEntry[]
  totalDurationMs: number
  encoding: string
}

const SRT_TIME_RE = /\b(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\b/

/** 时间戳文本 → 毫秒 */
export function timestampToMs(text: string): number {
  const m = text.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/)
  if (!m) return 0
  return parseInt(m[1]) * 3600000 + parseInt(m[2]) * 60000 + parseInt(m[3]) * 1000 + parseInt(m[4])
}

/** 毫秒 → 时间戳文本 */
export function msToTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const msPart = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msPart).padStart(3, '0')}`
}

/** 规范化字幕文本（BOM、换行、毫秒分隔符） */
export function normalizeSubtitleText(text: string): string {
  if (!text) return ''
  let normalized = text
  // BOM
  if (normalized.startsWith('\ufeff')) normalized = normalized.slice(1)
  // NUL bytes
  normalized = normalized.replace(/\x00/g, '')
  // 换行统一
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 毫秒分隔符 . → ,
  normalized = normalized.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
  return normalized.trim()
}

/** 检测是否包含 SRT 时间码 */
export function hasTimecodes(text: string): boolean {
  return SRT_TIME_RE.test(text)
}

/**
 * 解析 SRT 文本 → 结构化数组
 * 对照: NarratoAI plot_analysis.py 的时间戳提取逻辑
 */
export function parseSrt(rawText: string, encoding = 'utf-8'): SrtParseResult {
  const text = normalizeSubtitleText(rawText)
  const entries: SrtEntry[] = []

  // 按空行分割字幕块
  const blocks = text.split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // 第一行: 序号
    const index = parseInt(lines[0])
    if (isNaN(index)) continue

    // 第二行: 时间戳
    const timeMatch = lines[1].match(SRT_TIME_RE)
    if (!timeMatch) continue

    const startMs = timestampToMs(`${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]},${timeMatch[4]}`)
    const endMs = timestampToMs(`${timeMatch[5]}:${timeMatch[6]}:${timeMatch[7]},${timeMatch[8]}`)

    // 剩余行: 字幕文本
    const subtitleText = lines.slice(2).join('\n').trim()
    if (!subtitleText) continue

    entries.push({
      index,
      startMs,
      endMs,
      startText: `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]},${timeMatch[4]}`,
      endText: `${timeMatch[5]}:${timeMatch[6]}:${timeMatch[7]},${timeMatch[8]}`,
      text: subtitleText,
    })
  }

  return {
    entries,
    totalDurationMs: entries.length > 0 ? entries[entries.length - 1].endMs : 0,
    encoding,
  }
}

/**
 * 将结构化字幕转回 SRT 格式文本（不含序号和时间戳的纯文本，用于 LLM 分析）
 * 对照: NarratoAI plot_analysis.py 的输入格式
 */
export function formatSrtForLLM(entries: SrtEntry[]): string {
  return entries.map(e => `[${e.startText} → ${e.endText}] ${e.text}`).join('\n')
}

/**
 * 将结构化字幕转回标准 SRT 格式
 */
export function formatSrt(entries: SrtEntry[]): string {
  return entries.map(e =>
    `${e.index}\n${e.startText} --> ${e.endText}\n${e.text}\n`
  ).join('\n')
}
