import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDescribeArchitectureDirections,
  buildUploadArchitectureDirections,
  normalizeWikiArchitectureDirections,
} from '../vaultArchitecture'

test('normalizeWikiArchitectureDirections keeps 2-3 clean selectable directions', () => {
  const directions = normalizeWikiArchitectureDirections([
    {
      title: '按原书目录整理',
      description: '保留资料天然章节，适合工具书。',
      wikiFolders: ['总览', '章节/方法', '', '章节/方法'],
      rationale: '资料本身已有结构。',
      tradeoffs: '跨章节主题需要后续整理。',
    },
    {
      id: 'by-topic',
      title: '按主题整理',
      description: '把内容拆成主题页。',
      wikiFolders: ['概念', '流程'],
    },
    { title: '', description: 'invalid' },
    {
      title: '按实体整理',
      description: '围绕角色、地点、工具形成页面。',
      wikiFolders: ['实体', '关系'],
    },
    {
      title: '超出数量',
      description: '不应该保留第四个方向。',
      wikiFolders: ['其他'],
    },
  ])

  assert.equal(directions.length, 3)
  assert.equal(directions[0].id, 'direction_1')
  assert.equal(directions[1].id, 'by-topic')
  assert.deepEqual(directions[0].wikiFolders, ['总览', '章节/方法'])
})

test('buildUploadArchitectureDirections creates local fallback from first wiki draft folders', () => {
  const directions = buildUploadArchitectureDirections({
    files: [
      { name: '工具书.md', extractedText: '第一章 方法\n第二章 案例', status: 'ready' },
      { name: '访谈.txt', extractedText: '用户多次提到流程和角色', status: 'ready' },
    ],
    draftWikiFolders: ['章节', '流程', '角色'],
  })

  assert.ok(directions.length >= 2)
  assert.match(directions[0].title, /资料原结构|原结构/)
  assert.ok(directions.some(direction => direction.wikiFolders.includes('流程')))
})

test('buildDescribeArchitectureDirections creates beginner-friendly options from role and goal', () => {
  const directions = buildDescribeArchitectureDirections({
    role: '小说作者',
    goal: '管理人物设定和世界观',
  })

  assert.equal(directions.length, 3)
  assert.ok(directions.every(direction => direction.title && direction.description))
  assert.ok(directions.some(direction => direction.wikiFolders.some(folder => /流程|主题|对象|角色|实体/.test(folder))))
})
