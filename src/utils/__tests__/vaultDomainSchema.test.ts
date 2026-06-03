import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inferVaultDomainSchema } from '../vaultDomainSchema'

test('inferVaultDomainSchema returns novel folders for chapter and character material', () => {
  const schema = inferVaultDomainSchema({
    name: '长篇小说知识库',
    text: '第50章 男主和女主在山洞分吃饼干，感情线推进。角色关系出现变化。',
  })

  assert.equal(schema.domain, 'novel')
  assert.deepEqual(schema.wikiFolders.slice(0, 8), [
    '人物',
    '关系',
    '事件线',
    '章节索引',
    '场景',
    '道具',
    '世界观',
    '写作状态',
  ])
})

test('inferVaultDomainSchema returns legal folders for case and pleading material', () => {
  const schema = inferVaultDomainSchema({
    name: '律师案例库',
    text: '案由：故意伤害罪。（2024）京0101刑初123号。起诉状、证据清单、办案策略和结果复盘。',
  })

  assert.equal(schema.domain, 'legal')
  assert.deepEqual(schema.wikiFolders.slice(0, 7), [
    '案由',
    '案件',
    '事实结构',
    '证据',
    '文书模板',
    '办案策略',
    '结果复盘',
  ])
})

test('inferVaultDomainSchema keeps generic structure for unmatched material', () => {
  const schema = inferVaultDomainSchema({
    name: '运营资料',
    text: '账号定位、操作流程、复盘模板。',
  })

  assert.equal(schema.domain, 'general')
  assert.ok(schema.wikiFolders.includes('基础概念'))
  assert.ok(schema.wikiFolders.includes('流程'))
  assert.ok(schema.wikiFolders.includes('模板'))
})

test('inferVaultDomainSchema keeps user selected wiki folders before domain defaults', () => {
  const schema = inferVaultDomainSchema({
    name: '长篇小说知识库',
    text: '第1章 男主和女主相遇，感情线开始。',
    selectedFolders: ['角色档案', '感情年表'],
  })

  assert.equal(schema.domain, 'novel')
  assert.deepEqual(schema.wikiFolders.slice(0, 2), ['角色档案', '感情年表'])
  assert.ok(schema.wikiFolders.includes('人物'))
  assert.ok(schema.wikiFolders.includes('章节索引'))
})
