import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDesktopSearchMarkdown, desktopSearchHasQuotaLimit, parseJinaSearchText } from '../webSearch'

test('desktop search has no app-side daily quota', () => {
  assert.equal(desktopSearchHasQuotaLimit(), false)
})

test('parses jina search text into compact search results', () => {
  const text = [
    'Title: 第一条',
    'URL Source: https://example.com/a',
    'Markdown Content:',
    '第一条内容',
    '',
    'Title: 第二条',
    'URL Source: https://example.com/b',
    'Markdown Content:',
    '第二条内容',
  ].join('\n')

  const results = parseJinaSearchText(text, 5)

  assert.equal(results.length, 2)
  assert.deepEqual(results[0], {
    title: '第一条',
    url: 'https://example.com/a',
    content: '第一条内容',
  })
})

test('builds desktop search markdown without api quota copy', () => {
  const markdown = buildDesktopSearchMarkdown('韭菜盒子', [
    { title: '官网', url: 'https://example.com', content: '内容' },
  ])

  assert.match(markdown, /\[联网搜索结果\] 搜索词: "韭菜盒子"/)
  assert.match(markdown, /来源: https:\/\/example.com/)
  assert.doesNotMatch(markdown, /今日搜索次数/)
})
