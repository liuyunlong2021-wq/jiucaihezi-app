import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  isMeaningfulMarkdownContent,
  normalizeMarkdownOutputFilename,
  shouldRetryWithOcr,
} from '../documentMarkdown'

test('normalizeMarkdownOutputFilename keeps a single markdown extension', () => {
  assert.equal(normalizeMarkdownOutputFilename('救猫咪 3 反击战！.pdf'), '救猫咪 3 反击战！.md')
  assert.equal(normalizeMarkdownOutputFilename('notes.md'), 'notes.md')
  assert.equal(normalizeMarkdownOutputFilename('a/b:测试?.docx'), 'a_b_测试_.md')
})

test('isMeaningfulMarkdownContent rejects empty page marker extraction', () => {
  assert.equal(isMeaningfulMarkdownContent('[第1页]\n\n[第2页]'), false)
  assert.equal(isMeaningfulMarkdownContent('# 第一章\n\n真正的正文内容'), true)
})

test('shouldRetryWithOcr only retries scanned PDF conversion failures', () => {
  assert.equal(shouldRetryWithOcr(
    { name: '扫描书.pdf', type: 'application/pdf' },
    {
      status: 'error',
      source: '扫描书.pdf',
      filename: '扫描书.md',
      content: '',
      engine: 'markitdown',
      truncated: false,
      message: 'MarkItDown 没有提取到有效正文，可能是扫描版或图片型文档。',
    },
  ), true)

  assert.equal(shouldRetryWithOcr(
    { name: 'notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    {
      status: 'error',
      source: 'notes.docx',
      filename: 'notes.md',
      content: '',
      engine: 'markitdown',
      truncated: false,
      message: 'MarkItDown 没有提取到有效正文，可能是扫描版或图片型文档。',
    },
  ), false)
})

test('Web document conversion uses the shared converter instead of a desktop-only rejection', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(source, /convertWebDocumentToMarkdown/)
  assert.match(source, /documents\/markdown/)
  assert.doesNotMatch(source, /TAURI_REQUIRED/)
})

test('Tauri document cloud fallback uses the native request while Mac keeps local-first conversion', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(source, /!isTauriRuntime\(\) \|\| isTauriMobileRuntime\(\)/)
  assert.match(source, /return convertWebDocumentToMarkdown\(input, maxChars, outputFilename\)/)
  assert.match(source, /isTauriRuntime\(\)[\s\S]*document_markdown_request/)
  assert.match(source, /invoke\('document_to_markdown_file'/)
})

test('Desktop falls back to the existing cloud converter when local MarkItDown is unavailable', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(source, /localResult\.status === 'success'[\s\S]*convertWebDocumentToMarkdown\(input, maxChars, outputFilename\)/)
  assert.match(source, /catch \(err\) \{\s*return convertWebDocumentToMarkdown\(input, maxChars, outputFilename\)/)
})

test('Web document conversion rejects an HTML fallback even when it has HTTP 200', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(source, /content-type/)
  assert.match(source, /文档转换服务未部署或路由错误/)
})
