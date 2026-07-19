import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/components/mcp/McpManagerPanel.vue'), 'utf8')

test('MCP manager provides a validated add-and-connect form for custom MCP servers', () => {
  assert.match(source, /const showAddForm = ref\(false\)/)
  assert.match(source, /async function addCustomServer\(\)/)
  assert.match(source, /new URL\(.*url.*\)/)
  assert.match(source, /\['http:', 'https:'\]\.includes/)
  assert.match(source, /const server = mcpStore\.addServer\(config\)/)
  assert.match(source, /await toggleServer\(server\)/)
  assert.match(source, /添加并连接/)
})

test('MCP manager only offers local stdio configuration in the desktop app', () => {
  assert.match(source, /isTauriRuntime/)
  assert.match(source, /v-if="isDesktopRuntime"/)
  assert.match(source, /value="streamable-http"/)
  assert.match(source, /value="sse"/)
  assert.match(source, /value="stdio"/)
})
