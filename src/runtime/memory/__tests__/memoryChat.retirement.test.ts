import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseConversationMemoryIndex } from '../conversationMemoryIndex'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('jc-jiyi and its legacy tool are absent from production catalogs', () => {
  assert.equal(existsSync(join(process.cwd(), 'public/skills/jc-jiyi')), false)
  for (const path of [
    'src/runtime/memory/memoryChat.ts',
    'src/runtime/direct/creativeToolContract.ts',
    'src/runtime/direct/webProjectTools.ts',
  ]) {
    const content = source(path)
    assert.doesNotMatch(content, /conversation_memory_query/)
    assert.doesNotMatch(content, /selectedSkillNames\.includes\('jc-jiyi'\)/)
  }
})

test('existing V2 memory indexes remain readable without migration', () => {
  const content = [
    '# 对话记忆索引',
    '',
    '<!-- jc:conversation-memory-index conversation-id="chat-old" source="../对话记录/chat-old.md" version="2" -->',
    '',
    '- 简介：旧索引',
    '  - 关键词：兼容、记忆',
    '  - 正链：[查看这条回答](../对话记录/chat-old.md#jc-turn-a1)',
  ].join('\n')
  const parsed = parseConversationMemoryIndex(content)
  assert.equal(parsed?.conversationId, 'chat-old')
  assert.equal(parsed?.entries[0]?.assistantTurnId, 'a1')
})

test('memory UI keeps save-to-file and has no redundant Wiki action', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /<span>保存到文件<\/span>/)
  assert.doesNotMatch(workbench, />\s*(?:写入 Wiki|沉淀到 Wiki)\s*</)
})
