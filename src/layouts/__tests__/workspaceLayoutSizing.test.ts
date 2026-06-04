import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

test('WorkspaceLayout gives every right-panel rail entry the same toggle rule', () => {
  assert.match(source, /const TOGGLEABLE_RIGHT_PANELS = new Set/)
  for (const panel of ['agents', 'vaultCreate', 'vaultWarehouse', 'tools', 'editor', 'creation', 'settings']) {
    assert.match(source, new RegExp(`'${panel}'`))
  }
  assert.match(source, /function toggleRightPanel\(mode: string\)/)
  assert.match(source, /rightPanel\.value = rightPanel\.value === mode \? '' : mode/)
})

test('WorkspaceLayout lets chat fill spare desktop width instead of leaving blank space', () => {
  assert.match(source, /ref="chatEl"/)
  assert.match(source, /ref="rightPanelEl"/)
  assert.match(source, /flexBasis: chatWidth \+ 'px'/)
  assert.match(source, /\.ws-chat\s*\{[\s\S]*flex:\s*1 1 auto;/)
  assert.doesNotMatch(source, /const CHAT_MAX/)
})

