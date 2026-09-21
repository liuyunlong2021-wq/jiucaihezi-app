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

test('Skill Creator runtime prepares the install card once the draft is validated, whatever the user wrote', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_c' }

  const beforeValidation = runtime.beforeToolCall({
    toolName: 'save_skill',
    args,
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(beforeValidation.allowed, false)
  assert.equal(beforeValidation.errorCode, 'SKILL_CREATOR_VALIDATE_REQUIRED')

  runtime.afterToolResult({ toolName: 'skill_creator_validate', args, context, result: { status: 'ok' } })

  // 出卡不等于安装：装不装由用户点安装卡决定，所以不再要求用户复述“保存”这类确认词。
  for (const userInput of ['确认！安装', '看起来还可以', '']) {
    const decision = runtime.beforeToolCall({ toolName: 'save_skill', args, context: { ...context, userInput } })
    assert.equal(decision.allowed, true, `userInput=${userInput}`)
  }

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

// 线上事故回归：校验一次之后，不带草稿标识的调用被永久拦住。
// `skill_creator_load_installed_skill` 的参数只有 skill_id，模型无法「沿用返回的三件套」。
test('Skill Creator runtime lets tools that carry no draft identity through after validation', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_deadlock' }

  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args,
    context,
    result: { status: 'ok', draft_id: 'draft_x', revision: 1, content_hash: 'hash_x' },
  })

  const loadInstalled = runtime.beforeToolCall({
    toolName: 'skill_creator_load_installed_skill',
    args: { ...args, skill_id: 'jc-minimax-fenjing' },
    context,
  })
  assert.equal(loadInstalled.allowed, true, '读已安装 Skill 不该被草稿身份守卫拦住')

  const fileTreeDraft = runtime.beforeToolCall({
    toolName: 'save_skill',
    args: { ...args, draft_path: '.raw/jc-media/文档/skill-jc-minimax-fenjing' },
    context,
  })
  assert.equal(fileTreeDraft.allowed, true, '按 draft_path 操作的草稿没有可核对的标识')
})

// 守卫只在真有东西可核对时才生效，不能因为放宽就形同虚设。
test('Skill Creator runtime still blocks a stale draft identity', () => {
  const runtime = createSkillCreatorRuntime()
  const args = { test_id: 'run_stale' }

  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args,
    context,
    result: { status: 'ok', draft_id: 'draft_y', revision: 2, content_hash: 'hash_y' },
  })

  const stale = runtime.beforeToolCall({
    toolName: 'run_skill_tests',
    args: { ...args, draft_id: 'draft_old', revision: 1, content_hash: 'hash_old' },
    context,
  })
  assert.equal(stale.allowed, false)
  assert.equal(stale.errorCode, 'STALE_SKILL_DRAFT')
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

// 这条测试原来断言「漏传三件套就拦 STALE_SKILL_DRAFT」。那个断言本身锁死了线上事故：
// 参数里完全没有草稿标识的调用没有可核对的对象（读已安装 Skill、按 draft_path 操作的
// 文件树草稿、以及漏传三件套的调用都属此类），拦住它只会让模型无路可走 —— 报错还让
// 它「沿用返回的三件套」，而它手上根本没有。
// 现在这类调用交给执行器：那边对着真草稿库说话，报的是「请提供 draft_id 或 skill_md」，
// 模型能自己往下走。身份绑定本身由下面「stale revision」那条继续守着。
test('Skill Creator runtime leaves identity-less calls to the executor', () => {
  const runtime = createSkillCreatorRuntime()
  const validated = { test_id: 'run-bound', draft_id: 'draft-bound', revision: 1, content_hash: 'hash-bound' }
  runtime.afterToolResult({
    toolName: 'skill_creator_validate',
    args: validated,
    context,
    result: { status: 'ok', ...validated },
  })

  const missingIdentity = runtime.beforeToolCall({
    toolName: 'save_skill',
    args: { test_id: 'run-bound' },
    context: { ...context, userInput: '确认保存' },
  })
  assert.equal(missingIdentity.allowed, true)
})
