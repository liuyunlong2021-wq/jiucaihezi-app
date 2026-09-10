import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAdaptationWikiScaffoldPlan } from '../adaptationWikiScaffold'

test('adaptation Wiki scaffold creates the fixed minimal wiki tree', () => {
  const plan = buildAdaptationWikiScaffoldPlan([])
  assert.equal(plan.wikiRoot, 'wiki')
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.directories, [
    'wiki',
    'wiki/原始材料',
    'wiki/改编方案',
    'wiki/剧本',
    'wiki/资产',
    'wiki/资产/角色',
    'wiki/资产/场景',
    'wiki/资产/道具',
  ])
  assert.deepEqual(
    plan.files.map(item => item.path),
    [
      'wiki/index.md',
      'wiki/原始材料/index.md',
      'wiki/改编方案/index.md',
      'wiki/剧本/index.md',
      'wiki/资产/index.md',
      'wiki/资产/角色/index.md',
      'wiki/资产/场景/index.md',
      'wiki/资产/道具/index.md',
    ],
  )
})

test('adaptation Wiki scaffold reuses the only existing wiki root and stays idempotent', () => {
  const plan = buildAdaptationWikiScaffoldPlan([
    { path: 'docs/wiki', isDirectory: true },
    { path: 'docs/wiki/index.md', isDirectory: false },
    { path: 'docs/wiki/资产', isDirectory: true },
  ])
  assert.equal(plan.wikiRoot, 'docs/wiki')
  assert.ok(!plan.directories.includes('docs/wiki'))
  assert.ok(!plan.directories.includes('docs/wiki/资产'))
  assert.ok(!plan.files.some(item => item.path === 'docs/wiki/index.md'))
  assert.ok(plan.files.some(item => item.path === 'docs/wiki/资产/index.md'))
})

test('adaptation Wiki scaffold rejects parallel roots, legacy indexes, and occupied paths', () => {
  assert.match(
    buildAdaptationWikiScaffoldPlan([
      { path: 'wiki', isDirectory: true },
      { path: 'docs/wiki', isDirectory: true },
    ]).conflicts.join('\n'),
    /多个 Wiki 根目录/,
  )
  assert.match(
    buildAdaptationWikiScaffoldPlan([
      { path: 'wiki', isDirectory: true },
      { path: 'wiki/_index.md', isDirectory: false },
    ]).conflicts.join('\n'),
    /_index.md/,
  )
  assert.match(
    buildAdaptationWikiScaffoldPlan([{ path: 'wiki', isDirectory: false }]).conflicts.join('\n'),
    /普通文件占用/,
  )
})
