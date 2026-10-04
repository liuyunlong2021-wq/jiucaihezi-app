import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import {
  MANJU_ROUTER,
  MANJU_SKILLS,
  manjuRoutePrompt,
  normalizeManjuVideoModel,
  restoreManjuSelection,
} from '../manjuProduction'

test('the production bundle includes both video routes and excludes the portrait skill', () => {
  assert.equal(MANJU_SKILLS.length, 11)
  assert.ok(MANJU_SKILLS.includes('h3-prompt-writing'))
  assert.ok(MANJU_SKILLS.includes('jc-seedance'))
  assert.ok(!MANJU_SKILLS.includes('jc-shuaigemeinv'))
  for (const name of MANJU_SKILLS) assert.ok(existsSync(`public/skills/${name}/SKILL.md`), name)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  for (const name of MANJU_SKILLS) assert.ok(index.some((entry: { name: string }) => entry.name === name), name)
})

test('a conversation preference is a fallback and allows per-shot overrides and mixed models', () => {
  const h3 = manjuRoutePrompt('minimax-h3')
  const seedance = manjuRoutePrompt('seedance-2.5')
  assert.match(h3, /默认视频模型：MiniMax H3/)
  assert.match(seedance, /默认视频模型：Seedance 2.5/)
  for (const prompt of [h3, seedance, manjuRoutePrompt('ask')]) {
    assert.match(prompt, /本轮用户明确指定.*优先/)
    assert.match(prompt, /不同镜头.*不同模型/)
    assert.match(prompt, /时间戳.*用户/)
  }
  assert.match(manjuRoutePrompt('ask'), /未指定/)
  assert.equal(normalizeManjuVideoModel('other'), 'ask')
})

test('unsent toggle preferences survive reopening without leaking to a new conversation', () => {
  assert.deepEqual(restoreManjuSelection(['wiki-memory'], { enabled: true, videoModel: 'seedance-2.5' }), [MANJU_ROUTER])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER], { enabled: false, videoModel: 'ask' }), [])
  assert.deepEqual(restoreManjuSelection([], undefined), [])
  assert.deepEqual(restoreManjuSelection(['jc-manju-minimaxh3'], undefined), [MANJU_ROUTER])
  assert.deepEqual(restoreManjuSelection(['jc-daoyan-fenjing'], undefined), ['jc-seedance'])
  assert.deepEqual(restoreManjuSelection([MANJU_ROUTER, 'jc-seedance', 'wiki-memory'], undefined), [MANJU_ROUTER, 'jc-seedance'])
})
