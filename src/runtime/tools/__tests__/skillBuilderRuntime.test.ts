import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSkillBuilderRuntime } from '../skillBuilderRuntime'

const context = {
  agentId: 'preset_skill-builder',
  sessionId: 'session_builder',
  userInput: '继续',
}

test('Skill Builder runtime blocks save until the draft and its tests are done', () => {
  const runtime = createSkillBuilderRuntime()
  const args = { draft_id: 'draft_a' }

  const noDraft = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(noDraft.allowed, false)
  assert.equal(noDraft.errorCode, 'SKILL_BUILDER_DRAFT_REQUIRED')

  runtime.afterToolResult({
    toolName: 'build_skill_from_text',
    args,
    context,
    result: { status: 'ok', draft_id: 'draft_a' },
  })

  const noTests = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(noTests.allowed, false)
  assert.equal(noTests.errorCode, 'SKILL_BUILDER_TESTS_REQUIRED')

  runtime.afterToolResult({
    toolName: 'run_skill_tests',
    args: { ...args, test_cases: [{}, {}, {}] },
    context,
    result: { status: 'ok', eval_count: 3 },
  })

  // 出卡不等于保存：保存由用户点安装卡决定，所以不再要求用户复述“保存”这类确认词。
  for (const userInput of ['测试通过了', '确认保存这个 Skill']) {
    const decision = runtime.beforeToolCall({ toolName: 'save_skill', args, context: { ...context, userInput } })
    assert.equal(decision.allowed, true, `userInput=${userInput}`)
  }
})

test('Skill Builder runtime requires at least three successful test cases before save', () => {
  const runtime = createSkillBuilderRuntime()
  const args = { draft_id: 'draft_b' }

  runtime.afterToolResult({
    toolName: 'build_skill_from_text',
    args,
    context,
    result: { status: 'ok', draft_id: 'draft_b' },
  })
  runtime.afterToolResult({
    toolName: 'run_skill_tests',
    args: { ...args, test_cases: [{}, {}] },
    context,
    result: { status: 'ok', eval_count: 2 },
  })

  const blocked = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.errorCode, 'SKILL_BUILDER_MIN_TESTS_REQUIRED')
})

test('Skill Builder runtime isolates draft ids by session', () => {
  const runtime = createSkillBuilderRuntime()
  const args = { draft_id: 'same_draft' }

  runtime.afterToolResult({
    toolName: 'build_skill_from_text',
    args,
    context: { ...context, sessionId: 'session_a' },
    result: { status: 'ok', draft_id: 'same_draft' },
  })
  runtime.afterToolResult({
    toolName: 'run_skill_tests',
    args: { ...args, test_cases: [{}, {}, {}] },
    context: { ...context, sessionId: 'session_a' },
    result: { status: 'ok', eval_count: 3 },
  })

  const otherSession = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, sessionId: 'session_b', userInput: '确认保存' },
  })
  assert.equal(otherSession.allowed, false)
  assert.equal(otherSession.errorCode, 'SKILL_BUILDER_DRAFT_REQUIRED')
})
