import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  consumeMcpOAuthCallbackUrl,
  prepareMcpOAuthIntent,
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
