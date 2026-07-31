import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeReadUrlTool, extractPublicHttpUrls, JINA_READER_MODEL, READ_URL_TOOL_DEFINITION } from '../webReader'

test('read_url only reads a public URL explicitly present in the current turn', async () => {
  const url = 'https://huggingface.co/microsoft/Mage-VL'
  assert.equal(READ_URL_TOOL_DEFINITION.function.name, 'read_url')
  assert.equal(JINA_READER_MODEL, 'jina-reader')
  assert.deepEqual(extractPublicHttpUrls(`查看 ${url}，告诉我是什么。`), [url])
  assert.deepEqual(extractPublicHttpUrls('查看 http://127.0.0.1:3000 和 file:///tmp/a'), [])

  const result = await executeReadUrlTool(
    JSON.stringify({ url }),
    new Set([url]),
    async input => `[网页正文]\n来源: ${input}\n\n# Mage-VL`,
  )
  assert.match(result.content, /\[网页正文\]/)
  assert.match(result.content, /# Mage-VL/)
  await assert.rejects(
    () => executeReadUrlTool(JSON.stringify({ url: 'https://example.com' }), new Set([url])),
    /只能读取用户本轮明确提供的网址/,
  )
})
