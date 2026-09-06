import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSkillCreatorRuntime } from '../skillCreatorRuntime'

const context = {
  agentId: 'preset_skill-creator',
  sessionId: 'session_a',
  userInput: '请继续',
}

test('Skill Creator runtime blocks tests until the draft is validated', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_a' }

  const blocked = runtime.beforeToolCall({
    toolName: 'run_skill_tests',
    args,
    context,
  })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.errorCode, 'SKILL_CREATOR_VALIDATE_REQUIRED')
  assert.match(blocked.nextStep, /skill_creator_validate/)

  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args,
    context,
    result: { status: 'ok' },
  })

  const allowed = runtime.beforeToolCall({
    toolName: 'run_skill_tests',
    args,
    context,
  })
  assert.equal(allowed.allowed, true)
})

test('Skill Creator runtime blocks review until tests complete', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_b' }

  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args,
    context,
    result: { status: 'ok' },
  })

  const blocked = runtime.beforeToolCall({
    toolName: 'skill_creator_open_eval_review',
    args,
    context,
  })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.errorCode, 'SKILL_CREATOR_TESTS_REQUIRED')

  runtime.afterToolResult({
    toolName: 'run_skill_tests',
    args,
    context,
    result: { status: 'ok' },
  })

  const allowed = runtime.beforeToolCall({
    toolName: 'skill_creator_open_eval_review',
    args,
    context,
  })
  assert.equal(allowed.allowed, true)
})

test('Skill Creator runtime allows an explicitly confirmed save after validation without tests', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_c' }

  runtime.afterToolResult({ toolName: 'skill_creator_validate', args, context, result: { status: 'ok' } })

  const notConfirmed = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '看起来还可以' },
  })
  assert.equal(notConfirmed.allowed, false)
  assert.equal(notConfirmed.errorCode, 'SKILL_CREATOR_SAVE_CONFIRMATION_REQUIRED')

  const confirmed = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存这个 Skill' },
  })
  assert.equal(confirmed.allowed, true)

  const prepared = runtime.afterToolResult({
    toolName: 'save_skill',
    args,
    context,
    result: { status: 'prepared' },
  })
  assert.equal(prepared.state, 'package_ready')
})

test('Skill Creator runtime requires review when optional tests were run', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_tested' }
  runtime.afterToolResult({ toolName: 'skill_creator_validate', args, context, result: { status: 'ok' } })
  runtime.afterToolResult({ toolName: 'run_skill_tests', args, context, result: { status: 'ok' } })

  const blocked = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.errorCode, 'SKILL_CREATOR_REVIEW_REQUIRED')
})

test('Skill Creator runtime isolates same test_id across sessions', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'same_run' }

  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args,
    context: { ...context, sessionId: 'session_a' },
    result: { status: 'ok' },
  })
  runtime.afterToolResult({
    toolName: 'run_skill_tests',
    args,
    context: { ...context, sessionId: 'session_a' },
    result: { status: 'ok' },
  })

  const otherSession = runtime.beforeToolCall({
    toolName: 'skill_creator_open_eval_review',
    args,
    context: { ...context, sessionId: 'session_b' },
  })
  assert.equal(otherSession.allowed, false)
  assert.equal(otherSession.errorCode, 'SKILL_CREATOR_TESTS_REQUIRED')
})

test('Skill Creator runtime turns continue-improve feedback into improving state', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_d' }

  runtime.afterToolResult({ toolName: 'skill_creator_validate', args, context, result: { status: 'ok' } })
  runtime.afterToolResult({ toolName: 'run_skill_tests', args, context, result: { status: 'ok' } })
  runtime.afterToolResult({ toolName: 'skill_creator_open_eval_review', args, context, result: { status: 'ok' } })

  const decision = runtime.beforeToolCall({
    toolName: 'skill_creator_improve_description',
    args,
    context: { ...context, userInput: '不满意，继续优化描述和命中关键词' },
  })

  assert.equal(decision.allowed, true)
  assert.equal(runtime.getSnapshot(args, context)?.state, 'improving')
})

test('Skill Creator runtime allows improvement after validation when tests were skipped', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_no_tests' }
  runtime.afterToolResult({ toolName: 'skill_creator_validate', args, context, result: { status: 'ok' } })
  const decision = runtime.beforeToolCall({ toolName: 'skill_creator_improve_description', args, context: { ...context, userInput: '继续优化描述' } })
  assert.equal(decision.allowed, true)
})

test('Skill Creator runtime requires a new validation cycle after improvement', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_e' }

  runtime.afterToolResult({ toolName: 'skill_creator_validate', args, context, result: { status: 'ok' } })
  runtime.afterToolResult({ toolName: 'run_skill_tests', args, context, result: { status: 'ok' } })
  runtime.afterToolResult({ toolName: 'skill_creator_open_eval_review', args, context, result: { status: 'ok' } })
  runtime.beforeToolCall({
    toolName: 'skill_creator_improve_description',
    args,
    context: { ...context, userInput: '不满意，继续改' },
  })
  runtime.afterToolResult({ toolName: 'skill_creator_improve_description', args, context, result: { status: 'ok' } })

  const blockedTest = runtime.beforeToolCall({ toolName: 'run_skill_tests', args, context })
  assert.equal(blockedTest.allowed, false)
  assert.equal(blockedTest.errorCode, 'SKILL_CREATOR_VALIDATE_REQUIRED')

  const blockedSave = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(blockedSave.allowed, false)
  assert.equal(blockedSave.errorCode, 'SKILL_CREATOR_VALIDATE_REQUIRED')
})

test('Skill Creator runtime rejects a stale draft revision after validation', () => {
  const runtime = createSkillCreatorRuntime()
  const validated = { draft_id: 'draft-a', revision: 1, content_hash: 'hash-1' }
  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args: validated,
    context,
    result: { status: 'ok', ...validated },
  })

  const stale = runtime.beforeToolCall({
    toolName: 'run_skill_tests',
    args: { draft_id: 'draft-a', revision: 2, content_hash: 'hash-2' },
    context,
  })
  assert.equal(stale.allowed, false)
  assert.equal(stale.errorCode, 'STALE_SKILL_DRAFT')
})
