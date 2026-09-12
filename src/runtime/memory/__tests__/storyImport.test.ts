import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProjectFileService } from '@/services/projectFileService'
import type { ProjectResource } from '@/utils/projectResource'
import {
  applyStoryImportPlan,
  buildStoryImportPlan,
  detectStorySplit,
  parseStoryOrdinal,
  upsertWikiIndex,
} from '../storyImport'

function memoryFiles(initial: Record<string, string> = {}) {
  const entries = new Map(
    Object.entries(initial).map(([path, content]) => [path, { content, revision: 1 }]),
  )
  const writes: string[] = []
  const resource = (owner: string, path: string, content: string): ProjectResource => ({
    runtime: 'web',
    owner,
    path,
    name: path.split('/').at(-1) || path,
    isDirectory: false,
    kind: 'text',
    size: content.length,
  })
  const files = {
    async list(owner: string) {
      return [...entries].map(([path, value]) => resource(owner, path, value.content))
    },
    async readTextAt(_owner: string, path: string) {
      const value = entries.get(path)
      if (!value) throw new Error('文件不存在')
      return {
        content: value.content,
        size: value.content.length,
        revision: { value: String(value.revision), size: value.content.length },
      }
    },
    async createText(owner: string, path: string, content: string) {
      if (entries.has(path)) throw new Error(`文件已存在: ${path}`)
      entries.set(path, { content, revision: 1 })
      writes.push(path)
      return resource(owner, path, content)
    },
    async writeText(_resource: ProjectResource, content: string, expected: { value: string }) {
      const value = entries.get(_resource.path)
      if (!value) return { status: 'missing' as const }
      if (String(value.revision) !== expected.value) throw new Error('unexpected stale test write')
      value.content = content
      value.revision += 1
      writes.push(_resource.path)
      return {
        status: 'saved' as const,
        revision: { value: String(value.revision), size: content.length },
      }
    },
  } as unknown as ProjectFileService
  return { entries, files, writes }
}

test('Wiki index additions stay inside their matching sections', () => {
  const updated = upsertWikiIndex(
    '# Wiki\n\n## 子目录\n\n- [[旧目录/index|旧目录]]\n\n## 页面\n\n- [[旧页面|旧页面]]\n',
    'Wiki',
    '项目知识导航。',
    [{ target: '新目录/index', label: '新目录', summary: '新增目录。' }],
    [{ target: '新页面', label: '新页面', summary: '新增页面。' }],
  )
  assert.ok(updated.indexOf('[[新目录/index|新目录]]') < updated.indexOf('## 页面'))
  assert.ok(updated.indexOf('[[新页面|新页面]]') > updated.indexOf('## 页面'))
})

test('story import detects numbered nodes and builds the complete navigable Wiki', async () => {
  assert.deepEqual(detectStorySplit('1.\n甲\n2.\n乙'), { strategy: 'story_numbered' })
  assert.deepEqual(detectStorySplit('1\n甲\n２\n乙\n3、\n丙'), { strategy: 'story_numbered' })
  const plan = await buildStoryImportPlan({
    content: '题记\n1.\n甲\n1.\n乙\n85.\n丙',
    title: '故事.md',
    originalName: '故事.txt',
    sourceEncoding: 'gb18030',
  })
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n' })
  const result = await applyStoryImportPlan(
    plan,
    '题记\n1.\n甲\n1.\n乙\n85.\n丙',
    state.files,
    'project',
    { acceptWarnings: true },
  )

  assert.equal(plan.split.nodes[1]?.path.endsWith('/0001.md'), true)
  assert.equal(plan.split.nodes[2]?.sourceLabel, '1.')
  assert.match(plan.completionContent, /source_encoding: "gb18030"/)
  assert.match(
    state.entries.get('wiki/index.md')?.content || '',
    /\[\[原始材料\/index\|原始材料\]\]/,
  )
  assert.match(
    state.entries.get('wiki/原始材料/index.md')?.content || '',
    /\[\[故事\/index\|故事\]\]/,
  )
  assert.match(
    state.entries.get('wiki/原始材料/故事/index.md')?.content || '',
    /\[\[原文节点\/index\|原文节点\]\]/,
  )
  assert.equal(state.writes.at(-1), 'wiki/原始材料/故事/来源.md')
  assert.match(state.entries.get(state.writes.at(-1)!)?.content || '', /import_status: complete/)
  assert.ok(result.created > 0)

  const repeated = await applyStoryImportPlan(
    plan,
    '题记\n1.\n甲\n1.\n乙\n85.\n丙',
    state.files,
    'project',
    { acceptWarnings: true },
  )
  assert.equal(repeated.created, 0)
  assert.equal(repeated.updated, 0)
})

test('story numbering normalizes multilingual and suffix ordinals', () => {
  assert.equal(parseStoryOrdinal('中风一'), 1)
  assert.equal(parseStoryOrdinal('中寒二（附伤寒、伤风）'), 2)
  assert.equal(parseStoryOrdinal('霍乱十二'), 12)
  assert.equal(parseStoryOrdinal('秘方一百'), 100)
  assert.equal(parseStoryOrdinal('第壹佰零貳章'), 102)
  assert.equal(parseStoryOrdinal('第十二話'), 12)
  assert.equal(parseStoryOrdinal('第Ⅻ章'), 12)
  assert.equal(parseStoryOrdinal('Chapter XII'), 12)
  assert.equal(parseStoryOrdinal('Episode ００３'), 3)
  assert.equal(parseStoryOrdinal('001、标题'), 1)
})

test('numbered heading sequence outranks wrapper headings', () => {
  const chineseSuffix = [
    '# 丹溪心法',
    '## 卷一',
    '### 中风一',
    '正文',
    '### 中寒二',
    '正文',
    '### 中暑三',
    '正文',
    '# About this digital edition',
  ].join('\n')
  assert.deepEqual(detectStorySplit(chineseSuffix), {
    strategy: 'markdown_heading',
    headingLevel: 3,
  })

  const englishRoman = '# Book\n## Chapter I\nText\n## Chapter II\nText\n## Chapter III\nText'
  assert.deepEqual(detectStorySplit(englishRoman), { strategy: 'story_chapter' })
})

test('Chinese heading gaps are reported without inventing a boundary', async () => {
  const content = '# 书名\n### 开端一\n正文\n### 转折三\n正文'
  const plan = await buildStoryImportPlan({ content, title: '缺章书', originalName: '缺章书.epub' })
  assert.equal(plan.split.nodes.filter(node => node.order > 0).length, 2)
  assert.match(plan.split.warnings.join('\n'), /缺少编号：2/)
  assert.equal(plan.split.requiresReview, true)
})

test('one import builds all 33 physical nodes even when source labels repeat or jump', async () => {
  const labels = Array.from({ length: 33 }, (_, index) =>
    index === 1 ? '1' : index === 20 ? '85' : String(index + 1),
  )
  const content = labels.map((label, index) => `${label}.\n张三进城${index + 1}。`).join('\n')
  const plan = await buildStoryImportPlan({
    content,
    title: '三十三节点',
    originalName: '三十三节点.md',
  })
  const state = memoryFiles()
  await applyStoryImportPlan(plan, content, state.files, 'project', { acceptWarnings: true })

  assert.equal(plan.split.nodes.length, 33)
  assert.deepEqual(
    plan.split.nodes.map(node => node.path.split('/').at(-1)),
    Array.from(
      { length: 33 },
      (_, index) => `${String(index + 1).padStart(4, '0')}_张三进城${index + 1}.md`,
    ),
  )
  assert.equal(plan.split.nodes[1]?.sourceLabel, '1.')
  assert.equal(plan.split.nodes[20]?.sourceLabel, '85.')
  assert.match(
    state.entries.get(`${plan.workDirectory}/原文节点/index.md`)?.content || '',
    /\[\[0033_张三进城33\|33\. 张三进城33\]\]/,
  )
  assert.equal(state.writes.at(-1), plan.completionPath)
})

test('automatic detection stops when similarly strong rules would cut at different lines', () => {
  assert.throws(
    () => detectStorySplit('第一章\n甲\n1.\n乙\n第二章\n丙\n2.\n丁'),
    /多种接近但切片位置不同/,
  )
  assert.deepEqual(detectStorySplit('# 第一章\n甲\n# 第二章\n乙'), {
    strategy: 'story_chapter',
  })
})

test('missing numeric labels require an explicit warning confirmation', async () => {
  const content = '1\n甲\n2.\n乙\n4、\n丁'
  const plan = await buildStoryImportPlan({
    content,
    title: '缺号故事',
    originalName: '缺号故事.txt',
  })
  const state = memoryFiles()
  assert.equal(plan.split.requiresReview, true)
  assert.match(plan.split.warnings.join('\n'), /缺少编号：3/)
  await assert.rejects(
    () => applyStoryImportPlan(plan, content, state.files, 'project'),
    /需要确认/,
  )
  assert.equal(state.writes.length, 0)
  await applyStoryImportPlan(plan, content, state.files, 'project', { acceptWarnings: true })
  assert.equal(state.writes.at(-1), plan.completionPath)
})

test('story import preflights conflicts before writing and never marks a partial import complete', async () => {
  const content = '第一章\n正文\n第二章\n正文'
  const plan = await buildStoryImportPlan({
    content,
    title: '冲突故事',
    originalName: '冲突故事.md',
  })
  const conflictPath = plan.split.nodes[0]!.path
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n', [conflictPath]: '用户内容' })

  await assert.rejects(
    () => applyStoryImportPlan(plan, content, state.files, 'project'),
    /目标文件冲突/,
  )
  assert.equal(state.writes.length, 0)
  assert.equal(state.entries.has(plan.completionPath), false)
})

test('story import stops when a node number already carries a different name', async () => {
  const content = '第一章\n刘备走进桃园。\n第二章\n张飞端来酒碗。'
  const plan = await buildStoryImportPlan({
    content,
    title: '换名故事',
    originalName: '换名故事.md',
  })
  assert.equal(plan.split.nodes[0]!.path.endsWith('/0001_刘备走进桃园.md'), true)

  const renamed = memoryFiles({
    'wiki/index.md': '# Wiki\n',
    [`${plan.workDirectory}/原文节点/0001_旧名.md`]: '上一版内容',
  })
  await assert.rejects(
    () => applyStoryImportPlan(plan, content, renamed.files, 'project'),
    /同一序号已有不同名称的节点文件/,
  )
  assert.equal(renamed.writes.length, 0)

  const legacy = memoryFiles({
    'wiki/index.md': '# Wiki\n',
    [`${plan.workDirectory}/原文节点/0001.md`]: '旧版纯编号内容',
  })
  await assert.rejects(
    () => applyStoryImportPlan(plan, content, legacy.files, 'project'),
    /同一序号已有不同名称的节点文件/,
  )
  assert.equal(legacy.writes.length, 0)
})

test('story imports for one project serialize and the queued duplicate becomes a no-op', async () => {
  const content = '第一章\n甲\n第二章\n乙'
  const plan = await buildStoryImportPlan({
    content,
    title: '并发故事',
    originalName: '并发故事.md',
  })
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n' })
  const originalCreate = state.files.createText.bind(state.files)
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let firstCreateStarted!: () => void
  const started = new Promise<void>(resolve => {
    firstCreateStarted = resolve
  })
  let createCalls = 0
  state.files.createText = async (...args) => {
    createCalls += 1
    if (createCalls === 1) {
      firstCreateStarted()
      await gate
    }
    return await originalCreate(...args)
  }

  const first = applyStoryImportPlan(plan, content, state.files, 'project')
  await started
  const second = applyStoryImportPlan(plan, content, state.files, 'project')
  await Promise.resolve()
  assert.equal(createCalls, 1)
  release()
  const [, repeated] = await Promise.all([first, second])
  assert.equal(repeated.created, 0)
  assert.equal(repeated.updated, 0)
})

test('story import resumes after interruption and writes the completion marker last', async () => {
  const content = '第一章\n甲\n第二章\n乙'
  const plan = await buildStoryImportPlan({
    content,
    title: '续跑故事',
    originalName: '续跑故事.md',
  })
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n' })
  const originalCreate = state.files.createText.bind(state.files)
  const interruptedPath = plan.split.nodes[1]!.path
  let interrupt = true
  state.files.createText = async (...args) => {
    if (interrupt && args[1] === interruptedPath) {
      interrupt = false
      throw new Error('模拟中断')
    }
    return await originalCreate(...args)
  }

  await assert.rejects(
    () => applyStoryImportPlan(plan, content, state.files, 'project'),
    /模拟中断/,
  )
  assert.equal(state.entries.has(plan.completionPath), false)
  await applyStoryImportPlan(plan, content, state.files, 'project')
  assert.equal(state.writes.at(-1), plan.completionPath)
  assert.match(state.entries.get(plan.completionPath)?.content || '', /import_status: complete/)
})
