import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createBottomAnchorFollow,
  isNearBottom,
  shouldAutoScrollAfterContentChange,
} from '../autoScrollPolicy'

test('isNearBottom treats the old viewport bottom as eligible before content grows', () => {
  assert.equal(isNearBottom({
    scrollTop: 900,
    clientHeight: 500,
    scrollHeight: 1450,
  }), true)
})

test('shouldAutoScrollAfterContentChange follows only when user did not scroll away', () => {
  assert.equal(shouldAutoScrollAfterContentChange({
    wasAtBottom: true,
    userScrolled: false,
  }), true)

  assert.equal(shouldAutoScrollAfterContentChange({
    wasAtBottom: true,
    userScrolled: true,
  }), false)

  assert.equal(shouldAutoScrollAfterContentChange({
    wasAtBottom: false,
    userScrolled: false,
  }), false)
})

test('bottom anchor follow keeps locking to the newest content for multiple resize frames', () => {
  const calls: string[] = []
  const follow = createBottomAnchorFollow({
    frames: 3,
    isAnchored: () => true,
    scrollToBottom: () => calls.push('bottom'),
  })

  assert.equal(follow.tick(), true)
  assert.equal(follow.tick(), true)
  assert.equal(follow.tick(), true)
  assert.equal(follow.tick(), false)
  assert.deepEqual(calls, ['bottom', 'bottom', 'bottom'])
})

test('bottom anchor follow stops immediately when user leaves the bottom', () => {
  const calls: string[] = []
  const follow = createBottomAnchorFollow({
    frames: 3,
    isAnchored: () => false,
    scrollToBottom: () => calls.push('bottom'),
  })

  assert.equal(follow.tick(), false)
  assert.deepEqual(calls, [])
})
