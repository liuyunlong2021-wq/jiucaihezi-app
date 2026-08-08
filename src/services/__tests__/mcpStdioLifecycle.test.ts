import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const client = readFileSync(join(process.cwd(), 'src/services/mcpClient.ts'), 'utf8')
const transport = readFileSync(join(process.cwd(), 'src/services/mcpStdioTransport.ts'), 'utf8')
const store = readFileSync(join(process.cwd(), 'src/stores/mcpStore.ts'), 'utf8')
const sdkClient = readFileSync(join(process.cwd(), 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'), 'utf8')

test('stdio MCP uses the node tsx entrypoint and protocol timeouts', () => {
  assert.match(client, /tsx\\\/dist\\\/cli\\\.mjs/)
  assert.match(client, /timeout: STDIO_TIMEOUT/)
  assert.match(client, /timeout: TOOL_TIMEOUT/)
  assert.match(sdkClient, /method: 'notifications\/initialized'/)
})

test('stdio transport separates diagnostics from JSON-RPC stdout', () => {
  assert.match(transport, /onStderr: stderr/)
  assert.match(transport, /onExit: exit/)
  assert.match(transport, /JSON\.parse\(raw\)/)
  assert.match(transport, /diagnostics\(\)/)
})

test('failed MCP status cannot retain an old tool list', () => {
  assert.match(store, /if \(status !== 'connected'\)/)
})

test('MCP tool calls use the tools/call method through the SDK', () => {
  assert.match(client, /conn\.client\.callTool\(/)
  assert.match(client, /timeout: TOOL_TIMEOUT/)
})
