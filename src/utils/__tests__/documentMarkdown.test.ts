import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  classifyDocumentMarkdownReuse,
  convertDocumentToMarkdown,
  isMeaningfulMarkdownContent,
  normalizeMarkdownOutputFilename,
} from '../documentMarkdown'
import { detectFileType } from '@/composables/useFileUpload'

test('normalizeMarkdownOutputFilename keeps a single markdown extension', () => {
  assert.equal(normalizeMarkdownOutputFilename('救猫咪 3 反击战！.pdf'), '救猫咪 3 反击战！.md')
  assert.equal(normalizeMarkdownOutputFilename('notes.md'), 'notes.md')
  assert.equal(normalizeMarkdownOutputFilename('a/b:测试?.docx'), 'a_b_测试_.md')
})

test('subtitle files stay on the text path instead of becoming binary attachments', () => {
  assert.equal(detectFileType(new File(['1\n00:00:00,000 --> 00:00:01,000\n字幕'], 'clip.srt')), 'text')
  assert.equal(detectFileType(new File(['WEBVTT\n'], 'clip.vtt')), 'text')
})

test('subtitle conversion uses the local text Markdown path', async () => {
  const result = await convertDocumentToMarkdown({
    file: new File(['1\n00:00:00,000 --> 00:00:01,000\n字幕'], 'clip.srt'),
  })
  assert.equal(result.status, 'success')
  assert.equal(result.engine, 'text')
  assert.match(result.content, /字幕/)
})

test('isMeaningfulMarkdownContent rejects empty page marker extraction', () => {
  assert.equal(isMeaningfulMarkdownContent('[第1页]\n\n[第2页]'), false)
  assert.equal(isMeaningfulMarkdownContent('# 第一章\n\n真正的正文内容'), true)
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
  assert.doesNotMatch(source, /rapidocr|shouldRetryWithOcr/)
})

test('Desktop only falls back to cloud for an internal local parser failure', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(source, /localResult\.errorCode === 'internal'[\s\S]*convertWebDocumentToMarkdown\(input, maxChars, outputFilename\)/)
  assert.match(source, /: localResult/)
  assert.match(source, /catch \(err\) \{\s*return convertWebDocumentToMarkdown\(input, maxChars, outputFilename\)/)
})

test('Web document conversion rejects an HTML fallback even when it has HTTP 200', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(source, /content-type/)
  assert.match(source, /文档转换服务未部署或路由错误/)
})

test('AnyDoc metadata reuses only an unchanged current-version conversion', async () => {
  const content = '# 正文\n'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const contentSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const metadata = JSON.stringify({
    sourceSha256: 'source-hash',
    converterId: 'anydoc',
    converterVersion: '0.2.3',
    outputSchemaVersion: 1,
    contentSha256,
  })
  const markdown = `<!-- jc-document-conversion ${metadata} -->\n\n${content}`

  assert.equal(await classifyDocumentMarkdownReuse(markdown, 'source-hash'), 'reusable')
  assert.equal(await classifyDocumentMarkdownReuse(markdown, 'different-source'), 'stale')
  assert.equal(await classifyDocumentMarkdownReuse(`${markdown}用户修改`, 'source-hash'), 'edited')
  assert.equal(await classifyDocumentMarkdownReuse(content, 'source-hash'), 'stale')
})

test('AnyDoc dependency and persisted metadata version stay in sync', () => {
  const cargo = readFileSync(join(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8')
  const source = readFileSync(join(process.cwd(), 'src/utils/documentMarkdown.ts'), 'utf8')

  assert.match(cargo, /anydoc = "=0\.2\.3"/)
  assert.match(source, /ANYDOC_CONVERTER_VERSION = '0\.2\.3'/)
})

test('OCR-required Desktop errors use an explicit scanned-PDF message', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useFileUpload.ts'), 'utf8')

  assert.match(source, /converted\.errorCode === 'ocr_required'/)
  assert.match(source, /扫描版或图片型 PDF，没有可提取的文字层，需要 OCR/)
  assert.doesNotMatch(source, /ocr_required[\s\S]{0,300}文件损坏/)
})
