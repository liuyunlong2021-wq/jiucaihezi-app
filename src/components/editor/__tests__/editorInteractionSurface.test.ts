import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const editorPanel = readFileSync(join(process.cwd(), 'src/components/editor/EditorPanel.vue'), 'utf8')

test('editor relies on the fixed toolbar instead of mounting a duplicate floating format menu', () => {
  assert.doesNotMatch(editorPanel, /import EditorBubbleMenu from '\.\/EditorBubbleMenu\.vue'/)
  assert.doesNotMatch(editorPanel, /<EditorBubbleMenu\b/)
})

test('editor content suppresses the untranslated native context menu', () => {
  assert.match(editorPanel, /<EditorContent[^>]*@contextmenu\.prevent/)
})

test('a clean deleted project tab is removed instead of becoming a stale legacy tab', () => {
  const resourceSync = editorPanel.match(/function touchProjectSessions\(\)[\s\S]*?\n}\n\nfunction captureActiveProjectSession/)?.[0] || ''
  const resourceChange = editorPanel.match(/const offProjectResourceChanged = onProjectResourceChange\([\s\S]*?\n}\)\n/)?.[0] || ''

  assert.match(resourceSync, /const nonProjectTabs = openTabs\.value\.filter\(tab => !tab\.resource\)/)
  assert.match(resourceChange, /else if \(openTabs\.value\.length\) selectTab\(openTabs\.value\[0\]\.id\)\s+else clearEditorAfterLastTab\(\)/)
})
