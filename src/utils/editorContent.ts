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

export function textToTiptapDoc(text: string) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const content = lines.map(line => textParagraph(line))
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
