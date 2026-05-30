import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildExplicitAgentLockNotice,
  canAutoRouteAgent,
  createSkillRuntimeSpec,
  isSkillContentResolved,
  resolveAgentTier,
} from '../agentRuntime'
import type { SkillConfig } from '../../types/skill'

function skill(patch: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: 'skill_a',
    name: '写作Skill',
    description: '写作',
    triggers: ['写作'],
    skillContent: '## 角色\n你是写作Skill',
    references: [],
    examples: [],
    version: 1,
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    evolutionLog: [],
    ...patch,
  }
}

test('isSkillContentResolved rejects unresolved skill protocol placeholders', () => {
  assert.equal(isSkillContentResolved(skill({ skillContent: 'skill://foo/SKILL.md' })), false)
  assert.equal(isSkillContentResolved(skill({ skillContent: '## 角色\n完整内容' })), true)
})

test('isSkillContentResolved rejects generated preset fallback content', () => {
  assert.equal(isSkillContentResolved(skill({
    source: 'preset',
    skillContent: '## 写作Skill\n\n写作\n\n请根据以上角色定义完成用户的请求。',
  })), false)
})

test('createSkillRuntimeSpec includes tier, hash, summary and full skill content', () => {
  const spec = createSkillRuntimeSpec(skill())
  assert.equal(spec.id, 'skill_a')
  assert.equal(spec.tier, 'L1')
  assert.equal(spec.fullSkillMd, '## 角色\n你是写作Skill')
  assert.match(spec.contentHash, /^[a-f0-9]{16}$/)
  assert.equal(spec.summary, '写作')
})

test('resolveAgentTier treats missing tier as L1 and preserves L2', () => {
  assert.equal(resolveAgentTier(skill()), 'L1')
  assert.equal(resolveAgentTier(skill({ tier: 'L2' })), 'L2')
})

test('canAutoRouteAgent blocks automatic routing unless smart switching is enabled', () => {
  assert.equal(canAutoRouteAgent({ currentAgent: skill(), smartSwitchEnabled: false }), false)
  assert.equal(canAutoRouteAgent({ currentAgent: skill(), smartSwitchEnabled: true }), true)
  assert.equal(canAutoRouteAgent({ currentAgent: null, smartSwitchEnabled: false }), false)
  assert.equal(canAutoRouteAgent({ currentAgent: null, smartSwitchEnabled: true }), true)
})

test('canAutoRouteAgent blocks L2 internal routing unless smart switching is enabled', () => {
  assert.equal(canAutoRouteAgent({ currentAgent: skill({ tier: 'L2' }), smartSwitchEnabled: false }), false)
  assert.equal(canAutoRouteAgent({ currentAgent: skill({ tier: 'L2' }), smartSwitchEnabled: true }), true)
})

test('buildExplicitAgentLockNotice explains suggested switches without mutating selection', () => {
  assert.equal(
    buildExplicitAgentLockNotice(skill({ name: '写作Skill' }), '法律Skill'),
    '已锁定当前Skill「写作Skill」。如果想切换到「法律Skill」，请手动选择或开启智能切换。',
  )
})
