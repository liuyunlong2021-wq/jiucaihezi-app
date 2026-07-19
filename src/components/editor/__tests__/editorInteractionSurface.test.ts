import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const editorPanel = readFileSync(join(process.cwd(), 'src/components/editor/EditorPanel.vue'), 'utf8')

test('editor relies on the fixed toolbar instead of mounting a duplicate floating format menu', () => {
  assert.doesNotMatch(editorPanel, /import EditorBubbleMenu from '\.\/EditorBubbleMenu\.vue'/)
  assert.doesNotMatch(editorPanel, /<EditorBubbleMenu\b/)
})

test('editor content leaves the native context menu available until a custom menu exists', () => {
  assert.doesNotMatch(editorPanel, /<EditorContent[^>]*@contextmenu\.prevent/)
})

test('editor gives raw project text a dedicated textarea instead of parsing it as Markdown', () => {
  assert.match(editorPanel, /<textarea\s+v-if="isPlainProjectText"/)
  assert.match(editorPanel, /v-model="plainProjectText"/)
})

test('save all uses the themed icon-button contract and only enables with saveable sessions', () => {
  assert.match(editorPanel, /class="ep-fmt-btn"[^>]*:disabled="!hasSaveableProjectChanges"[^>]*title="全部保存"/)
  assert.match(editorPanel, /<JcIcon name="save" \/>/)
})

test('export is a stable submenu inside the more-menu instead of closing its own trigger', () => {
  assert.match(editorPanel, /function toggleExportMenu\(\)/)
  assert.match(editorPanel, /@click="toggleExportMenu"/)
  assert.match(editorPanel, /class="ep-more-submenu"/)
})

test('the editor requests a project document instead of making an unbound draft', () => {
  assert.match(editorPanel, /function requestNewProjectDocument\(\)/)
  assert.match(editorPanel, /emitEvent\('project:new-document'\)/)
})

test('plain project text exports from its raw buffer instead of a Markdown-parsed Tiptap document', () => {
  const exportHandler = editorPanel.match(/async function exportDoc[\s\S]*?\n}\n\nasync function openLastExportedFile/)?.[0] || ''

  assert.match(exportHandler, /const rawText = isPlainProjectText\.value ? plainProjectText\.value : undefined/)
  assert.match(exportHandler, /rawText,/)
})

test('a clean deleted project tab is removed instead of becoming a stale legacy tab', () => {
  const resourceSync = editorPanel.match(/function touchProjectSessions\(\)[\s\S]*?\n}\n\nfunction captureActiveProjectSession/)?.[0] || ''
  const resourceChange = editorPanel.match(/const offProjectResourceChanged = onProjectResourceChange\([\s\S]*?\n}\)\n/)?.[0] || ''

  assert.match(resourceSync, /const nonProjectTabs = openTabs\.value\.filter\(tab => !tab\.resource\)/)
  assert.match(resourceChange, /else if \(openTabs\.value\.length\) selectTab\(openTabs\.value\[0\]\.id\)\s+else clearEditorAfterLastTab\(\)/)
})
