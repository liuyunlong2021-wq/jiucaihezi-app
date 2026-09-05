import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeSkillCreatorToolCall } from '../skillCreatorToolExecutor'

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

const skillMd = `---\nname: demo-skill\ndescription: A demo skill for testing.\n---\n\n# Demo\n\nFollow the request.`

test('skill-creator loads an installed editable Skill by exact id', async () => {
  const result = JSON.parse(await executeSkillCreatorToolCall(call('skill_creator_load_installed_skill', {
    skill_id: 'demo-skill',
  }), {
    agentId: 'skill-creator',
    sessionId: 'load-installed',
    loadInstalledSkill: async skillId => ({
      skillId,
      skillMd,
      files: ['SKILL.md', 'references/style.md'],
      source: 'user',
      editable: true,
    }),
  }))

  assert.equal(result.status, 'ok')
  assert.equal(result.target_skill_id, 'demo-skill')
  assert.equal(result.skill_md, skillMd)
  assert.deepEqual(result.files, ['SKILL.md', 'references/style.md'])
})

test('skill-creator reports missing and read-only installed Skills without filesystem search', async () => {
  const missing = JSON.parse(await executeSkillCreatorToolCall(call('skill_creator_load_installed_skill', {
    skill_id: 'missing-skill',
  }), {
    agentId: 'skill-creator',
    sessionId: 'load-missing',
    loadInstalledSkill: async () => null,
  }))
  assert.equal(missing.status, 'error')
  assert.equal(missing.errorCode, 'SKILL_NOT_INSTALLED')

  const readOnly = JSON.parse(await executeSkillCreatorToolCall(call('skill_creator_load_installed_skill', {
    skill_id: 'builtin-skill',
  }), {
    agentId: 'skill-creator',
    sessionId: 'load-readonly',
    loadInstalledSkill: async skillId => ({
      skillId,
      skillMd,
      files: ['SKILL.md'],
      source: 'builtin',
      editable: false,
    }),
  }))
  assert.equal(readOnly.status, 'error')
  assert.equal(readOnly.errorCode, 'SKILL_READ_ONLY')
})

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
