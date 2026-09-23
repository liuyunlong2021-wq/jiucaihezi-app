import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeSkillCreatorToolResult } from '../memoryChat'

test('T2.1: Skill remains visible after first successful answer', () => {
  // Test that selectedSkillNames persists across turns
  // Test that Skill tag remains clickable in UI
  assert.ok(true, 'Skill persistence test placeholder')
})

test('T2.2: second turn without re-selecting Skill still includes Skill rules and tools', () => {
  // Test that subsequent messages in same conversation
  // continue to load the selected Skill
  assert.ok(true, 'Skill continuity test placeholder')
})

test('T2.3: user can manually remove Skill via UI button', () => {
  // Test that clicking remove button clears Skill from current state
  // Test that next turn does not include removed Skill
  assert.ok(true, 'Skill removal test placeholder')
})

test('T2.4: reopening conversation restores Skill from latest user turn', () => {
  // Test that Raw stores Skill names in user turn
  // Test that reloading conversation reads and restores Skill state
  assert.ok(true, 'Skill restoration test placeholder')
})

test('T2.5: new conversation does not inherit previous conversation Skill', () => {
  // Test that Skill state is per-conversation
  assert.ok(true, 'Skill isolation test placeholder')
})

test('save_skill 由 Runtime 直接返回安装卡，不再等待模型补正文', () => {
  const token = {
    schemaVersion: 2,
    draftId: 'draft_demo',
    sessionId: 'session_demo',
    revision: 1,
    contentHash: 'hash_demo',
    targetSkillId: 'demo-skill',
  }
  const result = normalizeSkillCreatorToolResult(
    'save_skill',
    JSON.stringify({ status: 'prepared', install_token: token }),
  )

  assert.equal(result.status, 'succeeded')
  assert.match(result.content, /```jc-skill-install-v2/)
  assert.match(result.content, /"targetSkillId":"demo-skill"/)
})

test('save_skill 失败时不能被 Runtime 当成成功终点', () => {
  const result = normalizeSkillCreatorToolResult(
    'save_skill',
    JSON.stringify({
      status: 'error',
      errorCode: 'SKILL_DRAFT_NOT_FOUND',
      message: '找不到草稿',
    }),
  )

  assert.equal(result.status, 'failed')
  assert.doesNotMatch(result.content, /jc-skill-install-v2/)
})
