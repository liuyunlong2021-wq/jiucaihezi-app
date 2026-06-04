import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createToolJobRunner } from '@/runtime/tools/jobRunner'
import { createToolJobStore } from '@/runtime/tools/jobStore'
import { getSkillBuilderDraft } from '../skillBuilderTools'
import { executeCompileSkillMaterialsToolCall, runSkillMaterialCompilerWithTauri } from '../skillMaterialCompiler'

test('executeCompileSkillMaterialsToolCall returns unavailable when advanced runtime is missing', async () => {
  const result = await executeCompileSkillMaterialsToolCall({
    function: {
      name: 'compile_skill_materials',
      arguments: JSON.stringify({
        name: 'PDF Skill',
        sources: [{ type: 'pdf', path: '/Users/by3/Documents/input.pdf' }],
      }),
    },
  }, {
    sessionId: 'session_compile_unavailable',
    detectRuntime: async () => ({ available: false, capabilities: [], errorCode: 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE' }),
  })

  const parsed = JSON.parse(result!)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.error, 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE')
})

test('executeCompileSkillMaterialsToolCall rejects empty source lists before starting a job', async () => {
  let started = false
  const runner = createToolJobRunner({
    store: createToolJobStore({ now: () => 1000 }),
    createId: () => {
      started = true
      return 'job_should_not_start'
    },
  })

  const result = await executeCompileSkillMaterialsToolCall({
    function: {
      name: 'compile_skill_materials',
      arguments: JSON.stringify({
        name: 'Empty Source Skill',
        sources: [],
      }),
    },
  }, {
    sessionId: 'session_empty_sources',
    jobRunner: runner,
    detectRuntime: async () => ({
      available: true,
      cwd: '/Users/by3/Documents/Skill_Seekers',
      command: 'uv',
      argsPrefix: ['run', 'skill-seekers'],
      capabilities: ['skill.source.pdf'],
    }),
  })

  const parsed = JSON.parse(result!)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.error, 'INVALID_TOOL_ARGUMENTS')
  assert.equal(started, false)
})

test('executeCompileSkillMaterialsToolCall starts a job and stores compiled draft under the active session', async () => {
  const store = createToolJobStore({ now: () => 1000 })
  const runner = createToolJobRunner({ store, createId: () => 'job_compile_1' })

  const result = await executeCompileSkillMaterialsToolCall({
    id: 'call_compile_1',
    function: {
      name: 'compile_skill_materials',
      arguments: JSON.stringify({
        name: 'Repo Skill',
        description: '整理仓库资料',
        sources: [{ type: 'github_repo', repo: 'owner/project' }],
      }),
    },
  }, {
    sessionId: 'session_compile',
    jobRunner: runner,
    detectRuntime: async () => ({
      available: true,
      cwd: '/Users/by3/Documents/Skill_Seekers',
      command: 'uv',
      argsPrefix: ['run', 'skill-seekers'],
      capabilities: ['skill.source.github_repo'],
    }),
    runCompiler: async () => ({
      rawFiles: [
        { path: 'SKILL.md', content: '---\nname: Repo Skill\ndescription: 整理仓库资料\n---\n# Repo Skill' },
        { path: 'references/source.md', content: 'Repo source material' },
      ],
    }),
    normalizerFs: {
      mkdir: async () => {},
      writeTextFile: async () => {},
    },
    workspaceRoot: '/tmp/jc-builds',
  })

  const started = JSON.parse(result!)
  assert.equal(started.status, 'running')
  assert.equal(started.jobId, 'job_compile_1')

  const final = await runner.waitForJob('job_compile_1')
  assert.equal(final?.status, 'succeeded')
  const data = final?.result?.data as any
  assert.match(data.draft_id, /^draft_/)
  assert.equal(getSkillBuilderDraft(data.draft_id, 'session_compile')?.references[0].content, 'Repo source material')
  assert.equal(getSkillBuilderDraft(data.draft_id, 'other_session'), null)
})

test('executeCompileSkillMaterialsToolCall uses a unique workspace per job', async () => {
  const store = createToolJobStore({ now: () => 1000 })
  const runner = createToolJobRunner({ store, createId: () => 'job_compile_unique' })
  let workspacePath = ''

  const result = await executeCompileSkillMaterialsToolCall({
    id: 'call_compile_unique',
    function: {
      name: 'compile_skill_materials',
      arguments: JSON.stringify({
        name: 'PDF Skill',
        sources: [{ type: 'pdf', path: '/Users/by3/Documents/input.pdf' }],
      }),
    },
  }, {
    sessionId: 'session_compile_unique',
    jobRunner: runner,
    detectRuntime: async () => ({
      available: true,
      cwd: '/Users/by3/Documents/Skill_Seekers',
      command: 'uv',
      argsPrefix: ['run', 'skill-seekers'],
      capabilities: ['skill.source.pdf'],
    }),
    runCompiler: async (input) => {
      workspacePath = input.workspacePath
      return {
        rawFiles: [
          { path: 'SKILL.md', content: '---\nname: PDF Skill\ndescription: x\n---\n# PDF Skill' },
        ],
      }
    },
    normalizerFs: {
      mkdir: async () => {},
      writeTextFile: async () => {},
    },
    workspaceRoot: '/tmp/jc-builds',
  })

  const started = JSON.parse(result!)
  await runner.waitForJob(started.jobId)
  assert.equal(workspacePath, '/tmp/jc-builds/job_compile_unique')
})

test('runSkillMaterialCompilerWithTauri invokes the restricted Rust compiler command', async () => {
  const calls: any[] = []
  const output = await runSkillMaterialCompilerWithTauri({
    command: {
      command: 'uv',
      args: ['run', 'skill-seekers', 'create', 'owner/project'],
      cwd: '/Users/by3/Documents/Skill_Seekers',
      env: { GITHUB_TOKEN: 'ghp_secret_token' },
    },
    source: {
      type: 'github_repo',
      repo: 'owner/project',
      githubToken: 'ghp_secret_token',
    },
    name: 'Repo Skill',
    workspacePath: '/tmp/jc-builds/job_1',
  }, async (command, payload) => {
    calls.push({ command, payload })
    return {
      rawFiles: [
        { path: 'SKILL.md', content: '# Repo Skill' },
        { path: 'references/source.md', content: 'source' },
      ],
    }
  })

  assert.deepEqual(output.rawFiles.map(file => file.path), ['SKILL.md', 'references/source.md'])
  assert.equal(calls[0].command, 'skill_material_compile')
  assert.equal(calls[0].payload.input.runtimeRoot, '/Users/by3/Documents/Skill_Seekers')
  assert.equal(calls[0].payload.input.source.sourceType, 'github_repo')
  assert.equal(calls[0].payload.input.source.value, 'owner/project')
  assert.equal(calls[0].payload.input.source.githubToken, 'ghp_secret_token')
  assert.equal(JSON.stringify(calls[0].payload).includes('args'), false)
})

test('runSkillMaterialCompilerWithTauri surfaces native compiler failures with redacted stderr', async () => {
  await assert.rejects(
    () => runSkillMaterialCompilerWithTauri({
      command: {
        command: 'uv',
        args: ['run', 'skill-seekers', 'create', 'owner/project'],
        cwd: '/Users/by3/Documents/Skill_Seekers',
        env: { GITHUB_TOKEN: 'ghp_secret_token' },
      },
      source: {
        type: 'github_repo',
        repo: 'owner/project',
        githubToken: 'ghp_secret_token',
      },
      name: 'Repo Skill',
      workspacePath: '/tmp/jc-builds/job_failed',
    }, async () => ({
      exitCode: 1,
      stderr: 'rate limited for [REDACTED]',
      rawFiles: [],
    })),
    /rate limited for \[REDACTED\]/,
  )
})
