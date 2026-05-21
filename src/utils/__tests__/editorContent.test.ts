import assert from 'node:assert/strict'
import { test } from 'node:test'

import { textToTiptapDoc } from '../editorContent'

test('imports common markdown blocks into tiptap nodes', () => {
  const doc = textToTiptapDoc('# 标题\n\n正文\n\n- 要点\n\n> 引用\n\n---\n\n![图](asset://demo)')

  assert.deepEqual(
    doc.content.map((node: any) => node.type),
    ['heading', 'paragraph', 'bulletList', 'blockquote', 'horizontalRule', 'image'],
  )
  assert.equal((doc.content[0] as any).attrs.level, 1)
})

test('imports simple markdown tables into table nodes', () => {
  const doc = textToTiptapDoc('| A | B |\n| --- | --- |\n| 1 | 2 |')
  const table = doc.content[0] as any

  assert.equal(table.type, 'table')
  assert.equal(table.content.length, 2)
  assert.equal(table.content[0].content[0].type, 'tableHeader')
  assert.equal(table.content[1].content[0].type, 'tableCell')
})
