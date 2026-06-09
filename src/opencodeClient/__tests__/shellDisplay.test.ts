import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isOpenCodeShellPart,
  shellDisplayCommand,
  shellDisplayDetail,
  shellDisplayDurationLabel,
  shellDisplayErrorText,
  shellDisplayExitLabel,
  shellDisplayStderr,
  shellDisplayStdout,
  shellDisplaySubtitle,
} from '../shellDisplay'
import { normalizeOpenCodePart } from '../timelineRows'

test('shell display extracts top-level shell output without flattening into object strings', () => {
  const part = normalizeOpenCodePart({
    type: 'shell',
    id: 'shell1',
    command: 'pnpm test',
    stdout: { lines: ['ok'], count: 1 },
    stderr: ['warn'],
    exitCode: 0,
    time: { created: 100, completed: 101.2 },
  }, 'msg1')

  assert.equal(isOpenCodeShellPart(part), true)
  assert.equal(shellDisplayCommand(part), 'pnpm test')
  assert.match(shellDisplayStdout(part), /"lines"/)
  assert.notEqual(shellDisplayStdout(part), '[object Object]')
  assert.match(shellDisplayStderr(part), /warn/)
  assert.notEqual(shellDisplayStderr(part), '[object Object]')
  assert.equal(shellDisplayExitLabel(part), 'exit 0')
  assert.equal(shellDisplayDurationLabel(part), '1.2s')
})

test('shell display extracts bash tool content arrays and structured errors safely', () => {
  const part = normalizeOpenCodePart({
    type: 'tool',
    id: 'bash1',
    tool: 'bash',
    state: {
      status: 'error',
      input: { command: 'pwd' },
      content: [{ type: 'text', text: '/repo' }],
      error: { message: 'failed', detail: { code: 'E_TEST' } },
      result: { code: 2 },
    },
  }, 'msg2')

  assert.equal(isOpenCodeShellPart(part), true)
  assert.equal(shellDisplayCommand(part), 'pwd')
  assert.equal(shellDisplayStdout(part), '/repo')
  assert.equal(shellDisplayStderr(part), 'failed')
  assert.equal(shellDisplayErrorText(part), 'failed')
  assert.equal(shellDisplayExitLabel(part), 'exit 2')
  assert.match(shellDisplaySubtitle(part), /Shell 失败/)
})

test('shell display formats structured error card text without object strings', () => {
  const part = normalizeOpenCodePart({
    type: 'tool',
    id: 'bash2',
    tool: 'bash',
    state: {
      status: 'error',
      input: { command: 'pnpm test' },
      error: { detail: { code: 'E_TEST' } },
    },
  }, 'msg4')

  assert.match(shellDisplayErrorText(part), /"detail"/)
  assert.notEqual(shellDisplayErrorText(part), '[object Object]')
})

test('shell display detail summarizes already rendered output fields', () => {
  const part = normalizeOpenCodePart({
    type: 'shell',
    id: 'shell2',
    command: 'pnpm test',
    stdout: 'visible stdout',
    stderr: 'visible stderr',
    output: 'legacy output',
    state: {
      status: 'completed',
      output: 'state output',
      content: [{ type: 'text', text: 'content output' }],
      result: {
        stdout: 'result stdout',
        stderr: 'result stderr',
        code: 0,
      },
    },
  }, 'msg5')

  const detail = shellDisplayDetail(part)
  assert.match(detail, /已在终端 stdout 面板显示/)
  assert.match(detail, /已在终端 stderr 面板显示/)
  assert.match(detail, /"code": 0/)
  assert.doesNotMatch(detail, /visible stdout/)
  assert.doesNotMatch(detail, /visible stderr/)
  assert.doesNotMatch(detail, /legacy output/)
  assert.doesNotMatch(detail, /state output/)
  assert.doesNotMatch(detail, /content output/)
  assert.doesNotMatch(detail, /result stdout/)
  assert.doesNotMatch(detail, /result stderr/)
})

test('shell display ignores non-shell tool parts', () => {
  const part = normalizeOpenCodePart({
    type: 'tool',
    id: 'read1',
    tool: 'read',
    state: { status: 'completed', input: { filePath: 'README.md' } },
  }, 'msg3')

  assert.equal(isOpenCodeShellPart(part), false)
})
