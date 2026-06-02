import { mergeAttributes, Node } from '@tiptap/core'

export const EditorTable = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'table' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['table', mergeAttributes(HTMLAttributes, { class: 'editor-table' }), ['tbody', 0]]
  },
})

export const EditorTableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell|tableHeader)*',

  parseHTML() {
    return [{ tag: 'tr' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['tr', mergeAttributes(HTMLAttributes), 0]
  },
})

function cellAttrs() {
  return {
    colspan: {
      default: 1,
      parseHTML: (element: HTMLElement) => Number(element.getAttribute('colspan') || 1),
    },
    rowspan: {
      default: 1,
      parseHTML: (element: HTMLElement) => Number(element.getAttribute('rowspan') || 1),
    },
    // textAlign for DOCX fidelity (maps to w:jc in cell paragraphs or tcPr)
    textAlign: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-text-align') || element.style.textAlign || null,
    },
    // colwidth for resizable table support (array or single)
    colwidth: {
      default: null,
      parseHTML: (element: HTMLElement) => {
        const w = element.getAttribute('data-colwidth') || element.style.width
        return w ? w : null
      },
    },
  }
}

export const EditorTableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return cellAttrs()
  },

  parseHTML() {
    return [{ tag: 'td' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['td', mergeAttributes(HTMLAttributes, { 'data-text-align': HTMLAttributes.textAlign || undefined }), 0]
  },
})

export const EditorTableHeader = Node.create({
  name: 'tableHeader',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return cellAttrs()
  },

  parseHTML() {
    return [{ tag: 'th' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['th', mergeAttributes(HTMLAttributes, { 'data-text-align': HTMLAttributes.textAlign || undefined }), 0]
  },
})
