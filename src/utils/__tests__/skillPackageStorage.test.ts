import assert from 'node:assert/strict'
import { test } from 'node:test'

import { persistSkillPackageDraft } from '../skillPackageStorage'
import { buildSkillPackageFromText } from '../skillTextBuilder'

test('persistSkillPackageDraft writes SKILL.md references and package manifest', async () => {
  const draft = buildSkillPackageFromText({
    name: '短剧爽点拆解',
    description: '把短剧教程整理成可执行 Skill',
    sourceTitle: '短剧教程.md',
    sourceText: '前三秒必须有冲突，第一集必须出现强钩子。',
  })
  const writes = new Map<string, string>()
  const mkdirs: string[] = []
  const renames: Array<[string, string]> = []

  const persisted = await persistSkillPackageDraft({
    skillId: 'skill_abc123',
    skillMd: draft.skillMd,
    references: draft.references,
    manifest: draft.manifest,
    rootDir: '/tmp/jc-skills',
  }, {
    mkdir: async (path: string) => { mkdirs.push(path) },
    writeTextFile: async (path: string, content: string) => { writes.set(path, content) },
    rename: async (from: string, to: string) => { renames.push([from, to]) },
    remove: async () => {},
  })

  assert.ok(persisted)
  assert.equal(persisted.packagePath, '/tmp/jc-skills/skill_abc123')
  assert.equal(persisted.packageManifestPath, '/tmp/jc-skills/skill_abc123/skill-package.json')
  assert.deepEqual(mkdirs, [
    '/tmp/jc-skills/skill_abc123.tmp',
    '/tmp/jc-skills/skill_abc123.tmp/references',
  ])
  assert.equal(writes.get('/tmp/jc-skills/skill_abc123.tmp/SKILL.md'), draft.skillMd)
  assert.match(writes.get('/tmp/jc-skills/skill_abc123.tmp/references/source.md') || '', /前三秒必须有冲突/)
  assert.deepEqual(renames, [['/tmp/jc-skills/skill_abc123.tmp', '/tmp/jc-skills/skill_abc123']])
  const manifest = JSON.parse(writes.get('/tmp/jc-skills/skill_abc123.tmp/skill-package.json') || '{}')
  assert.equal(manifest.entry, 'SKILL.md')
  assert.equal(manifest.files.some((file: any) => file.path === 'references/source.md'), true)
  assert.deepEqual(persisted.assetIndex.map(asset => asset.path), ['SKILL.md', 'references/source.md'])
})

test('persistSkillPackageDraft cleans temp package when a write fails', async () => {
  const removed: Array<{ path: string; recursive?: boolean }> = []

  await assert.rejects(
    () => persistSkillPackageDraft({
      skillId: 'skill_fail',
      skillMd: '# Skill',
      references: [{ path: 'references/source.md', title: 'source', content: 'x', mimeType: 'text/markdown' }],
      rootDir: '/tmp/jc-skills',
    }, {
      mkdir: async () => {},
      writeTextFile: async (path: string) => {
        if (path.endsWith('references/source.md')) throw new Error('disk full')
      },
      rename: async () => {},
      remove: async (path: string, options?: { recursive?: boolean }) => { removed.push({ path, recursive: options?.recursive }) },
    }),
    /disk full/,
  )

  assert.deepEqual(removed, [
    { path: '/tmp/jc-skills/skill_fail.tmp', recursive: true },
    { path: '/tmp/jc-skills/skill_fail.tmp', recursive: true },
  ])
})

test('persistSkillPackageDraft refuses to persist without atomic rename support', async () => {
  const mkdirs: string[] = []
  const writes: string[] = []

  const persisted = await persistSkillPackageDraft({
    skillId: 'skill_no_rename',
    skillMd: '# Skill',
    references: [{ path: 'references/source.md', title: 'source', content: 'x', mimeType: 'text/markdown' }],
    rootDir: '/tmp/jc-skills',
  }, {
    mkdir: async (path: string) => { mkdirs.push(path) },
    writeTextFile: async (path: string) => { writes.push(path) },
  })

  assert.equal(persisted, null)
  assert.deepEqual(mkdirs, [])
  assert.deepEqual(writes, [])
})

test('persistSkillPackageDraft rejects unsafe package file paths', async () => {
  await assert.rejects(
    () => persistSkillPackageDraft({
      skillId: 'skill_bad',
      skillMd: '# Bad',
      references: [{ path: '../secret.md', title: 'secret', content: 'x', mimeType: 'text/markdown' }],
      rootDir: '/tmp/jc-skills',
    }, {
      mkdir: async () => {},
      writeTextFile: async () => {},
      rename: async () => {},
    }),
    /Invalid skill package path/,
  )
})
