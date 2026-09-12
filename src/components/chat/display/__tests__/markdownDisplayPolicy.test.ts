import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderMessageMarkdown } from '../markdownDisplayPolicy'

test('renderMessageMarkdown escapes user HTML without rewriting it as Markdown', () => {
  const html = renderMessageMarkdown('<img src=x onerror=alert(1)>\n**not bold**', 'user')

  assert.equal(html.includes('<img'), false)
  assert.match(html, /&lt;img/)
  assert.match(html, /\*\*not bold\*\*/)
})

test('renderMessageMarkdown keeps unsafe assistant links inert after sanitization', () => {
  const html = renderMessageMarkdown('[bad](javascript:alert(1) \"x\\\" onmouseover=alert(1)\")', 'assistant')

  assert.match(html, />bad<\/a>/)
  assert.equal(html.includes('javascript:'), false)
  assert.equal(html.includes('onmouseover'), false)
})

test('renderMessageMarkdown keeps project file links in-app', () => {
  const html = renderMessageMarkdown('[笔记](#jc-file=notes%2Fresult)', 'assistant')
  assert.match(html, /href="#jc-file=notes%2Fresult"/)
  assert.doesNotMatch(html, /target="_blank"/)
})

test('renderMessageMarkdown resolves Markdown file links instead of dropping the path', () => {
  const relative = renderMessageMarkdown('[30秒广告.md](wiki/剧本/30秒广告.md)', 'assistant')
  assert.match(
    relative,
    /href="#jc-file=wiki%2F%E5%89%A7%E6%9C%AC%2F30%E7%A7%92%E5%B9%BF%E5%91%8A\.md"/,
  )
  assert.doesNotMatch(relative, /target="_blank"/)

  const absolute = renderMessageMarkdown('[30秒广告.md](/wiki/剧本/30秒广告.md)', 'assistant')
  assert.match(absolute, /href="#jc-file=wiki%2F/)
  assert.equal(absolute.includes('href="/wiki'), false)

  const directory = renderMessageMarkdown('[剧本](/wiki/剧本)', 'assistant')
  assert.equal(directory.includes('href="/wiki'), false)
  assert.equal(directory.includes('jc-file'), false)

  const external = renderMessageMarkdown('[x](//evil.test/a.md)', 'assistant')
  assert.equal(external.includes('jc-file'), false)
})

test('renderMessageMarkdown renders code copy chrome and table wrapper', () => {
  const html = renderMessageMarkdown('```ts\nconst x = 1\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |', 'assistant')

  assert.match(html, /data-code-copy="1"/)
  assert.match(html, /aria-label="复制代码"/)
  assert.match(html, /class="md-table-wrap"/)
})

test('renderMessageMarkdown keeps semantic blocks for a compact document layout', () => {
  const html = renderMessageMarkdown('## 标题\n\n正文第一段。\n\n1. 第一项\n2. 第二项\n\n---\n\n正文第二段。', 'assistant')

  assert.match(html, /<h2>标题<\/h2>/)
  assert.match(html, /<ol>/)
  assert.match(html, /<hr>/)
  assert.match(html, /<p>正文第二段。<\/p>/)
})
