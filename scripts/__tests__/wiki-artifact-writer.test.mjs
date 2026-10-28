import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createWikiArtifactTool, setWikiSourceContent, validateSeedanceReferences, resetWikiReads, recordWikiRead, dialogueSeconds, unitSeconds, planEventEpisodes, TIME_UNITS, TIER_FACTORS } from '../../src-tauri/resources/deepseek-harness/manju-wiki.mjs'

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

test('Manju precise layout separates film style, character image, format, voice and episode documents', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-manju-layout-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  for (const [args, expected] of [
    [{ artifact_kind: 'film_style' }, '项目风格/影片比例与风格.md'],
    [{ artifact_kind: 'character_asset', entity_name: '甲' }, '资产/角色/甲/角色生图提示词.md'],
    [{ artifact_kind: 'character_format', entity_name: '甲' }, '资产/角色/甲/角色生图格式提示词.md'],
    [{ artifact_kind: 'character_voice', entity_name: '甲' }, '资产/角色/甲/声音设计提示词.md'],
    [{ artifact_kind: 'scene_research', entity_name: '山门' }, '项目资料/场景说明/山门.md'],
    [{ artifact_kind: 'episode_source_script', episode_number: 1 }, '项目资料/分集剧本/第1集分集剧本.md'],
    [{ artifact_kind: 'engineering_script', episode_number: 1 }, '剧本/工程剧本/第1集工程剧本.md'],
    [{ artifact_kind: 'sound_direction', episode_number: 1 }, '剧本/声音剧本/第1集声音剧本.md'],
    [{ artifact_kind: 'video_prompt', episode_number: 1, video_model: 'Seedance', segment: '1' }, '剧本/视频提示词/Seedance/第1集001视频提示词.md'],
  ]) {
    const result = await tool.execute({ ...args, content: `# ${expected}` }, exec)
    assert.equal(result.path, `wiki/${expected}`)
    assert.equal(result.status, 'saved')
  }
  assert.ok(files.has(join(root, 'wiki/资产/角色/甲/index.md')))
  assert.ok(!files.has(join(root, 'wiki/剧本/第001集/index.md')))
})

test('Manju keeps an existing legacy artifact at its original path instead of silently duplicating it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-manju-legacy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, 'wiki/index.md'), { content: '# Wiki\n', version: 0 })
  files.set(join(root, 'wiki/资产/角色/甲.md'), { content: '# 旧角色', version: 1 })
  const result = await tool.execute({ artifact_kind: 'character_asset', entity_name: '甲', content: '# 修订旧角色' }, exec)
  assert.equal(result.path, 'wiki/资产/角色/甲.md')
  assert.ok(!files.has(join(root, 'wiki/资产/角色/甲/角色生图提示词.md')))
})

test('pipeline checkpoints reject missing stages and overlong segments, then complete with verified files', async t => {
  for (const model of ['H3', 'Seedance']) {
    const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-check-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const { tool, exec, files } = createHarness(root, { route: 'manju' })
    files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
    const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: model, episode_number: 1, content: JSON.stringify(input) }, exec)
    await assert.rejects(checkpoint({ stage: 'complete', outputs: [] }), /前置阶段/)
    const progress = await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] })
    const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
    const summary = await save({ artifact_kind: 'story_summary' }, '# 故事梗概\n主角归来')
    await checkpoint({ stage: 'materials', outputs: [summary] })
    const style = await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：9:16\n视觉风格：二维')
    await checkpoint({ stage: 'style', outputs: [style] })
    const asset = await save({ artifact_kind: 'scene_asset', entity_name: '山门' }, '# 山门提示词')
    await checkpoint({ stage: 'assets', outputs: [asset] })
    const engineering = await save({ artifact_kind: 'engineering_script', episode_number: 1 }, '# 工程剧本\n比例：9:16\n资产清单：山门\n镜头1')
    const limit = 30
    await checkpoint({ stage: 'engineering', outputs: [engineering], duration_seconds: limit + 1 })
    const first = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: model, segment: '001' }, model === 'H3' ? '# 第一段\n<Picture 1> is 山门.' : '# 第一段\n@图1：山门')
    await assert.rejects(checkpoint({ stage: 'prompts', outputs: [first], segments: [{ path: first, start_seconds: 0, end_seconds: limit + 1 }] }), /上限/)
    const second = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: model, segment: '002' }, model === 'H3' ? '# 第二段\n<Picture 1> is 山门.' : '# 第二段\n@图1：山门')
    const refs = { refs: ['场景/山门'] }
    await checkpoint({ stage: 'prompts', outputs: [first, second], segments: [
      { path: first, start_seconds: 0, end_seconds: limit, ...refs }, { path: second, start_seconds: limit, end_seconds: limit + 1, ...refs },
    ] })
    files.set(join(root, summary), { content: '# 被用户改过', version: 99 })
    await assert.rejects(checkpoint({ stage: 'complete', outputs: [] }), /前置产物已修改/)
    files.set(join(root, summary), { content: '# 故事梗概\n主角归来\n', version: 100 })
    await assert.rejects(checkpoint({ stage: 'complete', outputs: [], status: 'blocked', reason: '矛盾状态' }), /完成阶段不能同时标记暂停/)
    await checkpoint({ stage: 'complete', outputs: [] })
    assert.equal(JSON.parse(files.get(join(root, progress.path)).content).stage, 'complete')
    assert.equal(JSON.parse(files.get(join(root, progress.path)).content).status, 'completed')
  }
})

test('Seedance pipeline registers image assets and binds each segment @图 order to registered refs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-refs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'Seedance', episode_number: 1, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  const progress = await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：9:16')] })
  const portrait = await save({ artifact_kind: 'character_asset', entity_name: '莫甘娜' }, '# 莫甘娜生图')
  const sheet = await save({ artifact_kind: 'character_format', entity_name: '莫甘娜' }, '# 莫甘娜三视图')
  const voice = await save({ artifact_kind: 'character_voice', entity_name: '莫甘娜' }, '# 莫甘娜声音')
  const road = await save({ artifact_kind: 'scene_asset', entity_name: '石道' }, '# 石道')
  const crowd = await save({ artifact_kind: 'crowd_asset', entity_name: '太虚宗弟子' }, '# 太虚宗弟子群像')
  assert.equal(crowd, 'wiki/资产/人群/太虚宗弟子/群像生图提示词.md')
  await checkpoint({ stage: 'assets', outputs: [portrait, sheet, voice, road, crowd] })
  const registered = JSON.parse(files.get(join(root, progress.path)).content).assets
  assert.deepEqual(Object.keys(registered).sort(), ['人群/太虚宗弟子', '场景/石道', '角色/莫甘娜'])
  assert.equal(registered['人群/太虚宗弟子'].kind, 'crowd')
  assert.equal(registered['角色/莫甘娜'].prompt_path, sheet, '角色优先使用三视图格式提示词作为参考图')
  assert.equal(registered['角色/莫甘娜'].kind, 'character')
  assert.match(registered['场景/石道'].prompt_hash, /^[0-9a-f]{64}$/)
  await checkpoint({ stage: 'engineering', outputs: [await save({ artifact_kind: 'engineering_script', episode_number: 1 }, '# 工程剧本\n比例：9:16\n资产清单：莫甘娜、石道')], duration_seconds: 10 })
  const body = '基调。\n@图1：莫甘娜，银发。\n@图2：石道，右侧石壁。\n【全局设定】\n【时间戳剧本分镜】\n@图1在@图2\n【全局补充】'
  const first = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: 'Seedance', segment: '001' }, body)
  const prompts = refs => checkpoint({ stage: 'prompts', outputs: [first], segments: [{ path: first, start_seconds: 0, end_seconds: 10, ...(refs && { refs }) }] })
  await assert.rejects(prompts(), /refs/)
  await assert.rejects(prompts(['角色/莫甘娜']), /数量/)
  await assert.rejects(prompts(['场景/石道', '角色/莫甘娜']), /@图1.*莫甘娜|顺序/)
  await assert.rejects(prompts(['角色/莫甘娜', '道具/旧剑']), /未登记/)
  await prompts(['角色/莫甘娜', '场景/石道'])
  const saved = JSON.parse(files.get(join(root, progress.path)).content)
  assert.deepEqual(saved.segments[0].refs, ['角色/莫甘娜', '场景/石道'])
  await checkpoint({ stage: 'complete', outputs: [] })
  assert.deepEqual(Object.keys(JSON.parse(files.get(join(root, progress.path)).content).assets).sort(), ['人群/太虚宗弟子', '场景/石道', '角色/莫甘娜'])
  // 审片修改：完成后只能从 engineering 或 prompts 重开，资产登记沿用。
  await assert.rejects(checkpoint({ stage: 'assets', outputs: [portrait, sheet, voice, road, crowd] }), /跳过/)
  await checkpoint({ stage: 'engineering', status: 'running', outputs: ['wiki/剧本/工程剧本/第1集工程剧本.md'], duration_seconds: 10 })
  assert.equal(JSON.parse(files.get(join(root, progress.path)).content).stage, 'engineering')
  await prompts(['角色/莫甘娜', '场景/石道'])
  await checkpoint({ stage: 'complete', outputs: [] })
  await prompts(['角色/莫甘娜', '场景/石道'])
  assert.equal(Object.keys(JSON.parse(files.get(join(root, progress.path)).content).assets).length, 3)
})

test('costume looks register as their own character id, linked to the base identity and the costume', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-look-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'Seedance', episode_number: 12, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  const progress = await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：9:16')] })
  const base = await save({ artifact_kind: 'character_format', entity_name: '顾云舟' }, '# 顾云舟三格')
  const costume = await save({ artifact_kind: 'costume_asset', entity_name: '顾云舟·帝王' }, '# 帝王服装')
  assert.equal(costume, 'wiki/资产/角色/顾云舟·帝王/服装生图提示词.md')
  const look = await save({ artifact_kind: 'character_look', entity_name: '顾云舟·帝王' }, '# 融合\n以参考图1为人物身份，换上参考图2的服装。')
  assert.equal(look, 'wiki/资产/角色/顾云舟·帝王/角色造型融合提示词.md')
  await assert.rejects(checkpoint({ stage: 'assets', outputs: [base, look] }), /服装/)
  await checkpoint({ stage: 'assets', outputs: [base, costume, look] })
  const assets = JSON.parse(files.get(join(root, progress.path)).content).assets
  assert.deepEqual(Object.keys(assets).sort(), ['服装/顾云舟·帝王', '角色/顾云舟', '角色/顾云舟·帝王'])
  assert.equal(assets['服装/顾云舟·帝王'].kind, 'costume')
  assert.deepEqual({ kind: assets['角色/顾云舟·帝王'].kind, base: assets['角色/顾云舟·帝王'].base, costume: assets['角色/顾云舟·帝王'].costume },
    { kind: 'look', base: '角色/顾云舟', costume: '服装/顾云舟·帝王' })
})

test('H3 pipeline uses plan limits (28s, 6 images) and binds <Picture N> labels to registered refs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-h3-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'H3', episode_number: 1, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  await assert.rejects(checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [], limits: { max_seconds: 31, max_refs: 6 } }), /limits/)
  const progress = await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [], limits: { max_seconds: 28, max_refs: 6 } })
  assert.deepEqual(JSON.parse(files.get(join(root, progress.path)).content).limits, { max_seconds: 28, max_refs: 6 })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：9:16')] })
  const sheet = await save({ artifact_kind: 'character_format', entity_name: '莫甘娜' }, '# 莫甘娜三视图')
  const road = await save({ artifact_kind: 'scene_asset', entity_name: '石道' }, '# 石道')
  await checkpoint({ stage: 'assets', outputs: [sheet, road] })
  await checkpoint({ stage: 'engineering', outputs: [await save({ artifact_kind: 'engineering_script', episode_number: 1 }, '# 工程剧本\n比例：9:16\n资产清单：莫甘娜、石道')], duration_seconds: 28 })
  const body = 'subject_definitions\n<Subject 1> is 莫甘娜 from <Picture 1>, silver hair.\n<Picture 2> is the environment reference for 石道.\nsummary\n<Subject 1> walks along <Picture 2>.'
  const first = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: 'H3', segment: '001' }, body)
  const prompts = refs => checkpoint({ stage: 'prompts', outputs: [first], segments: [{ path: first, start_seconds: 0, end_seconds: 28, ...(refs && { refs }) }] })
  await assert.rejects(prompts(), /refs/)
  await assert.rejects(prompts(['场景/石道', '角色/莫甘娜']), /Picture 1/)
  await assert.rejects(prompts(['角色/莫甘娜']), /数量/)
  await prompts(['角色/莫甘娜', '场景/石道'])
})

test('plan max_refs caps the reference images of every segment', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-maxrefs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'Seedance', episode_number: 1, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [], limits: { max_seconds: 30, max_refs: 1 } })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：9:16')] })
  const sheet = await save({ artifact_kind: 'character_format', entity_name: '莫甘娜' }, '# 莫甘娜')
  const road = await save({ artifact_kind: 'scene_asset', entity_name: '石道' }, '# 石道')
  await checkpoint({ stage: 'assets', outputs: [sheet, road] })
  await checkpoint({ stage: 'engineering', outputs: [await save({ artifact_kind: 'engineering_script', episode_number: 1 }, '# 工程剧本\n比例：9:16\n资产清单：莫甘娜、石道')], duration_seconds: 10 })
  const first = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: 'Seedance', segment: '001' }, '基调。\n@图1：莫甘娜\n@图2：石道')
  await assert.rejects(checkpoint({ stage: 'prompts', outputs: [first], segments: [{ path: first, start_seconds: 0, end_seconds: 10, refs: ['角色/莫甘娜', '场景/石道'] }] }), /最多 1 张/)
})

test('pure text-to-video (max_refs 0) skips assets: empty assets stage, H3 T2VA segments with empty refs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-t2v-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'H3', episode_number: 2, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  const progress = await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [], limits: { max_seconds: 30, max_refs: 0 } })
  assert.deepEqual(JSON.parse(files.get(join(root, progress.path)).content).limits, { max_seconds: 30, max_refs: 0 })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：16:9')] })
  const tower = await save({ artifact_kind: 'scene_asset', entity_name: '木塔' }, '# 木塔')
  await assert.rejects(checkpoint({ stage: 'assets', outputs: [tower] }), /纯文生/)
  await checkpoint({ stage: 'assets', outputs: [] })
  await checkpoint({ stage: 'engineering', outputs: [await save({ artifact_kind: 'engineering_script', episode_number: 2 }, '# 工程剧本\n比例：16:9\n资产清单：无（纯文生）')], duration_seconds: 60 })
  const segment = async (n, body) => save({ artifact_kind: 'video_prompt', episode_number: 2, video_model: 'H3', segment: n }, body)
  const first = await segment('001', 'summary\nDawn mist over the wooden pagoda.')
  const second = await segment('002', 'summary\nCarpenters raise the octagonal base.')
  const prompts = refs => checkpoint({ stage: 'prompts', outputs: [first, second], segments: [
    { path: first, start_seconds: 0, end_seconds: 30, refs }, { path: second, start_seconds: 30, end_seconds: 60, refs: [] }] })
  await assert.rejects(prompts(['场景/木塔']), /最多 0 张/)
  await prompts([])
  await checkpoint({ stage: 'complete', outputs: [] })
  const saved = JSON.parse(files.get(join(root, progress.path)).content)
  assert.equal(saved.stage, 'complete')
  assert.deepEqual(saved.assets, {})
})

test('references are per segment: a Seedance episode mixes a segment with @图 refs and a pure text segment', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-mixed-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'Seedance', episode_number: 1, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [], limits: { max_seconds: 30, max_refs: 9 } })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：16:9')] })
  await checkpoint({ stage: 'assets', outputs: [await save({ artifact_kind: 'scene_asset', entity_name: '木塔' }, '# 木塔')] })
  await checkpoint({ stage: 'engineering', outputs: [await save({ artifact_kind: 'engineering_script', episode_number: 1 }, '# 工程剧本\n比例：16:9\n资产清单：木塔')], duration_seconds: 20 })
  const withTower = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: 'Seedance', segment: '001' },
    '纪录片开场。\n@图1：木塔，八角九层。\n【全局设定】\n【时间戳剧本分镜】\n晨雾中的@图1\n【全局补充】')
  const pureText = await save({ artifact_kind: 'video_prompt', episode_number: 1, video_model: 'Seedance', segment: '002' },
    '纪录片空镜。\n【全局设定】\n【时间戳剧本分镜】\n工匠刨木，木屑飞起\n【全局补充】')
  const prompts = refs => checkpoint({ stage: 'prompts', outputs: [withTower, pureText], segments: [
    { path: withTower, start_seconds: 0, end_seconds: 10, refs: ['场景/木塔'] }, { path: pureText, start_seconds: 10, end_seconds: 20, refs }] })
  await assert.rejects(prompts(['场景/木塔']), /数量/)
  await prompts([])
})

test('assets stage follows the project style list: assets marked 文字带过 cannot be registered', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-pipeline-advice-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'H3', episode_number: 1, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] })
  await checkpoint({ stage: 'materials', outputs: [await save({ artifact_kind: 'story_summary' }, '# 故事梗概')] })
  await checkpoint({ stage: 'style', outputs: [await save({ artifact_kind: 'film_style' },
    '制作路线：旁白宣传片\n画面比例：16:9\n参考图方式：按段决定（只有木塔需要跨段一致）\n资产名称：木塔\n资产类别：场景\n参考图：需要（6段都出现）\n资产名称：工匠\n资产类别：角色\n参考图：文字带过（群体）')] })
  const tower = await save({ artifact_kind: 'scene_asset', entity_name: '木塔' }, '# 木塔')
  const crowd = await save({ artifact_kind: 'crowd_asset', entity_name: '工匠' }, '# 工匠')
  await assert.rejects(checkpoint({ stage: 'assets', outputs: [tower, crowd] }), /工匠.*文字带过/)
  await checkpoint({ stage: 'assets', outputs: [tower] })
})

test('full-auto may write a character three-panel format prompt straight from the read bio, without a separate design prompt', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-format-from-bio-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files, sourceAgent } = createHarness(root, { route: 'manju' })
  sourceAgent.session = exec.agent.session
  resetWikiReads(sourceAgent)
  files.set(join(root, '剧本.md'), { content: '# 来源', version: 1 })
  const checkpoint = input => tool.execute({ artifact_kind: 'pipeline_checkpoint', video_model: 'Seedance', episode_number: 1, content: JSON.stringify(input) }, exec)
  const save = async (args, content) => (await tool.execute({ ...args, content }, exec)).path
  const read = path => recordWikiRead(sourceAgent, { targetKey: join(root, path) }, { kind: 'present', version: files.get(join(root, path)).version }, { ...exec, agent: sourceAgent, name: 'read' })
  await checkpoint({ stage: 'plan', source_path: '剧本.md', outputs: [] })
  const summary = await save({ artifact_kind: 'story_summary' }, '# 故事梗概')
  const bio = await save({ artifact_kind: 'character_bio', entity_name: '莫甘娜' }, '# 莫甘娜\n银发金瞳，暗红长裙')
  await checkpoint({ stage: 'materials', outputs: [summary, bio] })
  read(summary)
  const style = await save({ artifact_kind: 'film_style' }, '# 影片比例与风格\n画面比例：9:16')
  await checkpoint({ stage: 'style', outputs: [style] })
  read(style)
  const format = { artifact_kind: 'character_format', entity_name: '莫甘娜' }
  await assert.rejects(tool.execute({ ...format, content: '9:16三格人物设定图，莫甘娜' }, exec), /精准读取缺失/)
  read(bio)
  const saved = await tool.execute({ ...format, content: '9:16三格人物设定图，莫甘娜银发金瞳' }, exec)
  assert.equal(saved.path, 'wiki/资产/角色/莫甘娜/角色生图格式提示词.md')
  assert.ok(!files.has(join(root, 'wiki/资产/角色/莫甘娜/角色生图提示词.md')), '不需要先存设计提示词')
})

test('each creative route automatically replaces its own generated artifact in place and keeps one index entry', async t => {
  for (const [route, artifact] of [
    ['manju', { artifact_kind: 'engineering_script', episode_number: 1 }],
    ['short-drama', { artifact_kind: 'screenplay', episode_number: 1 }],
    ['novel', { artifact_kind: 'novel_chapter_draft', work_name: '星海', chapter_number: 1, chapter_title: '归来' }],
  ]) {
    const root = mkdtempSync(join(tmpdir(), 'jc-wiki-auto-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const { tool, exec, files } = createHarness(root, { route })
    const directory = route === 'novel' ? '创作' : '剧本'
    files.set(join(root, 'wiki/index.md'), { content: `# 用户的 Wiki\n\n- [[${directory}/index]]\n`, version: 0 })
    const first = await tool.execute({ ...artifact, content: '# 原来的稿件' }, exec)
    const updated = await tool.execute({ ...artifact, content: '# 用户要求修改后的稿件' }, exec)
    assert.equal(updated.path, first.path)
    assert.equal(updated.operation, 'updated')
    assert.match(files.get(join(root, updated.path)).content, /用户要求修改后的稿件/)
    const repeated = await tool.execute({ ...artifact, content: '# 用户要求修改后的稿件' }, exec)
    assert.equal(repeated.operation, 'unchanged')
    assert.equal(files.get(join(root, 'wiki/index.md')).content.split(`[[${directory}/index`).length - 1, 1)
    const filename = updated.path.split('/').at(-1).replace(/\.md$/, '')
    assert.equal(files.get(join(root, dirname(updated.path), 'index.md')).content.split(`[[${filename}|`).length - 1, 1)
    assert.ok(!files.has(join(root, 'wiki/原始材料/星海/原文.md')))
  }
})

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


test('all 48 artifact contracts have explicit routes and every allowed kind saves with its restricted writer', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-route-artifacts-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const contract = JSON.parse(readFileSync('public/skills/wiki-artifacts.json', 'utf8'))
  assert.equal(Object.keys(contract.types).length, 48)
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
      if (template.entity) args.entity_name = kind === 'adaptation_event' ? 'E01_角色甲登场' : '角色甲'
      if (template.episode) args.episode_number = 1
      if (template.model) args.video_model = template.model[0]
      if (template.path.includes('{segment}')) args.segment = '001'
      if (template.mode === 'pipeline') {
        files.set(join(root, route, kind, '剧本.md'), { content: '# 来源', version: 1 })
        args.content = JSON.stringify({ stage: 'plan', source_path: '剧本.md', outputs: [] })
      }
      if (['adaptation_cut', 'adaptation_pipeline'].includes(template.mode)) {
        const cwd = exec.agent.session.header.cwd, path = join(cwd, '原文.md')
        const body = '这是当前章完整的原文内容，包含人物衣服五官与实际行动，不允许跨入下一章。'
        files.set(path, { content: `第一章 原文\n${body}`, version: 1 })
        sourceAgent.session = exec.agent.session
        resetWikiReads(sourceAgent)
        recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 1 }, { ...exec, agent: sourceAgent, name: 'read' })
        args.content = JSON.stringify(template.mode === 'adaptation_cut'
          ? { segments: [{ source_path: '原文.md', chapter_heading: '第一章 原文', start_line: 2, end_line: 2 }] }
          : { stage: 'source', source_paths: ['原文.md'], outputs: [] })
      }
      if (route === 'short-drama' && kind === 'adaptation_annotation') {
        // 标注须有本批章节（source 进度）和已存在的事件文档；保存后程序组装分集剧本。
        const cwd = exec.agent.session.header.cwd
        files.set(join(cwd, '原文.md'), { content: '第一章 原文\n这是当前章完整的原文内容。\n', version: 1 })
        await tool.execute({ artifact_kind: 'adaptation_checkpoint', content: JSON.stringify({ stage: 'source', source_paths: ['原文.md'], outputs: [] }) }, exec)
        await tool.execute({ artifact_kind: 'adaptation_event', entity_name: 'E01_原文事件', content: '# 原文事件' }, exec)
        const at = { chapter_heading: '第一章 原文', line: 2 }
        args.entity_name = '第001-001章'
        args.content = JSON.stringify({ rhythm: { name: '标准剧情', min: 75, target: 90, max: 120 }, events: [{ event: 'E01_原文事件', start: at, end: at, rounds: [{ ...at, desc: '一幕', result: '收束', units: { 停顿: 1 } }], skip: [] }] })
      }
      if (route === 'short-drama' && kind === 'episode_source_script') {
        // 短剧的分集剧本只能由程序从已保存的切分生成。
        const cwd = exec.agent.session.header.cwd, path = join(cwd, '原文.md')
        files.set(path, { content: '第一章 原文\n这是当前章完整的原文内容，包含人物衣服五官与实际行动。', version: 1 })
        sourceAgent.session = exec.agent.session
        resetWikiReads(sourceAgent)
        recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 1 }, { ...exec, agent: sourceAgent, name: 'read' })
        await tool.execute({ artifact_kind: 'adaptation_cut', episode_number: 1, content: JSON.stringify({ segments: [{ source_path: '原文.md', chapter_heading: '第一章 原文', start_line: 2, end_line: 2 }] }) }, exec)
        args.content = JSON.stringify({ from_cut: 1 })
      }
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
      if (kind === 'adaptation_card') {
        // 切分卡只能由程序生成。
        await assert.rejects(tool.execute(args, exec), /程序生成/)
        continue
      }
      const result = await tool.execute(args, exec)
      assert.equal(result.status, 'saved', `${route}/${kind}`)
      assert.ok(files.get(join(exec.agent.session.header.cwd, result.path))?.content.trim())
    }
  }
  assert.deepEqual(counts, { manju: 27, 'short-drama': 20, novel: 16 })
})

test('source links use document-relative targets and summaries contain only readable labels', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-source-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'manju' })
  const result = await tool.execute({ artifact_kind: 'character_bio', entity_name: '甲',
    content: '# 甲\n来源：[[wiki/原始材料/故事/原文.md 第001集]]。\n风格见[[wiki/项目风格/影片比例与风格.md|影片风格]]。' }, exec)
  const text = files.get(join(root, result.path)).content
  assert.match(text, /\[\[\.\.\/\.\.\/原始材料\/故事\/原文\.md\|第001集\]\]/)
  assert.match(text, /\[\[\.\.\/\.\.\/项目风格\/影片比例与风格\.md\|影片风格\]\]/)
  const index = files.get(join(root, 'wiki/项目资料/人物小传/index.md')).content
  assert.match(index, /来源：第001集/)
  assert.doesNotMatch(index, /\[\[wiki\/|\.md 第001集/)
})


test('Seedance submits standalone five-module prompts with @ image lines and voice identity only in character lines', () => {
  const valid = '古装女子石道追问的电影片段。\n@图1：莫甘娜，银发金瞳。声音九维：年龄感成熟；音高中低；明暗冷亮；厚薄饱满；共鸣胸腔；气息稳定；颗粒感平滑；口音普通话；稳定表达习惯短句尾压低。\n@图2：石道，右侧石壁。\n@图1莫甘娜站在@图2石道左侧，面朝画外右侧。\n【全局设定】\n日间石道，二维平涂，左上日光，表演克制，无字幕。\n【时间戳剧本分镜】\n镜头1【0—1.5秒】：【追问】 ｜ 近景，平视，固定 ｜ @图1莫甘娜站在@图2石道中，轻声问：“真的要走吗？”\n情感解析：她等待对方亲口回答，目光不移开。\n【全局补充】\n保持同侧观察、统一光向，无BGM。'
  assert.doesNotThrow(() => validateSeedanceReferences(valid))
  // 本段没有入画资产（纯文生段）时不写 @图 行；但引用了 @图 就必须先定义。
  assert.doesNotThrow(() => validateSeedanceReferences(valid.replace(/^@图.*\n/gm, '').replace(/@图\d/g, '')))
  assert.throws(() => validateSeedanceReferences(valid.replace(/^@图.*\n/gm, '')), /未定义/)
  assert.throws(() => validateSeedanceReferences(valid.replace('@图2：', '@图1：')), /连续/)
  assert.throws(() => validateSeedanceReferences(valid.replace('站在@图2', '站在@图3')), /未定义/)
  assert.throws(() => validateSeedanceReferences(valid.replace('轻声问', '声音九维：音高中低，轻声问')), /九维/)
  for (const note of ['待上传', '工程镜63—72对应本段镜1—10', '全片153—179秒，本段26秒预算，以下从0计非实测', '承接上一段'])
    assert.throws(() => validateSeedanceReferences(valid + '\n' + note), /备注|跨段/)
  assert.throws(() => validateSeedanceReferences(valid.replace('【全局补充】', '制作总结')), /五模块/)
  assert.throws(() => validateSeedanceReferences(valid.replace('气息稳定；', '')), /九维信息不完整/)
  assert.throws(() => validateSeedanceReferences(valid.replace('@图2：石道，右侧石壁。', '@图2：')), /资产名称与特征/)
  assert.throws(() => validateSeedanceReferences(valid.replace('@图1：莫甘娜', '@图1：莫甘娜 @图3：兔子')), /单独一行/)
})


test('short-drama cuts copy only the chosen real chapter range and reject cross-chapter selection', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-adaptation-cut-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files, sourceAgent } = createHarness(root, { route: 'short-drama' })
  sourceAgent.session = exec.agent.session
  resetWikiReads(sourceAgent)
  const path = join(root, '小说.md')
  const first = '顾云舟穿着青色旧袍站在门前，握紧旧剑，听见门外的呼喊。'
  const second = '莫甘娜穿着暗红长裙站在石阶，金色眼睛直视山门，呼吸平稳。'
  files.set(path, { content: `\uFEFF第一章 山门\r\n${first}\r\n第二章 石阶\r\n${second}\r\n`, version: 1 })
  recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 1 }, { ...exec, agent: sourceAgent, name: 'read' })
  const imported = await tool.execute({ artifact_kind: 'source_material', work_name: '原作', content: JSON.stringify({ source_path: '小说.md' }) }, exec)
  assert.equal(files.get(join(root, imported.path)).content, files.get(path).content)
  const cut = (episode_number, ...inputs) => tool.execute({ artifact_kind: 'adaptation_cut', episode_number, content: JSON.stringify({ segments: inputs.map(input => ({ source_path: '小说.md', ...input })) }) }, exec)
  const args = { artifact_kind: 'adaptation_cut', episode_number: 1, content: JSON.stringify({ segments: [{ source_path: '小说.md', chapter_heading: '第一章 山门', start_line: 2, end_line: 2 }] }) }
  const result = await tool.execute(args, exec)
  const text = files.get(join(root, result.path)).content
  assert.equal(result.path, 'wiki/改编方案/分集切分/第001集原文.md')
  assert.ok(text.endsWith(first + '\r\n') || text.endsWith(first), JSON.stringify(text.slice(-20)))
  assert.ok(!text.includes(second))
  assert.match(text, /"start_line":2,"end_line":2/)
  await assert.rejects(cut(2, { chapter_heading: '第一章 山门', start_line: 2, end_line: 4 }), /当前章|跨章/)
  await assert.rejects(cut(2, { chapter_heading: '第一章 山门', start_line: 2, end_line: 1 }), /行号/)
  await assert.rejects(cut(2, { chapter_heading: '第一章 山门', cut_start: first.slice(0, 12), cut_end: first.slice(-12) }), /行号/)
  await assert.rejects(tool.execute({ artifact_kind: 'adaptation_cut', episode_number: 2, content: JSON.stringify({ source_path: '小说.md', chapter_heading: '第一章 山门', start_line: 2, end_line: 2 }) }, exec), /segments/)
  const multi = await cut(5, { chapter_heading: '第一章 山门', start_line: 2, end_line: 2 }, { chapter_heading: '第二章 石阶', start_line: 4, end_line: 4 })
  const multiText = files.get(join(root, multi.path)).content
  assert.ok(multiText.indexOf(first) < multiText.indexOf(second))
  assert.match(multiText, /第一章 山门[\s\S]*第二章 石阶/)
  await assert.rejects(cut(2, { chapter_heading: '全文', start_line: 2, end_line: 2 }), /全文/)
  files.set(path, { ...files.get(path), version: 2 })
  await assert.rejects(tool.execute(args, exec), /修改后重读/)
  recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 2 }, { ...exec, agent: sourceAgent, name: 'read' })
  assert.equal((await tool.execute(args, exec)).operation, 'unchanged')
  const huge = '独特开头用于大章切分测试' + '字'.repeat(340000) + '独特结尾用于大章切分测试'
  files.set(path, { content: `第一章 大章\n${huge}`, version: 3 })
  recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 3 }, { ...exec, agent: sourceAgent, name: 'read' })
  await assert.rejects(cut(3, { chapter_heading: '第一章 大章', start_line: 2, end_line: 2 }), /超过1MB/)
  const story = ['短篇开头，林晚推开雨夜的店门。', '店主抬头，认出了她手里的旧照片。', '她把照片拍在柜台上，问他要一个答案。']
  files.set(path, { content: story.join('\n') + '\n', version: 4 })
  recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 4 }, { ...exec, agent: sourceAgent, name: 'read' })
  const whole = await cut(4, { chapter_heading: '全文', start_line: 2, end_line: 3 })
  const wholeText = files.get(join(root, whole.path)).content
  assert.match(wholeText, /"chapter_heading":"全文"/)
  assert.ok(wholeText.includes(story[1]) && wholeText.includes(story[2]) && !wholeText.includes(story[0]))
})

test('short-drama saves the episode plan as 分集规划 but keeps an existing 逐章规划 in place', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-chapter-plan-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = createHarness(join(root, 'new'), { route: 'short-drama' })
  const result = await first.tool.execute({ artifact_kind: 'adaptation_episode_plan', content: '# 分集规划' }, first.exec)
  assert.equal(result.path, 'wiki/改编方案/分集规划.md')
  const old = createHarness(join(root, 'old'), { route: 'short-drama' })
  old.files.set(join(root, 'old/wiki/index.md'), { content: '# Wiki', version: 1 })
  old.files.set(join(root, 'old/wiki/改编方案/逐章规划.md'), { content: '# 旧规划', version: 2 })
  const kept = await old.tool.execute({ artifact_kind: 'adaptation_episode_plan', content: '# 修订' }, old.exec)
  assert.equal(kept.path, 'wiki/改编方案/逐章规划.md')
})

test('short-drama event docs are numbered and episode scripts are generated only from verified cuts', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-event-script-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files, sourceAgent } = createHarness(root, { route: 'short-drama' })
  sourceAgent.session = exec.agent.session
  resetWikiReads(sourceAgent)
  await assert.rejects(tool.execute({ artifact_kind: 'adaptation_event', entity_name: '噗叽偷食被收服', content: '# 事件' }, exec), /E\+数字_|E数字_|序号/)
  const event = await tool.execute({ artifact_kind: 'adaptation_event', entity_name: 'E03_噗叽偷食被收服', content: '# 噗叽偷食被收服' }, exec)
  assert.equal(event.path, 'wiki/改编方案/事件/E03_噗叽偷食被收服.md')
  const path = join(root, '小说.md')
  const lines = ['第一章 树洞', '食物不见了，地上有细小的爪印。', '这是一大段关于种子的设定介绍。', '“谁偷了我的饭？”李长青握紧木棍。']
  files.set(path, { content: lines.join('\n') + '\n', version: 1 })
  recordWikiRead(sourceAgent, { targetKey: path }, { kind: 'present', version: 1 }, { ...exec, agent: sourceAgent, name: 'read' })
  await tool.execute({ artifact_kind: 'adaptation_cut', episode_number: 1, content: JSON.stringify({ segments: [
    { source_path: '小说.md', chapter_heading: '第一章 树洞', start_line: 2, end_line: 2 },
    { source_path: '小说.md', chapter_heading: '第一章 树洞', start_line: 4, end_line: 4 }] }) }, exec)
  const script = await tool.execute({ artifact_kind: 'episode_source_script', episode_number: 1, content: JSON.stringify({ from_cut: 1 }) }, exec)
  assert.equal(script.path, 'wiki/项目资料/分集剧本/第1集分集剧本.md')
  const body = files.get(join(root, script.path)).content
  assert.ok(body.includes(lines[1]) && body.includes(lines[3]))
  assert.ok(!body.includes(lines[2]), '删掉的行不出现')
  assert.doesNotMatch(body, /出处|<!--|jc_adaptation_cut/, '正文只有原文')
  await assert.rejects(tool.execute({ artifact_kind: 'episode_source_script', episode_number: 1, content: '# 模型自己写的正文' }, exec), /from_cut/)
  await assert.rejects(tool.execute({ artifact_kind: 'episode_source_script', episode_number: 2, content: JSON.stringify({ from_cut: 1 }) }, exec), /集号/)
  files.set(path, { content: lines.join('\n').replace('爪印', '脚印') + '\n', version: 2 })
  await assert.rejects(tool.execute({ artifact_kind: 'episode_source_script', episode_number: 1, content: JSON.stringify({ from_cut: 1 }) }, exec), /已变化/)
})

// ---- 时间账：回合标注、按时间切集、切分卡、清单与逐集改编 ----
test('time ledger: dialogue is 240 chars a minute plus half a second per line, actions are counted by unit', () => {
  assert.equal(dialogueSeconds('他走了过去。'), 0)
  assert.equal(dialogueSeconds('“你来了。”他说。“嗯。”'), (4 + 2) / 4 + 0.5 * 2)
  assert.equal(dialogueSeconds('「快跑！」'), 3 / 4 + 0.5)
  assert.equal(unitSeconds({ 快招: 3, 大招: 1 }), 3 * 2 + 15)
  assert.equal(unitSeconds({ 快招: 3 }, 2), 12)
  assert.throws(() => unitSeconds({ 乱来: 1 }), /单元/)
  assert.deepEqual(TIME_UNITS, { 快招: 2, 攻防: 4, 技能: 8, 大招: 15, 走位: 3, 反应: 2, 全景: 3, 停顿: 3, 面板: 2.5, 闪回: 6 })
  assert.deepEqual(TIER_FACTORS, { 压缩: 0.6, 如实: 1, 细写: 2, 决战: 3 })
})

test('episode count follows planned time; cuts land on round boundaries, prefer hooks, avoid fragments and honour overrides', () => {
  const limits = { min: 90, target: 120, max: 150 }
  const line = (round, planned) => ({ round, planned })
  const covers = (plan, count) => plan[0].from === 0 && plan.at(-1).to === count - 1 && plan.every((item, index) => index === 0 || item.from === plan[index - 1].to + 1)
  // 三个回合各60秒，共180：2集，第二个回合有钩子，切在它后面。
  const even = [0, 0, 0, 1, 1, 1, 2, 2, 2].map(round => line(round, 20))
  assert.deepEqual(planEventEpisodes(even, [{ hook: false }, { hook: true }, { hook: false }], limits).map(item => [item.from, item.to]), [[0, 5], [6, 8]])
  // 第一个回合只有10秒且有钩子：切在它后面会得到碎片集，改为切在第二个回合后。
  const fragment = [line(0, 10), ...Array(5).fill(line(1, 20)), ...Array(5).fill(line(2, 20))]
  assert.deepEqual(planEventEpisodes(fragment, [{ hook: true }, { hook: false }, { hook: false }], limits).map(item => [item.from, item.to]), [[0, 5], [6, 10]])
  // 一个回合计划600秒（12行×50秒）：回合内按行切开，每集不超过最长150秒，共5集。
  const huge = Array(12).fill(line(0, 50))
  const plan = planEventEpisodes(huge, [{ hook: false }], limits)
  assert.equal(plan.length, 5)
  assert.ok(covers(plan, 12) && plan.every(item => item.planned <= 150))
  // 不足一集的事件就是一集。
  assert.deepEqual(planEventEpisodes([line(0, 10), line(1, 30)], [{}, {}], limits).map(item => [item.from, item.to]), [[0, 1]])
  // 用户指定集数：两个回合各100秒，要求4集。
  const forced = [...Array(5).fill(line(0, 20)), ...Array(5).fill(line(1, 20))]
  const four = planEventEpisodes(forced, [{}, {}], limits, 4)
  assert.equal(four.length, 4)
  assert.ok(covers(four, 10))
})

async function ledgerWorld(t) {
  const novel = ['第1章 树洞', '甲站在树洞前，握紧木棍。', '这座森林的来历很长，作者写了很多设定。', '乙从树后窜出，偷走了饭。', '甲追出去。', '乙被逼到悬崖边。',
    '第2章 悬崖', '乙跪地求饶。', '甲收下木棍，转身离去。', '第3章 余波', '风吹过山岗。']
  const root = mkdtempSync(join(tmpdir(), 'jc-ledger-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'short-drama' })
  files.set(join(root, '原文.md'), { content: novel.join('\n') + '\n', version: 1 })
  const save = (artifact_kind, content, extra = {}) => tool.execute({ artifact_kind, content: typeof content === 'string' ? content : JSON.stringify(content), ...extra }, exec)
  await save('adaptation_checkpoint', { stage: 'source', source_paths: ['原文.md'], outputs: [] })
  await save('adaptation_event', '# E01', { entity_name: 'E01_甲追乙' })
  const at = (chapter_heading, line) => ({ chapter_heading, line })
  const event = (extra = {}) => ({ event: 'E01_甲追乙', start: at('第1章 树洞', 2), end: at('第2章 悬崖', 9),
    rounds: [
      { ...at('第1章 树洞', 2), desc: '甲守在树洞前', result: '局势平稳', units: { 大招: 2 } },
      { ...at('第1章 树洞', 4), desc: '乙偷饭被追到悬崖', result: '甲占上风', units: { 大招: 3 }, tier: '细写', why: '主角首次追击，关系到后文', hook: true, peak: true },
      { ...at('第2章 悬崖', 8), desc: '乙求饶', result: '收束', units: { 大招: 2 } }],
    skip: [{ chapter_heading: '第1章 树洞', start_line: 3, end_line: 3, reason: '世界观设定，已写进世界规则' }], ...extra })
  const read = path => files.get(join(root, path))?.content
  return { root, tool, exec, files, save, at, event, read,
    rhythm: { name: '快节奏爽剧', min: 60, target: 75, max: 90 },
    annotate: (content, entity_name = '第001-003章') => save('adaptation_annotation', content, { entity_name }),
    script: n => read(`wiki/项目资料/分集剧本/第${n}集分集剧本.md`),
    body: n => read(`wiki/项目资料/分集剧本/第${n}集分集剧本.md`)?.replace(/^---\n[\s\S]*?\n---\n/, ''),
    manifest: () => JSON.parse(read('wiki/改编方案/分集清单.json')) }
}

test('short-drama time ledger: rounds are validated, episodes are planned by time, cut cards, the manifest, gaps and warnings are written', async t => {
  const w = await ledgerWorld(t)
  const { annotate, event, rhythm, at } = w
  const rounds = event().rounds
  // 旧格式、节奏、回合的校验。
  await assert.rejects(annotate({ rhythm, events: [{ ...event(), beats: [{ ...at('第1章 树洞', 2), weight: 1 }] }] }), /回合|rounds/)
  await assert.rejects(annotate({ rhythm, events: [{ ...event(), delete: [] }] }), /回合|rounds/)
  await assert.rejects(annotate({ events: [event()] }), /rhythm/)
  await assert.rejects(annotate({ rhythm: { ...rhythm, max: 200 }, events: [event()] }), /180/)
  await assert.rejects(annotate({ rhythm, events: [event({ rounds: [{ ...rounds[0], line: 4 }, ...rounds.slice(1)] })] }), /第一个回合/)
  await assert.rejects(annotate({ rhythm, events: [event({ rounds: [{ ...rounds[0], units: { 乱来: 1 } }, ...rounds.slice(1)] })] }), /单元/)
  await assert.rejects(annotate({ rhythm, events: [event({ rounds: [rounds[0], { ...rounds[1], why: undefined }, rounds[2]] })] }), /理由|why/)
  await assert.rejects(annotate({ rhythm, events: [event({ skip: [{ chapter_heading: '第1章 树洞', start_line: 3, end_line: 3 }] })] }), /理由|reason/)
  await assert.rejects(annotate({ rhythm, events: [event({ rounds: [{ ...rounds[0], units: { 大招: 13 } }, ...rounds.slice(1)] })] }), /180[\s\S]*拆|多次局势变化/)
  // 道具汇总档会被提示。
  w.files.set(join(w.root, 'wiki/项目资料/原作/道具/逆齿造物汇总.md'), { content: '# 汇总\n## 1\n## 2\n## 3\n## 4\n', version: 1 })
  // 通过：一个事件，细写回合90秒，共150秒；快节奏爽剧每集最长90秒，只有3集装得下。
  const saved = await annotate({ rhythm, planned_through: '第3章 余波', events: [event()] })
  assert.match(saved.assembled, /共3集/)
  assert.equal(w.body(1), '甲站在树洞前，握紧木棍。\n')
  assert.equal(w.body(2), '乙从树后窜出，偷走了饭。\n甲追出去。\n乙被逼到悬崖边。\n')
  assert.equal(w.body(3), '乙跪地求饶。\n甲收下木棍，转身离去。\n')
  let manifest = w.manifest()
  assert.equal(manifest.version, 2)
  assert.deepEqual(manifest.rhythm, { ...rhythm, pace: 1 })
  assert.deepEqual(manifest.events[0].plan.map(item => [item.episode, item.planned_s, item.natural_s]), [[1, 30, 30], [2, 90, 45], [3, 30, 30]])
  assert.deepEqual(manifest.heavy.map(item => [item.event, item.tier, item.why]), [['E01_甲追乙', '细写', '主角首次追击，关系到后文']])
  assert.deepEqual(manifest.gaps.map(item => [item.chapter_heading, item.start_line, item.end_line]), [['第3章 余波', 11, 11]])
  assert.ok(manifest.warnings.some(item => /逆齿造物汇总/.test(item) && /汇总档/.test(item)))
  const card = w.read('wiki/改编方案/切分卡/第002集.md')
  assert.match(card, /E01_甲追乙/)
  assert.match(card, /第2\/3集/)
  assert.match(card, /计划[^\n]*90/)
  assert.match(card, /细写/)
  assert.match(card, /## 峰值[\s\S]*乙偷饭被追到悬崖/)
  assert.match(card, /## 结尾钩子[\s\S]*甲占上风/)
  await assert.rejects(w.save('adaptation_card', '# 自己写', { episode_number: 2 }), /程序生成/)
  // 长回合经 single 放行，但单行无法再切开时给出超时长警告。
  await w.save('adaptation_event', '# E02', { entity_name: 'E02_余波' })
  const e02 = { event: 'E02_余波', start: at('第3章 余波', 11), end: at('第3章 余波', 11), skip: [],
    rounds: [{ ...at('第3章 余波', 11), desc: '长时间追逐', result: '收束', units: { 大招: 13 }, single: true, why: '一场连续的长时间战斗' }] }
  await annotate({ events: [event(), e02] }, '第003-003章')
  assert.ok(w.manifest().warnings.some(item => /E02_余波/.test(item) && /195/.test(item) && /90/.test(item)))
  // 整体节奏：pace 加倍后单元时间加倍，集数变多。
  await annotate({ replan: { pace: 2 } }, '调整')
  manifest = w.manifest()
  assert.equal(manifest.rhythm.pace, 2)
  assert.ok(manifest.events[0].count > 3)
  // 重切：E01 指定2集，其后各集前移，多出来的旧集进入 stale。
  await annotate({ recut: { event: 'E01_甲追乙', episodes: 2 } }, '调整')
  manifest = w.manifest()
  assert.deepEqual(manifest.events[0].episodes, [1, 2])
  assert.ok(manifest.stale.length > 0)
  assert.ok((w.body(1) + w.body(2)).includes('乙跪地求饶') && (w.body(1) + w.body(2)).includes('甲站在树洞前'))
})

test('删减式改编没有 scheme/cuts/writing 可登记：分集清单全部改编完即可完成', async t => {
  const w = await ledgerWorld(t)
  const { save, annotate, rhythm, event } = w
  await save('story_summary', '# 原作梗概\n甲追乙到悬崖。', { research_version: 'original' })
  const materials = await save('adaptation_checkpoint', { stage: 'materials', outputs: ['wiki/项目资料/原作/故事梗概.md'] })
  assert.ok(materials)
  await annotate({ rhythm, planned_through: '第3章 余波', events: [event()] })
  assert.deepEqual(w.manifest().adapted, [])
  // 还没改编：不能直接完成，旧的逐级校验仍然生效。
  await assert.rejects(save('adaptation_checkpoint', { stage: 'complete', outputs: [] }), /不能跳过前置阶段/)
  // 程序按标注组装出3集并全部改编完。
  const manifest = { ...w.manifest(), adapted: [1, 2, 3] }
  w.files.set(join(w.root, 'wiki/改编方案/分集清单.json'), { content: JSON.stringify(manifest, null, 2) + '\n', version: 9 })
  await save('adaptation_checkpoint', { stage: 'complete', outputs: [] })
  const progress = JSON.parse(w.read('wiki/改编方案/执行进度.json'))
  assert.equal(progress.stage, 'complete')
  assert.equal(progress.status, 'completed')
})

test('short-drama adapted scripts carry scene times and sources; the program checks range, dialogue time and the platform cap', async t => {
  const w = await ledgerWorld(t)
  await w.annotate({ rhythm: w.rhythm, planned_through: '第3章 余波', events: [w.event()] })
  const scene = (extra = {}) => ({ title: '场1', role: 'main', seconds: 40, sources: [{ chapter_heading: '第1章 树洞', start_line: 4, end_line: 6 }],
    text: '乙从树后窜出，抱走饭盒。\n“站住！”甲怒喝。\n乙一路狂奔，被逼到悬崖边。', ...extra })
  const adapt = (adapted, episode_number = 2) => w.save('episode_source_script', { adapted }, { episode_number })
  await assert.rejects(adapt({ strategy: '顺叙影视化', scenes: [scene()] }, 9), /切分卡|没有/)
  await assert.rejects(adapt({ strategy: '', scenes: [scene()] }), /strategy|策略/)
  await assert.rejects(adapt({ strategy: '顺叙影视化', scenes: [] }), /scenes|场/)
  await assert.rejects(adapt({ strategy: '顺叙影视化', scenes: [scene({ sources: [] })] }), /出处/)
  await assert.rejects(adapt({ strategy: '顺叙影视化', scenes: [scene({ sources: [{ chapter_heading: '第1章 树洞', start_line: 2, end_line: 3 }] })] }), /本集原文范围/)
  await assert.rejects(adapt({ strategy: '顺叙影视化', scenes: [scene({ seconds: 1, text: `“${'这是一句很长很长的台词。'.repeat(4)}”` })] }), /对白/)
  await assert.rejects(adapt({ strategy: '顺叙影视化', scenes: [scene({ seconds: 200 })] }), /180/)
  await assert.rejects(adapt({ strategy: '冷开场', scenes: [scene({ role: 'cold', seconds: 30, sources: [{ chapter_heading: '第2章 悬崖', start_line: 8, end_line: 8 }] }), scene({ seconds: 40 })] }), /25%/)
  const saved = await adapt({ strategy: '顺叙影视化', scenes: [scene()] })
  assert.equal(saved.status, 'saved_with_warnings')
  assert.ok(saved.warnings.some(item => /60[–-]90/.test(item)), '总时长低于本风格区间')
  assert.ok(saved.warnings.some(item => /计划/.test(item)), '与切分卡计划时长偏差过大')
  const text = w.script(2)
  assert.match(text, /^---\nevent: "\[\[wiki\/改编方案\/事件\/E01_甲追乙\|E01_甲追乙\]\]"\nstrategy: 顺叙影视化\nseconds: 40\n/)
  assert.match(text, /sources:\n  - "第1章 树洞 4–6行"\n---\n/)
  assert.match(text, /【场1 约40秒｜对白1秒＋其余39秒】\n乙从树后窜出，抱走饭盒。/)
  assert.doesNotMatch(text, /甲追出去。/)
  assert.deepEqual(w.manifest().adapted, [2])
  // 冷开场：峰值片段可来自本集之外，占比不超过25%。
  await adapt({ strategy: '冷开场', scenes: [scene({ role: 'cold', title: '冷开场', seconds: 10, sources: [{ chapter_heading: '第2章 悬崖', start_line: 8, end_line: 8 }], text: '乙跪在崖边，哭喊求饶。' }), scene({ seconds: 60 })] })
  assert.match(w.script(2), /strategy: 冷开场/)
  assert.match(w.script(2), /【冷开场 约10秒｜/)
  assert.match(w.script(2), /  - "第2章 悬崖 8–8行"/)
  // 标注不变时重新保存不覆盖已改编的集；重切会把受影响的集恢复为原文直出并清掉改编记录。
  await w.annotate({ events: [w.event()] })
  assert.match(w.script(2), /strategy: 冷开场/)
  await w.annotate({ recut: { event: 'E01_甲追乙', episodes: 2 } }, '调整')
  assert.doesNotMatch(w.script(2), /strategy:/)
  assert.deepEqual(w.manifest().adapted, [])
})

test('short-drama episode scripts start with a header of links (event, characters, scenes, props) found in the text, and the raw body is original text only', async t => {
  const root = mkdtempSync(join(tmpdir(), 'jc-episode-header-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { tool, exec, files } = createHarness(root, { route: 'short-drama' })
  const lines = ['第1章 树洞', '甲兄站在树洞前，手里握着木棍。', '乙偷吃了饭，转身就跑。', '丙远远地看着。', '风吹过山岗。']
  files.set(join(root, '原文.md'), { content: lines.join('\n') + '\n', version: 1 })
  files.set(join(root, 'wiki/index.md'), { content: '# Wiki', version: 1 })
  const asset = (path, text) => files.set(join(root, `wiki/项目资料/原作/${path}.md`), { content: text, version: 1 })
  asset('人物小传/甲', '# 甲\n\n## 身份与基本信息\n- **姓名/称谓**：甲 / 甲兄\n- **身份**：猎人\n')
  asset('人物小传/乙', '# 乙\n\n- **姓名**：乙\n')
  asset('人物小传/丙', '# 丙\n\n- **姓名**：丙\n')
  asset('场景/树洞庇护所', '# 树洞庇护所\n\n## 陈设\n- 木桌\n')
  asset('道具/木棍', '# 木棍\n')
  asset('道具/无关道具', '# 无关道具\n')
  const save = (artifact_kind, content, extra = {}) => tool.execute({ artifact_kind, content: typeof content === 'string' ? content : JSON.stringify(content), ...extra }, exec)
  await save('adaptation_checkpoint', { stage: 'source', source_paths: ['原文.md'], outputs: [] })
  const link = (category, name) => `[[wiki/项目资料/原作/${category}/${name}|${name}]]`
  await save('adaptation_event', `# E01\n\n## 涉及人物/场景/道具\n- ${[link('人物小传', '甲'), link('人物小传', '乙'), link('人物小传', '丙'), link('道具', '木棍'), link('道具', '无关道具')].join('、')}、[[wiki/项目资料/原作/场景/树洞庇护所|树洞]]\n`, { entity_name: 'E01_甲追乙' })
  await save('adaptation_event', '# E02\n', { entity_name: 'E02_乙逃跑' })
  await save('adaptation_event', '# E03\n', { entity_name: 'E03_空镜' })
  const at = line => ({ chapter_heading: '第1章 树洞', line })
  const rhythm = { name: '标准剧情', min: 75, target: 90, max: 120 }
  const rounds = (start, end) => [{ ...at(start), desc: '一幕', result: '收束', units: { 停顿: 1 } }]
  await save('adaptation_annotation', { rhythm, events: [
    { event: 'E01_甲追乙', start: at(2), end: at(3), rounds: rounds(2, 3), skip: [] },
    { event: 'E02_乙逃跑', start: at(3), end: at(4), rounds: rounds(3, 4), skip: [] },
    { event: 'E03_空镜', start: at(5), end: at(5), rounds: rounds(5, 5), skip: [] }] }, { entity_name: '第001-001章' })
  const read = n => files.get(join(root, `wiki/项目资料/分集剧本/第${n}集分集剧本.md`))?.content
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(read(1))
  assert.ok(match, '文件头存在')
  const [, header, body] = match
  assert.equal(body, `${lines[1]}\n${lines[2]}\n`, '正文只有原文')
  assert.match(header, /^event: "\[\[wiki\/改编方案\/事件\/E01_甲追乙\|E01_甲追乙\]\]"$/m)
  assert.match(header, /characters:\n  - "\[\[wiki\/项目资料\/原作\/人物小传\/甲\|甲\]\]"\n  - "\[\[wiki\/项目资料\/原作\/人物小传\/乙\|乙\]\]"/, '别名“甲兄”也算出场，按首次出现排序')
  // 事件文档里的链接标签（“树洞”）也算这个场景的叫法。
  assert.match(header, /scenes:\n  - "\[\[wiki\/项目资料\/原作\/场景\/树洞庇护所\|树洞庇护所\]\]"/)
  assert.match(header, /props:\n  - "\[\[wiki\/项目资料\/原作\/道具\/木棍\|木棍\]\]"/)
  assert.doesNotMatch(header, /丙/)
  assert.doesNotMatch(header, /无关道具/)
  // 事件文档没有链接时，按名字在全库资产里查找。
  assert.match(read(2), /event: "\[\[wiki\/改编方案\/事件\/E02_乙逃跑\|E02_乙逃跑\]\]"/)
  assert.match(read(2), /\[\[wiki\/项目资料\/原作\/人物小传\/乙\|乙\]\]/)
  assert.match(read(2), /\[\[wiki\/项目资料\/原作\/人物小传\/丙\|丙\]\]/)
  assert.doesNotMatch(read(2), /甲/)
  // 本集没有任何资产出现时只保留所属事件。
  assert.match(read(3), /^---\nevent: "\[\[wiki\/改编方案\/事件\/E03_空镜\|E03_空镜\]\]"\n---\n风吹过山岗。\n$/)
})
