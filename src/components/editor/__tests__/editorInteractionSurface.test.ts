import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const editorPanel = readFileSync(join(process.cwd(), 'src/components/editor/EditorPanel.vue'), 'utf8')

test('editor relies on the fixed toolbar instead of mounting a duplicate floating format menu', () => {
  assert.doesNotMatch(editorPanel, /import EditorBubbleMenu from '\.\/EditorBubbleMenu\.vue'/)
  assert.doesNotMatch(editorPanel, /<EditorBubbleMenu\b/)
})

test('editor surfaces use a Chinese context menu instead of the system menu', () => {
  assert.match(editorPanel, /function openEditorContextMenu\(event: MouseEvent\)/)
  assert.match(editorPanel, /<textarea[\s\S]*?@contextmenu\.prevent="openEditorContextMenu"/)
  assert.match(editorPanel, /<EditorContent[^>]*@contextmenu\.prevent="openEditorContextMenu"/)
  assert.match(editorPanel, /v-if="editorContextMenu\.show"/)
  assert.match(editorPanel, />剪切</)
  assert.match(editorPanel, />复制</)
  assert.match(editorPanel, />粘贴</)
  assert.match(editorPanel, /v-else-if="hasRichTextSelection"/)
  assert.match(editorPanel, />AI 润色</)
  assert.match(editorPanel, />查找替换</)
})

test('editor gives raw project text a dedicated textarea instead of parsing it as Markdown', () => {
  assert.match(editorPanel, /<textarea[\s\S]*?v-if="isPlainProjectText"/)
  assert.match(editorPanel, /v-model="plainProjectText"/)
})

test('save only targets the active dirty project session', () => {
  assert.match(editorPanel, /const canSaveActiveProjectSession = computed/)
  assert.match(editorPanel, /function saveActiveProjectSession\(\)/)
  assert.match(editorPanel, /class="ep-fmt-btn"[^>]*:disabled="!canSaveActiveProjectSession"[^>]*title="保存"/)
  assert.match(editorPanel, /<JcIcon name="save" \/>/)
})

test('project export saves the active resource before delegating to the file tree command host', () => {
  const start = editorPanel.indexOf('async function exportCurrentProjectResource')
  const end = editorPanel.indexOf('function onPlainProjectTextInput', start)
  const exportHandler = editorPanel.slice(start, end)

  assert.match(exportHandler, /await saveProjectSession\(session\.tabId\)/)
  assert.match(exportHandler, /exportProjectResourceThroughFileTree\(session\.resource\)/)
  assert.match(editorPanel, /emitEvent\('project:export-resources'/)
  assert.match(editorPanel, /@click="exportCurrentProjectResource"/)
  assert.doesNotMatch(editorPanel, /@click="exportDoc\('docx'\)"/)
})

test('editor has no legacy format-conversion export path', () => {
  assert.doesNotMatch(editorPanel, /async function exportDoc\(/)
  assert.doesNotMatch(editorPanel, /function openExportPreview\(/)
  assert.doesNotMatch(editorPanel, /function openExportOptions\(/)
  assert.doesNotMatch(editorPanel, /function performChunkedExport\(/)
  assert.doesNotMatch(editorPanel, /import\('@\/components\/editor\/editorExport'\)/)
  assert.doesNotMatch(editorPanel, /导出为 Word/)
})

test('AI export requests use the same original project resource path', () => {
  const start = editorPanel.indexOf("const offExportCurrentEditor = onEvent('export-current-editor'")
  const end = editorPanel.indexOf('// Phase 2: 从模板加载', start)
  const handler = editorPanel.slice(start, end)

  assert.match(handler, /exportProjectResourceThroughFileTree\(session\.resource\)/)
  assert.doesNotMatch(handler, /editorExport/)
})

test('the editor requests a project document instead of making an unbound draft', () => {
  assert.match(editorPanel, /function requestNewProjectDocument\(\)/)
  assert.match(editorPanel, /emitEvent\('project:new-document'\)/)
})

test('project document images enter the project resource service before the editor displays them', () => {
  const start = editorPanel.indexOf('async function insertImageFiles')
  const end = editorPanel.indexOf('const assetInput', start)
  const handler = editorPanel.slice(start, end)

  assert.match(handler, /projectFileService\.importBinary/)
  assert.match(handler, /path: projectImagePath\(file\)/)
  assert.match(handler, /if \(projectSession\?\.resource\)/)
})

test('a clean deleted project tab is removed instead of becoming a stale legacy tab', () => {
  const resourceSync = editorPanel.match(/function touchProjectSessions\(\)[\s\S]*?\n}\n\nfunction captureActiveProjectSession/)?.[0] || ''
  const resourceChange = editorPanel.match(/const offProjectResourceChanged = onProjectResourceChange\([\s\S]*?\n}\)\n/)?.[0] || ''

  assert.match(resourceSync, /const nonProjectTabs = openTabs\.value\.filter\(tab => !tab\.resource\)/)
  assert.match(resourceChange, /else if \(openTabs\.value\.length\) selectTab\(openTabs\.value\[0\]\.id\)\s+else clearEditorAfterLastTab\(\)/)
})
