import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseWikiAgentStep,
  parseWikiReadPlan,
  parseWikiSynthesisAndChangePlan,
  WIKI_READ_PLAN_SYSTEM_PROMPT,
  WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT,
} from '../wikiPlans'

test('generic Wiki plans treat Skill as method rules, not a domain schema', () => {
  assert.match(WIKI_READ_PLAN_SYSTEM_PROMPT, /Skill 是业务规则核心，Wiki 只提供事实/)
  assert.match(WIKI_READ_PLAN_SYSTEM_PROMPT, /任务、必要对话、完整 Skill、Wiki 根 index/)
  assert.match(WIKI_READ_PLAN_SYSTEM_PROMPT, /已选 Skill 或用户明确给出的 Wiki 根内路径属于直接读取授权/)
  assert.match(WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT, /Wiki 只负责事实、页面组织和确定性落盘/)
  assert.match(WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT, /Skill 规则不是 Wiki 事实/)
  assert.doesNotMatch(WIKI_READ_PLAN_SYSTEM_PROMPT, /角色|场景|道具|伏笔|分集/)
})

test('Wiki Agent accepts the minimal Skill-led step protocol', () => {
  assert.deepEqual(parseWikiAgentStep('{"paths":["日记/index.md"]}'), {
    kind: 'read',
    plan: {
      paths: [{ path: '日记/index.md', reason: '完成任务所需资料' }],
      missing: [],
      sufficient: false,
      status: 'need_more',
    },
  })
  assert.deepEqual(
    parseWikiAgentStep(JSON.stringify({
      answer: '已完成',
      actions: [{ kind: 'write', path: '日记/2026/0830.md', content: '正文' }],
    })),
    {
      kind: 'final',
      plan: {
        answer: '已完成',
        changePlan: {
          reason: '',
          basis: [],
          operations: [{
            kind: 'create',
            path: '日记/2026/0830.md',
            content: '正文',
            title: '0830',
          }],
          indexChanges: [],
        },
      },
    },
  )
})

test('synthesis protocol treats the previous assistant answer as Wiki input when requested', () => {
  assert.match(WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT, /最近一条 assistant 消息就是待整理正文/)
  assert.match(WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT, /必须直接整理该正文并输出可执行 changePlan/)
})

test('ReadPlan accepts a bounded unique list and rejects duplicate or unsafe paths', () => {
  assert.deepEqual(
    parseWikiReadPlan(
      JSON.stringify({
        paths: [{ path: '剧情/总纲.md', reason: '确定目标' }],
        missing: [],
        sufficient: true,
      }),
    ),
    {
      paths: [{ path: '剧情/总纲.md', reason: '确定目标' }],
      missing: [],
      sufficient: true,
      status: 'complete',
    },
  )
  assert.throws(
    () =>
      parseWikiReadPlan(
        JSON.stringify({
          paths: [
            { path: 'a.md', reason: 'a' },
            { path: 'a.md', reason: 'b' },
          ],
          missing: [],
          sufficient: true,
        }),
      ),
    /路径重复/,
  )
  assert.throws(
    () =>
      parseWikiReadPlan(
        JSON.stringify({
          paths: [{ path: '../secret.md', reason: 'bad' }],
          missing: [],
          sufficient: true,
        }),
      ),
    /项目内相对路径/,
  )
})

test('Synthesis plan separates answer from a complete Wiki change plan', () => {
  const parsed = parseWikiSynthesisAndChangePlan(
    JSON.stringify({
      answer: '正文',
      changePlan: {
        reason: '新增页面',
        basis: ['剧情/总纲.md'],
        operations: [{ kind: 'create', path: '剧情/第1集.md', title: '第1集', content: '正文' }],
        indexChanges: [{ directory: '剧情', path: '剧情/第1集.md', title: '第1集', action: 'add' }],
      },
    }),
  )
  assert.equal(parsed.answer, '正文')
  assert.equal(parsed.changePlan?.operations[0]?.kind, 'create')
  assert.equal(parsed.changePlan?.indexChanges[0]?.directory, '剧情')
})

test('Synthesis plan accepts a simple create change without repeating the operation kind', () => {
  const parsed = parseWikiSynthesisAndChangePlan(
    JSON.stringify({
      answer: '正文',
      changePlan: {
        reason: '新增页面',
        basis: ['剧情/总纲.md'],
        operations: [{ path: '剧情/第2集.md', title: '第2集', content: '正文' }],
      },
    }),
  )
  assert.equal(parsed.changePlan?.operations[0]?.kind, 'create')
  assert.deepEqual(parsed.changePlan?.indexChanges, [])
})

test('Synthesis plan maps a simple write action to a create operation', () => {
  const parsed = parseWikiSynthesisAndChangePlan(
    JSON.stringify({
      answer: '正文',
      changePlan: {
        reason: '新增页面',
        basis: ['剧情/总纲.md'],
        operations: [{ action: 'write', path: '剧情/第3集.md', title: '第3集', content: '正文' }],
      },
    }),
  )
  assert.equal(parsed.changePlan?.operations[0]?.kind, 'create')
})

test('read-only synthesis can omit a change plan, while malformed mutations fail', () => {
  assert.deepEqual(parseWikiSynthesisAndChangePlan('{"answer":"只读结果","changePlan":null}'), {
    answer: '只读结果',
    changePlan: null,
  })
  assert.throws(
    () =>
      parseWikiSynthesisAndChangePlan(
        JSON.stringify({
          answer: '正文',
          changePlan: { reason: '缺操作类型', basis: ['a.md'], operations: [{}] },
        }),
      ),
    /operations\[0\]\.kind/,
  )
  assert.throws(() => parseWikiSynthesisAndChangePlan('普通回答'), /合法 JSON/)
})
