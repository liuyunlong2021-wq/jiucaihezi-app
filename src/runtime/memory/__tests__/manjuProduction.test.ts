import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import {
  MANJU_ROUTER,
  MANJU_SKILLS,
  WIKI_MEMORY_SKILL,
  restoreManjuSelection,
} from '../manjuProduction'
import { NOVEL_SKILL, restoreNovelSelection } from '../novelProduction'

test('the production bundle includes both video routes and excludes the portrait skill', () => {
  assert.equal(MANJU_SKILLS.length, 15)
  assert.ok(!MANJU_SKILLS.includes('jc-duanju'))
  assert.ok(MANJU_SKILLS.includes('h3-prompt-writing'))
  assert.ok(MANJU_SKILLS.includes('jc-seedance'))
  for (const name of ['cinematic-four-panel-frames', 'seedance-storyboard-assets', 'jc-shengyin-sheji', 'jc-shengyin-daoyan']) {
    assert.ok(MANJU_SKILLS.includes(name))
    const router = readFileSync('public/skills/jc-manju-zhizuo/SKILL.md', 'utf8')
    assert.ok(router.includes(`../${name}/SKILL.md`))
  }
  assert.ok(!MANJU_SKILLS.includes('jc-shuaigemeinv'))
  for (const name of MANJU_SKILLS) assert.ok(existsSync(`public/skills/${name}/SKILL.md`), name)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  for (const name of MANJU_SKILLS) assert.ok(index.some((entry: { name: string }) => entry.name === name), name)
})

test('brainstorm is discoverable and remains selected across production session restore', () => {
  assert.ok(MANJU_SKILLS.includes('jc-manju-brainstorm'))
  const selected = [MANJU_ROUTER, 'jc-manju-brainstorm', WIKI_MEMORY_SKILL]
  assert.deepEqual(restoreManjuSelection(selected, { enabled: true }), selected)
  assert.deepEqual(restoreManjuSelection(selected, undefined), selected)
  assert.deepEqual(restoreManjuSelection(selected, { enabled: false }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection(selected, { enabled: false, wikiMemoryWasSelected: false }), [])
})

test('brainstorm resources and delegated skills resolve inside the production package', () => {
  const root = resolve('public/skills')
  const index = JSON.parse(readFileSync(`${root}/index.json`, 'utf8'))
  const skill = index.find((entry: { name: string }) => entry.name === 'jc-manju-brainstorm')
  assert.ok(skill, 'brainstorm must be indexed')
  const declared = new Set(skill.package.files.map((file: { path: string }) => file.path))
  const pending = ['SKILL.md']
  const visited = new Set<string>()
  while (pending.length) {
    const resource = pending.pop()!
    if (visited.has(resource)) continue
    visited.add(resource)
    assert.ok(declared.has(resource), `unpackaged resource: ${resource}`)
    const path = resolve(root, skill.id, resource)
    const content = readFileSync(path, 'utf8')
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolve(dirname(path), match[1]!)
      assert.ok(existsSync(target), `missing reference: ${target}`)
      const [name, ...parts] = relative(root, target).split(/[\\/]/)
      assert.ok(MANJU_SKILLS.includes(name!) || name === WIKI_MEMORY_SKILL, `outside route: ${name}`)
      if (name === skill.id) pending.push(parts.join('/'))
    }
  }
  assert.deepEqual([...visited].sort(), [...declared].sort(), 'every brainstorm resource must be reachable')
})

test('production routes explicitly named skills and defaults directly to H3', () => {
  const skill = readFileSync('public/skills/jc-manju-zhizuo/SKILL.md', 'utf8')
  assert.match(skill, /明确指定 Skill 或模型/)
  assert.match(skill, /未指定.*h3-prompt-writing.*MiniMax H3/)
  assert.match(skill, /不自动补跑/)
  assert.match(skill, /不询问默认模型/)
  assert.doesNotMatch(skill, /界面默认|上轮选择/)
  assert.doesNotMatch(skill, /完整项目的默认衔接|界面默认模型/)
})

test('routing instructions preserve continuation, natural requests and explicit beginner help', () => {
  const skill = readFileSync('public/skills/jc-manju-zhizuo/SKILL.md', 'utf8')
  const sections = ['明确指定 Skill 或模型', '明确续改已有产物', '明确指定交付物', '明确求起步引导', '其余未指定创作请求']
  let previous = -1
  for (const section of sections) {
    const position = skill.indexOf(section)
    assert.ok(position > previous, section)
    previous = position
  }
  for (const text of ['不因消息短', '不执行制作', '执行推荐的第一步', '引导不授权付费生成', '不要求固定文件名']) assert.ok(skill.includes(text), text)
  assert.match(skill, /明确续改已有产物/)
  assert.match(skill, /明确指定交付物/)
  assert.match(skill, /只有.*明确请求才进入下节/)
})

test('character format requests accept existing character text and override ordinary continuation routing', () => {
  const router = readFileSync('public/skills/jc-manju-zhizuo/SKILL.md', 'utf8')
  const format = readFileSync('public/skills/jc-juese-geshi/SKILL.md', 'utf8')
  assert.match(router, /已有角色文字提示词.*jc-juese-geshi/)
  assert.match(router, /格式转换.*优先于.*续改/)
  assert.match(format, /已有角色文字提示词/)
  assert.match(format, /文字模式.*不要求.*参考图/)
  assert.match(format, /不声称.*看过.*图片/)
  assert.match(format, /不重新设计.*服装/)
  assert.match(format, /H3.*Seedance.*不属于/)
  assert.match(format, /此段身份描述适用于全部三格/)
  assert.match(format, /此段造型描述适用于全部三格/)
  assert.match(format, /不要求先生成单幅角色图/)
  assert.match(format, /不凭空附加参考图/)
  assert.doesNotMatch(format, /缺少参考图时只指出需先选定人物图/)
})

test('the approved contract and packaged router share the same intent order', () => {
  const contract = readFileSync('docs/wiki/开发/漫剧制作合同.md', 'utf8')
  const sections = ['明确指定 Skill 或模型', '明确续改已有产物', '明确指定交付物', '明确求起步引导', '其他未明确指定的创作请求']
  let previous = -1
  for (const section of sections) {
    const position = contract.indexOf(section)
    assert.ok(position > previous, section)
    previous = position
  }
  assert.match(contract, /旧 `videoModel`.*不恢复、不传递、不参与路由/)
})

test('the composer retains the production entry without a model selector or model state', () => {
  const source = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  assert.match(source, /@click="[^"\n]*toggleManjuProduction\(\)"/)
  assert.doesNotMatch(source, /memory-manju-model|manjuVideoModel|manjuModelSnapshot|changeManjuVideoModel/)
  for (const file of ['src/services/deepSeekHarness.ts', 'src/services/desktopConversationRuntime.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /manjuVideoModel|ManjuVideoModel/)
  }
})

test('unsent toggle preferences survive reopening without leaking to a new conversation', () => {
  const legacyPreference = { enabled: true, videoModel: 'seedance-2.5' }
  assert.deepEqual(restoreManjuSelection(['wiki-memory'], legacyPreference), [MANJU_ROUTER, WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER], { enabled: false }), [])
  assert.deepEqual(restoreManjuSelection([], undefined), [])
  assert.deepEqual(restoreManjuSelection(['jc-manju-minimaxh3'], undefined), [MANJU_ROUTER])
  assert.deepEqual(restoreManjuSelection(['jc-daoyan-fenjing'], undefined), ['jc-seedance'])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, 'jc-seedance', WIKI_MEMORY_SKILL], undefined), [MANJU_ROUTER, 'jc-seedance', WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: false }), [])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: true }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreNovelSelection([], { enabled: true }), [NOVEL_SKILL])
  assert.deepEqual(restoreNovelSelection([MANJU_ROUTER, WIKI_MEMORY_SKILL], { enabled: true }), [NOVEL_SKILL, WIKI_MEMORY_SKILL])
  assert.deepEqual(
    restoreNovelSelection([NOVEL_SKILL, 'skill-creator', WIKI_MEMORY_SKILL], { enabled: true }),
    [NOVEL_SKILL, WIKI_MEMORY_SKILL],
  )
  assert.deepEqual(restoreNovelSelection([NOVEL_SKILL, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: false }), [])
})


test('short drama restores explicitly selected route skills and removes them on exit', async () => {
  const { SHORT_DRAMA_SKILLS, restoreShortDramaSelection } = await import('../shortDramaProduction')
  const selected = ['jc-duanju', 'jc-duanju-cehua', WIKI_MEMORY_SKILL]
  assert.ok(SHORT_DRAMA_SKILLS.includes('jc-xiangmuziliao'))
  assert.deepEqual(restoreShortDramaSelection(selected, { enabled: true }), selected)
  assert.deepEqual(restoreShortDramaSelection(selected, { enabled: false }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreShortDramaSelection(selected, { enabled: false, wikiMemoryWasSelected: false }), [])
  assert.deepEqual(restoreShortDramaSelection(['jc-duanju', 'jc-seedance']), ['jc-duanju'])
})


test('short drama route resources are packaged and all delegated links resolve inside its scope', () => {
  const route = JSON.parse(readFileSync('public/skills/short-drama-route.json', 'utf8'))
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  const allowed = new Set([...route.skills, 'wiki-memory'])
  for (const name of route.skills) {
    const entry = index.find((item: { name: string }) => item.name === name)
    assert.ok(entry?.package.files.some((file: { path: string }) => file.path === 'SKILL.md'), name)
    const path = resolve('public/skills', name, 'SKILL.md')
    for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolve(dirname(path), match[1]!)
      assert.ok(existsSync(target), target)
      assert.ok(allowed.has(relative(resolve('public/skills'), target).split(/[\\/]/)[0]), target)
    }
  }
})


test('native Wiki remains independent of all three production Skill selections', async () => {
  const { needsProjectWiki, nativeWikiSelection, PROJECT_WIKI } = await import('../projectWiki')
  const { restoreShortDramaSelection } = await import('../shortDramaProduction')
  assert.deepEqual(nativeWikiSelection(['wiki-memory', PROJECT_WIKI, 'skill-creator']), [PROJECT_WIKI, 'skill-creator'])
  assert.deepEqual(restoreManjuSelection([], { enabled: true }), [MANJU_ROUTER])
  assert.deepEqual(restoreNovelSelection([], { enabled: true }), [NOVEL_SKILL])
  assert.deepEqual(restoreShortDramaSelection([], { enabled: true }), ['jc-duanju'])
  for (const name of [MANJU_ROUTER, NOVEL_SKILL, 'jc-duanju', PROJECT_WIKI, 'wiki-memory'])
    assert.equal(needsProjectWiki('继续', [name]), true)
  assert.equal(needsProjectWiki('你好', []), false)
  assert.equal(needsProjectWiki('查询项目 Wiki', []), true)
})
