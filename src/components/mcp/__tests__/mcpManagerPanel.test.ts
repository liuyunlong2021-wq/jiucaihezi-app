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
  assert.match(source, /class="mcp-transport-picker"/)
  assert.match(source, /role="radiogroup"/)
  assert.match(source, /@click="newServer\.transport = 'streamable-http'"/)
  assert.match(source, /@click="newServer\.transport = 'sse'"/)
  assert.match(source, /@click="newServer\.transport = 'stdio'"/)
  assert.doesNotMatch(source, /<select v-model="newServer\.transport">/)
})

test('MCP manager keeps its add form actions at the product control height', () => {
  assert.match(source, /\.mcp-add-form-actions button \{\s+min-height: 32px;/)
  assert.match(source, /\.mcp-transport-picker button\.active/)
})
