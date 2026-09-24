import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

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

test('the archived memory index backend is absent from production', () => {
  assert.equal(existsSync(join(process.cwd(), 'src/runtime/memory/conversationMemoryIndex.ts')), false)
  assert.equal(existsSync(join(process.cwd(), 'src/runtime/memory/conversationMemorySummary.ts')), false)
  for (const path of ['src/runtime/memory/memoryChat.ts', 'src/components/memory/MemoryWorkbench.vue']) {
    assert.doesNotMatch(source(path), /memory_search|conversationMemoryIndex|最近三轮/)
  }
})

test('memory UI keeps save-to-file and has no redundant Wiki action', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /<span>保存到文件<\/span>/)
  assert.doesNotMatch(workbench, />\s*(?:写入 Wiki|沉淀到 Wiki)\s*</)
})
