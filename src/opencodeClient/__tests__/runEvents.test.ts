import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getOpenCodeRunErrorDetail,
  isOpenCodeRunCompleteEvent,
  isOpenCodeRunErrorEvent,
  normalizeOpenCodeSessionStatus,
} from '../runEvents'

test('detects all official-compatible run completion events', () => {
  assert.equal(isOpenCodeRunCompleteEvent('session.idle', { sessionID: 'ses_1' }), true)
  assert.equal(isOpenCodeRunCompleteEvent('session.finished', { sessionID: 'ses_1' }), true)
  assert.equal(isOpenCodeRunCompleteEvent('session.next.finished', { sessionID: 'ses_1' }), true)
  assert.equal(isOpenCodeRunCompleteEvent('session.status', { status: { type: 'idle' } }), true)
  assert.equal(isOpenCodeRunCompleteEvent('session.status', { status: 'idle' }), true)
  assert.equal(isOpenCodeRunCompleteEvent('session.status', { status: { type: 'busy' } }), false)
})

test('detects status error as a run error event with a visible detail', () => {
  const event = {
    status: {
      type: 'error',
      error: { message: 'provider failed' },
    },
  }

  assert.equal(normalizeOpenCodeSessionStatus(event), 'error')
  assert.equal(isOpenCodeRunErrorEvent('session.status', event), true)
  assert.match(getOpenCodeRunErrorDetail('session.status', event), /provider failed/)
  assert.match(getOpenCodeRunErrorDetail('session.error', { error: 'boom' }), /boom/)
})

test('formats OpenCode APIError like official clients by using data.message', () => {
  const event = {
    error: {
      name: 'APIError',
      data: {
        message: 'Credit has been exceeded! Current cost: 10216.95135140001, Max credit: 10200.0',
        statusCode: 400,
        isRetryable: false,
        responseHeaders: {
          'x-oneapi-request-id': '202606091011115458088828268d9d6ZSFRZTv6',
        },
        responseBody: '{"error":{"message":"nested budget message","type":"budget_exceeded"}}',
      },
    },
  }

  const detail = getOpenCodeRunErrorDetail('session.error', event)
  assert.equal(detail, 'Credit has been exceeded! Current cost: 10216.95135140001, Max credit: 10200.0')
  assert.doesNotMatch(detail, /responseHeaders/)
  assert.doesNotMatch(detail, /responseBody/)
  assert.doesNotMatch(detail, /x-oneapi-request-id/)
})

test('falls back to provider responseBody message when APIError data.message is absent', () => {
  const detail = getOpenCodeRunErrorDetail('session.error', {
    error: {
      name: 'APIError',
      data: {
        statusCode: 400,
        isRetryable: false,
        responseBody: '{"error":{"message":"Budget limit reached","type":"budget_exceeded"}}',
      },
    },
  })

  assert.equal(detail, 'Budget limit reached')
})
