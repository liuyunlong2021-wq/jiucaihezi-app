import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEditorDocumentMetadata,
  mergeEditorAssets,
  tiptapJsonToMarkdown,
} from '../editorDocument'

test('serializes basic tiptap json to markdown', () => {
  const markdown = tiptapJsonToMarkdown({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '要点' }] }] },
      ] },
    ],
  })

  assert.equal(markdown, '# 标题\n\n正文\n\n- 要点')
})

test('serializes images and tables without losing structure', () => {
  const markdown = tiptapJsonToMarkdown({
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: 'asset://image-1', alt: '截图' } },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列A' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列B' }] }] },
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
          ] },
        ],
      },
    ],
  })

  assert.equal(markdown, '![截图](asset://image-1)\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |')
})

test('merges editor assets by id while keeping order', () => {
  assert.deepEqual(
    mergeEditorAssets(
      [{ id: 'a', name: 'old.png', mimeType: 'image/png', size: 10 }],
      [
        { id: 'b', name: 'new.png', mimeType: 'image/png', size: 20 },
        { id: 'a', name: 'old-new.png', mimeType: 'image/png', size: 30 },
      ],
    ),
    [
      { id: 'a', name: 'old-new.png', mimeType: 'image/png', size: 30 },
      { id: 'b', name: 'new.png', mimeType: 'image/png', size: 20 },
    ],
  )
})

test('builds versioned editor document metadata', () => {
  const metadata = buildEditorDocumentMetadata(
    { custom: 'kept', editorVersion: 2, editorAssets: [{ id: 'old', name: 'old.png', mimeType: 'image/png', size: 1 }] },
    {
      tiptapJson: { type: 'doc', content: [] },
      html: '<p>正文</p>',
      markdown: '正文',
      assets: [{ id: 'new', name: 'new.png', mimeType: 'image/png', size: 2 }],
    },
  )

  assert.equal(metadata.custom, 'kept')
  assert.equal(metadata.editorVersion, 3)
  assert.equal(metadata.markdown, '正文')
  assert.equal((metadata.editorAssets as any[]).length, 2)
})
