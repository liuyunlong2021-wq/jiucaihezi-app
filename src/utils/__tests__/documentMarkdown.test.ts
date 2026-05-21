import assert from 'node:assert/strict'
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
