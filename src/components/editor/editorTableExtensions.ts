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
    return ['td', mergeAttributes(HTMLAttributes), 0]
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
    return ['th', mergeAttributes(HTMLAttributes), 0]
  },
})
