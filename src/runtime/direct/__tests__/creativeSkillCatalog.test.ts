import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeCreativeSkillCatalog } from '../creativeSkillCatalog'

test('local Skill overrides same-name built-in Skill in the one effective catalog', () => {
  const catalog = mergeCreativeSkillCatalog([
    { id: 'local-video', name: '视频反推', description: '本机版本' },
  ], [
    { id: 'builtin-video', name: '视频反推', description: '内置版本', triggers: [], commands: [], files: ['SKILL.md'] },
    { id: 'builtin-image', name: '图片反推', description: '内置图片', triggers: [], commands: [], files: ['SKILL.md'] },
  ])

  assert.deepEqual(catalog.map(skill => [skill.name, skill.source]), [
    ['视频反推', 'local'],
    ['图片反推', 'builtin'],
  ])
  assert.equal(catalog[0]?.id, 'local-video')
})

test('effective Skill catalog carries the exact source needed by skill(name)', () => {
  const [skill] = mergeCreativeSkillCatalog([], [
    { id: 'builtin-video', name: '视频反推', description: '内置版本', triggers: ['视频'], commands: [], files: ['SKILL.md', 'references/rules.md'] },
  ])

  assert.deepEqual(skill, {
    id: 'builtin-video',
    name: '视频反推',
    description: '内置版本',
    source: 'builtin',
    triggers: ['视频'],
    commands: [],
    files: ['SKILL.md', 'references/rules.md'],
  })
})
