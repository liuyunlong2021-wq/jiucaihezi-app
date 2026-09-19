import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProjectFileService } from '@/services/projectFileService'
import type { ProjectResource } from '@/utils/projectResource'
import {
  applyStoryImportPlan,
  buildStoryImportPlan,
  detectStorySplit,
  inferStoryIdentity,
  parseStoryOrdinal,
  upsertWikiIndex,
} from '../storyImport'
import { normalizeStoryMarker, probeStoryMarker } from '../markdownSplit'

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

test('自定义标记词按前缀式拆 SC 分场，短名剥掉标记', async () => {
  const content = [
    'SC01 雨夜追踪',
    '甲走了。',
    'SC02 清晨',
    '乙来了。',
    'SC03 黄昏',
    '丙回来了。',
  ].join('\n')
  assert.deepEqual(detectStorySplit(content, { marker: 'SC' }), {
    strategy: 'story_custom',
    marker: 'SC',
    markerShape: 'prefix',
  })
  const plan = await buildStoryImportPlan({
    content,
    title: '分场剧本',
    originalName: '分场剧本.txt',
    marker: 'SC01',
  })
  assert.equal(plan.split.nodes[0]?.path.endsWith('/0001_雨夜追踪.md'), true)
  assert.equal(plan.split.nodes[2]?.path.endsWith('/0003_黄昏.md'), true)
  // 标记词进 optionKey：换规则必须换 plan id，否则续跑会把两次拆分认成同一次。
  const auto = await buildStoryImportPlan({
    content,
    title: '分场剧本',
    originalName: '分场剧本.txt',
  })
  assert.equal(auto.split.strategy, 'story_chapter')
  assert.notEqual(auto.split.id, plan.split.id)
})

test('自定义标记词退回后缀式，正文里的“1场大雨”不算边界', async () => {
  const content = [
    '第一场 雨夜',
    '甲走了。',
    '1场大雨下了整夜。',
    '第二场 清晨',
    '乙来了。',
    '第三场 黄昏',
    '丙回来了。',
  ].join('\n')
  assert.deepEqual(detectStorySplit(content, { marker: '场' }), {
    strategy: 'story_custom',
    marker: '场',
    markerShape: 'suffix',
  })
  const plan = await buildStoryImportPlan({
    content,
    title: '场次剧本',
    originalName: '场次剧本.md',
    marker: '场',
  })
  assert.equal(plan.split.nodes.length, 3)
  assert.equal(plan.split.nodes[0]?.path.endsWith('/0001_雨夜.md'), true)
  assert.match(plan.split.nodes[0]!.source, /1场大雨下了整夜。/)
})

test('白名单认下常见缩写与场次，整段抄标题的标记词也认', () => {
  assert.deepEqual(detectStorySplit('第一场 雨夜\n正文\n第二场 清晨\n正文'), {
    strategy: 'story_chapter',
  })
  assert.deepEqual(detectStorySplit('SC01 雨夜\n正文\nSC02 清晨\n正文'), {
    strategy: 'story_chapter',
  })
  assert.equal(normalizeStoryMarker('SC'), 'SC')
  assert.equal(normalizeStoryMarker('SC01'), 'SC')
  assert.equal(normalizeStoryMarker('SC-01'), 'SC')
  assert.equal(normalizeStoryMarker('第一场'), '场')
  assert.equal(normalizeStoryMarker('第1场'), '场')
  assert.equal(normalizeStoryMarker('01'), '')
  assert.deepEqual(probeStoryMarker('SC01 雨夜\n正文\nSC02 清晨', 'SC'), {
    marker: 'SC',
    shape: 'prefix',
    count: 2,
    firstLine: 'SC01 雨夜',
  })
})

test('缩写前缀不会把 Sci-fi 这类正文行当成边界', () => {
  const content = ['Sci-fi 的设定', '没错。', '1场大雨下了整夜。', '还是雨。'].join('\n')
  assert.throws(() => detectStorySplit(content), /没有识别到故事边界/)
  assert.equal(probeStoryMarker(content, 'S'), null)
  assert.throws(() => detectStorySplit(content, { marker: 'SC' }), /没有识别到「SC」的拆分边界/)
})

test('story import recognizes AnyDoc bold-wrapped Word episode headings', async () => {
  const content = [
    '**## 一、项目信息**',
    '前置资料',
    '**### 1. 江晚（女主）**',
    '人物资料',
    '**### 2. 傅行止（男主）**',
    '人物资料',
    '**### 3. 系统999**',
    '人物资料',
    '**### 4. 温予棠**',
    '人物资料',
    '**## 第一集 下错药的一夜**',
    '江晚在失重的昏眩里睁眼。',
    '**---**',
    '**## 第二集 疯批医生**',
    '江晚瘫坐在地。',
    '**## 第三集 我死了，就挺突然**',
    '光屏亮起。',
  ].join('\n')

  assert.deepEqual(detectStorySplit(content), { strategy: 'story_chapter' })
  const plan = await buildStoryImportPlan({
    content,
    title: '钓系恶女攻略疯批的正确姿势',
    originalName: '钓系恶女攻略疯批的正确姿势.docx',
  })
  assert.deepEqual(
    plan.split.nodes.filter(node => node.order > 0).map(node => node.title),
    ['第一集 下错药的一夜', '第二集 疯批医生', '第三集 我死了，就挺突然'],
  )
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

test('前置内容与章节共用一个页面小节', async () => {
  const content = '题记\n第一章 雨夜\n甲走了很久。\n第二章 清晨\n乙来了。'
  const plan = await buildStoryImportPlan({ content, title: '前置内容', originalName: '前置内容.md' })
  const index = plan.split.writes.find(write => write.path.endsWith('原文节点/index.md'))!.content

  // 分两次 push「## 页面」会在有前置内容时写出两个同名标题：章节导航被劈成两段。
  assert.equal((index.match(/^## 页面$/gm) || []).length, 1)
  assert.ok(index.indexOf('[[0000|') < index.indexOf('[[0001_'))
  assert.ok(index.indexOf('[[0001_') < index.indexOf('[[0002_'))
})

test('故事名与作者先从原文标题和文件名推断', () => {
  assert.deepEqual(inferStoryIdentity('# 召唤万岁\n\n正文', '召唤万岁(霞飞双颊).epub'), {
    title: '召唤万岁',
    author: '霞飞双颊',
  })
  // 转换产物没有一级标题时退回文件名，并照样拆出作者
  assert.deepEqual(inferStoryIdentity('正文', '兽血沸腾（静官）.epub'), {
    title: '兽血沸腾',
    author: '静官',
  })
  // 下载器另外两种常见写法：带《》和「作者：」，以及 `书名 - 作者`
  assert.deepEqual(inferStoryIdentity('正文', '《赘婿》作者：愤怒的香蕉.epub'), {
    title: '赘婿',
    author: '愤怒的香蕉',
  })
  assert.deepEqual(inferStoryIdentity('正文', '十日终焉 - 杀虫队队员.txt'), {
    title: '十日终焉',
    author: '杀虫队队员',
  })
  // 破折号后面是卷册不是作者；纯书名不留作者
  assert.deepEqual(inferStoryIdentity('正文', '斗破苍穹 - 第1卷.txt'), {
    title: '斗破苍穹 - 第1卷',
    author: '',
  })
  assert.deepEqual(inferStoryIdentity('正文', '三结义.md'), { title: '三结义', author: '' })
})

test('作者写进来源记录，空作者不留空字段', async () => {
  const withAuthor = await buildStoryImportPlan({
    content: '# 召唤万岁\n\n## 第一章 穿越\n甲走了很久。\n## 第二章 醒来\n乙来了。',
    title: '召唤万岁',
    author: '霞飞双颊',
    originalName: '召唤万岁(霞飞双颊).epub',
    marker: '章',
  })
  assert.match(withAuthor.completionContent, /author: "霞飞双颊"/)
  assert.match(withAuthor.completionContent, /- 作者：霞飞双颊/)

  const withoutAuthor = await buildStoryImportPlan({
    content: '题记\n第一章\n甲',
    title: '无作者书',
    originalName: '无作者书.md',
  })
  assert.doesNotMatch(withoutAuthor.completionContent, /author:/)
})

test('追加章节后重导：老节点跳过、新节点创建、原文与来源记录刷新', async () => {
  const first = '题记\n第一章 雨夜\n甲走了很久。\n第二章 清晨\n乙来了。'
  const plan = await buildStoryImportPlan({
    content: first,
    title: '追加书',
    originalName: '追加书.md',
  })
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n' })
  await applyStoryImportPlan(plan, first, state.files, 'project', { acceptWarnings: true })

  const grown = `${first}\n第三章 黄昏\n丙回来了。`
  const grownPlan = await buildStoryImportPlan({
    content: grown,
    title: '追加书',
    originalName: '追加书.md',
  })
  const result = await applyStoryImportPlan(grownPlan, grown, state.files, 'project', {
    acceptWarnings: true,
  })

  // 老节点内容没变 → 跳过；新章节建新节点
  assert.ok(result.created > 0)
  assert.equal(state.entries.has('wiki/原始材料/追加书/原文节点/0003_黄昏.md'), true)
  // 原文.md 与 来源.md 是本次导入生成的记录，允许刷新（旧代码在这里抛「目标文件冲突」）
  assert.match(state.entries.get('wiki/原始材料/追加书/原文.md')!.content, /第三章 黄昏/)
  assert.match(
    state.entries.get('wiki/原始材料/追加书/来源.md')!.content,
    /node_count: 4/,
  )
})

test('改稿被挡，用户写在生成块之后的笔记保留', async () => {
  const content = '题记\n第一章 雨夜\n甲走了很久。'
  const plan = await buildStoryImportPlan({
    content,
    title: '改稿书',
    originalName: '改稿书.md',
  })
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n' })
  await applyStoryImportPlan(plan, content, state.files, 'project', { acceptWarnings: true })

  // 非追加的改稿：新内容不是旧内容的开头 → 仍然停下
  const rewritten = '序\n第一章 雨夜\n甲走了很久，但又不同。'
  const rewrittenPlan = await buildStoryImportPlan({
    content: rewritten,
    title: '改稿书',
    originalName: '改稿书.md',
  })
  await assert.rejects(
    () => applyStoryImportPlan(rewrittenPlan, rewritten, state.files, 'project', { acceptWarnings: true }),
    /目标文件冲突/,
  )

  // 用户写在生成块之后的笔记：重导时刷新记录，但笔记必须还在
  const record = state.entries.get('wiki/原始材料/改稿书/来源.md')!
  record.content = `${record.content}\n## 我的笔记\n别删这段。\n`
  const appended = `${content}\n第二章 清晨\n乙来了很久。`
  const appendedPlan = await buildStoryImportPlan({
    content: appended,
    title: '改稿书',
    originalName: '改稿书.md',
  })
  await applyStoryImportPlan(appendedPlan, appended, state.files, 'project', { acceptWarnings: true })

  const refreshed = state.entries.get('wiki/原始材料/改稿书/来源.md')!.content
  assert.match(refreshed, /node_count: 3/)
  assert.match(refreshed, /## 我的笔记\n别删这段。/)
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
