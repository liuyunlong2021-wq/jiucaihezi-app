import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDocxFromText } from '../localDocx'

test('createDocxFromText creates a valid docx zip with document xml', () => {
  const bytes = createDocxFromText({
    title: '影视剧本',
    content: '# 第一场\n人物冲突与分场结构。',
  })
  const text = Buffer.from(bytes).toString('utf8')

  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  assert.match(text, /\[Content_Types\]\.xml/)
  assert.match(text, /word\/document\.xml/)
  assert.match(text, /影视剧本/)
  assert.match(text, /人物冲突与分场结构/)
})

test('createDocxFromText escapes xml control characters', () => {
  const bytes = createDocxFromText({
    title: 'A&B',
    content: '<tag> "quote"',
  })
  const text = Buffer.from(bytes).toString('utf8')

  assert.match(text, /A&amp;B/)
  assert.match(text, /&lt;tag&gt; &quot;quote&quot;/)
})
