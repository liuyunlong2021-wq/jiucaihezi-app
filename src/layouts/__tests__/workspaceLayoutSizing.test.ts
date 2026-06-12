import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

test('WorkspaceLayout gives every remaining right-panel rail entry the same toggle rule', () => {
  assert.match(source, /const TOGGLEABLE_RIGHT_PANELS = new Set/)
  for (const panel of ['skills', 'tools', 'mcp', 'editor', 'creation', 'settings']) {
    assert.match(source, new RegExp(`'${panel}'`))
  }
  assert.doesNotMatch(source, /'vaultCreate'/)
  assert.doesNotMatch(source, /'vaultWarehouse'/)
  assert.doesNotMatch(source, /'agents'/)
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

test('WorkspaceLayout keeps only the official Skill Manager panel visible', () => {
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')
  const globalSearchSource = readFileSync(join(process.cwd(), 'src/components/search/GlobalSearch.vue'), 'utf8')

  assert.doesNotMatch(source, /<h3>对话 Skill<\/h3>/)
  assert.doesNotMatch(source, /<h3>Skill仓库<\/h3>/)
  assert.match(source, /<CentralSkillsPanel v-if="rightPanel === 'skills' && !isWebRuntime"/)
  assert.match(source, /WEB_UNSUPPORTED_PANELS = new Set\(\['skills', 'tools', 'mcp', 'files'\]\)/)
  assert.match(source, /<McpManagerPanel v-else-if="rightPanel === 'mcp' && isMember && !isWebRuntime"/)
  assert.equal(fileTreeSource.includes("{ key: 'skill', icon: 'smart_toy', label: 'Skill' }"), false)
  assert.equal(fileTreeSource.includes("key: 'knowledge'"), false)
  assert.doesNotMatch(fileTreeSource, /offSwitchFileTreeTab[\s\S]*tab === 'skill'[\s\S]*switchTab\(tab\)/)
  assert.doesNotMatch(globalSearchSource, /useAgentStore/)
  assert.doesNotMatch(globalSearchSource, /agentStore\.agents/)
  assert.doesNotMatch(globalSearchSource, /agentStore\.selectAgent/)
  assert.doesNotMatch(globalSearchSource, /placeholder="搜索会话、知识库、Skill/)
})
