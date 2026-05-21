import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildFirstWikiPageJobs, pageJobToSeedPage } from '../vaultWikiGeneration'

test('buildFirstWikiPageJobs turns corpus chunks into page-level wiki jobs', () => {
  const jobs = buildFirstWikiPageJobs({
    rawMarkdownFiles: [
      {
        name: '编剧工具书.md',
        path: 'raw/转换后的MD/编剧工具书.md',
        content: '# 编剧工具书\n\n## 三幕结构流程\n\n第一步建立目标。第二步制造阻碍。\n\n## 人物动机\n\n角色必须有主动选择。',
      },
    ],
    wikiFolders: ['方法模型', '角色'],
    maxPages: 8,
  })

  assert.ok(jobs.some(job => job.targetPath === '方法模型/三幕结构流程.md'))
  assert.ok(jobs.some(job => job.targetPath === '角色/人物动机.md'))
  assert.ok(jobs.every(job => job.sourceAnchors.length > 0))
  assert.match(jobs[0].prompt, /只输出单个 Markdown Wiki 页面/)
})

test('pageJobToSeedPage keeps source references and controlled page shape', () => {
  const [job] = buildFirstWikiPageJobs({
    rawMarkdownFiles: [
      {
        name: '运营手册.md',
        path: 'raw/转换后的MD/运营手册.md',
        content: '# 运营手册\n\n## 选题流程\n\n第一步确定用户。第二步收集问题。',
      },
    ],
    wikiFolders: ['操作流程'],
  })

  const page = pageJobToSeedPage(job)
  assert.equal(page.path, '操作流程/选题流程.md')
  assert.match(page.content || '', /## 核心要点/)
  assert.match(page.content || '', /raw\/转换后的MD\/运营手册.md#选题流程/)
  assert.deepEqual(page.sources, ['raw/转换后的MD/运营手册.md#选题流程'])
})
