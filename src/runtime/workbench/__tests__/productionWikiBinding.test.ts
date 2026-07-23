import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveProductionWikiScene } from '../productionWikiBinding'

const resource = (path: string, isDirectory = false) => ({
  id: path,
  path,
  name: path.split('/').pop() || path,
  isDirectory,
  kind: isDirectory ? 'binary' as const : 'document' as const,
})

test('a selected scene resolves only its linked flat Chinese Wiki entities', () => {
  const resolved = resolveProductionWikiScene({
    rootPath: 'wiki',
    anchor: resource('wiki/作品/第8集.md'),
    content: '[[角色/林不凡]]在[[场景/客栈大堂]]取走[[道具/红伞]]。',
    resources: [
      resource('wiki/角色/林不凡.md'),
      resource('wiki/角色/温宁.md'),
      resource('wiki/场景/客栈大堂.md'),
      resource('wiki/道具/红伞.md'),
    ],
  })

  assert.deepEqual(resolved.entities.map(entity => ({ kind: entity.kind, name: entity.name, paths: entity.paths })), [
    { kind: 'character', name: '林不凡', paths: ['wiki/角色/林不凡.md'] },
    { kind: 'scene', name: '客栈大堂', paths: ['wiki/场景/客栈大堂.md'] },
    { kind: 'prop', name: '红伞', paths: ['wiki/道具/红伞.md'] },
  ])
})

test('a selected scene resolves linked directory entities without injecting the rest of the library', () => {
  const resolved = resolveProductionWikiScene({
    rootPath: 'wiki',
    anchor: resource('wiki/作品/正文/第8集/正文.md'),
    content: '[[角色/林不凡]]进入[[场景/客栈大堂]]。',
    resources: [
      resource('wiki/角色/林不凡', true),
      resource('wiki/角色/林不凡/01-基础信息/基础档案.md'),
      resource('wiki/角色/林不凡/02-人物塑造/塑造.md'),
      resource('wiki/角色/温宁', true),
      resource('wiki/角色/温宁/01-基础信息/基础档案.md'),
      resource('wiki/场景/客栈大堂', true),
      resource('wiki/场景/客栈大堂/01-基础信息/简介.md'),
    ],
  })

  assert.deepEqual(resolved.entities.map(entity => ({ kind: entity.kind, name: entity.name, paths: entity.paths })), [
    {
      kind: 'character',
      name: '林不凡',
      paths: [
        'wiki/角色/林不凡/01-基础信息/基础档案.md',
        'wiki/角色/林不凡/02-人物塑造/塑造.md',
      ],
    },
    { kind: 'scene', name: '客栈大堂', paths: ['wiki/场景/客栈大堂/01-基础信息/简介.md'] },
  ])
})

test('missing or non-entity Wiki links are reported instead of guessed from prose', () => {
  const resolved = resolveProductionWikiScene({
    rootPath: 'wiki',
    anchor: resource('wiki/作品/第8集.md'),
    content: '林不凡出现，[[角色/不存在]]看见[[世界/云城]]。',
    resources: [resource('wiki/角色/林不凡.md')],
  })

  assert.deepEqual(resolved.entities, [])
  assert.deepEqual(resolved.unresolvedLinks, ['角色/不存在'])
})

test('a nested entity document link does not expand an entire entity directory', () => {
  const resolved = resolveProductionWikiScene({
    rootPath: 'wiki',
    anchor: resource('wiki/作品/第8集.md'),
    content: '[[角色/林不凡/01-基础信息/基础档案]]',
    resources: [
      resource('wiki/角色/林不凡/01-基础信息/基础档案.md'),
      resource('wiki/角色/林不凡/02-人物塑造/塑造.md'),
    ],
  })

  assert.deepEqual(resolved.entities, [])
})
