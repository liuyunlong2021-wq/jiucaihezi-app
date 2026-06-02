import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderStreamingText } from '../streamingTextRenderer'

test('renderStreamingText escapes html during streaming', () => {
  const html = renderStreamingText('<img src=x onerror=alert(1)> & "quote"')

  assert.equal(html, '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot;')
})

test('renderStreamingText preserves line breaks without invoking markdown rendering', () => {
  const html = renderStreamingText('第一行\n第二行')

  assert.equal(html, '第一行<br>第二行')
  assert.doesNotMatch(html, /<pre|<code|language-/)
})

test('renderStreamingText wraps unfinished fences with lightweight code markup', () => {
  const html = renderStreamingText('第一行\n```ts\nconst x = 1')

  assert.match(html, /第一行<br>/)
  assert.match(html, /md-code-streaming/)
  assert.match(html, /<span class="md-code-lang">ts<\/span>/)
  assert.match(html, /const x = 1\n<\/code><\/pre><\/div>$/)
  assert.doesNotMatch(html, /hljs|language-ts|data-mermaid/)
})

test('renderStreamingText escapes html inside streaming code fences', () => {
  const html = renderStreamingText('```html\n<script>alert(1)</script>')

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})
