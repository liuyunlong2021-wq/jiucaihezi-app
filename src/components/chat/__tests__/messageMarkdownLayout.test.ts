import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/components/chat/MessageBubble.vue'), 'utf8')

test('assistant Markdown collapses renderer whitespace while preserving code formatting', () => {
  assert.match(source, /\.msg-body \{ white-space: normal; \}/)
  assert.doesNotMatch(source, /\.msg-body \{ white-space: pre-wrap; \}/)
  assert.match(source, /:deep\(\.md-code pre\)/)
  assert.match(source, /font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;/)
})

test('assistant prose uses compact paragraph and list spacing', () => {
  assert.match(source, /\.msg\.layout-assistant-prose :deep\(\.msg-body p\) \{\s+margin: 0 0 \.42em;/)
  assert.match(source, /\.msg\.layout-assistant-prose :deep\(\.msg-body ul\),[\s\S]*?margin: \.42em 0 \.62em;/)
  assert.match(source, /\.msg\.layout-assistant-prose :deep\(\.msg-body li\) \{\s+margin: \.16em 0;/)
})
