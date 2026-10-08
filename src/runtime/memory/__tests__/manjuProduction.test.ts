import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import {
  MANJU_ROUTER,
  MANJU_SKILLS,
  WIKI_MEMORY_SKILL,
  manjuRoutePrompt,
  restoreManjuSelection,
} from '../manjuProduction'
import { NOVEL_SKILL, restoreNovelSelection } from '../novelProduction'

test('the production bundle includes both video routes and excludes the portrait skill', () => {
  assert.equal(MANJU_SKILLS.length, 11)
  assert.ok(MANJU_SKILLS.includes('h3-prompt-writing'))
  assert.ok(MANJU_SKILLS.includes('jc-seedance'))
  assert.ok(!MANJU_SKILLS.includes('jc-shuaigemeinv'))
  for (const name of MANJU_SKILLS) assert.ok(existsSync(`public/skills/${name}/SKILL.md`), name)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  for (const name of MANJU_SKILLS) assert.ok(index.some((entry: { name: string }) => entry.name === name), name)
})

test('production routes explicitly named skills and defaults directly to H3', () => {
  const prompt = manjuRoutePrompt()
  assert.match(prompt, /用户明确指定.*Skill.*优先/)
  assert.match(prompt, /未指定.*h3-prompt-writing.*MiniMax H3/)
  assert.match(prompt, /不自动补跑/)
  assert.doesNotMatch(prompt, /界面默认|上轮选择|询问.*模型/)
  const skill = readFileSync('public/skills/jc-manju-zhizuo/SKILL.md', 'utf8')
  assert.match(skill, /未指定.*h3-prompt-writing/)
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
  assert.match(manjuRoutePrompt(), /续改已有产物沿用原 Skill 与格式/)
  assert.match(manjuRoutePrompt(), /自然语言指定交付物/)
  assert.match(manjuRoutePrompt(), /仅明确求起步才引导/)
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
  assert.match(source, /@click="toggleManjuProduction"/)
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
  assert.deepEqual(restoreManjuSelection(['jc-manju-minimaxh3'], undefined), [MANJU_ROUTER, WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection(['jc-daoyan-fenjing'], undefined), ['jc-seedance'])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, 'jc-seedance', WIKI_MEMORY_SKILL], undefined), [MANJU_ROUTER, 'jc-seedance', WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: false }), [])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: true }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreNovelSelection([], { enabled: true }), [NOVEL_SKILL, WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreNovelSelection([MANJU_ROUTER, WIKI_MEMORY_SKILL], { enabled: true }), [NOVEL_SKILL, WIKI_MEMORY_SKILL])
  assert.deepEqual(
    restoreNovelSelection([NOVEL_SKILL, 'skill-creator', WIKI_MEMORY_SKILL], { enabled: true }),
    [NOVEL_SKILL, WIKI_MEMORY_SKILL],
  )
  assert.deepEqual(restoreNovelSelection([NOVEL_SKILL, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: false }), [])
})
