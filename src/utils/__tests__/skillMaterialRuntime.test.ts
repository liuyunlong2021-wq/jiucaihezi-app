import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSkillMaterialRuntimeCommand,
  detectSkillMaterialRuntime,
  validateSkillMaterialSources,
  type SkillMaterialSourceInput,
} from '../skillMaterialRuntime'

test('detectSkillMaterialRuntime returns unavailable when no runtime path exists', async () => {
  const runtime = await detectSkillMaterialRuntime({
    devProjectPath: '/Users/by3/Documents/Skill_Seekers',
    exists: async () => false,
  })

  assert.equal(runtime.available, false)
  assert.equal(runtime.errorCode, 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE')
  assert.deepEqual(runtime.capabilities, [])
})

test('detectSkillMaterialRuntime exposes source capabilities for the configured dev runtime', async () => {
  const runtime = await detectSkillMaterialRuntime({
    devProjectPath: '/Users/by3/Documents/Skill_Seekers',
    exists: async path => path === '/Users/by3/Documents/Skill_Seekers',
  })

  assert.equal(runtime.available, true)
  assert.equal(runtime.cwd, '/Users/by3/Documents/Skill_Seekers')
  assert.equal(runtime.command, 'uv')
  assert.deepEqual(runtime.argsPrefix, ['run', 'skill-seekers'])
  assert.deepEqual(runtime.capabilities, [
    'skill.source.pdf',
    'skill.source.documentation_url',
    'skill.source.github_repo',
    'skill.source.local_codebase',
  ])
})

test('detectSkillMaterialRuntime uses the real default filesystem check', async () => {
  const runtime = await detectSkillMaterialRuntime({
    devProjectPath: '/Users/by3/Documents/jiucaihezi-app',
  })

  assert.equal(runtime.available, true)
  assert.equal(runtime.cwd, '/Users/by3/Documents/jiucaihezi-app')
})

test('buildSkillMaterialRuntimeCommand keeps GitHub token out of argv and passes it through env', () => {
  const command = buildSkillMaterialRuntimeCommand({
    runtime: {
      available: true,
      cwd: '/Users/by3/Documents/Skill_Seekers',
      command: 'uv',
      argsPrefix: ['run', 'skill-seekers'],
      capabilities: ['skill.source.github_repo'],
    },
    name: 'Repo Skill',
    source: {
      type: 'github_repo',
      repo: 'owner/project',
      githubToken: 'ghp_secret_token',
    },
    preset: 'quick',
  })

  assert.equal(command.command, 'uv')
  assert.equal(command.cwd, '/Users/by3/Documents/Skill_Seekers')
  assert.equal(command.env.GITHUB_TOKEN, 'ghp_secret_token')
  assert.equal(command.args.includes('ghp_secret_token'), false)
  assert.deepEqual(command.args, [
    'run',
    'skill-seekers',
    'create',
    'owner/project',
    '--name',
    'Repo Skill',
    '--preset',
    'quick',
    '--enhance-level',
    '0',
    '--quiet',
    '--non-interactive',
  ])
})

test('validateSkillMaterialSources only allows safe source shapes', () => {
  const valid: SkillMaterialSourceInput[] = [
    { type: 'pdf', path: '/Users/by3/Documents/input.pdf', fileName: 'input.pdf' },
    { type: 'documentation_url', url: 'https://docs.example.com/start' },
    { type: 'github_repo', repo: 'owner/repo' },
    { type: 'local_codebase', path: '/Users/by3/Documents/project' },
  ]

  assert.deepEqual(validateSkillMaterialSources(valid).errors, [])
  assert.equal(validateSkillMaterialSources([{ type: 'documentation_url', url: 'file:///Users/by3/secret' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'documentation_url', url: 'http://localhost:3000/docs' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'documentation_url', url: 'https://user:pass@example.com/docs' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'documentation_url', url: 'http://169.254.169.254/latest/meta-data' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'local_codebase', path: '../project' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'github_repo', repo: 'https://evil.example.com/repo' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'pdf', path: '/Users/by3/evil\u0000.pdf' }]).errors[0].code, 'SOURCE_ACCESS_DENIED')
  assert.equal(validateSkillMaterialSources([{ type: 'openapi' } as any]).errors[0].code, 'UNSUPPORTED_SOURCE_TYPE')
})
