import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WIKI_AGENT_POLICY } from '../wikiAgent'

test('native Wiki policy keeps only the generic capability boundary', () => {
  for (const term of ['外部 Markdown 事实源', 'Skill 负责当前任务的方法', '按计划提供事实', '经过校验的 Wiki 变更计划'])
    assert.match(WIKI_AGENT_POLICY, new RegExp(term))
})

test('native Wiki policy keeps rejected legacy behavior out', () => {
  for (const term of ['自动扫描全部 Raw', '固定小说骨架', '自动修复所有问题', '来源记录自动成为权威结论'])
    assert.doesNotMatch(WIKI_AGENT_POLICY, new RegExp(term))
})
