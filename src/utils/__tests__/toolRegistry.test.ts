import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyToolInvocation } from '../toolActivity'
import { getToolCardByName, summarizeToolInvocation } from '../toolRegistry'

test('maps local and office tool aliases to visible warehouse cards', () => {
  assert.equal(getToolCardByName('office_create')?.id, 'office_generate')
  assert.equal(getToolCardByName('create_document')?.id, 'office_generate')
  assert.equal(getToolCardByName('read_document')?.id, 'document_read')
  assert.equal(getToolCardByName('browser_search')?.id, 'browser_control')
  assert.equal(getToolCardByName('web_search')?.id, 'browser_control')
  assert.equal(getToolCardByName('search')?.id, 'browser_control')
  assert.equal(getToolCardByName('browser_click')?.id, 'browser_control')
  assert.equal(getToolCardByName('browser_read')?.source, 'local')
  assert.equal(getToolCardByName('bash')?.id, 'command_exec')
  assert.equal(getToolCardByName('apply_patch')?.id, 'file_edit')
  assert.equal(getToolCardByName('create_cron')?.id, 'cron_task')
})

test('summarizes tool invocation details for card subtitles', () => {
  assert.equal(
    summarizeToolInvocation('bash', { command: 'pnpm build' }),
    'pnpm build',
  )
  assert.equal(
    summarizeToolInvocation('browser_open', { url: 'https://api.jiucaihezi.studio' }),
    'https://api.jiucaihezi.studio',
  )
  assert.equal(
    summarizeToolInvocation('file_read', { path: '/Users/by3/demo.docx' }),
    '/Users/by3/demo.docx',
  )
})

test('tool activity marks a card active during a call and keeps call count after finish', () => {
  let state = applyToolInvocation({}, {
    callId: 'call-1',
    toolName: 'bash',
    status: 'running',
    args: { command: 'pnpm build' },
    at: 100,
  })

  assert.equal(state.command_exec.active, true)
  assert.equal(state.command_exec.status, 'running')
  assert.equal(state.command_exec.callCount, 1)
  assert.equal(state.command_exec.lastDetail, 'pnpm build')

  state = applyToolInvocation(state, {
    callId: 'call-1',
    toolName: 'bash',
    status: 'done',
    at: 150,
  })

  assert.equal(state.command_exec.active, false)
  assert.equal(state.command_exec.status, 'done')
  assert.equal(state.command_exec.callCount, 1)
  assert.equal(state.command_exec.lastFinishedAt, 150)
})

test('tool activity records errors without incrementing the same call twice', () => {
  let state = applyToolInvocation({}, {
    callId: 'call-2',
    toolName: 'office_create',
    status: 'running',
    args: { filename: '方案.docx' },
    at: 200,
  })
  state = applyToolInvocation(state, {
    callId: 'call-2',
    toolName: 'office_create',
    status: 'error',
    error: '生成失败',
    at: 240,
  })

  assert.equal(state.office_generate.active, false)
  assert.equal(state.office_generate.status, 'error')
  assert.equal(state.office_generate.callCount, 1)
  assert.equal(state.office_generate.lastError, '生成失败')
})
