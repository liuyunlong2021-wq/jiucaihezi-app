import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

test('WorkspaceLayout toggles only the current right-panel rail entries', () => {
  assert.match(source, /const TOGGLEABLE_RIGHT_PANELS = new Set\(\['editor', 'creation', 'settings'\]\)/)
  assert.match(source, /function toggleRightPanel\(mode: string\)/)
  assert.match(source, /rightPanel\.value = rightPanel\.value === mode \? '' : mode/)
})

test('WorkspaceLayout lets chat fill spare desktop width instead of leaving blank space', () => {
  assert.match(source, /\.ws-chat\s*\{[\s\S]*flex:\s*1 1 auto;/)
  assert.doesNotMatch(source, /const CHAT_MAX/)
})

test('right divider keeps its drag target out of the chat scrollbar gutter', () => {
  assert.doesNotMatch(source, /onResizeStart\(\$event, 'chat-right'\)/)
  assert.match(source, /onResizeStart\(\$event, 'right-edge'\)/)
  assert.match(source, /\.ws-resize-right\s*\{\s*right:\s*auto;\s*left:\s*0;\s*width:\s*14px;/)
  assert.match(source, /\.ws-resize-right::after\s*\{\s*left:\s*0;/)
  assert.match(source, /\.ws-right-collapse\s*\{[\s\S]*z-index:\s*31;/)
})

test('WorkspaceLayout keeps the creation panel mounted as right-panel content', () => {
  assert.match(source, /<CreationPanel v-if="creationMounted" v-show="rightPanel === 'creation' && creationEnabled" \/>/)
  assert.doesNotMatch(source, /<[^>]+class="ws-creation-stage"/)
})

test('SettingsPanel owns Skill management after it left WorkspaceLayout', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')
  const globalSearchSource = readFileSync(join(process.cwd(), 'src/components/search/GlobalSearch.vue'), 'utf8')

  assert.doesNotMatch(source, /CentralSkillsPanel|WebSkillPanel|ReviewPanel/)
  assert.match(settingsSource, /<CentralSkillsPanel v-if="!isWebRuntime" \/>/)
  assert.match(settingsSource, /<WebSkillPanel v-else \/>/)
  assert.match(settingsSource, /<ReviewPanel \/>/)
  assert.equal(fileTreeSource.includes("{ key: 'skill', icon: 'smart_toy', label: 'Skill' }"), false)
  assert.equal(fileTreeSource.includes("key: 'knowledge'"), false)
  assert.doesNotMatch(fileTreeSource, /offSwitchFileTreeTab[\s\S]*tab === 'skill'[\s\S]*switchTab\(tab\)/)
  assert.doesNotMatch(globalSearchSource, /useAgentStore/)
  assert.doesNotMatch(globalSearchSource, /agentStore\.agents/)
  assert.doesNotMatch(globalSearchSource, /agentStore\.selectAgent/)
  assert.doesNotMatch(globalSearchSource, /placeholder="搜索会话、知识库、Skill/)
})

test('WorkspaceLayout only blocks unavailable Web rail panels', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.match(source, /WEB_UNSUPPORTED_PANELS = new Set\(\['files', 'context'\]\)/)
  assert.doesNotMatch(source, /rightPanel === 'review'/)
  assert.match(settingsSource, /<div v-if="!isWebRuntime" class="sp-section">\s*<div class="sp-section-title">变更审查<\/div>/)
})
