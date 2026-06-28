import assert from 'node:assert/strict'
import { test } from 'node:test'

import { subscribeOpenCodeEvents } from '../eventBridge'

async function* events() {
  yield { type: 'session.next.text.delta', properties: { sessionID: 'ses_1', delta: '你' } }
  yield { type: 'session.next.text.delta', properties: { sessionID: 'ses_1', delta: '好' } }
}

test('subscribes through official event.subscribe', async () => {
  const calls: unknown[] = []
  const received: unknown[] = []
  const client = {
    event: {
      subscribe: async (input: unknown, _opts?: unknown) => {
        calls.push(input)
        return { stream: events() }
      },
    },
  } as any

  const subscription = await subscribeOpenCodeEvents(client, event => received.push(event), {
    directory: '/tmp/project',
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  subscription.close()

  assert.deepEqual(calls, [{
    directory: '/tmp/project',
    workspace: undefined,
  }])
  assert.equal(received.length, 2)
})

test('notifies stream close after the event iterator completes', async () => {
  const received: unknown[] = []
  let closed = 0
  const client = {
    event: {
      subscribe: async () => ({ stream: events() }),
    },
  } as any

  const subscription = await subscribeOpenCodeEvents(client, event => received.push(event), {
    onClose: () => { closed++ },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  subscription.close()

  assert.equal(received.length, 2)
  assert.equal(closed, 1)
})

test('notifies stream errors without throwing an unhandled background error', async () => {
  let errorMessage = ''
  async function* failingEvents() {
    yield { type: 'server.connected', properties: {} }
    throw new Error('stream broke')
  }
  const client = {
    event: {
      subscribe: async () => ({ stream: failingEvents() }),
    },
  } as any

  const subscription = await subscribeOpenCodeEvents(client, () => {}, {
    onError: (error) => { errorMessage = error instanceof Error ? error.message : String(error) },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  subscription.close()

  assert.equal(errorMessage, 'stream broke')
})
