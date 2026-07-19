import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clearMcpOAuthCredentialCache,
  getMcpOAuthCredentialCache,
  setMcpOAuthCredentialCache,
} from '../mcpOAuthCredentialCache'

test('MCP OAuth credential cache makes a newly connected client see the token from this app session', () => {
  clearMcpOAuthCredentialCache('github')
  const credential = { tokens: { access_token: 'token', token_type: 'bearer' } }

  setMcpOAuthCredentialCache('github', credential)

  assert.deepEqual(getMcpOAuthCredentialCache<typeof credential>('github'), credential)
  clearMcpOAuthCredentialCache('github')
})
