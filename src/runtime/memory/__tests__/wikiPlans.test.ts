import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseWikiReadPlan,
  parseWikiSynthesisAndChangePlan,
  WIKI_READ_PLAN_SYSTEM_PROMPT,
  WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT,
} from '../wikiPlans'

test('generic Wiki plans treat Skill as method rules, not a domain schema', () => {
  assert.match(WIKI_READ_PLAN_SYSTEM_PROMPT, /Skill.*方法.*格式.*质量规则/)
  assert.match(WIKI_READ_PLAN_SYSTEM_PROMPT, /不要.*Wiki.*事实/)
  assert.match(WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT, /Wiki 只负责事实、页面组织和确定性落盘/)
  assert.match(WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT, /Skill 规则不是 Wiki 事实/)
  assert.doesNotMatch(WIKI_READ_PLAN_SYSTEM_PROMPT, /角色|场景|道具|伏笔|分集/)
})

test('ReadPlan accepts a bounded unique list and rejects duplicate or unsafe paths', () => {
  assert.deepEqual(parseWikiReadPlan(JSON.stringify({
    paths: [{ path: '剧情/总纲.md', reason: '确定目标' }],
    missing: [],
    sufficient: true,
  })), {
    paths: [{ path: '剧情/总纲.md', reason: '确定目标' }],
    missing: [],
    sufficient: true,
  })
  assert.throws(() => parseWikiReadPlan(JSON.stringify({
    paths: [{ path: 'a.md', reason: 'a' }, { path: 'a.md', reason: 'b' }], missing: [], sufficient: true,
  })), /路径重复/)
  assert.throws(() => parseWikiReadPlan(JSON.stringify({
    paths: [{ path: '../secret.md', reason: 'bad' }], missing: [], sufficient: true,
  })), /项目内相对路径/)
})

test('Synthesis plan separates answer from a complete Wiki change plan', () => {
  const parsed = parseWikiSynthesisAndChangePlan(JSON.stringify({
    answer: '正文',
    changePlan: {
      reason: '新增页面',
      basis: ['剧情/总纲.md'],
      operations: [{ kind: 'create', path: '剧情/第1集.md', title: '第1集', content: '正文' }],
      indexChanges: [{ directory: '剧情', path: '剧情/第1集.md', title: '第1集', action: 'add' }],
    },
  }))
  assert.equal(parsed.answer, '正文')
  assert.equal(parsed.changePlan?.operations[0]?.kind, 'create')
  assert.equal(parsed.changePlan?.indexChanges[0]?.directory, '剧情')
})

test('read-only synthesis can omit a change plan, but malformed mutations fail', () => {
  assert.deepEqual(parseWikiSynthesisAndChangePlan('{"answer":"只读结果","changePlan":null}'), {
    answer: '只读结果', changePlan: null,
  })
  assert.throws(() => parseWikiSynthesisAndChangePlan(JSON.stringify({
    answer: '正文', changePlan: { reason: '缺入口', basis: ['a.md'], operations: [{ kind: 'create', path: 'a.md', title: 'A', content: '正文' }] },
  })), /indexChanges 必须是数组/)
  assert.throws(() => parseWikiSynthesisAndChangePlan('普通回答'), /合法 JSON/)
})
