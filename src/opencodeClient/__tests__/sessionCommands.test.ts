import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  archiveOpenCodeSession,
  compactOpenCodeSession,
  forkOpenCodeSession,
  listOpenCodeSessionDiff,
  revertOpenCodeSessionMessage,
  runOpenCodeShellCommand,
  runOpenCodeSlashCommand,
  shareOpenCodeSession,
  unshareOpenCodeSession,
  unrevertOpenCodeSession,
  waitOpenCodeSessionIdle,
} from '../sessionCommands'

test('session commands call official OpenCode SDK endpoints', async () => {
  const calls: Array<[string, unknown]> = []
  const client = {
    v2: {
      session: {
        compact: async (input: unknown) => { calls.push(['compact', input]); return {} },
        wait: async (input: unknown) => { calls.push(['wait', input]); return {} },
      },
    },
    session: {
      fork: async (input: unknown) => { calls.push(['fork', input]); return { data: { id: 'forked' } } },
      share: async (input: unknown) => { calls.push(['share', input]); return { data: { share: { url: 'https://share' } } } },
      unshare: async (input: unknown) => { calls.push(['unshare', input]); return { data: true } },
      update: async (input: unknown) => { calls.push(['update', input]); return { data: { id: 'ses' } } },
      diff: async (input: unknown) => { calls.push(['diff', input]); return { data: [{ file: 'a.ts', additions: 1, deletions: 0 }] } },
      revert: async (input: unknown) => { calls.push(['revert', input]); return { data: { ok: true } } },
      unrevert: async (input: unknown) => { calls.push(['unrevert', input]); return { data: { ok: true } } },
      command: async (input: unknown) => { calls.push(['command', input]); return { data: { ok: true } } },
      shell: async (input: unknown) => { calls.push(['shell', input]); return { data: { ok: true } } },
    },
  } as any

  assert.equal((await forkOpenCodeSession(client, { sessionID: 'ses', directory: '/repo' }) as any).id, 'forked')
  await compactOpenCodeSession(client, { sessionID: 'ses' })
  await waitOpenCodeSessionIdle(client, { sessionID: 'ses' })
  assert.equal((await shareOpenCodeSession(client, { sessionID: 'ses' }) as any).share.url, 'https://share')
  await unshareOpenCodeSession(client, { sessionID: 'ses' })
  await archiveOpenCodeSession(client, { sessionID: 'ses', archivedAt: 123 })
  assert.equal((await listOpenCodeSessionDiff(client, { sessionID: 'ses' }))[0].file, 'a.ts')
  await revertOpenCodeSessionMessage(client, { sessionID: 'ses', messageID: 'msg_1' })
  await unrevertOpenCodeSession(client, { sessionID: 'ses' })
  await runOpenCodeSlashCommand(client, { sessionID: 'ses', command: 'summarize', arguments: 'now' })
  await runOpenCodeShellCommand(client, {
    sessionID: 'ses',
    command: 'pwd',
    agent: 'build',
    model: { providerID: 'jiucaihezi', modelID: 'claude-sonnet-4-6' },
  })

  assert.deepEqual(calls.map(call => call[0]), ['fork', 'compact', 'wait', 'share', 'unshare', 'update', 'diff', 'revert', 'unrevert', 'command', 'shell'])
  assert.deepEqual(calls[5][1], { sessionID: 'ses', directory: undefined, workspace: undefined, time: { archived: 123 } })
  assert.deepEqual(calls[7][1], { sessionID: 'ses', messageID: 'msg_1' })
})

test('session commands throw OpenCode SDK error payloads', async () => {
  const client = {
    v2: {
      session: {
        compact: async () => ({ error: { message: 'compact failed' } }),
      },
    },
  } as any

  await assert.rejects(
    compactOpenCodeSession(client, { sessionID: 'ses' }),
    /compact failed/,
  )
})
