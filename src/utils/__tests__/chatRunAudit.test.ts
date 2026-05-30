import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildChatRunAuditTrace,
  recordAuditedChatRun,
} from '../chatRunAudit'
import { clearLastRunTrace, getLastRunTrace } from '../runTrace'
import type { SkillConfig } from '../../types/skill'

function skill(patch: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: 'skill_writer',
    name: '写作Skill',
    description: '负责小说创作',
    triggers: ['小说', '剧情'],
    skillContent: '## 角色\n你是写作Skill。\n\n## 能力\n保持人物一致性。',
    references: [],
    examples: [],
    version: 3,
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    evolutionLog: [],
    ...patch,
  }
}

test('buildChatRunAuditTrace proves selected skill vault and knowledge evidence are wired', () => {
  const trace = buildChatRunAuditTrace({
    runId: 'chat_1',
    timestamp: 123,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    agent: skill(),
    vault: { id: 'vault_story', name: '小说设定库' },
    contextMode: 'deep',
    sections: [
      { name: 'product-system', tokens: 22 },
      { name: 'skill', tokens: 30 },
      { name: 'knowledge', tokens: 48 },
    ],
    knowledgeHits: [{
      id: 'hit_1',
      path: 'wiki/角色/主角.md',
      title: '主角.md',
      source: 'wiki',
      reason: 'Wiki 命中 · title:主角 · skill-hint:写作Skill',
      score: 88,
      snippet: '主角设定',
    }],
    knowledgeSearched: true,
    staticKnowledgeInjected: true,
    exposedTools: ['document_to_markdown', 'browser_search'],
    promptPreview: '[当前Skill开始]\nSECRET_PROMPT\n[知识库资料开始]\n主角设定\n[知识库资料结束]',
  })

  assert.equal(trace.selectedSkill?.name, '写作Skill')
  assert.equal(trace.selectedSkill?.tier, 'L1')
  assert.match(trace.selectedSkill?.hash || '', /^[a-f0-9]{16}$/)
  assert.equal(trace.selectedVault?.name, '小说设定库')
  assert.deepEqual(trace.contextPlan.sections.map(section => section.name), ['product-system', 'skill', 'knowledge'])
  assert.deepEqual(trace.exposedTools, ['document_to_markdown', 'browser_search'])
  assert.equal(trace.knowledgeHits[0].reason.includes('skill-hint'), true)
  assert.equal(trace.promptPreview.includes('SECRET_PROMPT'), false)
  assert.match(trace.promptPreview, /prompt body redacted/i)
})

test('recordAuditedChatRun returns UI-safe summary without leaking prompt preview', () => {
  clearLastRunTrace()
  const summary = recordAuditedChatRun({
    runId: 'chat_2',
    timestamp: 456,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    agent: skill({ tier: 'L2', source: 'preset' }),
    vault: { id: 'vault_story', name: '小说设定库' },
    contextMode: 'balanced',
    sections: [{ name: 'knowledge', tokens: 12 }],
    knowledgeHits: [],
    knowledgeSearched: true,
    staticKnowledgeInjected: false,
    exposedTools: ['document_to_markdown'],
    promptPreview: 'SECRET_PROMPT_SHOULD_NOT_APPEAR_IN_SUMMARY',
  })

  assert.equal(summary.skillLabel, '写作Skill · L2')
  assert.equal(summary.vaultLabel, '小说设定库')
  assert.deepEqual(summary.toolLabels, ['document_to_markdown'])
  assert.equal(summary.knowledgeStatus, '已检索，未命中相关条目')
  assert.equal('promptPreview' in summary, false)
  assert.equal(getLastRunTrace()?.promptPreview.includes('SECRET_PROMPT'), false)
  assert.match(getLastRunTrace()?.promptPreview || '', /prompt body redacted/i)
})
