import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findComposerSuggestion, replaceComposerSuggestion } from '../composerSuggestions'

test('composer suggestions recognize slash and at triggers at token boundaries', () => {
  assert.deepEqual(findComposerSuggestion('/mcp', 4), { trigger: '/', start: 0, end: 4, query: 'mcp' })
  assert.deepEqual(findComposerSuggestion('请看 @wiki/角色.md', 10), { trigger: '@', start: 3, end: 14, query: 'wiki/角' })
  assert.equal(findComposerSuggestion('https://example.test/path', 14), null)
  assert.equal(findComposerSuggestion('hello/world', 11), null)
})

test('composer suggestion replacement preserves text on both sides of the cursor', () => {
  const suggestion = findComposerSuggestion('先看 @角色.md 然后总结', 6)
  assert.ok(suggestion)
  assert.deepEqual(replaceComposerSuggestion('先看 @角色.md 然后总结', suggestion, ''), {
    text: '先看  然后总结', cursor: 3,
  })
  const slash = findComposerSuggestion('前文 /mcp 后文', 7)
  assert.ok(slash)
  assert.deepEqual(replaceComposerSuggestion('前文 /mcp 后文', slash, ''), {
    text: '前文  后文', cursor: 3,
  })
})
