import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/components/chat/MessageBubble.vue'), 'utf8')
const markdownCss = readFileSync(join(process.cwd(), 'src/styles/markdown.css'), 'utf8')

test('assistant Markdown collapses renderer whitespace while preserving code formatting', () => {
  assert.match(markdownCss, /\.markdown-body\s*\{[\s\S]*white-space:\s*normal;/)
  assert.doesNotMatch(source, /\.msg-body \{ white-space: pre-wrap; \}/)
  assert.match(markdownCss, /\.md-code pre/)
  assert.match(markdownCss, /font: \.92em\/1\.62 'SF Mono', 'Fira Code', 'Consolas', monospace;/)
  assert.match(markdownCss, /\.md-code code \{[\s\S]*font: inherit;[\s\S]*line-height: inherit;/)
})

test('assistant prose uses compact paragraph and list spacing', () => {
  assert.match(markdownCss, /\.markdown-body p \{ margin: \.5em 0; \}/)
  assert.match(markdownCss, /\.markdown-body ul,[\s\S]*padding-inline-start: 1\.5em;/)
  assert.match(markdownCss, /\.markdown-body li \{ margin: \.2em 0; \}/)
  assert.doesNotMatch(source, /\.layout-assistant-prose :deep\(\.msg-body (?:p|h1|h2|h3|ul|ol|li|blockquote)/)
})
