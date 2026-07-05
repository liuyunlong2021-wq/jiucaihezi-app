export interface EditorImportBlock {
  agentName?: string
  content: string
  timestamp?: Date
}

function textParagraph(text: string) {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : undefined,
  }
}

function textNode(text: string) {
  return text ? [{ type: 'text', text }] : undefined
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim().replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|'))
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1]))
}

function tableCell(type: 'tableHeader' | 'tableCell', text: string) {
  return {
    type,
    content: [textParagraph(text)],
  }
}

function tableRow(cells: string[], header = false) {
  return {
    type: 'tableRow',
    content: cells.map(cell => tableCell(header ? 'tableHeader' : 'tableCell', cell)),
  }
}

function parseTable(lines: string[], index: number) {
  const rows: string[][] = [splitTableRow(lines[index])]
  let cursor = index + 2
  while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
    rows.push(splitTableRow(lines[cursor]))
    cursor++
  }
  return {
    node: {
      type: 'table',
      content: rows.map((row, rowIndex) => tableRow(row, rowIndex === 0)),
    },
    nextIndex: cursor,
  }
}

function parseList(lines: string[], index: number, ordered = false) {
  const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/
  const items = []
  let cursor = index
  while (cursor < lines.length) {
    const match = lines[cursor].match(pattern)
    if (!match) break
    items.push({
      type: 'listItem',
      content: [textParagraph(match[1])],
    })
    cursor++
  }
  return {
    node: { type: ordered ? 'orderedList' : 'bulletList', content: items },
    nextIndex: cursor,
  }
}

function parseBlockquote(lines: string[], index: number) {
  const parts = []
  let cursor = index
  while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor])) {
    parts.push(lines[cursor].replace(/^\s*>\s?/, ''))
    cursor++
  }
  return {
    node: {
      type: 'blockquote',
      content: [textParagraph(parts.join('\n'))],
    },
    nextIndex: cursor,
  }
}

function parseCodeBlock(lines: string[], index: number) {
  const parts = []
  let cursor = index + 1
  while (cursor < lines.length && !/^```/.test(lines[cursor])) {
    parts.push(lines[cursor])
    cursor++
  }
  return {
    node: {
      type: 'codeBlock',
      content: textNode(parts.join('\n')),
    },
    nextIndex: cursor < lines.length ? cursor + 1 : cursor,
  }
}

function parseParagraph(lines: string[], index: number) {
  const parts = []
  let cursor = index
  while (cursor < lines.length) {
    const line = lines[cursor]
    if (!line.trim()) break
    if (/^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^\s*>\s?/.test(line) || /^---+$/.test(line.trim()) || /^```/.test(line) || isTableStart(lines, cursor)) break
    parts.push(line)
    cursor++
  }
  return {
    node: textParagraph(parts.join('\n')),
    nextIndex: cursor,
  }
}

export function textToTiptapDoc(text: string) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const content: any[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      i++
      continue
    }

    if (isTableStart(lines, i)) {
      const parsed = parseTable(lines, i)
      content.push(parsed.node)
      i = parsed.nextIndex
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1].length, 6) },
        content: textNode(heading[2]),
      })
      i++
      continue
    }

    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (image) {
      content.push({
        type: 'image',
        attrs: { alt: image[1], src: image[2] },
      })
      i++
      continue
    }

    if (/^```/.test(trimmed)) {
      const parsed = parseCodeBlock(lines, i)
      content.push(parsed.node)
      i = parsed.nextIndex
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const parsed = parseList(lines, i, false)
      content.push(parsed.node)
      i = parsed.nextIndex
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const parsed = parseList(lines, i, true)
      content.push(parsed.node)
      i = parsed.nextIndex
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const parsed = parseBlockquote(lines, i)
      content.push(parsed.node)
      i = parsed.nextIndex
      continue
    }

    if (/^---+$/.test(trimmed)) {
      content.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const parsed = parseParagraph(lines, i)
    content.push(parsed.node)
    i = parsed.nextIndex
  }
  return {
    type: 'doc',
    content: content.length > 0 ? content : [textParagraph('')],
  }
}

export function buildImportedTextDoc(block: EditorImportBlock) {
  const agentName = String(block.agentName || '助手')
  const timeText = (block.timestamp || new Date()).toLocaleTimeString()

  return {
    type: 'doc',
    content: [
      { type: 'horizontalRule' },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `${agentName} · ${timeText}` }],
          },
        ],
      },
      ...textToTiptapDoc(block.content).content,
    ],
  }
}
