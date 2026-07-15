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

test('creative chat automatically exposes the Skill catalog and defers visible text until tools finish', () => {
  assert.match(source, /buildWebSkillCatalogPrompt\(await loadWebSkillCatalog\(\)\)/)
  assert.match(source, /skillSystemPrompt:\s*\[input\.skillPrompt, skillCatalog\]\.filter\(Boolean\)\.join\('\\n\\n'\)/)
  assert.match(source, /onText:\s*text\s*=>\s*\{ roundText = text \}/)
  assert.match(source, /\}\)\.then\(result\s*=>\s*\{\s*input\.onText\(result\.text \|\| roundText \|\| '模型没有返回内容。'\)/s)
})
