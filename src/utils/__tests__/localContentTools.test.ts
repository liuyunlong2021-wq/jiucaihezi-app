import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMediaProcessInput,
  buildMediaAttachmentSummary,
  getLocalContentToolDefinitions,
  isAudioVideoFilename,
} from '../localContentTools'

test('detects audio and video filenames', () => {
  assert.equal(isAudioVideoFilename('demo.mp4'), true)
  assert.equal(isAudioVideoFilename('voice.MP3'), true)
  assert.equal(isAudioVideoFilename('notes.md'), false)
})

test('exposes local content and media tools', () => {
  assert.deepEqual(
    getLocalContentToolDefinitions().map(tool => tool.function.name),
    [
      'document_to_markdown',
      'local_extract_attachment',
      'local_media_inspect',
      'local_media_plan',
      'local_media_process',
      'local_media_transcribe',
      'local_subtitle_burn',
      'local_video_narrate',
    ],
  )
})

test('document_to_markdown produces markdown from uploaded text attachments', async () => {
  const { executeLocalContentToolCall } = await import('../localContentTools')
  const result = await executeLocalContentToolCall(
    {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'document_to_markdown',
        arguments: JSON.stringify({ filename: 'demo', max_chars: 2000 }),
      },
    } as any,
    {
      files: [
        { name: 'demo.txt', content: '第一章\n这是正文。' },
        { name: 'other.txt', content: '忽略我。' },
      ],
    } as any,
  )
  const parsed = JSON.parse(result)

  assert.equal(parsed.status, 'success')
  assert.equal(parsed.tool, 'document_to_markdown')
  assert.equal(parsed.files.length, 1)
  assert.equal(parsed.files[0].filename, 'demo.md')
  assert.match(parsed.files[0].content, /# demo/)
  assert.match(parsed.files[0].content, /第一章/)
})

test('local_extract_attachment reads current uploaded text attachments only', async () => {
  const { executeLocalContentToolCall } = await import('../localContentTools')
  const result = await executeLocalContentToolCall(
    {
      id: 'call_extract',
      type: 'function',
      function: {
        name: 'local_extract_attachment',
        arguments: JSON.stringify({ filename: 'demo', max_chars: 10 }),
      },
    } as any,
    {
      files: [
        { name: 'demo.md', content: '前三秒必须有冲突，第一集必须出现强钩子。' },
        { name: 'other.md', content: '不应该返回。' },
      ],
    } as any,
  )
  const parsed = JSON.parse(result)

  assert.equal(parsed.status, 'success')
  assert.equal(parsed.tool, 'local_extract_attachment')
  assert.equal(parsed.count, 1)
  assert.equal(parsed.files[0].name, 'demo.md')
  assert.match(parsed.files[0].content, /前三秒必须有冲突/)
  assert.equal(parsed.files[0].truncated, true)
})

test('builds readable media attachment summary', () => {
  const summary = buildMediaAttachmentSummary({
    name: 'lesson.mp4',
    type: 'video/mp4',
    size: 12_345_678,
    durationSeconds: 92.4,
    width: 1920,
    height: 1080,
  })

  assert.match(summary, /lesson\.mp4/)
  assert.match(summary, /video\/mp4/)
  assert.match(summary, /92\.4 秒/)
  assert.match(summary, /1920x1080/)
})

test('builds a safe media process input from cached upload metadata', () => {
  const summary = buildMediaAttachmentSummary({
    name: 'lesson.mp4',
    type: 'video/mp4',
    size: 12_345_678,
    cachedPath: '/Users/by3/Library/Application Support/韭菜盒子/media-cache/lesson.mp4',
  })

  const input = buildMediaProcessInput(
    { filename: 'lesson', action: 'extract_audio', target_format: 'mp3' },
    [{ name: 'lesson.mp4', content: summary }],
  )

  assert.equal(input.status, 'ready')
  assert.equal(input.request.action, 'extract_audio')
  assert.equal(input.request.targetFormat, 'mp3')
  assert.equal(input.request.outputFilename, 'lesson_audio.mp3')
})

test('rejects unsupported media process actions', () => {
  const input = buildMediaProcessInput(
    { filename: 'lesson', action: 'delete_everything' },
    [{ name: 'lesson.mp4', content: buildMediaAttachmentSummary({ name: 'lesson.mp4', cachedPath: '/tmp/lesson.mp4' }) }],
  )

  assert.equal(input.status, 'error')
  assert.match(input.message, /不支持/)
})
