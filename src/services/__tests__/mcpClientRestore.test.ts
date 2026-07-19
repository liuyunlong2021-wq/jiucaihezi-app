import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  mcpOAuthPostAuthFailureMessage,
  McpAuthorizationRequiredError,
  restoreMcpServers,
} from '../mcpClient'

const enabledServer = {
  id: 'github',
  name: 'GitHub',
  transport: 'streamable-http' as const,
  enabled: true,
  status: 'disconnected' as const,
}

test('MCP OAuth post-auth errors distinguish a missing token from a server rejection', () => {
  assert.equal(
    mcpOAuthPostAuthFailureMessage(false),
    'GitHub 已授权，但 App 没有收到访问凭证。',
  )
  assert.equal(
    mcpOAuthPostAuthFailureMessage(true),
    'GitHub 已授权，但 GitHub MCP 拒绝了访问凭证。',
  )
})

test('MCP restore reconnects only enabled servers and exposes their tools', async () => {
  const statuses: Array<[string, string, string | undefined]> = []
  const tools: Array<[string, unknown[]]> = []

  await restoreMcpServers({
    servers: [enabledServer, { ...enabledServer, id: 'disabled', enabled: false }],
    setServerStatus: (id, status, error) => statuses.push([id, status, error]),
    setServerTools: (id, serverTools) => tools.push([id, serverTools]),
    connect: async server => [{
      name: `mcp__${server.id}__search`,
      description: '',
      inputSchema: {},
      serverId: server.id,
      originalName: 'search',
    }],
  })

  assert.deepEqual(statuses, [['github', 'connecting', undefined], ['github', 'connected', undefined]])
  assert.equal(tools.length, 1)
})

test('MCP restore marks expired OAuth credentials as requiring reconnection', async () => {
  const statuses: Array<[string, string, string | undefined]> = []

  await restoreMcpServers({
    servers: [enabledServer],
    setServerStatus: (id, status, error) => statuses.push([id, status, error]),
    setServerTools: () => undefined,
    connect: async () => { throw new McpAuthorizationRequiredError('github') },
  })

  assert.deepEqual(statuses, [
    ['github', 'connecting', undefined],
    ['github', 'error', '需要重新连接'],
  ])
})
