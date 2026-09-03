import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeSkillCreatorToolCall } from '../skillCreatorToolExecutor'

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

const skillMd = `---\nname: demo-skill\ndescription: A demo skill for testing.\n---\n\n# Demo\n\nFollow the request.`

test('skill-creator validates official agents and eval-viewer package paths', async () => {
  const result = JSON.parse(await executeSkillCreatorToolCall(call('skill_creator_validate', {
    skill_md: skillMd,
    references: [
      { path: 'agents/grader.md', content: '# grader' },
      { path: 'eval-viewer/generate_review.py', content: 'print(1)' },
      { path: 'LICENSE.txt', content: 'MIT' },
    ],
  }), { agentId: 'skill-creator', sessionId: 'test' }))
  assert.equal(result.status, 'ok')
})

test('skill-creator runtime rejects tests before validation', async () => {
  const result = JSON.parse(await executeSkillCreatorToolCall(call('run_skill_tests', {
    draft_skill_md: skillMd,
    test_cases: [],
    test_id: 'blocked',
  }), { agentId: 'skill-creator', sessionId: 'test' }))
  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'SKILL_CREATOR_VALIDATE_REQUIRED')
})
