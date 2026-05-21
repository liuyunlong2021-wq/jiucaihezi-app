export interface EditorAssetRef {
  id: string
  name: string
  mimeType: string
  size: number
  src?: string
  createdAt?: number
}

interface EditorDocumentSnapshot {
  tiptapJson: unknown
  html: string
  markdown: string
  assets?: EditorAssetRef[]
}

type TiptapNode = {
  type?: string
  text?: string
  attrs?: Record<string, any>
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  content?: TiptapNode[]
}

function nodeText(node: TiptapNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return applyMarks(node.text || '', node.marks || [])
  return (node.content || []).map(child => nodeText(child)).join('')
}

function applyMarks(text: string, marks: Array<{ type: string; attrs?: Record<string, any> }>): string {
  return marks.reduce((value, mark) => {
    if (mark.type === 'bold') return `**${value}**`
    if (mark.type === 'italic') return `*${value}*`
    if (mark.type === 'strike') return `~~${value}~~`
    if (mark.type === 'code') return `\`${value}\``
    if (mark.type === 'link' && mark.attrs?.href) return `[${value}](${mark.attrs.href})`
    return value
  }, text)
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, '<br>').trim()
}

function renderTable(node: TiptapNode): string {
  const rows = (node.content || []).filter(row => row.type === 'tableRow')
  if (rows.length === 0) return ''

  const renderedRows = rows.map(row => (row.content || []).map(cell => escapeTableCell(nodeText(cell))))
  const width = Math.max(...renderedRows.map(row => row.length), 1)
  const normalized = renderedRows.map(row => {
    const next = row.slice()
    while (next.length < width) next.push('')
    return next
  })
  const header = normalized[0]
  const separator = Array.from({ length: width }, () => '---')
  const body = normalized.slice(1)
  return [header, separator, ...body]
    .map(row => `| ${row.join(' | ')} |`)
    .join('\n')
}

function renderList(node: TiptapNode, ordered: boolean): string {
  return (node.content || [])
    .map((item, index) => {
      const body = (item.content || [])
        .map(child => renderNode(child))
        .filter(Boolean)
        .join('\n')
      const prefix = ordered ? `${index + 1}. ` : '- '
      return body
        .split('\n')
        .map((line, lineIndex) => lineIndex === 0 ? `${prefix}${line}` : `  ${line}`)
        .join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

function renderNode(node: TiptapNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text || '', node.marks || [])
    case 'paragraph':
      return nodeText(node)
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level || 1), 1), 6)
      return `${'#'.repeat(level)} ${nodeText(node)}`
    }
    case 'blockquote':
      return (node.content || [])
        .map(child => renderNode(child))
        .join('\n')
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')
    case 'bulletList':
      return renderList(node, false)
    case 'orderedList':
      return renderList(node, true)
    case 'listItem':
      return (node.content || []).map(child => renderNode(child)).join('\n')
    case 'codeBlock':
      return `\`\`\`\n${nodeText(node)}\n\`\`\``
    case 'horizontalRule':
      return '---'
    case 'image': {
      const src = String(node.attrs?.src || '')
      const alt = String(node.attrs?.alt || node.attrs?.title || '')
      return src ? `![${alt}](${src})` : ''
    }
    case 'hardBreak':
      return '\n'
    case 'table':
      return renderTable(node)
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return nodeText(node)
    default:
      return (node.content || []).map(child => renderNode(child)).filter(Boolean).join('\n\n')
  }
}

export function tiptapJsonToMarkdown(json: unknown): string {
  const root = json as TiptapNode
  const nodes = root?.type === 'doc' ? (root.content || []) : [root]
  return nodes
    .map(node => renderNode(node))
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function mergeEditorAssets(
  existing: EditorAssetRef[] = [],
  incoming: EditorAssetRef[] = [],
): EditorAssetRef[] {
  const byId = new Map<string, EditorAssetRef>()
  for (const asset of existing) {
    if (asset?.id) byId.set(asset.id, asset)
  }
  for (const asset of incoming) {
    if (asset?.id) byId.set(asset.id, asset)
  }
  return Array.from(byId.values())
}

export function buildEditorDocumentMetadata(
  existing: Record<string, unknown> | undefined,
  snapshot: EditorDocumentSnapshot,
): Record<string, unknown> {
  const previous = existing || {}
  const previousAssets = Array.isArray(previous.editorAssets)
    ? previous.editorAssets as EditorAssetRef[]
    : []

  return {
    ...previous,
    kind: previous.kind || 'editor-document',
    editorVersion: Number(previous.editorVersion || 0) + 1,
    tiptapJson: snapshot.tiptapJson,
    html: snapshot.html,
    markdown: snapshot.markdown,
    editorAssets: mergeEditorAssets(previousAssets, snapshot.assets || []),
    updatedByEditorAt: Date.now(),
  }
}
