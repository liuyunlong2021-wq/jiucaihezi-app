import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  coalesceServerEvents,
  createOpenCodeGlobalEventBridge,
  enqueueServerEvent,
  type QueuedServerEvent,
} from '../eventBridge'

function messagePartUpdated(text: string): QueuedServerEvent {
  return {
    directory: '/project',
    payload: {
      type: 'message.part.updated',
      properties: {
        part: { id: 'prt_1', messageID: 'msg_1', sessionID: 'ses_1', type: 'text', text },
      },
    } as any,
  }
}

test('enqueue replaces adjacent updates for the same message part', () => {
  const queue: QueuedServerEvent[] = []

  assert.equal(enqueueServerEvent(queue, messagePartUpdated('你')), true)
  assert.equal(enqueueServerEvent(queue, messagePartUpdated('你好')), false)

  assert.equal(queue.length, 1)
  assert.equal((queue[0].payload.properties as any).part.text, '你好')
})

test('coalesce joins adjacent text deltas without crossing directory or field boundaries', () => {
  const delta = (directory: string, field: string, value: string): QueuedServerEvent => ({
    directory,
    payload: {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_1',
        messageID: 'msg_1',
        partID: 'prt_1',
        field,
        delta: value,
      },
    } as any,
  })

  const result = coalesceServerEvents([
    delta('/project', 'text', '你'),
    delta('/project', 'text', '好'),
    delta('/project', 'reasoning', 'A'),
    delta('/other', 'reasoning', 'B'),
  ])

  assert.equal(result.length, 3)
  assert.equal((result[0].payload.properties as any).delta, '你好')
  assert.equal((result[1].payload.properties as any).delta, 'A')
  assert.equal((result[2].payload.properties as any).delta, 'B')
})

test('global bridge starts once and routes official envelopes until stopped', async () => {
  let starts = 0
  let aborted = false
  async function* events(signal: AbortSignal) {
    yield { directory: '/project', payload: { type: 'server.connected', properties: {} } }
    yield { directory: '/project', payload: { type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'busy' } } } }
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        aborted = true
        resolve()
      }, { once: true })
    })
  }
  const client = {
    global: {
      event: async (input: { signal: AbortSignal }) => {
        starts++
        return { stream: events(input.signal) }
      },
    },
  } as any
  const received: QueuedServerEvent[] = []
  const bridge = createOpenCodeGlobalEventBridge(client, { flushFrameMs: 0 })
  bridge.subscribe(event => received.push(event))

  const first = bridge.start()
  const second = bridge.start()
  assert.equal(first, second)
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(starts, 1)
  assert.deepEqual(received.map(event => [event.directory, event.payload.type]), [
    ['/project', 'server.connected'],
    ['/project', 'session.status'],
  ])

  bridge.stop()
  await first
  assert.equal(aborted, true)
})

test('global bridge ignores sync envelopes', async () => {
  async function* events() {
    yield { directory: '/project', payload: { type: 'sync', properties: {} } }
  }
  const client = {
    global: { event: async () => ({ stream: events() }) },
  } as any
  const received: QueuedServerEvent[] = []
  const bridge = createOpenCodeGlobalEventBridge(client, {
    flushFrameMs: 0,
    reconnectDelayMs: 1,
  })
  bridge.subscribe(event => received.push(event))

  const running = bridge.start()
  await new Promise(resolve => setTimeout(resolve, 5))
  bridge.stop()
  await running

  assert.deepEqual(received, [])
})

test('global bridge stops retrying after repeated transport failures', async () => {
  let starts = 0
  const client = {
    global: {
      event: async () => {
        starts++
        throw new Error('sidecar unavailable')
      },
    },
  } as any
  const errors: unknown[] = []
  const bridge = createOpenCodeGlobalEventBridge(client, {
    reconnectDelayMs: 1,
    maxConsecutiveFailures: 3,
    onError: error => errors.push(error),
  })

  await bridge.start()

  assert.equal(starts, 3)
  assert.equal(errors.length, 1)
})
