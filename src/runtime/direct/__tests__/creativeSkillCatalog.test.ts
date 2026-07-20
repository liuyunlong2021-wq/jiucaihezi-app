import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeCreativeSkillCatalog } from '../creativeSkillCatalog'

test('built-in Skill overrides a same-name local Skill in the one effective catalog', () => {
  const catalog = mergeCreativeSkillCatalog([
    { id: 'local-video', name: '视频反推', description: '本机版本' },
    { id: 'local-custom', name: '本机自定义', description: '仅本机存在' },
  ], [
    { id: 'builtin-video', name: '视频反推', description: '内置版本', triggers: [], commands: [], files: ['SKILL.md'] },
    { id: 'builtin-image', name: '图片反推', description: '内置图片', triggers: [], commands: [], files: ['SKILL.md'] },
  ])

  assert.deepEqual(catalog.map(skill => [skill.name, skill.source]), [
    ['视频反推', 'builtin'],
    ['图片反推', 'builtin'],
    ['本机自定义', 'local'],
  ])
  assert.equal(catalog[0]?.id, 'builtin-video')
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
