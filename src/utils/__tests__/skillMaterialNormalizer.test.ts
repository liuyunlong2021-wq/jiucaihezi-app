import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeSkillMaterialOutput } from '../skillMaterialNormalizer'

test('normalizeSkillMaterialOutput copies SKILL.md references and reports into a standard package', async () => {
  const writes = new Map<string, string>()
  const mkdirs: string[] = []
  const result = await normalizeSkillMaterialOutput({
    jobId: 'job_1',
    workspacePath: '/tmp/jc-builds/job_1',
    rawFiles: [
      { path: 'SKILL.md', content: '---\nname: Repo Skill\ndescription: Test\n---\n# Repo Skill' },
      { path: 'references/api.md', content: 'API reference' },
      { path: 'assets/config.json', content: '{"ok":true}' },
    ],
    fs: {
      mkdir: async path => { mkdirs.push(path) },
      writeTextFile: async (path, content) => { writes.set(path, content) },
    },
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.skillMdPath, '/tmp/jc-builds/job_1/skill/SKILL.md')
  assert.equal(result.manifestPath, '/tmp/jc-builds/job_1/skill/skill-package.json')
  assert.equal(result.reportPath, '/tmp/jc-builds/job_1/reports/source-analysis.json')
  assert.deepEqual(mkdirs, [
    '/tmp/jc-builds/job_1/skill',
    '/tmp/jc-builds/job_1/reports',
    '/tmp/jc-builds/job_1/skill/references',
    '/tmp/jc-builds/job_1/skill/assets',
  ])
  assert.equal(writes.get('/tmp/jc-builds/job_1/skill/SKILL.md')?.includes('Repo Skill'), true)
  assert.equal(writes.get('/tmp/jc-builds/job_1/skill/references/api.md'), 'API reference')
  const manifest = JSON.parse(writes.get('/tmp/jc-builds/job_1/skill/skill-package.json') || '{}')
  assert.equal(manifest.entry, 'SKILL.md')
  assert.equal(manifest.files.some((file: any) => file.path === 'references/api.md'), true)
  const report = JSON.parse(writes.get('/tmp/jc-builds/job_1/reports/source-analysis.json') || '{}')
  assert.equal(report.jobId, 'job_1')
  assert.equal(report.fileCount, 3)
})

test('normalizeSkillMaterialOutput rejects unsafe raw output paths', async () => {
  const result = await normalizeSkillMaterialOutput({
    jobId: 'job_bad',
    workspacePath: '/tmp/jc-builds/job_bad',
    rawFiles: [
      { path: 'SKILL.md', content: '# Skill' },
      { path: '../secret.md', content: 'secret' },
    ],
    fs: {
      mkdir: async () => {},
      writeTextFile: async () => {},
    },
  })

  assert.equal(result.status, 'error')
  assert.equal(result.error, 'SKILL_OUTPUT_UNSAFE_PATH')
})

test('normalizeSkillMaterialOutput returns SKILL_OUTPUT_MISSING when raw output lacks SKILL.md', async () => {
  const result = await normalizeSkillMaterialOutput({
    jobId: 'job_missing',
    workspacePath: '/tmp/jc-builds/job_missing',
    rawFiles: [
      { path: 'references/source.md', content: 'source only' },
    ],
    fs: {
      mkdir: async () => {},
      writeTextFile: async () => {},
    },
  })

  assert.equal(result.status, 'error')
  assert.equal(result.error, 'SKILL_OUTPUT_MISSING')
})

