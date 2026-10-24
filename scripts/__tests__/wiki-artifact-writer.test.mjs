import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createWikiArtifactTool, setWikiSourceContent } from '../../src-tauri/resources/deepseek-harness/manju-wiki.mjs'

function createHarness(root, { beforeWrite, route = 'none' } = {}) {
  const files = new Map()
  let version = 0
  const absolute = path => path.startsWith(root) ? path : join(root, path)
  const directories = () => {
    const values = new Set([root])
    for (const path of files.keys()) {
      let parent = dirname(path)
      while (parent.startsWith(root)) {
        values.add(parent)
        if (parent === root) break
        parent = dirname(parent)
      }
    }
    return values
  }
  const fs = {
    sandboxMode: undefined,
    async resolve(path) { return absolute(path) },
    contains(parent, child) {
      const value = relative(parent, child)
      return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep))
    },
    async lstat(path) {
      const target = absolute(path)
      if (files.has(target)) return { type: 'file' }
      if (directories().has(target)) return { type: 'directory' }
      return undefined
    },
    async stat(path) {
      const target = absolute(path)
      const file = files.get(target)
      if (file) return { type: 'file', version: file.version }
      if (directories().has(target)) return { type: 'directory', version: 0 }
      return undefined
    },
    async listDir(path) {
      const target = absolute(path)
      const children = new Map()
      for (const child of directories()) {
        if (dirname(child) === target) children.set(child, { name: child.slice(target.length + 1), type: 'directory' })
      }
      for (const child of files.keys()) {
        if (dirname(child) === target) children.set(child, { name: child.slice(target.length + 1), type: 'file' })
      }
      return [...children.values()]
    },
    async readText(path) {
      const file = files.get(absolute(path))
      if (!file) throw new Error('missing')
      return file.content
    },
    async writeText(path, content, expected) {
      const target = absolute(path)
      await beforeWrite?.(target, content)
      const before = files.get(target)
      if (expected?.kind === 'createIfAbsent' && before) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
      if (expected?.kind === 'replaceIfVersion' && (!before || before.version !== expected.version))
        throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
      version += 1
      files.set(target, { content, version })
      return { operation: before ? 'update' : 'create', version }
    },
  }
  const ctx = {
    fs,
    tools: { register() { return () => {} } },
    get() { return undefined },
    emit() {},
    async waterfall(_event, _target, _exec, fallback) { return fallback() },
  }
  const contract = JSON.parse(readFileSync('public/skills/wiki-artifacts.json', 'utf8'))
  const sourceAgent = {}
  const tool = createWikiArtifactTool(ctx, contract, sourceAgent, route)
  const exec = { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal }
  return { tool, exec, files, sourceAgent }
}

test('one shared writer archives Manju artifacts and updates the project indexes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-writer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root)
  const result = await tool.execute({ artifact_kind: 'screenplay', episode_number: 1, content: '# 第一集\n\n正文' }, exec)

  assert.equal(result.status, 'saved')
  assert.equal(result.path, 'wiki/剧本/第001集/分集剧本.md')
  assert.match(files.get(join(root, result.path)).content, /正文/)
  assert.match(files.get(join(root, 'wiki/index.md')).content, /\[\[剧本\/index\|剧本\]\]/)
  assert.match(files.get(join(root, 'wiki/剧本/index.md')).content, /\[\[第001集\/index\|第001集\]\]/)
  assert.match(files.get(join(root, 'wiki/剧本/第001集/index.md')).content, /\[\[分集剧本\|第001集分集剧本\]\]/)
})

test('the repository development knowledge base is excluded when selecting a creative Wiki root', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-root-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root)
  files.set(join(root, 'docs/wiki/index.md'), { content: '# Development Wiki\n', version: 1 })
  files.set(join(root, 'docs/wiki/CLAUDE.md'), { content: '# 通用记忆工作台开发文档\n', version: 1 })
  files.set(join(root, 'docs/wiki/开发/开发历史.md'), { content: '# History\n', version: 1 })

  const result = await tool.execute({ artifact_kind: 'novel_outline', content: '# 大纲\n\n主角追查一场失踪。' }, exec)
  assert.equal(result.path, 'wiki/创作/大纲.md')
  assert.ok(files.has(join(root, 'wiki/index.md')))
  assert.equal(files.has(join(root, 'docs/wiki/创作/大纲.md')), false)
})

test('shared artifact mappings place preparation, scripts, assets and novel plans in fixed paths', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-mapping-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec } = createHarness(root)
  const cases = [
    ['story_summary', {}, 'wiki/项目资料/故事梗概.md'],
    ['episode_summaries', {}, 'wiki/项目资料/分集梗概.md'],
    ['story_background', {}, 'wiki/项目资料/故事背景.md'],
    ['world_rules', {}, 'wiki/项目资料/世界规则.md'],
    ['character_bio', { entity_name: '林舟' }, 'wiki/项目资料/人物小传/林舟.md'],
    ['project_overview', {}, 'wiki/改编方案/项目总纲.md'],
    ['screenplay', { episode_number: 3 }, 'wiki/剧本/第003集/分集剧本.md'],
    ['engineering_script', { episode_number: 3 }, 'wiki/剧本/第003集/工程剧本.md'],
    ['video_prompt', { episode_number: 3, video_model: 'H3', segment: '片段001-003' }, 'wiki/剧本/第003集/视频提示词/H3/片段001-003.md'],
    ['storyboard_prompt', { episode_number: 3, video_model: 'H3', segment: '镜头001-004' }, 'wiki/剧本/第003集/分镜提示词/H3/镜头001-004.md'],
    ['storyboard_prompt', { episode_number: 3, video_model: 'Seedance', segment: '镜头001-009' }, 'wiki/剧本/第003集/分镜提示词/Seedance/镜头001-009.md'],
    ['character_voice', { entity_name: '林舟' }, 'wiki/资产/声音/林舟.md'],
    ['sound_direction', { episode_number: 3, segment: '全篇' }, 'wiki/剧本/第003集/声音导演/全篇.md'],
    ['character_asset', { entity_name: '林舟' }, 'wiki/资产/角色/林舟.md'],
    ['scene_asset', { entity_name: '旧站台' }, 'wiki/资产/场景/旧站台.md'],
    ['prop_asset', { entity_name: '车票' }, 'wiki/资产/道具/车票.md'],
    ['novel_idea', {}, 'wiki/创作/灵感方案.md'],
    ['novel_market_analysis', {}, 'wiki/创作/市场分析.md'],
    ['novel_core_premise', {}, 'wiki/创作/核心梗.md'],
    ['novel_world_setting', {}, 'wiki/创作/世界设定.md'],
    ['novel_outline', {}, 'wiki/创作/大纲.md'],
    ['novel_chapter_outline', {}, 'wiki/创作/章纲.md'],
    ['novel_foreshadow', {}, 'wiki/创作/伏笔.md'],
    ['novel_packaging', {}, 'wiki/创作/文案包装.md'],
    ['novel_manuscript_review', {}, 'wiki/创作/全稿复盘.md'],
    ['novel_character', { entity_name: '沈岚' }, 'wiki/资产/角色/沈岚.md'],
    ['novel_scene', { entity_name: '海边' }, 'wiki/资产/场景/海边.md'],
    ['novel_prop', { entity_name: '钥匙' }, 'wiki/资产/道具/钥匙.md'],
  ]

  for (const [artifact_kind, fields, expectedPath] of cases) {
    const result = await tool.execute({ artifact_kind, ...fields, content: `# ${artifact_kind}\n\n正文。` }, exec)
    assert.equal(result.path, expectedPath, artifact_kind)
    assert.equal(result.status, 'saved', artifact_kind)
  }
})

test('writer rejects two recognized project Wiki roots instead of mixing them', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-multiple-roots-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root)
  files.set(join(root, 'wiki/index.md'), { content: '# Wiki A\n', version: 1 })
  files.set(join(root, 'docs/wiki/index.md'), { content: '# Wiki B\n', version: 1 })

  await assert.rejects(
    tool.execute({ artifact_kind: 'novel_outline', content: '# 大纲\n\n正文。' }, exec),
    /检测到多个 Wiki 根目录/,
  )
  assert.equal(files.has(join(root, 'wiki/创作/大纲.md')), false)
})

test('index links carry concise summaries and refresh them when a page is updated', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-summary-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root)
  const path = 'wiki/创作/index.md'
  await tool.execute({ artifact_kind: 'novel_outline', content: '# 大纲\n\n故事从一场失踪开始。', summary: '主角追查一场失踪事件。' }, exec)
  assert.match(files.get(join(root, path)).content, /主角追查一场失踪事件。/)
  await tool.execute({ artifact_kind: 'novel_outline', content: '# 大纲\n\n故事从一次背叛开始。', summary: '主角发现盟友背叛。', write_mode: 'update' }, exec)
  const index = files.get(join(root, path)).content
  assert.match(index, /主角发现盟友背叛。/)
  assert.doesNotMatch(index, /主角追查一场失踪事件。/)
  assert.equal(index.match(/\[\[大纲\|全书大纲\]\]/g)?.length, 1)
})

test('novel chapter is saved as a draft first and only appends after an exact confirmed match', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-novel-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'novel' })
  const base = { work_name: '星海', chapter_number: 1, chapter_title: '归来' }
  const body = '凌晨三点，林舟推开了旧站台的门。'
  const draft = await tool.execute({ ...base, artifact_kind: 'novel_chapter_draft', content: body }, exec)

  assert.equal(draft.path, 'wiki/创作/章节草稿/星海/第001章.md')
  assert.equal(draft.status, 'saved')
  assert.ok(files.has(join(root, 'wiki/创作/章节草稿/星海/index.md')))
  assert.equal(files.get(join(root, draft.path)).content, `# 第001章 归来\n\n${body}\n`)
  await assert.rejects(tool.execute({ ...base, artifact_kind: 'novel_chapter_source', content: body }, exec), /用户明确确认/)
  await assert.rejects(tool.execute({ ...base, artifact_kind: 'novel_chapter_source', content: `${body} 后续` , user_confirmed: true }, exec), /草稿不一致/)

  const sourceArgs = { ...base, artifact_kind: 'novel_chapter_source', content: body, user_confirmed: true }
  const source = await tool.execute(sourceArgs, exec)
  assert.equal(source.path, 'wiki/原始材料/星海/原文.md')
  assert.match(files.get(join(root, source.path)).content, /# 第001章 归来/)
  const confirmation = files.get(join(root, draft.path)).content
  assert.match(confirmation, /状态：已由用户确认并追加到原文/)
  assert.match(confirmation, /草稿 SHA-256：[a-f0-9]{64}/)
  assert.match(confirmation, /\[\[\.\.\/\.\.\/\.\.\/原始材料\/星海\/原文\|已确认正文\]\]/)
  assert.doesNotMatch(confirmation, /凌晨三点，林舟推开了旧站台的门。/)
  const draftIndex = files.get(join(root, 'wiki/创作/章节草稿/星海/index.md')).content
  assert.match(draftIndex, /星海 第001章确认记录/)
  assert.doesNotMatch(draftIndex, /星海 第001章草稿/)
  assert.match(draftIndex, /已确认：第001章正文/)
  assert.equal((await tool.execute(sourceArgs, exec)).operation, 'unchanged')

  const changed = await tool.execute({
    ...base,
    artifact_kind: 'novel_chapter_draft',
    write_mode: 'update',
    content: '改写后的章节内容。',
  }, exec)
  assert.equal(changed.operation, 'updated')
  await assert.rejects(tool.execute({
    ...base,
    artifact_kind: 'novel_chapter_source',
    content: '改写后的章节内容。',
    user_confirmed: true,
  }, exec), /原文已存在不同内容/)
})

test('chapter confirmation conversion can recover after the source was appended', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-wiki-novel-retry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const draftPath = join(root, 'wiki/创作/章节草稿/星海/第001章.md')
  let failConversion = false
  const { tool, exec, files } = createHarness(root, {
    beforeWrite(path, content) {
      if (failConversion && path === draftPath && content.includes('已由用户确认并追加到原文')) {
        failConversion = false
        throw new Error('simulated draft update failure')
      }
    },
  })
  const base = { work_name: '星海', chapter_number: 1, chapter_title: '归来' }
  const content = '凌晨三点，林舟推开了旧站台的门。'
  await tool.execute({ ...base, artifact_kind: 'novel_chapter_draft', content }, exec)
  failConversion = true

  const args = { ...base, artifact_kind: 'novel_chapter_source', content, user_confirmed: true }
  const first = await tool.execute(args, exec)
  assert.equal(first.status, 'saved_with_warnings')
  assert.match(first.warnings.join('\n'), /原文已保存，但章节确认记录未完成转换/)
  assert.equal(files.get(draftPath).content, `# 第001章 归来\n\n${content}\n`)
  assert.equal(files.get(join(root, first.path)).content.match(/# 第001章 归来/g)?.length, 1)

  const retry = await tool.execute(args, exec)
  assert.equal(retry.status, 'saved')
  assert.equal(retry.operation, 'unchanged')
  assert.match(files.get(draftPath).content, /已由用户确认并追加到原文/)
  assert.equal(files.get(join(root, retry.path)).content.match(/# 第001章 归来/g)?.length, 1)
})


test('original and adapted research stay separate and legacy paths remain unchanged', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-research-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root)
  const base = { artifact_kind: 'character_bio', entity_name: '林舟' }
  const legacy = await tool.execute({ ...base, content: '旧资料' }, exec)
  const original = await tool.execute({ ...base, content: '原作人物', research_version: 'original' }, exec)
  const adapted = await tool.execute({ ...base, content: '新版人物', research_version: 'adapted' }, exec)
  assert.equal(legacy.path, 'wiki/项目资料/人物小传/林舟.md')
  assert.equal(original.path, 'wiki/项目资料/原作/人物小传/林舟.md')
  assert.equal(adapted.path, 'wiki/项目资料/改编版/人物小传/林舟.md')
  assert.match(files.get(join(root, original.path)).content, /原作人物/)
  assert.match(files.get(join(root, 'wiki/项目资料/改编版/index.md')).content, /人物小传/)
  for (const artifact_kind of ['scene_research', 'prop_research', 'event_timeline']) {
    const result = await tool.execute({ artifact_kind, entity_name: '圣剑', research_version: 'adapted', content: '剧情功能与规则' }, exec)
    assert.equal(result.status, 'saved')
    assert.ok(result.path.startsWith('wiki/项目资料/改编版/'))
  }
  const plan = await tool.execute({ artifact_kind: 'adaptation_episode_plan', content: '分集规划' }, exec)
  assert.equal(plan.path, 'wiki/改编方案/分集规划.md')
  await assert.rejects(tool.execute({ ...base, content: '坏版本', research_version: '../外部' }, exec), /research_version/)
  await assert.rejects(tool.execute({ artifact_kind: 'screenplay', episode_number: 1, content: '正文', research_version: 'adapted' }, exec), /research_version/)
})


test('long pasted source is sliced verbatim from the current turn, never from model content', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pasted-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files, sourceAgent } = createHarness(root)
  const beginning = '第一章：山门前的少年拔出断剑。'
  const ending = '终章：他终于将圣剑放回神殿。'
  const original = beginning + '\r\n' + '云海翻涌，众人各有心事。\r\n'.repeat(5000) + ending
  setWikiSourceContent(sourceAgent, [{ type: 'text', text: '/jc-duanju\n请改编下面小说：\n' + original + '\n请先做项目资料。' }])
  const args = { artifact_kind: 'source_material', work_name: '云海', source_block: 0, source_start: beginning, source_end: ending, content: '模型伪造的正文' }
  const result = await tool.execute(args, exec)
  assert.equal(result.status, 'saved')
  assert.equal(files.get(join(root, result.path)).content, original)
  assert.match(files.get(join(root, 'wiki/原始材料/index.md')).content, /云海/)
  assert.equal((await tool.execute(args, exec)).operation, 'unchanged')
  await assert.rejects(tool.execute({ ...args, write_mode: 'update' }, exec), /不覆盖/)
  setWikiSourceContent(sourceAgent, [{ type: 'text', text: '下一轮只有继续，没有小说原文' }])
  await assert.rejects(tool.execute({ ...args, work_name: '第二本' }, exec), /来源首尾/)
  setWikiSourceContent(sourceAgent, [{ type: 'text', text: original + beginning }])
  await assert.rejects(tool.execute({ ...args, work_name: '歧义来源' }, exec), /不唯一/)
})


test('all 36 artifact contracts have explicit routes and every allowed kind saves with its restricted writer', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-route-artifacts-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const contract = JSON.parse(readFileSync('public/skills/wiki-artifacts.json', 'utf8'))
  assert.equal(Object.keys(contract.types).length, 36)
  const counts = { manju: 0, 'short-drama': 0, novel: 0 }
  for (const [kind, template] of Object.entries(contract.types)) {
    assert.ok(Array.isArray(template.production_routes) && template.production_routes.length)
    for (const route of Object.keys(counts)) {
      const { tool, exec, files, sourceAgent } = createHarness(join(root, route, kind), { route })
      if (!template.production_routes.includes(route)) {
        await assert.rejects(tool.execute({ artifact_kind: kind, content: 'forbidden' }, exec), /不属于当前创作路线|artifact_kind.*must be one of/)
        assert.equal(files.size, 0)
        continue
      }
      counts[route]++
      const args = { artifact_kind: kind, content: '# 正式产物\n\n回读验证正文。' }
      if (template.entity) args.entity_name = '角色甲'
      if (template.episode) args.episode_number = 1
      if (template.model) args.video_model = template.model[0]
      if (template.path.includes('{segment}')) args.segment = '片段001'
      if (template.mode === 'source_selection') {
        const text = '这是当前用户明确交付的完整原文材料，用于归档回读和索引验证。'
        setWikiSourceContent(sourceAgent, [{ type: 'text', text }])
        Object.assign(args, { work_name: '测试作品', source_block: 0, source_start: text.slice(0, 12), source_end: text.slice(-12) })
      }
      if (template.mode === 'chapter_source' || template.mode === 'chapter_draft') {
        Object.assign(args, { work_name: '测试作品', chapter_number: 1, chapter_title: '开篇' })
        if (template.mode === 'chapter_source') {
          await tool.execute({ ...args, artifact_kind: 'novel_chapter_draft' }, exec)
          args.user_confirmed = true
        }
      }
      const result = await tool.execute(args, exec)
      assert.equal(result.status, 'saved', `${route}/${kind}`)
      assert.ok(files.get(join(exec.agent.session.header.cwd, result.path))?.content.trim())
    }
  }
  assert.deepEqual(counts, { manju: 20, 'short-drama': 14, novel: 16 })
})
