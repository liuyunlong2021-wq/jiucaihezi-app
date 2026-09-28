import assert from 'node:assert/strict'
import { test } from 'node:test'
import { desktopRemoteEventCursor, nextDesktopRemoteEventSeq } from '@/services/desktopRemoteEventSeq'

test('每个 Session 在同一 Gateway epoch 内独立连续编号', () => {
  const before = desktopRemoteEventCursor('session-a')
  assert.equal(nextDesktopRemoteEventSeq('session-a'), before.seq + 1)
  assert.equal(nextDesktopRemoteEventSeq('session-b'), 1)
  assert.equal(nextDesktopRemoteEventSeq('session-a'), before.seq + 2)
  assert.equal(desktopRemoteEventCursor('session-a').gatewayEpoch, before.gatewayEpoch)
})

test('同一个 Session 的 snapshot 游标等于最近一次发布序号', () => {
  const sessionId = 'session-c'
  const seq = nextDesktopRemoteEventSeq(sessionId)
  assert.deepEqual(desktopRemoteEventCursor(sessionId), {
    gatewayEpoch: desktopRemoteEventCursor(sessionId).gatewayEpoch,
    seq,
  })
})
