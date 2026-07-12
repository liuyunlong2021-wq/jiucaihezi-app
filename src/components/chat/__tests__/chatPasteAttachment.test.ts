import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('chat prevents the browser from inserting pasted image files into the composer', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/ChatPanel.vue'), 'utf8')
  assert.match(source, /if \(e\.clipboardData\?\.files\.length\) \{\s+e\.preventDefault\(\)/)
})
