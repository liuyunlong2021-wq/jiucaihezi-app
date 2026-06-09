export interface OpenCodeDiffFileLike {
  file?: string
  path?: string
  oldPath?: string
  newPath?: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
}

export type DiffReviewLineKind = 'add' | 'del' | 'context' | 'meta'

export interface DiffReviewLine {
  id: string
  kind: DiffReviewLineKind
  text: string
  oldLine?: number
  newLine?: number
}

export interface DiffReviewHunk {
  id: string
  header: string
  lines: DiffReviewLine[]
}

export interface DiffReviewFile {
  id: string
  file: string
  status: string
  additions: number
  deletions: number
  hasPatch: boolean
  hunks: DiffReviewHunk[]
}

export interface DiffReviewSummary {
  fileCount: number
  additions: number
  deletions: number
  hasPatchCount: number
  statusCounts: Record<string, number>
}

export interface DiffReviewModel {
  files: DiffReviewFile[]
  summary: DiffReviewSummary
}

function normalizeStatus(status: unknown): string {
  const text = String(status || 'modified').trim().toLowerCase()
  if (text === 'm') return 'modified'
  if (text === 'a') return 'added'
  if (text === 'd') return 'deleted'
  if (text === 'r') return 'renamed'
  return text || 'modified'
}

function diffFileName(file: OpenCodeDiffFileLike): string {
  return String(file.file || file.path || file.newPath || file.oldPath || '未命名文件')
}

function preHunkLineKind(text: string): DiffReviewLineKind {
  if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff --git')) return 'meta'
  if (text.startsWith('@@')) return 'meta'
  return 'context'
}

function hunkLineKind(text: string): DiffReviewLineKind {
  if (text.startsWith('+')) return 'add'
  if (text.startsWith('-')) return 'del'
  if (text.startsWith('\\')) return 'meta'
  return 'context'
}

function parseHunkStart(header: string): { oldLine: number; newLine: number } {
  const match = header.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
  return {
    oldLine: match ? Number(match[1]) : 0,
    newLine: match ? Number(match[2]) : 0,
  }
}

function parsePatchHunks(patch: string | undefined): DiffReviewHunk[] {
  const text = String(patch || '').trimEnd()
  if (!text) return []

  const hunks: DiffReviewHunk[] = []
  let current: DiffReviewHunk | null = null
  let oldLine = 0
  let newLine = 0

  function pushMetaLine(rawLine: string, index: number) {
    if (!current) current = { id: 'meta', header: '文件元信息', lines: [] }
    current.lines.push({ id: `${current.id}:${index}`, kind: preHunkLineKind(rawLine), text: rawLine })
  }

  text.split('\n').forEach((rawLine, index) => {
    if (rawLine.startsWith('@@')) {
      const parsed = parseHunkStart(rawLine)
      oldLine = parsed.oldLine
      newLine = parsed.newLine
      current = { id: `hunk-${hunks.length + 1}`, header: rawLine, lines: [] }
      hunks.push(current)
      return
    }

    if (!current) {
      pushMetaLine(rawLine, index)
      if (current && !hunks.includes(current)) hunks.push(current)
      return
    }

    const kind = hunkLineKind(rawLine)
    const line: DiffReviewLine = {
      id: `${current.id}:${index}`,
      kind,
      text: rawLine,
    }
    if (kind === 'add') {
      line.newLine = newLine || undefined
      newLine += 1
    } else if (kind === 'del') {
      line.oldLine = oldLine || undefined
      oldLine += 1
    } else if (kind === 'context') {
      line.oldLine = oldLine || undefined
      line.newLine = newLine || undefined
      oldLine += 1
      newLine += 1
    }
    current.lines.push(line)
  })

  return hunks.filter(hunk => hunk.lines.length || hunk.header)
}

export function buildDiffReviewModel(input: OpenCodeDiffFileLike[] | undefined): DiffReviewModel {
  const files = (input || []).map((file, index): DiffReviewFile => {
    const patch = String(file.patch || '')
    return {
      id: `${diffFileName(file)}:${index}`,
      file: diffFileName(file),
      status: normalizeStatus(file.status),
      additions: Number(file.additions || 0),
      deletions: Number(file.deletions || 0),
      hasPatch: Boolean(patch.trim()),
      hunks: parsePatchHunks(patch),
    }
  })

  const summary = files.reduce<DiffReviewSummary>((acc, file) => {
    acc.fileCount += 1
    acc.additions += file.additions
    acc.deletions += file.deletions
    if (file.hasPatch) acc.hasPatchCount += 1
    acc.statusCounts[file.status] = (acc.statusCounts[file.status] || 0) + 1
    return acc
  }, { fileCount: 0, additions: 0, deletions: 0, hasPatchCount: 0, statusCounts: {} })

  return { files, summary }
}
