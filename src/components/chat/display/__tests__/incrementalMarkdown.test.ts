import assert from 'node:assert/strict'
import { test } from 'node:test'
import { marked } from 'marked'
import { IncrementalMarkdown } from '../incrementalMarkdown'
import { renderMarkdownChunk } from '../markdownDisplayPolicy'

test('incremental Markdown keeps committed blocks stable as later paragraphs arrive', () => {
  const markdown = new IncrementalMarkdown()
  const first = markdown.update('# 标题\n\n第一段。\n\n第二段', 'run-a')
  const committed = first.chunks.filter(chunk => chunk.stable)
  assert.ok(committed.length >= 1)
  const identities = committed.map(chunk => chunk.key)

  const next = markdown.update('# 标题\n\n第一段。\n\n第二段\n\n第三段', 'run-a')
  assert.deepEqual(next.chunks.filter(chunk => chunk.stable).slice(0, identities.length).map(chunk => chunk.key), identities)
  assert.equal(next.chunks.at(-1)?.raw, '第三段')
})

test('incremental Markdown leaves open fences mutable and displays structured GFM tokens', () => {
  const markdown = new IncrementalMarkdown()
  const snapshot = markdown.update([
    '## 小标题', '',
    '- 第一项', '- 第二项', '',
    '| 名称 | 数量 |', '| --- | ---: |', '| 素材 | 2 |', '',
    '```ts', 'const answer = 42',
  ].join('\n'), 'run-b')

  assert.ok(snapshot.chunks.some(chunk => chunk.token.type === 'heading'))
  assert.ok(snapshot.chunks.some(chunk => chunk.token.type === 'list'))
  assert.ok(snapshot.chunks.some(chunk => chunk.token.type === 'table'))
  const code = snapshot.chunks.find(chunk => chunk.token.type === 'code')
  assert.ok(code)
  assert.equal(code.stable, false)
  const html = renderMarkdownChunk(code.token, snapshot.links, { streaming: true, stable: false })
  assert.match(html, /const answer = 42/)
  assert.match(html, /md-code-streaming/)
  assert.doesNotMatch(html, /hljs|language-ts/)
  assert.match(html, /data-code-copy="1"/)
})

test('reference definitions added later update links used by earlier stable blocks', () => {
  const markdown = new IncrementalMarkdown()
  const first = markdown.update('[官方文档][docs]\n\n第一段结束。\n\n下一段正在生成', 'run-c')
  const next = markdown.update(
    '[官方文档][docs]\n\n第一段结束。\n\n下一段正在生成\n\n[docs]: https://example.com/docs',
    'run-c',
  )

  assert.ok(next.linksVersion > first.linksVersion)
  const linkChunk = next.chunks.find(chunk => chunk.raw.includes('[官方文档]'))
  assert.ok(linkChunk)
  assert.match(renderMarkdownChunk(linkChunk.token, next.links), /href="https:\/\/example\.com\/docs"/)
})

test('incremental Markdown resets keys and definitions on replacement or new run', () => {
  const markdown = new IncrementalMarkdown()
  const first = markdown.update('[reference][id]\n\n[id]: https://old.example', 'run-old')
  const replaced = markdown.update('新回答', 'run-old')
  assert.equal(Object.keys(replaced.links).length, 0)
  assert.ok(replaced.chunks.every(chunk => chunk.key.startsWith('run-old:')))

  const nextRun = markdown.update('新回答', 'run-new')
  assert.ok(nextRun.chunks.every(chunk => chunk.key.startsWith('run-new:')))
  assert.notEqual(first.chunks[0]?.key, nextRun.chunks[0]?.key)
})

test('incremental Markdown keeps a long committed prefix and only the tail mutable', () => {
  const markdown = new IncrementalMarkdown()
  const prefix = Array.from({ length: 120 }, (_, index) => `第 ${index} 段`).join('\n\n')
  const first = markdown.update(`${prefix}\n\n尾部`, 'run-long')
  const stableKeys = first.chunks.filter(chunk => chunk.stable).map(chunk => chunk.key)
  const next = markdown.update(`${prefix}\n\n尾部继续`, 'run-long')

  assert.ok(stableKeys.length > 100)
  assert.deepEqual(next.chunks.filter(chunk => chunk.stable).slice(0, stableKeys.length).map(chunk => chunk.key), stableKeys)
  assert.equal(next.chunks.at(-1)?.raw, '尾部继续')
  assert.ok(next.relexedCharacters < next.sourceLength / 10)
})

test('replacement invalidates rendered-fragment revisions even when offsets are reused', () => {
  const markdown = new IncrementalMarkdown()
  const first = markdown.update('旧内容\n\n更多旧内容', 'same-view')
  const replaced = markdown.update('新内容\n\n更多新内容', 'same-view')
  assert.ok(replaced.revision > first.revision)
})

test('seeded chunk boundaries preserve Unicode, CRLF, GFM structure and late references', () => {
  const source = [
    '# 标题', '', '中文 😀 **加粗**', '', '- 第一项', '- 第二项', '',
    '> 引用内容', '', '| 名称 | 数量 |', '| --- | ---: |', '| 素材 | 2 |', '',
    '[官方文档][docs]', '', '```ts', 'const answer = 42', '```', '',
    '[docs]: https://example.com/docs',
  ].join('\r\n')
  const markdown = new IncrementalMarkdown()
  let state = 0x5eed
  let finalSnapshot = markdown.update('', 'seeded-run')
  for (let offset = 0; offset < source.length;) {
    state = (state * 48271) % 0x7fffffff
    offset = Math.min(source.length, offset + 1 + state % 11)
    finalSnapshot = markdown.update(source.slice(0, offset), 'seeded-run')
  }

  const visible = (tokens: Array<{ type: string; raw: string }>) => tokens
    .filter(token => token.type !== 'space' && token.type !== 'def')
    .map(({ type, raw }) => ({ type, raw }))
  assert.deepEqual(
    visible(finalSnapshot.chunks.map(chunk => chunk.token as { type: string; raw: string })),
    visible(marked.lexer(source, { breaks: true, gfm: true }) as Array<{ type: string; raw: string }>),
  )
  assert.ok(finalSnapshot.links.docs)
})
