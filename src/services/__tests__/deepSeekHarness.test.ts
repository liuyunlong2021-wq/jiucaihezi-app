import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  applyDeepSeekAssistantStream,
  deepSeekAssistantText,
  deepSeekContentBlocks,
  deepSeekHandoffTurns,
  deepSeekPermissionMode,
  deepSeekProgress,
  deepSeekPrompt,
  deepSeekSessionId,
  deepSeekTurnError,
} from '@/services/deepSeekHarness'

test('@文件 maps to the official Harness full-access mode', () => {
  assert.equal(deepSeekPermissionMode(false), 'workspace-write')
  assert.equal(deepSeekPermissionMode(true), 'danger-full-access')
})

test('DeepSeek Harness keeps one stable namespaced session per conversation', () => {
  assert.equal(deepSeekSessionId('conversation-1'), 'jc-v1-conversation-1')
  assert.equal(deepSeekSessionId('conversation-1'), deepSeekSessionId('conversation-1'))
})

test('DeepSeek Harness invokes UI-selected skills through native skill gestures', () => {
  assert.equal(
    deepSeekPrompt('执行任务', ['wiki-memory', 'skill-creator']),
    '/wiki-memory /skill-creator\n\n执行任务',
  )
  assert.equal(deepSeekPrompt('执行任务', []), '执行任务')
})

test('DeepSeek Harness hands off only conversation turns not already owned by its session', () => {
  const turns = [
    { id: 'u1', role: 'user' as const, content: '先分析', createdAt: '2026-01-01' },
    { id: 'a1', role: 'assistant' as const, content: '方案', createdAt: '2026-01-01' },
    { id: 'u2', role: 'user' as const, content: '第一次 DH', createdAt: '2026-01-01', toolChips: ['dh', 'dh-session-v1'] },
    { id: 'a2', role: 'assistant' as const, content: '已执行', createdAt: '2026-01-01' },
    { id: 'u3', role: 'user' as const, content: '普通补充', createdAt: '2026-01-01' },
    { id: 'a3', role: 'assistant' as const, content: '补充结论', createdAt: '2026-01-01' },
  ]
  assert.deepEqual(deepSeekHandoffTurns(turns).map(turn => turn.id), ['u3', 'a3'])
  assert.deepEqual(deepSeekHandoffTurns(turns.slice(0, 2)).map(turn => turn.id), ['u1', 'a1'])
  assert.deepEqual(deepSeekHandoffTurns(turns.slice(0, 4)), [])
  assert.deepEqual(
    deepSeekHandoffTurns(turns.map(turn => turn.id === 'u2' ? { ...turn, toolChips: ['dh'] } : turn))
      .map(turn => turn.id),
    ['u1', 'a1', 'u2', 'a2', 'u3', 'a3'],
  )
})

test('DeepSeek Harness transfers missing history once without a three-round contract', () => {
  assert.equal(
    deepSeekPrompt('直接执行', ['skill-creator'], [
      { id: 'u1', role: 'user', content: '原始要求', createdAt: '2026-01-01' },
      { id: 'a1', role: 'assistant', content: '确认方案', createdAt: '2026-01-01' },
    ]),
    '/skill-creator\n\n【既有对话移交】\n\n用户：原始要求\n\n助手：确认方案\n\n【本轮消息】\n\n直接执行',
  )
})

test('DeepSeek Harness sends materialized images through native SDK blocks', () => {
  assert.deepEqual(
    deepSeekContentBlocks('看图', [{
      id: 'image-1', name: 'image.png', mime: 'image/png', size: 3, kind: 'image',
      value: 'data:image/png;base64,QUJD', previewUrl: 'blob:thumbnail',
    }]),
    [{ type: 'text', text: '看图' }, { type: 'image', data: 'QUJD', mimeType: 'image/png' }],
  )
})

test('DeepSeek Harness sends already-read files in the first prompt', () => {
  assert.deepEqual(
    deepSeekContentBlocks('修改它', [], [{ name: 'wiki/方案.md', content: '# 旧方案' }]),
    [{ type: 'text', text: '修改它\n\n[已读取文件: wiki/方案.md]\n# 旧方案' }],
  )
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

test('DeepSeek Harness streams visible text in order and lets committed text stay authoritative', () => {
  const state = { attemptId: '', nextIndex: 0, text: '' }
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'start', attemptId: 'attempt-1', turn: 1, step: 1,
  }), '')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 0,
    chunk: { type: 'text-delta', index: 0, text: '正在' },
  }), '正在')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 1,
    chunk: { type: 'reasoning-delta', index: 0, text: '隐藏推理' },
  }), undefined)
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 2,
    chunk: { type: 'text-delta', index: 0, text: '输出' },
  }), '正在输出')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 2,
    chunk: { type: 'text-delta', index: 0, text: '重复' },
  }), undefined)
})

test('DeepSeek Harness exposes durable tool progress without leaking arguments', () => {
  assert.deepEqual(deepSeekProgress({
    type: 'tool/call', data: { callId: 'call-1', name: 'read', arguments: '{"path":"secret"}' },
  }), { id: 'call-1', label: '读取文件', state: 'running' })
  assert.deepEqual(deepSeekProgress({
    type: 'tool/result', data: { message: { toolCallId: 'call-1' } },
  }), { id: 'call-1', state: 'done' })
  assert.deepEqual(deepSeekProgress({
    type: 'tool/result', data: { message: { toolCallId: 'call-1', isError: true } },
  }), { id: 'call-1', state: 'failed' })
  assert.equal(deepSeekProgress({ type: 'assistant/message', data: {} }), undefined)
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

test('desktop package pins and embeds the official Harness SDK client with Node', () => {
  const runtimePackage = JSON.parse(
    readFileSync('src-tauri/resources/deepseek-harness/package.json', 'utf8'),
  )
  const tauri = readFileSync('src-tauri/tauri.conf.json', 'utf8')
  assert.equal(runtimePackage.dependencies['@deepseek-ai/dsh-sdk-client'], '0.1.7-alpha.2')
  assert.equal(runtimePackage.dependencies.node, '22.23.2')
  assert.match(tauri, /resources\/deepseek-harness/)
  assert.match(tauri, /build:deepseek-harness/)
})

test('Harness writes its project-local runtime files through the Rust project boundary', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  const runner = readFileSync('src-tauri/resources/deepseek-harness/runner.mjs', 'utf8')
  assert.match(source, /invoke\('dev_write_file'/)
  assert.match(source, /resolveResource\([^)]*node\/bin\//s)
  assert.match(source, /maxRetries: 1/)
  assert.match(source, /PI_AI_ERROR/)
  assert.match(source, /DSH_PERMISSION_MODE: deepSeekPermissionMode\(input\.fileAccessEnabled\)/)
  assert.match(source, /runtimeKey\(input\)/)
  assert.match(source, /wireSessionId = deepSeekSessionId\(input\.sessionId\)/)
  assert.doesNotMatch(source, /sessionNonce/)
  assert.match(source, /await active\.closed/)
  assert.doesNotMatch(source, /active\.closed,[\s\S]{0,100}2_000/)
  assert.match(runner, /DeepSeekHarness.*@deepseek-ai\/dsh-sdk-client/s)
  assert.match(runner, /await harness\.close\(\)/)
  const prepare = readFileSync('scripts/prepare-deepseek-harness.mjs', 'utf8')
  assert.match(prepare, /session\.assistant-stream/)
  assert.match(prepare, /sessionPersistence/)
  assert.match(prepare, /agents\.resume/)
  assert.doesNotMatch(source, /resolve_deepseek_harness/)
  assert.doesNotMatch(source, /@tauri-apps\/plugin-fs|\bmkdir\(|\bwriteTextFile\(/)
})
