import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/composables/creativeChat.ts'), 'utf8')

test('creative chat uses the direct runtime and Desktop project tools without OpenCode', () => {
  assert.match(source, /runDirectChatCompletion/)
  assert.match(source, /createDesktopProjectToolExecutor/)
  assert.match(source, /safeFetch/)
  assert.match(source, /AbortController/)
  assert.doesNotMatch(source, /openCodeSyncStore|ensureOpenCodeServer|createJiucaiOpenCodeClient/)
})

test('creative chat uses the caller-provided effective Skill catalog and forwards text deltas to the UI', () => {
  assert.match(source, /buildWebSkillCatalogPrompt\(input\.skillCatalog \|\| \[\]\)/)
  assert.match(source, /input\.skillCatalog/)
  assert.doesNotMatch(source, /loadWebSkillCatalog/)
  assert.match(source, /skillSystemPrompt:\s*\[input\.skillPrompt, skillCatalog\]\.filter\(Boolean\)\.join\('\\n\\n'\)/)
  assert.match(source, /onText:\s*text\s*=>\s*\{\s*roundText = text\s*;?\s*input\.onText\(text\)\s*;?\s*\}/)
  assert.match(source, /\}\)\.then\(result\s*=>\s*\{\s*input\.onText\(result\.text \|\| roundText \|\| '模型没有返回内容。'\)/s)
})

test('creative chat asks for approval before each filesystem or terminal tool and returns rejection to the model', () => {
  assert.match(source, /confirmTool\?:\s*\(call:\s*DirectToolCall\)\s*=>\s*boolean\s*\|\s*Promise<boolean>/s)
  assert.match(source, /if\s*\(call\.function\.name\s*!==\s*'skill'\)\s*\{\s*const approved = await input\.confirmTool\?\.\(call\)/s)
  assert.match(source, /用户拒绝了本次工具操作，未执行。请换一种方法继续。/)
  assert.doesNotMatch(source, /confirmTerminal/)
})

test('creative chat passes opaque attachment handles to the Desktop tool executor', () => {
  assert.match(source, /attachments\?:\s*Array<\{\s*name:\s*string;\s*inputPath:\s*string\s*\}>/s)
  assert.match(source, /attachments:\s*input\.attachments/)
})
