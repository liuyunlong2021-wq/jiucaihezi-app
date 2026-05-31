import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildToolSignature, shouldCreateRuntimeSegment } from '../runtimeSegment'

test('buildToolSignature is stable and deduplicated', () => {
  assert.equal(buildToolSignature(['browser_open', 'dev_read', 'browser_open']), 'browser_open|dev_read')
})

test('runtime segment changes for skill vault reset and critical tool switches', () => {
  assert.equal(shouldCreateRuntimeSegment({ reason: 'new_session' }).create, true)
  assert.equal(shouldCreateRuntimeSegment({ previousSkillId: 'a', nextSkillId: 'b' }).trigger, 'skill_changed')
  assert.equal(shouldCreateRuntimeSegment({ previousPrimaryVaultId: 'v1', nextPrimaryVaultId: 'v2' }).trigger, 'primary_vault_changed')
  assert.equal(shouldCreateRuntimeSegment({ contextReset: true }).trigger, 'context_reset')
  assert.equal(shouldCreateRuntimeSegment({
    previousToolNames: ['browser_open'],
    nextToolNames: ['browser_open', 'dev_write'],
    criticalToolNames: ['dev_write'],
  }).trigger, 'critical_tools_changed')
})

test('runtime segment does not change for model or search-only changes', () => {
  assert.equal(shouldCreateRuntimeSegment({
    previousModelId: 'claude-sonnet-4-6',
    nextModelId: 'gpt-5.5',
  }).create, false)
  assert.equal(shouldCreateRuntimeSegment({
    previousWebSearchEnabled: false,
    nextWebSearchEnabled: true,
  }).create, false)
  assert.equal(shouldCreateRuntimeSegment({
    previousSecondaryVaultIds: ['a'],
    nextSecondaryVaultIds: ['b'],
  }).create, false)
})
