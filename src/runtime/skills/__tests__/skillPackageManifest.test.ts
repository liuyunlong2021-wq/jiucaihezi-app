import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSkillPackageManifest,
  extractReferencedSkillPackagePaths,
  validateSkillPackageReferences,
} from '../skillPackageManifest'

test('skill package manifest classifies the complete package', () => {
  const manifest = buildSkillPackageManifest([
    'references/rules.md',
    'scripts/check.py',
    'assets/template.docx',
    'agents/openai.yaml',
  ])
  assert.deepEqual(manifest.files.map(file => [file.path, file.kind]), [
    ['SKILL.md', 'instruction'],
    ['agents/openai.yaml', 'metadata'],
    ['assets/template.docx', 'asset'],
    ['references/rules.md', 'reference'],
    ['scripts/check.py', 'script'],
  ])
})

test('skill package reference validation finds explicit bundled paths', () => {
  const skillMd = 'Read `references/rules.md` and run `scripts/check.py`; use assets/template.docx.'
  assert.deepEqual(extractReferencedSkillPackagePaths(skillMd), [
    'assets/template.docx',
    'references/rules.md',
    'scripts/check.py',
  ])
  assert.deepEqual(validateSkillPackageReferences(skillMd, ['SKILL.md', 'references/rules.md']), [
    'assets/template.docx',
    'scripts/check.py',
  ])
})

test('skill package reference validation ignores placeholder examples', () => {
  // 真实现场：human-physiognomy 的 SKILL.md 用 `references/{相术类型}.md` 举例，
  // 曾把整个包判成不完整，导致 Skill Creator 无法读取。
  const skillMd = [
    '面相 → references/mianxiang.md',
    '```yaml',
    'file_path: "references/{相术类型}.md"',
    '```',
  ].join('\n')
  assert.deepEqual(extractReferencedSkillPackagePaths(skillMd), ['references/mianxiang.md'])
  assert.deepEqual(
    validateSkillPackageReferences(skillMd, ['SKILL.md', 'references/mianxiang.md']),
    [],
  )
})
