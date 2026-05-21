import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildFirstWikiDraft, buildFirstWikiReport, mergeFirstWikiDraftSeedPages } from '../vaultFirstWiki'

test('buildFirstWikiDraft detects toolbook structure and proposes wiki pages', () => {
  const draft = buildFirstWikiDraft({
    vaultName: '小红书工具书',
    rawMarkdownFiles: [
      {
        name: '小红书工具书.md',
        path: 'raw/转换后的MD/小红书工具书.md',
        content: [
          '# 小红书运营工具书',
          '## 账号定位',
          '账号定位决定内容边界。',
          '## 账号冷启动流程',
          '第一步明确目标用户。第二步连续发布同一领域内容。',
          '## 标题公式',
          '标题要包含对象、场景和结果。',
          '## 为什么笔记没有流量',
          '常见原因是定位混乱、封面弱、选题泛。',
        ].join('\n\n'),
      },
    ],
  })

  assert.ok(draft.wikiFolders.includes('基础概念'))
  assert.ok(draft.wikiFolders.includes('操作流程'))
  assert.ok(draft.wikiFolders.includes('方法模型'))
  assert.ok(draft.wikiFolders.includes('FAQ'))
  assert.ok(draft.seedPages.some(page => page.path === '基础概念/账号定位.md'))
  assert.ok(draft.seedPages.some(page => page.path === '操作流程/账号冷启动流程.md'))
  assert.ok(draft.seedPages.some(page => page.sources?.includes('raw/转换后的MD/小红书工具书.md#账号定位')))
  assert.match(draft.seedPages[0].content || '', /## 适用场景/)
})

test('buildFirstWikiDraft falls back to overview page for weak structure', () => {
  const draft = buildFirstWikiDraft({
    vaultName: '零散笔记',
    rawMarkdownFiles: [
      {
        name: 'note.md',
        path: 'raw/转换后的MD/note.md',
        content: '今天讨论了很多想法，没有明显标题，但是有一些关于角色、场景和道具的碎片。',
      },
    ],
  })

  assert.ok(draft.wikiFolders.includes('沉淀内容'))
  assert.equal(draft.seedPages[0].path, '沉淀内容/资料概览.md')
  assert.match(draft.seedPages[0].content || '', /今天讨论了很多想法/)
})

test('buildFirstWikiDraft rejects page-marker-only source as empty material', () => {
  const draft = buildFirstWikiDraft({
    vaultName: '扫描空文档',
    rawMarkdownFiles: [
      {
        name: 'scan.md',
        path: 'raw/转换后的MD/scan.md',
        content: '[第1页]\n\n[第2页]\n\n[Page 3]',
      },
    ],
  })

  assert.equal(draft.seedPages.length, 0)
  assert.equal(draft.wikiFolders.length, 0)
  assert.equal(draft.mode, 'empty')
})

test('buildFirstWikiReport summarizes generated folders and pages', () => {
  const draft = buildFirstWikiDraft({
    vaultName: '测试',
    rawMarkdownFiles: [
      { name: 'a.md', path: 'raw/转换后的MD/a.md', content: '# A\n\n## 概念\n\n内容' },
    ],
  })
  const report = buildFirstWikiReport('测试', draft)

  assert.match(report, /# 测试 首版 Wiki 生成报告/)
  assert.match(report, /生成栏目：/)
  assert.match(report, /生成页面：/)
  assert.match(report, /raw\/转换后的MD\/a.md/)
})

test('mergeFirstWikiDraftSeedPages keeps llm pages and fills empty pages from local draft', () => {
  const draft = buildFirstWikiDraft({
    vaultName: '测试',
    rawMarkdownFiles: [
      {
        name: 'a.md',
        path: 'raw/转换后的MD/a.md',
        content: '# A\n\n## 账号定位\n\n账号定位决定内容边界。',
      },
    ],
  })

  const merged = mergeFirstWikiDraftSeedPages([
    {
      path: '基础概念/账号定位.md',
      title: '账号定位',
      summary: '',
      content: '',
      sources: [],
    },
    {
      path: '洞察/额外页面.md',
      title: '额外页面',
      content: '模型额外发现。',
    },
  ], draft)

  assert.equal(merged.length, 2)
  assert.match(merged.find(page => page.path === '基础概念/账号定位.md')?.content || '', /账号定位决定内容边界/)
  assert.ok(merged.some(page => page.path === '洞察/额外页面.md'))
})
