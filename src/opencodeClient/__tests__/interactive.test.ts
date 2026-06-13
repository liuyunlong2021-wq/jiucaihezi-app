import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
} from '../interactive'

test('prefers the server-supported official permission endpoint over stale generated v2 paths', async () => {
  const calls: Array<[string, unknown]> = []
  const client = {
    v2: {
      session: {
        permission: {
          reply: async (input: unknown) => {
            calls.push(['stale-v2', input])
            return { data: true }
          },
        },
      },
    },
    permission: {
      reply: async (input: unknown) => {
        calls.push(['legacy', input])
        return { data: true }
      },
    },
  } as any

  await replyOpenCodePermission(client, {
    sessionID: 'ses_123',
    requestID: 'req_456',
    reply: 'once',
    directory: '/repo',
  })

  assert.deepEqual(calls, [['legacy', {
    requestID: 'req_456',
    directory: '/repo',
    workspace: undefined,
    reply: 'once',
  }]])
})

test('falls back to generated v2 permission reply when legacy endpoint is unavailable', async () => {
  const calls: unknown[] = []
  const client = {
    v2: {
      session: {
        permission: {
          reply: async (input: unknown) => {
            calls.push(input)
            return { data: true }
          },
        },
      },
    },
  } as any

  await replyOpenCodePermission(client, {
    sessionID: 'ses_123',
    requestID: 'req_456',
    reply: 'once',
    directory: '/repo',
  })

  assert.deepEqual(calls, [{
    sessionID: 'ses_123',
    requestID: 'req_456',
    reply: 'once',
  }])
})

test('falls back to legacy permission reply when v2 session endpoint is unavailable', async () => {
  const calls: unknown[] = []
  const client = {
    permission: {
      reply: async (input: unknown) => {
        calls.push(input)
        return { data: true }
      },
    },
  } as any

  await replyOpenCodePermission(client, {
    sessionID: 'ses_123',
    requestID: 'req_456',
    reply: 'always',
    directory: '/repo',
    workspace: 'main',
  })

  assert.deepEqual(calls, [{
    requestID: 'req_456',
    directory: '/repo',
    workspace: 'main',
    reply: 'always',
  }])
})

test('throws OpenCode permission error payloads instead of treating them as success', async () => {
  const client = {
    permission: {
      reply: async () => ({
        error: {
          message: 'Permission request not found: per_missing',
        },
      }),
    },
  } as any

  await assert.rejects(
    replyOpenCodePermission(client, {
      sessionID: 'ses_123',
      requestID: 'per_missing',
      reply: 'once',
    }),
    /Permission request not found/,
  )
})

test('prefers server-supported official question endpoints over stale generated v2 paths', async () => {
  const calls: Array<[string, unknown]> = []
  const client = {
    v2: {
      session: {
        question: {
          reply: async (input: unknown) => {
            calls.push(['stale-v2-reply', input])
            return { data: true }
          },
          reject: async (input: unknown) => {
            calls.push(['stale-v2-reject', input])
            return { data: true }
          },
        },
      },
    },
    question: {
      reply: async (input: unknown) => {
        calls.push(['legacy-reply', input])
        return { data: true }
      },
      reject: async (input: unknown) => {
        calls.push(['legacy-reject', input])
        return { data: true }
      },
    },
  } as any

  await replyOpenCodeQuestion(client, {
    sessionID: 'ses_123',
    requestID: 'req_456',
    answers: [['yes']],
    directory: '/repo',
  })
  await rejectOpenCodeQuestion(client, {
    sessionID: 'ses_123',
    requestID: 'req_789',
    directory: '/repo',
  })

  assert.deepEqual(calls, [
    ['legacy-reply', {
      requestID: 'req_456',
      directory: '/repo',
      workspace: undefined,
      answers: [['yes']],
    }],
    ['legacy-reject', {
      requestID: 'req_789',
      directory: '/repo',
      workspace: undefined,
    }],
  ])
})
