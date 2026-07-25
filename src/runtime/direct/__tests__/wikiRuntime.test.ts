import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeWikiAction, type WikiWorkspace } from '../wikiRuntime'

function memoryWiki(initial: Record<string, string | null> = {}, git?: { status: string; diff: string }) {
  const entries = new Map(Object.entries(initial))
  const workspace: WikiWorkspace = {
    async list() {
      return [...entries].map(([path, content]) => ({ path, isDir: content === null }))
    },
    async read(path) {
      const content = entries.get(path)
      if (typeof content !== 'string') throw new Error(`文件不存在: ${path}`)
      return content
    },
    async write(path, content) {
      entries.set(path, content)
    },
    async createDirectory(path) {
      entries.set(path, null)
    },
    ...(git ? { async gitEvidence() { return git } } : {}),
  }
  return { entries, workspace }
}

function developmentWiki(extra: Record<string, string | null> = {}) {
  return memoryWiki({
    'docs': null,
    'docs/wiki': null,
    'docs/wiki/CLAUDE.md': '# Wiki\n',
    'docs/wiki/hot.md': '# Hot\n\n[[开发/事实]]\n',
    'docs/wiki/log.md': '# Log\n\n## [2026-07-22] 最近操作\n',
    'docs/wiki/来源索引.md': '# 来源\n\n[[开发/事实]]\n',
    'docs/wiki/开发': null,
    'docs/wiki/架构': null,
    'docs/wiki/运维': null,
    'docs/wiki/排障': null,
    'docs/wiki/学习': null,
    'docs/wiki/巡检报告': null,
    'docs/wiki/归档': null,
    'docs/wiki/开发/事实.md': '# 事实\n\n稳定结论。\n',
    ...extra,
  })
}

test('inspect locates the one existing Wiki and reports Raw without creating it', async () => {
  const { entries, workspace } = developmentWiki({ '.raw': null })

  const output = await executeWikiAction(workspace, { action: 'inspect' })

  assert.match(output, /state: existing/)
  assert.match(output, /path: docs\/wiki/)
  assert.match(output, /raw-state: existing/)
  assert.equal(entries.has('.raw/sessions'), false)
})

test('scaffold fills a development Wiki without overwriting content or creating .raw', async () => {
  const { entries, workspace } = memoryWiki({
    'docs': null,
    'docs/wiki': null,
    'docs/wiki/hot.md': '# 用户已有热缓存\n',
  })

  const output = await executeWikiAction(workspace, { action: 'scaffold', type: 'dev_project' })

  assert.match(output, /created-or-completed: docs\/wiki/)
  assert.equal(entries.get('docs/wiki/hot.md'), '# 用户已有热缓存\n')
  assert.equal(typeof entries.get('docs/wiki/CLAUDE.md'), 'string')
  assert.equal(entries.has('docs/wiki/巡检报告'), true)
  assert.equal([...entries.keys()].some(path => path === '.raw' || path.startsWith('.raw/')), false)
})

test('scaffold keeps the film structure distinct from novel-only categories', async () => {
  const { entries, workspace } = memoryWiki()

  await executeWikiAction(workspace, { action: 'scaffold', type: 'film' })

  assert.equal(entries.has('wiki/作品/大纲/场纲'), true)
  assert.equal(entries.has('wiki/世界/设定/世界观.md'), true)
  assert.equal(entries.has('wiki/世界/规则'), false)
  assert.equal(entries.has('wiki/世界/设定/历史与时代.md'), false)
})

test('generic scaffold creates only the five stable Wiki files', async () => {
  const { entries, workspace } = memoryWiki()

  await executeWikiAction(workspace, { action: 'scaffold', type: 'generic' })
  await executeWikiAction(workspace, { action: 'validate', type: 'generic' })

  assert.deepEqual(
    [...entries.keys()].filter(path => path.startsWith('wiki/')).sort(),
    ['wiki/CLAUDE.md', 'wiki/hot.md', 'wiki/index.md', 'wiki/log.md', 'wiki/来源索引.md'],
  )
  assert.match(String(entries.get('wiki/来源索引.md')), /\.raw\/对话记录/)
})

test('search prioritizes current entry pages and excludes log and archive by default', async () => {
  const { workspace } = developmentWiki({
    'docs/wiki/hot.md': '# Hot\n\n原生运行时当前结论\n',
    'docs/wiki/log.md': '# Log\n\n原生运行时流水\n',
    'docs/wiki/归档/旧方案.md': '# 旧\n\n原生运行时旧方案\n',
  })

  const output = await executeWikiAction(workspace, { action: 'search', query: '原生运行时' })

  assert.match(output, /hot\.md:3/)
  assert.doesNotMatch(output, /\nlog\.md:/)
  assert.doesNotMatch(output, /旧方案/)
})

test('status reports development category counts and latest operation', async () => {
  const { workspace } = developmentWiki()
  const output = await executeWikiAction(workspace, { action: 'status' })

  assert.match(output, /类型：开发项目/)
  assert.match(output, /开发：1 篇/)
  assert.match(output, /2026-07-22/)
})

test('graph writes Canvas from real Markdown links but ignores code and comments', async () => {
  const { entries, workspace } = developmentWiki({
    'docs/wiki/开发/甲.md': '# 甲\n\n[[开发/事实]]\n`[[不存在]]`\n<!-- [[也不存在]] -->\n',
  })

  const output = await executeWikiAction(workspace, { action: 'graph' })
  const canvas = JSON.parse(String(entries.get('docs/wiki/关系图.canvas')))

  assert.match(output, /关系图\.canvas/)
  assert.equal(canvas.edges.length, 2)
  assert.equal(JSON.stringify(canvas).includes('不存在'), false)
})

test('validate checks required development entries and stable entry links', async () => {
  const { workspace } = developmentWiki()
  assert.match(await executeWikiAction(workspace, { action: 'validate' }), /验证通过/)

  const broken = developmentWiki({
    'docs/wiki/hot.md': '# Hot\n\n[[开发/不存在]]\n',
  })
  await assert.rejects(
    () => executeWikiAction(broken.workspace, { action: 'validate' }),
    /稳定入口存在断链.*不存在/s,
  )
})

test('audit separates active broken links from archive hygiene and ignores pseudo links', async () => {
  const { workspace } = developmentWiki({
    'docs/wiki/开发/风险.md': '# 风险\n\n[[缺失页]]\n`[[代码假链接]]`\n',
    'docs/wiki/归档/旧页.md': '# 旧页\n\n[[归档缺失页]]\n',
  })

  const output = await executeWikiAction(workspace, { action: 'audit' })

  assert.match(output, /\[现行风险\]/)
  assert.match(output, /缺失页/)
  assert.match(output, /归档卫生：1 条/)
  assert.doesNotMatch(output, /代码假链接/)
})

test('closeout fingerprints provided evidence and states when Web has no Git evidence', async () => {
  const { workspace } = developmentWiki({
    'verification.txt': 'pnpm run test:focused\ntests passed\npnpm run build\nvite build\n',
  })

  const output = await executeWikiAction(workspace, {
    action: 'closeout',
    evidencePaths: ['verification.txt'],
  })

  assert.match(output, /Git：不可用/)
  assert.match(output, /测试：已提供/)
  assert.match(output, /构建：已提供/)
  assert.match(output, /verification\.txt sha256:[a-f0-9]{12}/)
})

test('replace is dry-run by default and writes only after apply', async () => {
  const project = developmentWiki({ 'docs/wiki/开发/名称.md': '# 名称\n\n旧名\n' })

  const preview = await executeWikiAction(project.workspace, {
    action: 'replace', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认',
  })
  assert.match(preview, /预览（未写盘/)
  assert.equal(project.entries.get('docs/wiki/开发/名称.md'), '# 名称\n\n旧名\n')

  const applied = await executeWikiAction(project.workspace, {
    action: 'replace', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认', apply: true,
  })
  assert.match(applied, /\[修复回执\]/)
  assert.equal(project.entries.get('docs/wiki/开发/名称.md'), '# 名称\n\n新名\n')
})

test('link and extend preserve dry-run semantics and apply confirmed writes', async () => {
  const project = developmentWiki()

  await executeWikiAction(project.workspace, {
    action: 'link', path: 'docs/wiki/开发/事实.md', target: '架构/产品', reason: '补回链', basis: '巡检',
  })
  await executeWikiAction(project.workspace, {
    action: 'extend', category: '产品', description: '产品事实', reason: '扩展', basis: '用户确认',
  })
  assert.doesNotMatch(String(project.entries.get('docs/wiki/开发/事实.md')), /架构\/产品/)
  assert.equal(project.entries.has('docs/wiki/产品'), false)

  assert.match(await executeWikiAction(project.workspace, {
    action: 'link', path: 'docs/wiki/开发/事实.md', target: '架构/产品', reason: '补回链', basis: '巡检', apply: true,
  }), /\[修复回执\]/)
  assert.match(await executeWikiAction(project.workspace, {
    action: 'extend', category: '产品', description: '产品事实', reason: '扩展', basis: '用户确认', apply: true,
  }), /\[修复回执\]/)
  assert.match(String(project.entries.get('docs/wiki/开发/事实.md')), /\[\[架构\/产品\]\]/)
  assert.equal(project.entries.get('docs/wiki/产品/_index.md'), '# 产品\n\n> 产品事实\n')
})
