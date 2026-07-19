import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  consumeMcpOAuthCallbackUrl,
  getPendingMcpOAuthCodeVerifier,
  prepareMcpOAuthIntent,
  saveMcpOAuthCodeVerifier,
} from '../mcpOAuth'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => Array.from(data.keys())[index] ?? null,
    removeItem: key => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

test('MCP OAuth callback accepts only the pending server and state', () => {
  const storage = createMemoryStorage()
  const state = prepareMcpOAuthIntent('github', storage)

  assert.deepEqual(
    consumeMcpOAuthCallbackUrl({
      href: `jiucaihezi://mcp/oauth/callback?server=github&code=oauth-code&state=${state}`,
      storage,
    }),
    { serverId: 'github', code: 'oauth-code' },
  )
})

test('MCP OAuth callback rejects a code for a different server', () => {
  const storage = createMemoryStorage()
  const state = prepareMcpOAuthIntent('github', storage)

  assert.equal(
    consumeMcpOAuthCallbackUrl({
      href: `jiucaihezi://mcp/oauth/callback?server=notion&code=oauth-code&state=${state}`,
      storage,
    }),
    null,
  )
})

test('MCP OAuth callback preserves a matching authorization denial', () => {
  const storage = createMemoryStorage()
  const state = prepareMcpOAuthIntent('github', storage)

  assert.deepEqual(
    consumeMcpOAuthCallbackUrl({
      href: `jiucaihezi://mcp/oauth/callback?server=github&error=access_denied&error_description=cancelled&state=${state}`,
      storage,
    }),
    { serverId: 'github', error: 'access_denied', errorDescription: 'cancelled' },
  )
})

test('MCP OAuth keeps the PKCE verifier until the matching callback completes', () => {
  const storage = createMemoryStorage()
  const state = prepareMcpOAuthIntent('github', storage)
  saveMcpOAuthCodeVerifier('github', 'pkce-verifier', storage)

  assert.deepEqual(
    consumeMcpOAuthCallbackUrl({
      href: `jiucaihezi://mcp/oauth/callback?server=github&code=oauth-code&state=${state}`,
      storage,
    }),
    { serverId: 'github', code: 'oauth-code' },
  )
  assert.equal(getPendingMcpOAuthCodeVerifier('github', storage), 'pkce-verifier')
})
