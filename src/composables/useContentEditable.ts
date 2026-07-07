/**
 * useContentEditable — 照抄 OpenCode prompt-input.tsx 的 DOM 操作函数
 * createPill (L832-848), addPart (L1100-1149), getCursorPosition, parseFromDOM
 */

export interface ContentPart {
  type: 'file' | 'agent'
  path?: string
  name?: string
  content: string
  mime?: string
  url?: string
  source?: {
    type: 'resource'
    clientName?: string
    uri?: string
  }
}

/** 创建不可编辑的 pill <span>，对齐 OpenCode createPill */
export function createPill(part: ContentPart): HTMLSpanElement {
  const pill = document.createElement('span')
  pill.textContent = part.content
  pill.setAttribute('data-type', part.type)
  pill.setAttribute('contenteditable', 'false')

  if (part.type === 'file') {
    if (part.path) pill.setAttribute('data-path', part.path)
    if (part.mime) pill.setAttribute('data-mime', part.mime)
    if (part.url) pill.setAttribute('data-url', part.url)
    if (part.source?.type === 'resource') {
      pill.setAttribute('data-source-type', 'resource')
      if (part.source.uri) pill.setAttribute('data-source-uri', part.source.uri)
    }
  }
  if (part.type === 'agent') {
    if (part.name) pill.setAttribute('data-name', part.name)
  }

  return pill
}

/** 获取光标在 contenteditable 中的字符偏移 */
export function getCursorPosition(editor: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0

  const range = sel.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.selectNodeContents(editor)
  preRange.setEnd(range.endContainer, range.endOffset)
  return preRange.toString().length
}

/** 设置 range 的 start/end 边缘 */
function setRangeEdge(editor: HTMLElement, range: Range, edge: 'start' | 'end', offset: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let pos = 0
  let node: Text | null = null

  while ((node = walker.nextNode() as Text | null)) {
    const len = node.length
    if (pos + len >= offset) {
      if (edge === 'start') range.setStart(node, offset - pos)
      else range.setEnd(node, offset - pos)
      return
    }
    pos += len
  }
  // fallback
  if (edge === 'start') range.setStart(editor, 0)
  else range.setEnd(editor, editor.childNodes.length)
}

/**
 * 添加 pill 到 contenteditable。对齐 OpenCode addPart:
 * 1. 找到光标前的 @xxx 文本
 * 2. 删除它
 * 3. 插入空格 + pill
 * 4. 光标移到 pill 后
 */
export function addPart(editor: HTMLElement, part: ContentPart) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return

  const cursorPos = getCursorPosition(editor)
  const range = sel.getRangeAt(0)

  // 提取光标前文本，匹配 @xxx
  const textBeforeCursor = (editor.textContent || '').slice(0, cursorPos)
  const atMatch = textBeforeCursor.match(/@(\S*)$/)

  const pill = createPill(part)
  const space = document.createTextNode('\u00A0') // &nbsp;

  if (atMatch) {
    const start = atMatch.index ?? cursorPos - atMatch[0].length
    const r = document.createRange()
    r.selectNodeContents(editor)
    setRangeEdge(editor, r, 'start', start)
    setRangeEdge(editor, r, 'end', cursorPos)
    r.deleteContents()
    r.insertNode(space)
    r.insertNode(pill)
    // 光标移到 pill 后
    r.setStartAfter(pill)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

/** 从 contenteditable 提取纯文本（跳过 pill） */
export function getPlainText(editor: HTMLElement): string {
  let text = ''
  const walk = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node: Node | null
  while ((node = walk.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node as Text).textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.getAttribute('contenteditable') === 'false') {
        // pill: 用其 textContent
        text += el.textContent || ''
      }
    }
  }
  return text
}

/** 从 contenteditable 提取所有 pill */
export function extractPills(editor: HTMLElement): ContentPart[] {
  const pills: ContentPart[] = []
  for (const el of editor.querySelectorAll('[contenteditable="false"][data-type]')) {
    const type = el.getAttribute('data-type') as 'file' | 'agent' | null
    if (!type) continue
    pills.push({
      type,
      content: el.textContent || '',
      path: el.getAttribute('data-path') || undefined,
      name: el.getAttribute('data-name') || undefined,
      mime: el.getAttribute('data-mime') || undefined,
      url: el.getAttribute('data-url') || undefined,
      source: el.getAttribute('data-source-type') === 'resource'
        ? { type: 'resource', uri: el.getAttribute('data-source-uri') || undefined }
        : undefined,
    })
  }
  return pills
}

/** 设置编辑器文本内容并聚焦到末尾 */
export function setEditorText(editor: HTMLElement | null, text: string) {
  if (!editor) return
  editor.textContent = text
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  editor.focus()
}
