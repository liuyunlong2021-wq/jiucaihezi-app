import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationUi } from '../../src-tauri/resources/deepseek-harness/conversation-ui.mjs'

function fixture(backing = new Map()) {
  const log = []
  const rows = new Map([
    ['jc-v1-old', { id: 'jc-v1-old', cwd: '/project', createdAt: 1 }],
    ['native-id', { id: 'native-id', cwd: '/project', createdAt: 2 }],
    ['jc-v1-child', { id: 'jc-v1-child', cwd: '/project', createdAt: 3, origin: 'subagent' }],
    ['jc-v1-other', { id: 'jc-v1-other', cwd: '/other', createdAt: 4 }],
  ])
  const titles = new Map()
  const table = { entries: () => backing.entries(), get: id => backing.get(id),
    put: async (id, value) => { backing.set(id, value) },
    update: async (id, change) => { if (!backing.has(id)) throw new Error('missing-key'); backing.set(id, change(backing.get(id))) } }
  const agents = new Map()
  const activate = async id => { log.push('activate'); if (!rows.has(id)) rows.set(id, { id, cwd: '/project', createdAt: 6 }); const agent = { session: { header: rows.get(id), id } }; agents.set(id, agent); return { agent, dispose: async () => {} } }
  const ctx = {
    agents: { get: id => agents.get(id), create: async options => activate(options.sessionId), resume: async options => activate(options.resumeSessionId) },
    storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    sessionQuery: {
      listSessions: async () => [...rows.values()].map(header => ({ header, persisted: true })),
      readTitleSnapshots: async ids => ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { title: titles.get(sessionId) } })),
      readTitleSnapshot: async id => ({ title: titles.get(id) }),
    },
    sessionTitle: { rename: (session, title) => { log.push('rename'); titles.set(session.id, { title, source: { kind: 'user' }, updatedAt: 5 }) } },
    sessions: { flush: async () => { log.push('flush') } },
  }
  const server = { ctx, cwd: '/project', disposers: [],
    getOrCreateSession: async id => { log.push('activate'); if (!rows.has(id)) rows.set(id, { id, cwd: '/project', createdAt: 6 }); return { handle: { agent: { session: rows.get(id) } } } },
    assertLiveAgent: () => {},
  }
  const sessionList = { list: async () => [...rows.values()].map(row => ({ ...row, sessionId: row.id, updatedAt: row.createdAt })) }
  return { request: createConversationUi(server, { sessionList }), rows, titles, log, backing }
}

test('official session discovery works with no browser catalog and never activates an Agent', async () => {
  const f = fixture()
  const result = await f.request({ action: 'list' })
  assert.deepEqual(result.entries.map(row => row.sessionId), ['jc-v1-old', 'native-id'])
  assert.deepEqual(f.log, [])
  assert.equal(result.entries[1].conversationId, 'native-id')
})

test('native IDs and old prefixed IDs stay distinct even when their aliases collide', async () => {
  const f = fixture()
  f.rows.set('old', { id: 'old', cwd: '/project', createdAt: 7 })
  const entries = (await f.request({ action: 'list' })).entries
  assert.equal(new Set(entries.map(row => row.conversationId)).size, entries.length)
  await f.request({ action: 'rename', conversationId: 'old', title: 'native' })
  assert.equal(f.titles.get('old').title, 'native')
  assert.equal(f.titles.has('jc-v1-old'), false)
})

test('new chats, rename and logical deletion use official persistence and survive UI restarts', async () => {
  const f = fixture()
  await f.request({ action: 'create', conversationId: 'new' })
  assert.ok(f.rows.has('jc-v1-new'))
  assert.ok(f.log.includes('flush'))
  await f.request({ action: 'rename', conversationId: 'old', title: 'kept title' })
  assert.equal((await f.request({ action: 'list' })).entries[0].title, 'kept title')
  await f.request({ action: 'hide', conversationId: 'old' })
  assert.ok(!(await fixture(f.backing).request({ action: 'list' })).entries.some(row => row.conversationId === 'old'))
  assert.equal(f.rows.size, 5, 'hiding must not delete any official logs or project assets')
})

test('legacy preference imports cannot replace official user titles, recent preferences or hidden state', async () => {
  const f = fixture()
  await f.request({ action: 'rename', conversationId: 'old', title: 'official title' })
  await f.request({ action: 'preferences', conversationId: 'old', preferences: { manju: { enabled: false } } })
  await f.request({ action: 'hide', conversationId: 'old' })
  await f.request({ action: 'import', entries: [{ workspaceKey: '/project', conversationId: 'old', title: 'stale title', manju: { enabled: true } }] })
  assert.equal(f.titles.get('jc-v1-old').title, 'official title')
  assert.equal(f.backing.get('jc-v1-old').manju.enabled, false)
  assert.equal(f.backing.get('jc-v1-old').hidden, true)
})

test('real SDK lists, creates, renames and hides sessions across restarts with no API key or model request', { timeout: 60_000 }, async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { DeepSeekHarness } = await import('../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')
  const root = mkdtempSync(join(tmpdir(), 'jc-official-session-ui-'))
  const patch = join(root, 'route.yml')
  writeFileSync(patch, '- id: llm-pi-ai\n  config:\n    providers:\n      jiucaihezi:\n        apiKeyEnv: JIUCAIHEZI_DH_API_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:1/v1\n        models:\n          - id: offline\n            name: offline\n            contextWindow: 262144\n            maxTokens: 1024\n')
  const options = { cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch], provider: 'jiucaihezi', model: 'offline',
    env: { ...process.env, DSH_AGENTS_HOME: join(root, 'agents'), DSH_PRIMARY_RUNTIME: '', JIUCAIHEZI_DH_API_KEY: '', DSH_TELEMETRY_MODE: 'DISABLED' } }
  let harness = new DeepSeekHarness(options)
  t.after(async () => { await harness.close(); rmSync(root, { recursive: true, force: true }) })
  const request = params => harness.client.request('session/ui', { provider: 'jiucaihezi', model: 'offline', ...params })
  assert.equal((await request({ action: 'list' })).entries.length, 0)
  const created = await request({ action: 'create', conversationId: 'offline-chat' })
  assert.equal(created.entries[0].sessionId, 'jc-v1-offline-chat')
  await request({ action: 'rename', conversationId: 'offline-chat', title: '持久标题' })
  await request({ action: 'preferences', conversationId: 'offline-chat', preferences: { manju: { enabled: true } } })
  await harness.close(); harness = new DeepSeekHarness(options)
  const restored = (await request({ action: 'list' })).entries[0]
  assert.equal(restored.title, '持久标题')
  assert.deepEqual(restored.manju, { enabled: true })
  const snapshot = await harness.client.request('session/read', { sessionId: 'jc-v1-offline-chat' })
  assert.ok(snapshot.events.some(event => event.type === 'session/title' && event.data.title === '持久标题'))
  assert.ok(!snapshot.events.some(event => event.type === 'user/message' || event.type === 'llm/request'))
  await request({ action: 'hide', conversationId: 'offline-chat' })
  await harness.close(); harness = new DeepSeekHarness(options)
  assert.equal((await request({ action: 'list' })).entries.length, 0)
  assert.ok((await harness.client.request('session/list', {})).some(row => row.header.id === 'jc-v1-offline-chat'))
})
