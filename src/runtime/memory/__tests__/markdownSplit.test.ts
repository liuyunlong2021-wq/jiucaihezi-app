import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyMarkdownSplitPlan, buildMarkdownSplitPlan } from '../markdownSplit'

const source = [
  '作品说明',
  '',
  '第一章 桃园相遇',
  '刘备遇见关羽和张飞。',
  '',
  '第二章 初次同行',
  '三人一同上路。',
].join('\n')

test('story split preserves preface and chapter source while building navigable indexes', async () => {
  const plan = await buildMarkdownSplitPlan(source, {
    sourcePath: '原始资料/故事.md',
    targetDirectory: 'wiki/作品/故事/章节',
    strategy: 'story_chapter',
    groupSize: 100,
  })

  assert.equal(plan.nodes.length, 3)
  assert.equal(plan.nodes[0]?.title, '前置内容')
  assert.equal(plan.nodes[1]?.title, '第一章 桃园相遇')
  assert.equal(plan.nodes[1]?.source, '第一章 桃园相遇\n刘备遇见关羽和张飞。\n\n')
  assert.ok(plan.writes.some(write => write.path.endsWith('/0001.md')))
  assert.match(
    plan.writes.find(write => write.path.endsWith('/index.md'))?.content || '',
    /\[\[0001\|第一章 桃园相遇\]\]/,
  )
  const firstChapter = plan.writes.find(write => write.path.endsWith('/0001.md'))?.content || ''
  assert.match(firstChapter, /source_label: "第一章 桃园相遇"/)
  assert.doesNotMatch(firstChapter, /analysis_status/)
})

test('numbered story nodes keep source labels but use physical order for stable paths', async () => {
  const plan = await buildMarkdownSplitPlan('引子\n1.\n甲\n1.\n乙\n85.\n丙', {
    sourcePath: '原始材料/原文.md',
    targetDirectory: 'wiki/原始材料/故事/原文节点',
    strategy: 'story_numbered',
  })

  assert.deepEqual(
    plan.nodes.map(node => node.path.split('/').at(-1)),
    ['0000.md', '0001.md', '0002.md', '0003.md'],
  )
  assert.deepEqual(
    plan.nodes.map(node => node.sourceLabel),
    ['', '1.', '1.', '85.'],
  )
  assert.match(plan.warnings.join('\n'), /重复编号：1/)
  assert.match(plan.warnings.join('\n'), /缺少编号：2、3/)
  assert.match(plan.warnings.join('\n'), /序号存在倒序/)
})

test('large split creates fixed-range intermediate indexes without merging chapters', async () => {
  const content = Array.from(
    { length: 1000 },
    (_, index) => `第${index + 1}章\n正文${index + 1}\n`,
  ).join('')
  const plan = await buildMarkdownSplitPlan(content, {
    sourcePath: '原始资料/长篇.md',
    targetDirectory: 'wiki/长篇/章节',
    strategy: 'story_chapter',
    groupSize: 100,
  })

  assert.equal(plan.nodes.length, 1000)
  assert.equal(plan.writes.length, 1011)
  assert.ok(plan.writes.some(write => write.path === 'wiki/长篇/章节/0001-0100/index.md'))
  assert.ok(plan.writes.some(write => write.path === 'wiki/长篇/章节/0901-1000/index.md'))
  assert.equal(plan.writes.filter(write => /\/\d{4}\.md$/.test(write.path)).length, 1000)
})

test('apply preflights every target, skips identical files, and never overwrites conflicts', async () => {
  const plan = await buildMarkdownSplitPlan('第一章\n正文', {
    sourcePath: '原始资料/故事.md',
    targetDirectory: 'wiki/故事/章节',
    strategy: 'story_chapter',
  })
  const existing = new Map<string, string>([[plan.writes[0]!.path, plan.writes[0]!.content]])
  const created: string[] = []

  const result = await applyMarkdownSplitPlan(plan, '第一章\n正文', {
    read: async path => existing.get(path) ?? null,
    create: async (path, content) => {
      created.push(path)
      existing.set(path, content)
    },
  })
  assert.equal(result.skipped, 1)
  assert.equal(result.created, plan.writes.length - 1)

  const conflictingPlan = await buildMarkdownSplitPlan('第一章\n改动', {
    sourcePath: '原始资料/故事.md',
    targetDirectory: 'wiki/冲突/章节',
    strategy: 'story_chapter',
  })
  const conflictPath = conflictingPlan.writes[0]!.path
  await assert.rejects(
    () =>
      applyMarkdownSplitPlan(conflictingPlan, '第一章\n改动', {
        read: async path => (path === conflictPath ? '用户已有内容' : null),
        create: async path => {
          created.push(path)
        },
      }),
    /目标文件冲突/,
  )
  assert.equal(
    created.some(path => path.startsWith('wiki/冲突/章节')),
    false,
  )
})

test('apply rejects a stale preview after source content changes', async () => {
  const plan = await buildMarkdownSplitPlan('第一章\n原文', {
    sourcePath: '原始资料/故事.md',
    targetDirectory: 'wiki/故事/章节',
    strategy: 'story_chapter',
  })
  await assert.rejects(
    () =>
      applyMarkdownSplitPlan(plan, '第一章\n后来修改', {
        read: async () => null,
        create: async () => undefined,
      }),
    /源文件已变化/,
  )
})

test('markdown heading strategy splits only the requested heading level', async () => {
  const plan = await buildMarkdownSplitPlan('# 第一部分\n## 小节\n正文\n# 第二部分\n正文', {
    sourcePath: '原始资料/资料.md',
    targetDirectory: 'wiki/资料/章节',
    strategy: 'markdown_heading',
    headingLevel: 1,
  })
  assert.deepEqual(
    plan.nodes.map(node => node.title),
    ['第一部分', '第二部分'],
  )
  assert.match(plan.nodes[0]!.source, /## 小节/)
})

test('split paths must stay inside the current project', async () => {
  await assert.rejects(
    () =>
      buildMarkdownSplitPlan('第一章\n正文', {
        sourcePath: '原始资料/故事.md',
        targetDirectory: '/tmp/章节',
        strategy: 'story_chapter',
      }),
    /当前项目内/,
  )
})
