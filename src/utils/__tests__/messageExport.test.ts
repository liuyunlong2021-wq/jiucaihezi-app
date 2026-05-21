import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMessageExportFile, getLocalExportFormats } from '../messageExport'

test('builds markdown and text export files from an assistant message', () => {
  const md = buildMessageExportFile('md', '# 标题\n\n正文', '产品报告')
  const txt = buildMessageExportFile('txt', '# 标题\n\n正文', '产品报告')

  assert.equal(md.filename, '产品报告.md')
  assert.equal(md.mimeType, 'text/markdown;charset=utf-8')
  assert.equal(md.content, '# 标题\n\n正文')
  assert.equal(txt.filename, '产品报告.txt')
  assert.equal(txt.content, '标题\n\n正文')
})

test('builds escaped html export file', () => {
  const file = buildMessageExportFile('html', '# 标题\n<script>alert(1)</script>', 'demo')

  assert.equal(file.filename, 'demo.html')
  assert.match(file.content, /<h1>标题<\/h1>/)
  assert.match(file.content, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('infers extra local formats from content', () => {
  assert.deepEqual(getLocalExportFormats('1\n00:00:00,000 --> 00:00:01,000\n你好'), ['md', 'txt', 'html', 'srt'])
  assert.deepEqual(getLocalExportFormats('a,b\n1,2'), ['md', 'txt', 'html', 'csv'])
  assert.deepEqual(getLocalExportFormats('{"a":1}'), ['md', 'txt', 'html', 'json'])
})
