import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  __resetGatewaySessionMemoryCacheForTests,
  gatewaySessionAuthenticated,
  getGatewaySessionToken,
} from '../newApiClient'
import { textSyncClient, TextSyncError } from '../textSyncClient'

const originalFetch = globalThis.fetch
const originalLocalStorage = (globalThis as any).localStorage

afterEach(() => {
  globalThis.fetch = originalFetch
  ;(globalThis as any).localStorage = originalLocalStorage
  __resetGatewaySessionMemoryCacheForTests('')
})

test('text sync client sends the dedicated session instead of the model API key', async () => {
  __resetGatewaySessionMemoryCacheForTests('sess_sync_client_1234')
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.jiucaihezi.studio/sync/projects')
    assert.equal(new Headers(init?.headers).get('X-JC-Session'), 'sess_sync_client_1234')
    assert.equal(init?.credentials, 'include')
    return Response.json({ projects: [{ id: 'project_12345678', name: '记忆', created_at: 1, updated_at: 1, deleted_at: null }] })
  }) as typeof fetch

  const projects = await textSyncClient.listProjects()
  assert.equal(projects[0].id, 'project_12345678')
})

test('text sync client preserves revision conflicts as typed errors', async () => {
  __resetGatewaySessionMemoryCacheForTests('sess_sync_client_1234')
  globalThis.fetch = (async () => Response.json({ code: 'sync_conflict', message: '文件版本冲突' }, { status: 409 })) as typeof fetch

  await assert.rejects(
    () => textSyncClient.pushFiles('project_12345678', 'device_12345678', [{
      mutation_id: 'mutation_12345678',
      path: 'wiki/人物.md',
      operation: 'delete',
      expected_revision: 1,
    }]),
    (error: unknown) => error instanceof TextSyncError && error.status === 409 && error.code === 'sync_conflict',
  )
})

test('text sync client clears an expired session after unauthorized response', async () => {
  __resetGatewaySessionMemoryCacheForTests('sess_expired_1234')
  ;(globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
  globalThis.fetch = (async () => Response.json({ code: 'unauthorized', message: '请重新登录' }, { status: 401 })) as typeof fetch

  await assert.rejects(
    () => textSyncClient.listProjects(),
    (error: unknown) => error instanceof TextSyncError && error.status === 401,
  )
  assert.equal(getGatewaySessionToken(), '')
  assert.equal(gatewaySessionAuthenticated.value, false)
})
