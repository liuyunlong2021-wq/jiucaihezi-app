import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const CHECKED_FILES = [
  'src/layouts/WorkspaceLayout.vue',
  'src/components/filetree/FileTreePanel.vue',
  'src/components/chat/ChatPanel.vue',
  'src/components/editor/EditorPanel.vue',
  'src/components/canvas/CanvasWorkspace.vue',
  'src/components/canvas/CanvasToolbar.vue',
  'src/stores/canvasStore.ts',
]

test('dangerous UI actions use confirmAction instead of native confirm', () => {
  for (const file of CHECKED_FILES) {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    assert.equal(source.includes('window.confirm'), false, file)
    assert.equal(/(?<![.\w])confirm\s*\(/.test(source), false, file)
  }
})
