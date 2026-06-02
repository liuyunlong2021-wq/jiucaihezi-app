import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConversationExperienceTrace } from '../conversationExperienceTrace'

test('createConversationExperienceTrace records streaming and scroll diagnostics without prompt content', () => {
  const trace = createConversationExperienceTrace({ messageId: 'msg_1', runId: 'run_1', now: () => 100 })

  trace.markStatus()
  trace.markDelta(12)
  trace.markDelta(700)
  trace.markVisibleCommit()
  trace.markAutoScrollSuppressed()
  trace.markToolStatus('running')
  trace.markToolStatus('succeeded')

  const snapshot = trace.snapshot()
  assert.equal(snapshot.messageId, 'msg_1')
  assert.equal(snapshot.runId, 'run_1')
  assert.equal(snapshot.firstStatusAt, 100)
  assert.equal(snapshot.firstDeltaAt, 100)
  assert.equal(snapshot.totalDeltas, 2)
  assert.equal(snapshot.largeDeltaCount, 1)
  assert.equal(snapshot.maxDeltaChars, 700)
  assert.equal(snapshot.visibleCommits, 1)
  assert.equal(snapshot.autoScrollSuppressed, true)
  assert.deepEqual(snapshot.toolStatusTransitions, ['running', 'succeeded'])
  assert.equal('prompt' in snapshot, false)
})
