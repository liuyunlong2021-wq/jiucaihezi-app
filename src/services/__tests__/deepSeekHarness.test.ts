import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { deepSeekAssistantText, deepSeekPrompt, deepSeekTurnError } from '@/services/deepSeekHarness'

test('DeepSeek Harness invokes UI-selected skills through native skill gestures', () => {
  assert.equal(
    deepSeekPrompt('执行任务', ['wiki-memory', 'skill-creator']),
    '/wiki-memory /skill-creator\n\n执行任务',
  )
  assert.equal(deepSeekPrompt('执行任务', []), '执行任务')
})

test('DeepSeek Harness reads the committed assistant message', () => {
  assert.equal(
    deepSeekAssistantText({
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'text', text: '完成' },
            { type: 'image' },
            { type: 'text', text: '。' },
          ],
        },
      },
    }),
    '完成。',
  )
  assert.equal(deepSeekAssistantText({ type: 'tool/result', data: {} }), '')
})

test('DeepSeek Harness exposes terminal turn failures instead of completing on idle', () => {
  assert.equal(
    deepSeekTurnError({
      type: 'turn/end',
      data: {
        reason: {
          kind: 'error',
          error: { code: 'PI_AI_ERROR', message: 'The service is temporarily unavailable.' },
        },
      },
    }),
    'The service is temporarily unavailable.',
  )
  assert.equal(deepSeekTurnError({ type: 'turn/end', data: { reason: { kind: 'complete' } } }), '')
})

test('desktop package pins and embeds the Harness runtime with Node', () => {
  const runtimePackage = JSON.parse(
    readFileSync('src-tauri/resources/deepseek-harness/package.json', 'utf8'),
  )
  const tauri = readFileSync('src-tauri/tauri.conf.json', 'utf8')
  assert.equal(runtimePackage.dependencies['@deepseek-ai/dsh'], '0.1.7-alpha.1')
  assert.equal(runtimePackage.dependencies.node, '22.23.2')
  assert.match(tauri, /resources\/deepseek-harness/)
  assert.match(tauri, /build:deepseek-harness/)
})

test('Harness writes its project-local runtime files through the Rust project boundary', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  assert.match(source, /invoke\('dev_write_file'/)
  assert.match(source, /resolveResource\([^)]*node\/bin\//s)
  assert.match(source, /maxRetries: 5/)
  assert.match(source, /PI_AI_ERROR/)
  assert.match(source, /wireSessionId = `\$\{input\.sessionId\}-\$\{active\.sessionNonce\}`/)
  assert.doesNotMatch(source, /resolve_deepseek_harness/)
  assert.doesNotMatch(source, /@tauri-apps\/plugin-fs|\bmkdir\(|\bwriteTextFile\(/)
})
