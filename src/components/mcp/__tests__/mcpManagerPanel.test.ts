import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/components/mcp/McpManagerPanel.vue'), 'utf8')
const catalogSource = readFileSync(join(process.cwd(), 'src/data/mcpCatalog.ts'), 'utf8')
const toolCommandSource = readFileSync(join(process.cwd(), 'src-tauri/src/commands/tools.rs'), 'utf8')
const mcpCommandSource = readFileSync(join(process.cwd(), 'src-tauri/src/commands/mcp.rs'), 'utf8')
const tauriLibSource = readFileSync(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8')
const capabilitySource = readFileSync(join(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf8')
const appPermissionSource = readFileSync(join(process.cwd(), 'src-tauri/permissions/app-commands.json'), 'utf8')

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

test('MCP catalog ships Playwright as a pinned desktop stdio server', () => {
  assert.match(catalogSource, /id: 'playwright'/)
  assert.match(catalogSource, /transport: 'stdio'/)
  assert.match(catalogSource, /command: 'npx'/)
  assert.match(catalogSource, /args: \['-y', '@playwright\/mcp@0\.0\.79'\]/)
  assert.match(source, /entry\.transport === 'stdio' && !isDesktopRuntime/)
})

test('predefined local MCP connects directly and explains a missing Node runtime', () => {
  assert.match(source, /entry\.transport === 'stdio' && entry\.command/)
  assert.match(source, /await toggleServer\(server\)/)
  assert.match(source, /https:\/\/nodejs\.org\/zh-cn\/download/)
  assert.match(source, /下载 Node\.js/)
  assert.match(source, /重新检测并连接/)
  assert.match(source, /!\/plugin not found\/i\.test/)
  assert.match(source, /openExternal\('https:\/\/nodejs\.org\/zh-cn\/download'\)/)
})

test('Windows resolves and launches the npx command shim', () => {
  assert.match(toolCommandSource, /npx\.cmd/)
  assert.match(toolCommandSource, /ProgramFiles/)
  assert.match(mcpCommandSource, /cmd\.exe/)
  assert.match(mcpCommandSource, /\/C/)
})

test('Tauri development URL receives every registered app command', () => {
  assert.match(capabilitySource, /"remote"\s*:\s*\{\s*"urls"\s*:\s*\["http:\/\/localhost:1420\/\*"\]/)
  assert.match(capabilitySource, /"allow-app-commands"/)

  const handlerBody = tauriLibSource.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] || ''
  const registeredCommands = [...handlerBody.matchAll(/(?:[A-Za-z_][\w]*::)*([A-Za-z_][\w]*)\s*,/g)]
    .map(match => match[1])
    .sort()
  const appPermission = JSON.parse(appPermissionSource)
  const allowedCommands = appPermission.permission
    .find((permission: { identifier: string }) => permission.identifier === 'allow-app-commands')
    .commands.allow
    .sort()

  assert.deepEqual(allowedCommands, registeredCommands)
})
