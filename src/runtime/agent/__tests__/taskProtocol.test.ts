import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderTaskActions, validateTaskEnvelope } from '../taskProtocol'

const agents = [
  { id: 'wiki', readKinds: ['context'], actionKinds: ['apply'] },
  { id: 'mcp', readKinds: ['query'], actionKinds: ['call'] },
]

test('TaskEnvelope accepts only selected concrete capabilities', () => {
  const result = validateTaskEnvelope({
    version: 1,
    runId: 'run-1',
    source: 'model',
    status: 'ready_to_execute',
    capabilities: ['wiki'],
    reads: [],
    actions: [{ id: 'write', agent: 'wiki', kind: 'apply', arguments: {} }],
  }, agents, ['wiki'])
  assert.equal(result.actions[0]?.agent, 'wiki')
})

test('TaskEnvelope rejects capability expansion and dependency cycles', () => {
  assert.throws(() => validateTaskEnvelope({ version: 1, runId: 'run-1', source: 'model', status: 'ready_to_execute', capabilities: ['mcp'], reads: [], actions: [] }, agents, ['wiki']))
  assert.throws(() => orderTaskActions([
    { id: 'a', agent: 'wiki', kind: 'apply', arguments: {}, dependsOn: ['b'] },
    { id: 'b', agent: 'wiki', kind: 'apply', arguments: {}, dependsOn: ['a'] },
  ]))
})

test('model cannot forge observations or completion without an answer', () => {
  assert.throws(() => validateTaskEnvelope({ version: 1, runId: 'run-1', source: 'model', status: 'complete', capabilities: [], reads: [], actions: [], observations: [] }, [], []))
  assert.throws(() => validateTaskEnvelope({ version: 1, runId: 'run-1', source: 'model', status: 'complete', capabilities: [], reads: [], actions: [] }, [], []))
  assert.throws(() => validateTaskEnvelope({ version: 1, runId: 'run-1', source: 'model', status: 'ready_to_execute', capabilities: ['wiki'], reads: [], actions: [], receipt: { ok: true, completedActionIds: [], failedActionIds: [] } }, agents, ['wiki']))
  assert.throws(() => validateTaskEnvelope({ version: 1, runId: 'run-1', source: 'model', status: 'needs_observation', capabilities: ['wiki'], reads: [], actions: [{ id: 'x', agent: 'wiki', kind: 'apply', arguments: {} }] }, agents, ['wiki']))
  assert.throws(() => validateTaskEnvelope({ version: 1, runId: 'run-1', source: 'model', status: 'complete', capabilities: [], reads: [], actions: [], answer: 'ok' }, agents, [], 'program'))
})

test('program observations and receipts are validated instead of type-cast', () => {
  assert.throws(() => validateTaskEnvelope({
    version: 1,
    runId: 'run-1',
    source: 'program',
    status: 'complete',
    capabilities: [],
    reads: [],
    actions: [],
    answer: 'ok',
    observations: [{ id: 'o1', agent: 'wiki', ok: 'yes' }],
    receipt: { ok: true, completedActionIds: 'a1', failedActionIds: [] },
  }, agents, [], 'program'), /observations\[0\]\.ok|receipt\.completedActionIds/)
})

test('program receipts and observations must reference the real plan', () => {
  assert.throws(() => validateTaskEnvelope({
    version: 1,
    runId: 'run-1',
    source: 'program',
    status: 'complete',
    capabilities: ['wiki'],
    reads: [{ id: 'read-1', agent: 'wiki', kind: 'context', arguments: {} }],
    actions: [{ id: 'write-1', agent: 'wiki', kind: 'apply', arguments: {} }],
    observations: [{ id: 'obs-1', readId: 'missing', agent: 'wiki', ok: true }],
    answer: 'ok',
    receipt: { ok: true, completedActionIds: ['missing'], failedActionIds: [] },
  }, agents, ['wiki'], 'program'))
})
