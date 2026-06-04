import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSkillPackageFromText, normalizeSkillPackagePath } from '../skillTextBuilder'

test('buildSkillPackageFromText creates a standard SKILL.md and reference from pasted text', () => {
  const result = buildSkillPackageFromText({
    name: '知乎小说拆解',
    description: '把用户提供的小说方法论整理成可复用创作 Skill',
    sourceTitle: '知乎小说.md',
    sourceText: '# 爽点\n主角必须在前三百字遇到明确冲突。\n\n## 输出\n按章节输出。',
  })

  assert.equal(result.manifest.kind, 'skill-package-draft')
  assert.equal(result.references.length, 1)
  assert.equal(result.references[0].path, 'references/source.md')
  assert.match(result.references[0].content, /主角必须在前三百字遇到明确冲突/)
  assert.match(result.skillMd, /^---\nname: 知乎小说拆解\n/m)
  assert.match(result.skillMd, /description: "把用户提供的小说方法论整理成可复用创作 Skill"/)
  assert.match(result.skillMd, /## When to Use/)
  assert.match(result.skillMd, /## Source Reference/)
  assert.equal(result.quality.hardGatePassed, true)
  assert.deepEqual(result.quality.errors, [])
})

test('buildSkillPackageFromText rejects empty source text', () => {
  assert.throws(() => buildSkillPackageFromText({
    name: '空内容',
    description: '不能从空内容创建 Skill',
    sourceText: '   ',
  }), /sourceText is required/)
})

test('normalizeSkillPackagePath blocks path traversal and absolute paths', () => {
  assert.equal(normalizeSkillPackagePath('references/source.md'), 'references/source.md')
  assert.throws(() => normalizeSkillPackagePath('../secret.md'), /Invalid skill package path/)
  assert.throws(() => normalizeSkillPackagePath('/tmp/secret.md'), /Invalid skill package path/)
  assert.throws(() => normalizeSkillPackagePath('references/a\0b.md'), /Invalid skill package path/)
})
