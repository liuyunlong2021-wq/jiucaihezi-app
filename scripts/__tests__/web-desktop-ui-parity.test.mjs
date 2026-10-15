import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = path => readFileSync(path, 'utf8')

test('Web uses desktop semantic theme, reading surface and accessible focus', () => {
  assert.match(source('src/styles/design-tokens.css'), /--jc-surface: #FAFAFA/)
  assert.match(source('src/styles/base.css'), /:focus-visible/)
  assert.match(source('src/styles/markdown.css'), /\.md-code-wrap/)
  assert.match(source('src/components/memory/MemoryMarkdown.vue'), /IncrementalMarkdown/)
})

test('Web creation panel keeps desktop parameter controls and canvas targeting', () => {
  const panel = source('src/components/creation/CreationPanel.vue')
  assert.match(panel, /commitDurationInput/)
  assert.match(panel, /fkBillingHint/)
  assert.match(panel, /syncCanvasViewport/)
  assert.match(panel, /canvasTarget,/)
  assert.match(panel, /:disabled="m.desktopOnly"/)
  assert.match(panel, /本机 ComfyUI 仅支持桌面 App，请选择云端模型/)
  assert.match(source('src/runtime/creation/creationModelRegistry.ts'), /newapi\/yihong\//)
  assert.match(source('src/runtime/creation/creationModelRegistry.ts'), /newapi\/yuanliu\//)
})

test('Web workbench has desktop tree resizing while preserving Web conversation runtime', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /aria-label="调整文件树宽度"/)
  assert.match(workbench, /--memory-tree-width/)
  assert.match(workbench, /runMemoryChat\(/)
  assert.match(workbench, /CREATION_ROUTES/)
  assert.match(workbench, /memoryEnabled/)
  assert.match(workbench, /memoryQueryEnabled/)
  assert.match(workbench, /chat-dock-narrow \.memory-toggle-button/)
  assert.match(workbench, /aria-label="更多工具"/)
  assert.match(workbench, /:inert="!settingsOpen"/)
  assert.match(source('src/App.vue'), /<GlobalSearch \/>/)
  assert.doesNotMatch(workbench, /from ['"]@\/services\/(?:deepSeekHarness|desktopConversationRuntime)['"]/)
})

test('Web settings uses desktop category layout without native settings modules', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  assert.match(settings, /模型与服务/)
  assert.match(settings, /customProviderDraft/)
  assert.match(settings, /memory-settings-desktop/)
  assert.doesNotMatch(settings, /import .* from ['"].*(?:desktopUpdater|DesktopUpdateSettings|desktopRemote)/)
  assert.match(settings, /WebSkillPanel/)
  assert.match(settings, /<WebSkillPanel v-else-if="tab === 'skills'"/)
  assert.match(settings, /<McpManagerPanel v-else-if="tab === 'mcp'"/)
})
