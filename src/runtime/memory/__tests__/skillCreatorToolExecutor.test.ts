import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DirectToolCall } from '@/runtime/direct/directTypes'
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

test('save_skill prepares a draft for user confirmation without claiming it is installed', async () => {
  const result = JSON.parse(await executeSkillCreatorToolCall(call('save_skill', {
    skill_md: skillMd,
  }), { agentId: 'other-agent', sessionId: 'prepare-save' }))

  assert.equal(result.status, 'prepared')
  assert.match(result.draft_id, /^draft_/)
  assert.equal(result.skill_md, skillMd)
  assert.match(result.message, /install_token/)
  assert.equal(result.install_token.revision, result.revision)
  assert.equal('packagePath' in result, false)
})

test('truncated tool arguments return an actionable error instead of the raw JSON.parse failure', async () => {
  const truncated: DirectToolCall = {
    id: 'call_truncated',
    type: 'function',
    function: {
      name: 'save_skill',
      arguments: '{"draft_id":"draft_1","revision":1,"content_hash":"abc',
    },
  }

  const result = JSON.parse(await executeSkillCreatorToolCall(truncated, { agentId: 'skill-creator', sessionId: 'bad-args' }))

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'MALFORMED_TOOL_ARGUMENTS')
  assert.match(result.message, /save_skill/)
  assert.match(result.message, /收到 \d+ 字符/)
  assert.match(result.message, /draft_id/)
  // 不能把引擎的原生报错原样丢给模型和用户。
  assert.doesNotMatch(result.message, /Unterminated|JSON Parse error/i)
})

test('tool arguments that are valid JSON but not an object are rejected by name', async () => {
  const arrayArgs: DirectToolCall = {
    id: 'call_array_args',
    type: 'function',
    function: { name: 'skill_creator_validate', arguments: '[1,2,3]' },
  }

  const result = JSON.parse(await executeSkillCreatorToolCall(arrayArgs, { agentId: 'skill-creator', sessionId: 'array-args' }))

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'MALFORMED_TOOL_ARGUMENTS')
  assert.match(result.message, /skill_creator_validate/)
  assert.match(result.message, /JSON 对象/)
})
