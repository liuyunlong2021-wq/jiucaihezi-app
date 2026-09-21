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
  const draftPath = '.raw/jc-media/文档/skill-demo-skill'
  const entries = {
    [`${draftPath}/SKILL.md`]: skillMd,
    [`${draftPath}/agents/grader.md`]: '# grader',
    [`${draftPath}/eval-viewer/generate_review.py`]: 'print(1)',
    [`${draftPath}/LICENSE.txt`]: 'MIT',
  }
  const result = JSON.parse(await executeSkillCreatorToolCall(call('skill_creator_validate', {
    draft_path: draftPath,
  }), {
    agentId: 'skill-creator',
    sessionId: 'package-paths',
    files: {
      async list(directory) { return Object.keys(entries).filter(path => path.startsWith(`${directory}/`)) },
      async readText(path) { return entries[path as keyof typeof entries] ?? '' },
      async hashFile() { return 'hash' },
    },
  }))
  assert.equal(result.status, 'ok')
})

test('skill-creator asks for a draft path when the call carries none', async () => {
  const result = JSON.parse(await executeSkillCreatorToolCall(call('run_skill_tests', {
    test_cases: [],
    test_id: 'blocked',
  }), { agentId: 'skill-creator', sessionId: 'test' }))
  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'SKILL_DRAFT_PATH_REQUIRED')
  // 报错要能自敕：告诉模型草稿该放在哪里
  assert.match(result.message, /draft_path/)
  assert.match(result.message, /jc-media\/文档\/skill-/)
})

test('save_skill freezes a file-tree draft for user confirmation without claiming it is installed', async () => {
  const draftPath = '.raw/jc-media/文档/skill-demo-skill'
  const result = JSON.parse(await executeSkillCreatorToolCall(call('save_skill', {
    draft_path: draftPath,
  }), {
    agentId: 'skill-creator',
    sessionId: 'prepare-save',
    files: {
      async list(directory) { return [`${directory}/SKILL.md`] },
      async readText(path) { return path.endsWith('SKILL.md') ? skillMd : '' },
      async hashFile() { return 'hash' },
    },
  }))

  assert.equal(result.status, 'prepared')
  assert.equal(result.draft_path, draftPath)
  assert.match(result.draft_id, /^draft_/, '安装快照必须有自己的 draftId')
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
      arguments: '{"draft_path":".raw/jc-media/文档/skill-x","test_cases":[',
    },
  }

  const result = JSON.parse(await executeSkillCreatorToolCall(truncated, { agentId: 'skill-creator', sessionId: 'bad-args' }))

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'MALFORMED_TOOL_ARGUMENTS')
  assert.match(result.message, /save_skill/)
  assert.match(result.message, /收到 \d+ 字符/)
  assert.match(result.message, /draft_path/)
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
