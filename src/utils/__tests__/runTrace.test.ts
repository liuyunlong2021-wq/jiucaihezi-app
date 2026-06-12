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
      name: '写作Skill',
      tier: 'L1',
      hash: 'abc123',
    },
    contextPlan: {
      mode: 'balanced',
      sections: [
        { name: 'system', tokens: 20 },
        { name: 'project-files', tokens: 30 },
      ],
    },
    exposedTools: ['document_to_markdown'],
    promptPreview: '## Secret Skill\nDo not keep this body.\n# Project\nSensitive project evidence.',
  })

  const trace = getLastRunTrace()
  assert.equal(trace?.runId, 'run_1')
  assert.equal(trace?.selectedSkill?.name, '写作Skill')
  assert.equal(trace?.promptPreview.includes('Secret Skill'), false)
  assert.equal(trace?.promptPreview.includes('Sensitive project evidence'), false)
  assert.match(trace?.promptPreview || '', /prompt body redacted/i)
  assert.deepEqual(trace?.exposedTools, ['document_to_markdown'])
})

test('clearLastRunTrace removes stored trace', () => {
  recordRunTrace({
    runId: 'run_2',
    timestamp: 2,
    model: 'gpt-5.5',
    runtime: 'responses',
    contextPlan: { mode: 'fast', sections: [] },
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
    selectedSkill: { id: 'skill_a', name: '写作Skill', tier: 'L1', hash: 'hash123' },
    contextPlan: {
      mode: 'deep',
      sections: [
        { name: 'product-system', tokens: 10 },
        { name: 'project-files', tokens: 20 },
      ],
    },
    exposedTools: ['document_to_markdown'],
    promptPreview: 'secret prompt preview',
  })

  assert.equal(summary.model, 'gpt-5.5')
  assert.equal(summary.skillLabel, '写作Skill · L1')
  assert.equal(summary.sectionLabels[1], 'project-files 20 tokens')
  assert.deepEqual(summary.toolLabels, ['document_to_markdown'])
  assert.equal('promptPreview' in summary, false)
})
