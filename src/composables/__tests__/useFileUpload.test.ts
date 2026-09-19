import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectFileType } from '../useFileUpload'

const file = (name: string, type = ''): File => new File(['x'], name, { type })

test('detectFileType routes EPUB to the document converter', () => {
  // 回归：.epub 以前落到 unknown 被直接拒绝。它必须和服务端白名单一起走 office。
  assert.equal(detectFileType(file('召唤万岁.epub', 'application/epub+zip')), 'office')
  // 浏览器不认 MIME 时按扩展名兜底
  assert.equal(detectFileType(file('book.EPUB', 'application/octet-stream')), 'office')
})

test('detectFileType covers the extensions AnyDoc can convert', () => {
  for (const name of ['macro.docm', 'deck.pptm', 'show.ppsx', 'show.ppsm', 'show.pps', 'tpl.pot', 'sheet.xlsm', 'sheet.xlsb']) {
    assert.equal(detectFileType(file(name)), 'office', name)
  }
})

test('detectFileType keeps text, pdf and unknown apart', () => {
  assert.equal(detectFileType(file('notes.md', 'text/markdown')), 'text')
  assert.equal(detectFileType(file('rows.csv')), 'text')
  assert.equal(detectFileType(file('doc.pdf', 'application/pdf')), 'pdf')
  assert.equal(detectFileType(file('book.mobi')), 'unknown')
  assert.equal(detectFileType(file('book.azw3')), 'unknown')
})
