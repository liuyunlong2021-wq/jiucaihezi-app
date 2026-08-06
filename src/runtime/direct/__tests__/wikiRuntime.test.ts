import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
    async fingerprint(path: string) {
      const content = entries.get(path)
      if (typeof content !== 'string') throw new Error(`文件不存在: ${path}`)
      return createHash('sha256').update(content).digest('hex')
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

test('generic scaffold creates only the app lifecycle files without a mandatory-read note', async () => {
  const { entries, workspace } = memoryWiki()

  await executeWikiAction(workspace, { action: 'scaffold', type: 'generic' })
  await executeWikiAction(workspace, { action: 'validate', type: 'generic' })

  assert.deepEqual(
    [...entries.keys()].filter(path => path.startsWith('wiki/')).sort(),
    ['wiki/hot.md', 'wiki/index.md', 'wiki/log.md', 'wiki/来源索引.md'],
  )
  assert.match(String(entries.get('wiki/来源索引.md')), /## 证据记录/)
  assert.match(String(entries.get('wiki/来源索引.md')), /\| Wiki 位置 \| 来源角色 \| 原始来源 \| 已处理范围 \| 写入时指纹 \| 记录时间 \|/)
  assert.doesNotMatch(String(entries.get('wiki/来源索引.md')), /待补充|conversation-id/)
})

test('evidence returns full content fingerprints without echoing content or writing files', async () => {
  const project = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n',
    '资料/制度.md': '不得出现在工具输出中的制度正文',
  })
  const before = new Map(project.entries)

  const output = await executeWikiAction(project.workspace, {
    action: 'evidence' as any,
    evidencePaths: ['资料/制度.md'],
  })

  assert.match(output, /\[来源证据\]/)
  assert.match(output, new RegExp(`资料/制度\\.md sha256:${createHash('sha256').update('不得出现在工具输出中的制度正文').digest('hex')}`))
  assert.doesNotMatch(output, /制度正文/)
  assert.deepEqual(project.entries, before)
})

test('evidence rejects unsafe, missing, directory, and external sources', async () => {
  const { workspace } = memoryWiki({ '资料': null, '资料/制度.md': '制度' })

  for (const path of ['', '资料', '不存在.md', '../越界.md', '/tmp/外部.md', 'C:\\外部.md', 'https://example.com/rule']) {
    await assert.rejects(
      () => executeWikiAction(workspace, { action: 'evidence' as any, evidencePaths: [path] }),
      /来源证据|项目内|文件|路径|URL|空/,
    )
  }
})

test('nested category extension updates its parent index instead of flattening navigation', async () => {
  const { entries, workspace } = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n\n- [[角色/_index|角色]]\n',
    'wiki/角色': null,
    'wiki/角色/_index.md': '# 角色\n\n> 人物资料。\n',
  })

  await executeWikiAction(workspace, {
    action: 'extend',
    category: '角色/主角',
    description: '主要人物资料。',
    reason: '用户确认新增主角分类',
    basis: '用户确认的 Wiki 结构方案',
    apply: true,
  })

  assert.match(String(entries.get('wiki/角色/_index.md')), /\[\[角色\/主角\/_index\|主角\]\]/)
  assert.doesNotMatch(String(entries.get('wiki/index.md')), /角色\/主角/)
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
  const { workspace } = developmentWiki({
    'docs/wiki/log.md': '# Log\n\n## [2026-07-22] 更早操作\n\n## [2026-08-04] 最近操作\n',
  })
  const output = await executeWikiAction(workspace, { action: 'status' })

  assert.match(output, /类型：开发项目/)
  assert.match(output, /开发：1 篇/)
  assert.match(output, /上次操作：\[2026-08-04\] 最近操作/)
})

test('graph requires confirmed seed pages and does not generate a full Wiki graph', async () => {
  const { entries, workspace } = developmentWiki()

  await assert.rejects(
    () => executeWikiAction(workspace, { action: 'graph' }),
    /种子页面/,
  )
  await assert.rejects(
    () => executeWikiAction(workspace, { action: 'graph', evidencePaths: ['开发/事实.md'], depth: 3 }),
    /depth 仅支持 1 或 2/,
  )
  assert.equal([...entries.keys()].some(path => path.endsWith('.canvas')), false)
})

test('graph writes a scoped Canvas with clickable file nodes and real Markdown links', async () => {
  const { entries, workspace } = developmentWiki({
    'docs/wiki/开发/甲.md': '# 甲\n\n[[开发/事实]]\n`[[不存在]]`\n<!-- [[也不存在]] -->\n',
    'docs/wiki/开发/乙.md': '# 乙\n\n[[开发/甲]]\n',
    'docs/wiki/开发/无关.md': '# 无关\n',
  })

  const output = await executeWikiAction(workspace, {
    action: 'graph',
    evidencePaths: ['开发/甲.md'],
    path: '开发/甲-关系图.canvas',
  })
  const canvas = JSON.parse(String(entries.get('docs/wiki/开发/甲-关系图.canvas')))
  const files = canvas.nodes.map((node: { type: string; file?: string }) => node.file).sort()

  assert.match(output, /甲-关系图\.canvas/)
  assert.deepEqual(files, ['docs/wiki/开发/乙.md', 'docs/wiki/开发/事实.md', 'docs/wiki/开发/甲.md'])
  assert.equal(canvas.nodes.every((node: { type: string }) => node.type === 'file'), true)
  assert.equal(canvas.edges.length, 2)
  assert.equal(JSON.stringify(canvas).includes('不存在'), false)
  assert.equal(JSON.stringify(canvas).includes('无关'), false)
  assert.equal(entries.has('docs/wiki/关系图.canvas'), false)
})

test('graph previews existing Canvas updates and preserves unrelated nodes and layout', async () => {
  const existing = JSON.stringify({
    nodes: [
      { id: 'a', type: 'file', file: 'wiki/A.md', x: 700, y: 800, width: 250, height: 80 },
      { id: 'manual', type: 'file', file: 'wiki/手工.md', x: 900, y: 1000, width: 250, height: 80 },
    ],
    edges: [],
  })
  const project = memoryWiki({
    'wiki': null,
    'wiki/A.md': '# A\n\n[[B]]\n',
    'wiki/B.md': '# B\n',
    'wiki/手工.md': '# 手工\n',
    'wiki/A-关系图.canvas': existing,
  })

  const preview = await executeWikiAction(project.workspace, {
    action: 'graph', evidencePaths: ['A.md'], path: 'A-关系图.canvas',
  })
  assert.match(preview, /预览（未写盘/)
  assert.equal(project.entries.get('wiki/A-关系图.canvas'), existing)

  await executeWikiAction(project.workspace, {
    action: 'graph', evidencePaths: ['A.md'], path: 'A-关系图.canvas', apply: true,
  })
  const canvas = JSON.parse(String(project.entries.get('wiki/A-关系图.canvas')))
  assert.equal(canvas.nodes.find((node: { id: string }) => node.id === 'a').x, 700)
  assert.equal(canvas.nodes.find((node: { id: string }) => node.id === 'manual').x, 900)
  assert.equal(canvas.nodes.some((node: { file?: string }) => node.file === 'wiki/B.md'), true)
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

test('audit resolves exact and unique links but reports duplicate basename ambiguity', async () => {
  const { workspace } = developmentWiki({
    'docs/wiki/开发/A': null,
    'docs/wiki/开发/B': null,
    'docs/wiki/开发/A/同名.md': '# A\n',
    'docs/wiki/开发/B/同名.md': '# B\n',
    'docs/wiki/开发/唯一.md': '# 唯一\n',
    'docs/wiki/开发/链接.md': '# 链接\n\n[[开发/A/同名]] [[唯一]] [[同名]]\n',
  })

  const output = await executeWikiAction(workspace, { action: 'audit', evidencePaths: ['开发/链接.md'] })

  assert.match(output, /歧义链接.*\[\[同名\]\]/)
  assert.doesNotMatch(output, /\[\[开发\/A\/同名\]\].*不存在/)
  assert.doesNotMatch(output, /\[\[唯一\]\].*不存在/)
})

test('audit separates navigation risks, candidates, and historical hygiene', async () => {
  const { entries, workspace } = developmentWiki({
    'docs/wiki/hot.md': '# Hot\n\n[[导航缺失]]\n',
    'docs/wiki/log.md': '# Log\n\n[[日志缺失]]\n',
    'docs/wiki/开发/风险.md': '# 风险\n\n[[普通缺失]]\n`[[代码假链接]]`\n<!-- [[注释假链接]] -->\n\\[[转义假链接]]\n',
    'docs/wiki/开发/孤儿.md': '# 孤儿\n',
    'docs/wiki/归档/旧页.md': '# 旧页\n\n[[归档缺失]]\n',
    'docs/wiki/开发/旧结论.md': '# 旧结论\n\n状态：已替代\n\n[[历史缺失]]\n',
  })
  const before = new Map(entries)

  const output = await executeWikiAction(workspace, { action: 'audit' })

  assert.match(output, /\[明确风险\][\s\S]*导航缺失/)
  assert.match(output, /\[待确认候选\][\s\S]*普通缺失/)
  assert.match(output, /\[待确认候选\][\s\S]*孤儿\.md: 孤儿候选/)
  assert.match(output, /\[历史卫生\][\s\S]*日志缺失/)
  assert.match(output, /\[历史卫生\][\s\S]*归档缺失/)
  assert.match(output, /\[历史卫生\][\s\S]*历史缺失/)
  for (const pseudo of ['代码假链接', '注释假链接', '转义假链接']) assert.doesNotMatch(output, new RegExp(pseudo))
  assert.deepEqual(entries, before)
})

test('audit evidencePaths restrict source scanning and directory size is not an error', async () => {
  const extra: Record<string, string | null> = {
    'docs/wiki/开发/范围内.md': '# 范围内\n\n[[范围内缺失]]\n',
    'docs/wiki/开发/范围外.md': '# 范围外\n\n[[范围外缺失]]\n',
  }
  for (let index = 0; index < 10; index += 1) extra[`docs/wiki/开发/大目录/${index}.md`] = `# ${index}\n`
  const { workspace } = developmentWiki(extra)

  const output = await executeWikiAction(workspace, { action: 'audit', evidencePaths: ['开发/范围内.md'] })

  assert.match(output, /范围内缺失/)
  assert.doesNotMatch(output, /范围外缺失/)
  assert.doesNotMatch(output, /明显多于|建议检查是否需要拆分/)
})

test('audit reports current, changed, missing, unverifiable, and incomplete evidence without writes', async () => {
  const current = createHash('sha256').update('当前制度').digest('hex')
  const old = createHash('sha256').update('旧制度').digest('hex')
  const sourceIndex = `# 来源索引

## 证据记录

| Wiki 位置 | 来源角色 | 原始来源 | 已处理范围 | 写入时指纹 | 记录时间 |
|---|---|---|---|---|---|
| [[制度/当前#期限]] | 原件 | \`资料/当前.md\` | 全文 | \`sha256:${current}\` | 2026-08-05T22:00:00+08:00 |
| [[制度/变化#期限]] | 原件 | \`资料/变化.md\` | 全文 | \`sha256:${old}\` | 2026-08-05T22:00:00+08:00 |
| [[制度/丢失#期限]] | 原件 | \`资料/丢失.md\` | 全文 | \`sha256:${old}\` | 2026-08-05T22:00:00+08:00 |
| [[制度/网页#期限]] | 网页 | https://example.com/rule | 网页正文 | 未计算（URL） | 2026-08-05T22:00:00+08:00 |
| [[制度/不存在#期限]] | 对话 | \`资料/当前.md\` | 全文 | \`sha256:${current}\` | 2026-08-05T22:00:00+08:00 |
| [[制度/当前#不存在章节]] | 对话 | \`资料/当前.md\` | 全文 | \`sha256:${current}\` | 2026-08-05T22:00:00+08:00 |
`
  const project = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n',
    'wiki/hot.md': '# 热缓存\n',
    'wiki/log.md': '# Wiki Log\n',
    'wiki/来源索引.md': sourceIndex,
    'wiki/制度': null,
    'wiki/制度/当前.md': '# 当前\n\n## 期限\n三十天。\n',
    'wiki/制度/变化.md': '# 变化\n\n## 期限\n三十天。\n',
    'wiki/制度/丢失.md': '# 丢失\n\n## 期限\n三十天。\n',
    'wiki/制度/网页.md': '# 网页\n\n## 期限\n三十天。\n',
    '资料/当前.md': '当前制度',
    '资料/变化.md': '当前制度',
  })
  const before = new Map(project.entries)

  const output = await executeWikiAction(project.workspace, { action: 'audit' })

  assert.match(output, /\[来源状态\]/)
  assert.match(output, /当前一致.*制度\/当前#期限/s)
  assert.match(output, /来源已变化.*制度\/变化#期限/s)
  assert.match(output, /来源不存在.*制度\/丢失#期限/s)
  assert.match(output, /无法验证.*制度\/网页#期限/s)
  assert.match(output, /登记不完整.*制度\/不存在#期限/s)
  assert.match(output, /登记不完整.*制度\/当前#不存在章节.*Wiki 章节不存在/s)
  assert.doesNotMatch(output, /事实错误/)
  assert.deepEqual(project.entries, before)
})

test('audit reports an unsafe Wiki location as incomplete and continues with valid records', async () => {
  const hash = createHash('sha256').update('当前制度').digest('hex')
  const { workspace } = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n',
    'wiki/hot.md': '# 热缓存\n',
    'wiki/log.md': '# Wiki Log\n',
    'wiki/来源索引.md': `# 来源索引

## 证据记录

| Wiki 位置 | 来源角色 | 原始来源 | 已处理范围 | 写入时指纹 | 记录时间 |
|---|---|---|---|---|---|
| [[../越界#期限]] | 原件 | \`资料/当前.md\` | 全文 | \`sha256:${hash}\` | 2026-08-05T22:00:00+08:00 |
| [[制度/当前#期限]] | 原件 | \`资料/当前.md\` | 全文 | \`sha256:${hash}\` | 2026-08-05T22:00:00+08:00 |
`,
    'wiki/制度': null,
    'wiki/制度/当前.md': '# 当前\n\n## 期限\n三十天。\n',
    '资料/当前.md': '当前制度',
  })

  const output = await executeWikiAction(workspace, { action: 'audit' })

  assert.match(output, /登记不完整.*\.\.\/越界#期限/)
  assert.match(output, /当前一致.*制度\/当前#期限/s)
})

test('audit rejects a Wiki page as its own original source', async () => {
  const page = '# 当前\n\n## 期限\n三十天。\n'
  const hash = createHash('sha256').update(page).digest('hex')
  const { workspace } = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n',
    'wiki/hot.md': '# 热缓存\n',
    'wiki/log.md': '# Wiki Log\n',
    'wiki/来源索引.md': `# 来源索引

## 证据记录

| Wiki 位置 | 来源角色 | 原始来源 | 已处理范围 | 写入时指纹 | 记录时间 |
|---|---|---|---|---|---|
| [[制度/当前#期限]] | 原件 | \`wiki/制度/当前.md\` | 全文 | \`sha256:${hash}\` | 2026-08-05T22:00:00+08:00 |
`,
    'wiki/制度': null,
    'wiki/制度/当前.md': page,
  })

  const output = await executeWikiAction(workspace, { action: 'audit' })

  assert.match(output, /登记不完整.*不能作为原始来源/)
  assert.doesNotMatch(output, /当前一致/)
})

test('audit resolves a unique Obsidian short link in an evidence record', async () => {
  const source = '当前制度'
  const hash = createHash('sha256').update(source).digest('hex')
  const { workspace } = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n',
    'wiki/hot.md': '# 热缓存\n',
    'wiki/log.md': '# Wiki Log\n',
    'wiki/来源索引.md': `# 来源索引

## 证据记录

| Wiki 位置 | 来源角色 | 原始来源 | 已处理范围 | 写入时指纹 | 记录时间 |
|---|---|---|---|---|---|
| [[当前#期限]] | 原件 | \`资料/当前.md\` | 全文 | \`sha256:${hash}\` | 2026-08-05T22:00:00+08:00 |
`,
    'wiki/制度': null,
    'wiki/制度/当前.md': '# 当前\n\n## 期限\n三十天。\n',
    '资料/当前.md': source,
  })

  const output = await executeWikiAction(workspace, { action: 'audit' })

  assert.match(output, /当前一致.*制度\/当前#期限/s)
  assert.doesNotMatch(output, /登记不完整.*当前#期限/)
})

test('audit scopes evidence records to the requested Wiki page', async () => {
  const hash = createHash('sha256').update('已变化').digest('hex')
  const { workspace } = memoryWiki({
    'wiki': null,
    'wiki/index.md': '# 全库目录\n',
    'wiki/hot.md': '# 热缓存\n',
    'wiki/log.md': '# Wiki Log\n',
    'wiki/来源索引.md': `# 来源索引

## 证据记录

| Wiki 位置 | 来源角色 | 原始来源 | 已处理范围 | 写入时指纹 | 记录时间 |
|---|---|---|---|---|---|
| [[制度/甲#期限]] | 原件 | \`资料/甲.md\` | 全文 | \`sha256:${hash}\` | 2026-08-05T22:00:00+08:00 |
| [[制度/乙#期限]] | 原件 | \`资料/乙.md\` | 全文 | \`sha256:${hash}\` | 2026-08-05T22:00:00+08:00 |
`,
    'wiki/制度': null,
    'wiki/制度/甲.md': '# 甲\n\n## 期限\n',
    'wiki/制度/乙.md': '# 乙\n\n## 期限\n',
    '资料/甲.md': '当前',
    '资料/乙.md': '当前',
  })

  const output = await executeWikiAction(workspace, { action: 'audit', evidencePaths: ['制度/甲.md'] })

  assert.match(output, /制度\/甲#期限/)
  assert.doesNotMatch(output, /制度\/乙#期限/)
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
    action: 'replace', path: '开发/名称.md', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认',
  })
  assert.match(preview, /预览（未写盘/)
  assert.equal(project.entries.get('docs/wiki/开发/名称.md'), '# 名称\n\n旧名\n')

  const applied = await executeWikiAction(project.workspace, {
    action: 'replace', path: '开发/名称.md', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认', apply: true,
  })
  assert.match(applied, /\[修复回执\]/)
  assert.match(applied, /验证：内容一致=是，新值存在=是，旧值剩余=0/)
  assert.equal(project.entries.get('docs/wiki/开发/名称.md'), '# 名称\n\n新名\n')
})

test('replace requires one explicit Wiki Markdown path', async () => {
  const project = developmentWiki({
    'docs/wiki/开发/名称.md': '# 名称\n\n旧名\n',
    'docs/wiki/开发/另一个.md': '# 另一个\n\n旧名\n',
  })

  await assert.rejects(
    () => executeWikiAction(project.workspace, {
      action: 'replace', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认',
    }),
    /必须提供目标 Markdown 文件路径/,
  )
  assert.match(String(project.entries.get('docs/wiki/开发/名称.md')), /旧名/)
  assert.match(String(project.entries.get('docs/wiki/开发/另一个.md')), /旧名/)
})

test('replace requires a reason and traceable basis', async () => {
  const project = developmentWiki({ 'docs/wiki/开发/名称.md': '# 名称\n\n旧名\n' })

  await assert.rejects(
    () => executeWikiAction(project.workspace, {
      action: 'replace', path: '开发/名称.md', oldText: '旧名', newText: '新名', basis: '用户确认',
    }),
    /reason 和 basis/,
  )
  await assert.rejects(
    () => executeWikiAction(project.workspace, {
      action: 'replace', path: '开发/名称.md', oldText: '旧名', newText: '新名', reason: '统一名称',
    }),
    /reason 和 basis/,
  )
})

test('replace rejects outside-Wiki and non-Markdown targets', async () => {
  const project = developmentWiki({ 'docs/other.txt': '旧名\n', 'docs/wiki/开发/资料.canvas': '{}\n' })

  await assert.rejects(
    () => executeWikiAction(project.workspace, {
      action: 'replace', path: '../other.txt', oldText: '旧名', newText: '新名', reason: '修正', basis: '用户确认',
    }),
    /当前 Wiki 内的 Markdown 文件/,
  )
  await assert.rejects(
    () => executeWikiAction(project.workspace, {
      action: 'replace', path: '开发/资料.canvas', oldText: '{}', newText: '{"ok":true}', reason: '修正', basis: '用户确认',
    }),
    /当前 Wiki 内的 Markdown 文件/,
  )
})

test('replace previews line evidence and rejects multiple matches unless replaceAll is explicit', async () => {
  const project = developmentWiki({ 'docs/wiki/开发/重复.md': '# 重复\n\n旧名\n\n旧名\n' })

  const preview = await executeWikiAction(project.workspace, {
    action: 'replace', path: '开发/重复.md', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认',
  })
  assert.match(preview, /重复\.md/)
  assert.match(preview, /命中行：3、5/)
  assert.match(preview, /命中 2 处/)
  assert.match(String(project.entries.get('docs/wiki/开发/重复.md')), /旧名.*旧名/s)
  await assert.rejects(
    () => executeWikiAction(project.workspace, {
      action: 'replace', path: '开发/重复.md', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认', apply: true,
    }),
    /多处命中.*replaceAll/s,
  )
  await executeWikiAction(project.workspace, {
    action: 'replace', path: '开发/重复.md', oldText: '旧名', newText: '新名', reason: '统一名称', basis: '用户确认', replaceAll: true, apply: true,
  })
  assert.doesNotMatch(String(project.entries.get('docs/wiki/开发/重复.md')), /旧名/)
})

test('extend remains available for Everything but link is no longer a Wiki action', async () => {
  const project = developmentWiki()

  await assert.rejects(
    () => executeWikiAction(project.workspace, { action: 'link' as never, path: '开发/事实.md', reason: '补回链', basis: '巡检' }),
    /不支持的 Wiki action/,
  )
  assert.match(await executeWikiAction(project.workspace, {
    action: 'extend', category: '产品', description: '产品事实', reason: '扩展', basis: '用户确认', apply: true,
  }), /\[修复回执\]/)
  assert.equal(project.entries.get('docs/wiki/产品/_index.md'), '# 产品\n\n> 产品事实\n')
})
