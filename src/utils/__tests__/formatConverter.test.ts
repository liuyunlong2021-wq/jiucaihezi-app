import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  defaultFormatConverterSettings,
  defaultConversionModeForPath,
  outputFormatsForPath,
  readableSourceMeta,
  shouldImportConvertedContentToEditor,
} from '../formatConverter'

test('chooses stable default conversion modes by file type', () => {
  assert.equal(defaultConversionModeForPath('/tmp/book.pdf'), 'auto')
  assert.equal(defaultConversionModeForPath('/tmp/scan.png'), 'ocr')
  assert.equal(defaultConversionModeForPath('/tmp/report.docx'), 'fast')
})

test('lists only real output formats for each source type', () => {
  assert.deepEqual(outputFormatsForPath('/tmp/book.pdf').map(item => item.value), ['md', 'txt', 'html'])
  assert.deepEqual(outputFormatsForPath('/tmp/table.xlsx').map(item => item.value), ['md', 'txt', 'html', 'csv'])
  assert.deepEqual(outputFormatsForPath('/tmp/data.json').map(item => item.value), ['md', 'txt', 'html', 'json'])
  assert.deepEqual(outputFormatsForPath('/tmp/subtitle.srt').map(item => item.value), ['md', 'txt', 'html', 'srt'])
})

test('builds concise source metadata for rows', () => {
  assert.equal(readableSourceMeta('/tmp/report.docx'), 'Word · 建议快速转换')
  assert.equal(readableSourceMeta('/tmp/book.pdf'), 'PDF · 智能推荐')
  assert.equal(readableSourceMeta('/tmp/scan.jpg'), '图片 · 建议 OCR')
})

test('does not auto-import large conversion output into the editor', () => {
  const settings = defaultFormatConverterSettings()
  assert.equal(settings.importToEditor, false)

  assert.equal(shouldImportConvertedContentToEditor({
    importToEditor: true,
    outputFormat: 'md',
    contentLength: 200_000,
  }), true)
  assert.equal(shouldImportConvertedContentToEditor({
    importToEditor: true,
    outputFormat: 'md',
    contentLength: 200_001,
  }), false)
  assert.equal(shouldImportConvertedContentToEditor({
    importToEditor: true,
    outputFormat: 'html',
    contentLength: 100,
  }), false)
})
