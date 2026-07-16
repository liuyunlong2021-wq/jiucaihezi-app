import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('contenteditable plain-text extraction preserves visual line breaks', () => {
  const source = readFileSync('src/composables/useContentEditable.ts', 'utf8')

  assert.match(source, /function appendTextWithLineBreaks/)
  assert.match(source, /appendTextWithLineBreaks\(editor, lines\)/)
  assert.doesNotMatch(source, /text \+= \(node as Text\)\.textContent \|\| ''/)
})
