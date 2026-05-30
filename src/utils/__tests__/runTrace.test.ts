import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRunTraceSummary,
  clearLastRunTrace,
  getLastRunTrace,
  recordRunTrace,
} from '../runTrace'

test('recordRunTrace stores safe metadata without prompt body', () => {
  clearLastRunTrace()
  recordRunTrace({
    runId: 'run_1',
    timestamp: 1,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    selectedSkill: {
      id: 'skill_a',
      name: '写作搭子',
      tier: 'L1',
      hash: 'abc123',
    },
    selectedVault: {
      id: 'vault_a',
      name: '小说设定',
    },
    contextPlan: {
      mode: 'balanced',
      sections: [
        { name: 'system', tokens: 20 },
        { name: 'knowledge', tokens: 30 },
      ],
    },
    knowledgeHits: [
      { path: 'wiki/角色/主角.md', title: '主角', reason: '关键词命中', score: 12 },
    ],
    exposedTools: ['document_to_markdown'],
    promptPreview: '## Secret Skill\nDo not keep this body.\n# Vault\nSensitive wiki evidence.',
  })

  const trace = getLastRunTrace()
  assert.equal(trace?.runId, 'run_1')
  assert.equal(trace?.selectedSkill?.name, '写作搭子')
  assert.equal(trace?.promptPreview.includes('Secret Skill'), false)
  assert.equal(trace?.promptPreview.includes('Sensitive wiki evidence'), false)
  assert.match(trace?.promptPreview || '', /prompt body redacted/i)
  assert.equal(trace?.knowledgeHits[0].path, 'wiki/角色/主角.md')
  assert.deepEqual(trace?.exposedTools, ['document_to_markdown'])
})

test('clearLastRunTrace removes stored trace', () => {
  recordRunTrace({
    runId: 'run_2',
    timestamp: 2,
    model: 'gpt-5.5',
    runtime: 'responses',
    contextPlan: { mode: 'fast', sections: [] },
    knowledgeHits: [],
    exposedTools: [],
    promptPreview: 'short',
  })
  clearLastRunTrace()
  assert.equal(getLastRunTrace(), null)
})

test('buildRunTraceSummary exposes safe context metadata without prompt preview', () => {
  const summary = buildRunTraceSummary({
    runId: 'run_3',
    timestamp: 3,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    selectedSkill: { id: 'skill_a', name: '写作搭子', tier: 'L1', hash: 'hash123' },
    selectedVault: { id: 'vault_a', name: '小说设定' },
    contextPlan: {
      mode: 'deep',
      sections: [
        { name: 'product-system', tokens: 10 },
        { name: 'knowledge', tokens: 20 },
      ],
    },
    knowledgeHits: [
      { path: 'wiki/a.md', title: 'A', reason: 'Wiki 命中', score: 9 },
    ],
    exposedTools: ['document_to_markdown'],
    knowledgeSearched: true,
    promptPreview: 'secret prompt preview',
  })

  assert.equal(summary.model, 'gpt-5.5')
  assert.equal(summary.skillLabel, '写作搭子 · L1')
  assert.equal(summary.vaultLabel, '小说设定')
  assert.equal(summary.sectionLabels[1], 'knowledge 20 tokens')
  assert.deepEqual(summary.toolLabels, ['document_to_markdown'])
  assert.equal(summary.knowledgeLabels[0], 'A · wiki/a.md · Wiki 命中')
  assert.equal(summary.knowledgeStatus, '命中 1 条')
  assert.equal('promptPreview' in summary, false)
})

test('buildRunTraceSummary distinguishes searched but unmatched knowledge', () => {
  const summary = buildRunTraceSummary({
    runId: 'run_4',
    timestamp: 4,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    contextPlan: { mode: 'balanced', sections: [] },
    knowledgeHits: [],
    exposedTools: [],
    knowledgeSearched: true,
    promptPreview: '',
  })

  assert.equal(summary.knowledgeStatus, '已检索，未命中相关条目')
})

test('buildRunTraceSummary reports static knowledge injection without retrieval hits', () => {
  const summary = buildRunTraceSummary({
    runId: 'run_5',
    timestamp: 5,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    contextPlan: { mode: 'balanced', sections: [] },
    knowledgeHits: [],
    exposedTools: [],
    knowledgeSearched: true,
    staticKnowledgeInjected: true,
    promptPreview: '',
  })

  assert.equal(summary.knowledgeStatus, '已检索，未命中条目；已注入知识库规则/钉选记忆')
})
