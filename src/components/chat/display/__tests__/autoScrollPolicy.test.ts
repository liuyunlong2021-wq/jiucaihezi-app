import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNearBottom, shouldAutoScrollAfterContentChange } from '../autoScrollPolicy'

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
